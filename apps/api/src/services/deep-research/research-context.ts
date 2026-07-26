/**
 * ============================================================
 * 딥리서치 컨텍스트 — 스킬 지식 + MCP 도구 근거 수집
 * ============================================================
 *
 * 딥리서치는 웹검색·스크래핑 전용 결정적 파이프라인이라 **MCP 도구도 스킬도
 * 전달되지 않았다**(2026-07-26 점검). 채팅·에이전트 작업은 둘 다 쓰는데 리서치만
 * 사내 데이터·전문 지식에 접근할 수 없었다.
 *
 * 이 모듈이 두 가지를 붙인다:
 *   ① 스킬 지식 — 활성 스킬 매니페스트를 프롬프트 앞에 주입 (분해·합성·보고서)
 *   ② MCP 근거 — 도구를 1회 호출해 얻은 결과를 SearchResult 로 변환, 웹 소스와
 *      동일하게 합성·인용 파이프라인에 태운다
 *
 * 도구폭주 방지: 전체 카탈로그(~150)를 넘기면 vLLM 문법 컴파일이 폭주한다(실측
 * 101s). 목표 관련성 top-K 로 캡하고 턴 수도 제한한다.
 *
 * @module services/deep-research/research-context
 */
import type { LLMClient, ToolDefinition } from '../../llm';
import type { SearchResult } from '../../mcp/web-search';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import { getSkillManager } from '../../agents/skill-manager';
import { selectRelevantToolsEmbedding } from '../agent-task/tool-selector-embedding';
import { filterRestrictedTools } from '../chat-service/tool-restrictions';
import { RESEARCH_CONTEXT } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('DeepResearch:Context');

/**
 * 딥리서치의 스킬 스코프 sentinel — 산업 agent 페르소나를 우회하므로
 * `__global__` + `user:{userId}` 스킬만 매칭된다 (agent-task 의 `__agent_task__` 관행).
 */
export const RESEARCH_SKILL_AGENT_ID = '__deep_research__';

/** MCP 도구 결과를 소스로 표시할 때 쓰는 스킴 — 스크래핑 대상에서 제외된다. */
export const MCP_SOURCE_SCHEME = 'mcp://';

/**
 * 활성 스킬 지식 블록. 실패/부재 시 '' — 리서치 흐름을 막지 않는다.
 */
export async function buildResearchSkillBlock(userId?: string): Promise<string> {
    if (!userId || userId === 'guest') return '';
    try {
        const block = await getSkillManager().buildManifestPrompt(RESEARCH_SKILL_AGENT_ID, userId);
        if (block) logger.info('[DeepResearch] 스킬 지식 주입');
        return block ?? '';
    } catch (e) {
        logger.debug(`스킬 주입 실패 — 무시: ${e instanceof Error ? e.message : e}`);
        return '';
    }
}

/** 프롬프트 앞에 스킬 블록을 붙인다 (블록이 비면 원본 그대로). */
export function withSkillContext(prompt: string, skillBlock: string): string {
    return skillBlock ? `${skillBlock}\n\n---\n\n${prompt}` : prompt;
}

/**
 * MCP 도구로 추가 근거를 수집해 SearchResult 로 변환한다.
 *
 * 웹으로는 닿지 않는 자료(사내 DB·노트북·설치한 MCP 서버)를 리서치에 포함시키는 것이
 * 목적이다. 실패·미지원·도구 없음은 모두 빈 배열 — 리서치 본류를 막지 않는다.
 */
