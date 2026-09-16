/**
 * 예산 게이트 대표 컨텍스트(F26.8) — 운영 조립 함수(buildExternalSystemPromptParts)에 실제 블록을 넣어 잰다.
 *
 * 가변 블록(에이전트 페르소나·메모리)은 고정 샘플 문자열이라 운영 크기와 같지 않다 — 여기서 보는 것은
 * "코드가 붙이는 정적·고정 문구가 늘었는가" 이다. DB·네트워크 없이 돈다(CI).
 *
 * @module evaluation/budget-contexts
 */
import { buildExternalSystemPromptParts } from '../services/chat-service/external-system-prompt';
import { getArtifactGuide } from '../prompts/artifact-guide';
import { getReportGuide } from '../prompts/report-guide';
import { getAnswerFormatGuard } from '../chat/answer-format';
import type { ChatMessageRequest } from '../services/chat-service-types';
import type { ResolvedProvider } from '../providers/provider-router';
import type { StreamFromExternalContext } from '../services/chat-service/external-provider-types';
import type { BudgetMeasurement } from './budget-evaluation';

interface BudgetContext {
    id: string;
    lang: 'ko' | 'en';
    style?: string;
    answerFormat?: 'structured' | 'prose';
    compactScreen?: boolean;
    artifact?: boolean;
    report?: boolean;
    agentPersona?: boolean;
    memory?: boolean;
}

export const BUDGET_CONTEXTS: readonly BudgetContext[] = [
    { id: 'base-ko', lang: 'ko', artifact: true },
    { id: 'concise-en', lang: 'en', style: 'concise', artifact: true },
    { id: 'structured-ko', lang: 'ko', answerFormat: 'structured', artifact: true },
    { id: 'report-ko', lang: 'ko', report: true },
    { id: 'agent-memory-ko', lang: 'ko', artifact: true, agentPersona: true, memory: true },
    { id: 'ios-compact-ko', lang: 'ko', answerFormat: 'prose', compactScreen: true, artifact: true },
];

const SAMPLE_PERSONA = '당신은 재무 분석 전문가입니다. 수치 근거를 먼저 제시하세요.';
const SAMPLE_MEMORY = '<user_memory>\n- 사용자는 한국어로 짧게 답받기를 선호한다.\n</user_memory>';

export function measureContext(c: BudgetContext): { staticChars: number; fullChars: number } {
    const ctx = {
        style: c.style,
        resolvedLanguage: c.lang,
        answerFormatBlock: c.answerFormat ? getAnswerFormatGuard(c.answerFormat, c.lang, { compactScreen: c.compactScreen }) : '',
        artifactGuideBlock: c.artifact && !c.report ? getArtifactGuide(c.lang) : '',
        ...(c.report ? { reportGuideBlock: getReportGuide(c.lang) } : {}),
        ...(c.agentPersona ? { agentSystemMessage: SAMPLE_PERSONA } : {}),
        ...(c.memory ? { memoryBlock: SAMPLE_MEMORY } : {}),
    } as unknown as StreamFromExternalContext;
    const { staticParts, dynamicParts } = buildExternalSystemPromptParts({
        req: { message: 'budget', userLanguagePreference: c.lang } as unknown as ChatMessageRequest,
        resolved: { fullId: 'budget/model' } as unknown as ResolvedProvider,
        ctx,
        wantsMap: false,
    });
    const staticText = staticParts.join('\n\n');
    return { staticChars: staticText.length, fullChars: [...staticParts, ...dynamicParts].join('\n\n').length };
}

/** 도구 정의 → OpenAI 호환 function 스키마(채팅 경로와 같은 모양) JSON 바이트. */
export function toolSchemaBytes(defs: Array<{ tool: { name: string; description?: string; inputSchema: unknown } }>): number {
    const json = JSON.stringify(defs.map((d) => ({ type: 'function', function: { name: d.tool.name, description: d.tool.description ?? '', parameters: d.tool.inputSchema } })));
    return Buffer.byteLength(json, 'utf8');
}

export async function measureBudget(): Promise<BudgetMeasurement> {
    const contexts: BudgetMeasurement['contexts'] = {};
    for (const c of BUDGET_CONTEXTS) contexts[c.id] = measureContext(c);
    const { builtInTools } = await import('../mcp/tools');
    const { CHAT_ALWAYS_ON_TOOL_NAMES } = await import('../mcp/agent-task-tools');
    const alwaysOn = builtInTools.filter((d) => CHAT_ALWAYS_ON_TOOL_NAMES.includes(d.tool.name));
    return { contexts, alwaysOnToolSchemaBytes: toolSchemaBytes(alwaysOn) };
}
