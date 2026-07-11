/**
 * Agent Task 스텝 영속·도구 실행 결과 처리 — AgentTaskService 에서 분리 (파일 크기 가드).
 * @module services/agent-task/task-steps
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import type { UserContext } from '../../mcp/user-sandbox';
import type { ExtractedArtifact } from '../../llm/artifact-parser';
import { MAX_TOOL_RESULT_CHARS, AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskService');

/** tool name 이 검색/정보수집류인지 (키워드 포함 여부) — 검색 폭주 하드 제한용 */
export function isSearchTool(name: string): boolean {
    const n = name.toLowerCase();
    return AGENT_TASK_LIMITS.SEARCH_TOOL_KEYWORDS.some((k) => n.includes(k));
}

/**
 * 최종 답변에서 추출한 deliverable 아티팩트를 step_type='artifact' 행으로 영속화.
 * content 는 ExtractedArtifact JSON (id/kind/title/lang/content) — 프론트 상세 모달이 파싱해 렌더.
 * 저장 실패는 작업을 실패시키지 않는다 (result 본문은 이미 보존됨).
 */
export async function persistArtifactSteps(
    taskId: string,
    artifacts: ExtractedArtifact[],
    stepNumber: number
): Promise<number> {
    const db = getUnifiedDatabase();
    for (const artifact of artifacts) {
        try {
            await db.addAgentTaskStep({
                taskId,
                stepNumber: stepNumber++,
                stepType: 'artifact',
                toolName: artifact.kind,
                content: JSON.stringify(artifact),
            });
        } catch (e) {
            logger.warn(`[AgentTask] 아티팩트 스텝 저장 실패: ${taskId} — ${e}`);
        }
    }
    return stepNumber;
}

/** 단일 도구 실행 — sandbox 는 executeToolWithContext 가 처리. 실패는 문자열로 흡수 */
export async function runTool(
    mcp: ReturnType<typeof getUnifiedMCPClient>,
    name: string,
    args: Record<string, unknown>,
    userCtx: UserContext,
): Promise<string> {
    try {
        const r = await mcp.executeToolWithContext(name, args, userCtx);
        // 문자열/JSON 양쪽 모두 캡 적용 — 대형 결과가 통째로 대화에 들어가면
        // 컨텍스트·체크포인트가 부풀어 token_limit abort 로 작업이 실패한다.
        const raw = typeof r.content === 'string' ? r.content : JSON.stringify(r.content);
        const text = raw.length > MAX_TOOL_RESULT_CHARS
            ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + '\n...[결과가 길어 잘렸습니다]'
            : raw;
        return r.isError ? `Error: ${text}` : text;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[AgentTask] 도구 실행 실패 (${name}): ${msg}`);
        return `Error: ${msg}`;
    }
}