export async function gatherMcpEvidence(params: {
    client: LLMClient;
    topic: string;
    userId?: string;
    userRole?: 'admin' | 'user' | 'guest';
    abortSignal?: AbortSignal;
}): Promise<SearchResult[]> {
    const { client, topic, userId, userRole, abortSignal } = params;
    if (!RESEARCH_CONTEXT.MCP_EVIDENCE_ENABLED) return [];
    if (!userId || userId === 'guest') return [];

    let tools: ToolDefinition[] = [];
    try {
        const all = filterRestrictedTools(
            (await getUnifiedMCPClient().getToolRouter().getLLMTools({ userId })) as unknown as ToolDefinition[],
            userRole ?? 'user',
        );
        // 목표 관련성 top-K 만 — 전체 카탈로그 전달은 문법 컴파일 폭주를 유발한다.
        tools = await selectRelevantToolsEmbedding(topic, all, {
            budget: RESEARCH_CONTEXT.MCP_TOOL_BUDGET,
            exclude: new Set(RESEARCH_CONTEXT.MCP_EXCLUDED_TOOLS),
        });
    } catch (e) {
        logger.debug(`도구 선별 실패 — MCP 근거 수집 생략: ${e instanceof Error ? e.message : e}`);
        return [];
    }
    if (tools.length === 0) return [];

    logger.info(
        `[DeepResearch] MCP 근거 수집 — 관련 도구 ${tools.length}종: `
        + tools.map((t) => t.function.name).join(', '),
    );

    try {
        const response = await client.chat(
            [
                {
                    role: 'system',
                    content:
                        '너는 리서치 근거 수집 보조자다. 주어진 도구들은 **웹 검색으로는 접근할 수 없는 '
                        + '내부 데이터**(사내 DB·노트북·설치된 MCP 서버 자료)에 닿는 통로다. '
                        + '리서치 주제가 내부 시스템·자체 데이터·특정 문서를 가리키면 해당 도구를 '
                        + '적극적으로 호출해 근거를 수집하라. '
                        + '웹 검색은 파이프라인이 이미 수행하므로, 공개 웹에서 쉽게 찾을 수 있는 일반 정보만 '
                        + '필요한 주제라면 도구를 호출하지 말고 빈 답을 내라.',
                },
                { role: 'user', content: `리서치 주제: ${topic}` },
            ],
            { num_predict: RESEARCH_CONTEXT.MCP_MAX_TOKENS },
            undefined,
            { tools, tool_choice: 'auto', think: false, ...(abortSignal ? { signal: abortSignal } : {}) },
        );

        const calls = response.tool_calls ?? [];
        if (calls.length === 0) {
            logger.info('[DeepResearch] MCP 도구 호출 없음 — 웹 소스만 사용');
            return [];
        }

        const results: SearchResult[] = [];
        const mcp = getUnifiedMCPClient();
        for (const [i, call] of calls.slice(0, RESEARCH_CONTEXT.MCP_MAX_CALLS).entries()) {
            const name = call.function.name;
            try {
                const out = await mcp.executeToolWithContext(
                    name,
                    (call.function.arguments ?? {}) as Record<string, unknown>,
                    { userId, role: userRole ?? 'user' },
                );
                // MCPToolResult → 텍스트 (content 배열의 text 파트 결합)
                const text = (out.content ?? [])
                    .map((c) => (typeof c === 'object' && c && 'text' in c ? String((c as { text?: unknown }).text ?? '') : ''))
                    .join('\n')
                    .trim();
                if (!text || text.length < RESEARCH_CONTEXT.MCP_MIN_RESULT_CHARS) continue;
                results.push({
                    title: `MCP 도구 결과: ${name}`,
                    // 스크래핑 대상에서 제외되도록 별도 스킴을 쓴다 (호출자가 scrapedUrls 에 등록)
                    url: `${MCP_SOURCE_SCHEME}${name}/${i + 1}`,
                    snippet: text.slice(0, 300),
                    fullContent: text.slice(0, RESEARCH_CONTEXT.MCP_RESULT_CHAR_CAP),
                    source: `mcp/${name}`,
                });
                logger.info(`[DeepResearch] MCP 근거 확보: ${name} (${text.length}자)`);
            } catch (e) {
                logger.warn(`[DeepResearch] MCP 도구 '${name}' 실행 실패 — 건너뜀: ${e instanceof Error ? e.message : e}`);
            }
        }
        return results;
    } catch (e) {
        logger.warn(`[DeepResearch] MCP 근거 수집 실패 — 웹 소스로 계속: ${e instanceof Error ? e.message : e}`);
        return [];
    }
}
