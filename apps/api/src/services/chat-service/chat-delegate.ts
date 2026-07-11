/**
 * 채팅 서브에이전트 위임 (chat-subagent) — agent task 의 delegate(5-1)를 채팅 경로로 확장.
 *
 * 채팅 도구 루프(external-provider)에 `delegate_expert` 도구를 노출하고, 호출 시
 * 전문가 페르소나 + **이 채팅에서 이미 활성화된 도구 서브셋**으로 depth=1 미니 tool-loop
 * (agent-task/subagent 재사용)를 실행해 결과를 도구 결과로 반환한다.
 *
 * 안전 원칙:
 *  - 서브 도구 = 부모 채팅이 이미 실행 가능한 도구만(자기 자신 제외) — 권한 증분 0.
 *  - 승인 정책 'none' 고정 — 채팅 도구는 원래 승인 없이 실행되는 모델과 정합
 *    (승인 레지스트리를 아예 타지 않음 → agent task HITL 과 간섭 없음).
 *  - 메시지당 호출 캡(CHAT_SUBAGENT.MAX_CALLS, 기본 1) — 지연·남용 억제(호출부가 집계).
 *  - 서브 LLM 은 항상 로컬 모델(createClient) — 외부 provider 채팅이어도 위임 비용은 로컬.
 *
 * @module services/chat-service/chat-delegate
 */
import { createClient } from '../../llm';
import type { ToolDefinition } from '../../llm/types';
import type { UserContext } from '../../mcp/user-sandbox';
import { getModelForRole } from '../../config/model-roles';
import { routeToAgent } from '../../agents/keyword-router';
import { getAgentSystemMessage } from '../../agents/system-prompt';
import { runSubagent } from '../agent-task/subagent';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ChatDelegate');

/** 채팅 위임 도구 이름 — agent task 샌드박스의 'delegate' 와 분리(카탈로그 충돌·혼동 방지). */
export const CHAT_DELEGATE_TOOL_NAME = 'delegate_expert';

/** PURE: 채팅 도구 루프에 노출할 delegate_expert 도구 정의. */
export function buildChatDelegateTool(): ToolDefinition {
    return {
        type: 'function',
        function: {
            name: CHAT_DELEGATE_TOOL_NAME,
            description: '전문 지식·판단이 필요한 하위 질의를 해당 분야 전문가(금융/법률/의료/엔지니어링 등)에게 '
                + '위임합니다. 전문가는 필요한 도구(검색 등)를 직접 사용해 조사한 결과를 반환합니다. '
                + '⚠️ 일반 상식·단순 질문에는 쓰지 말고 직접 답하세요 — 전문 검토가 답변 품질을 실제로 바꾸는 '
                + '경우에만 사용합니다(응답 시간이 늘어납니다).',
            parameters: {
                type: 'object',
                properties: {
                    subgoal: { type: 'string', description: '전문가에게 위임할 구체적 하위 질의' },
                    role: { type: 'string', description: '원하는 전문 분야(선택, 예: finance/legal/medical)' },
                },
                required: ['subgoal'],
            },
        },
    };
}

/** PURE: 서브에이전트에 넘길 도구 서브셋 — 부모 채팅 활성 도구에서 자기 자신만 제외. */
export function buildSubagentTools(chatTools: ToolDefinition[]): ToolDefinition[] {
    return chatTools.filter((t) => t.function.name !== CHAT_DELEGATE_TOOL_NAME);
}

/**
 * delegate_expert 실행 — 실패는 문자열로 흡수(채팅 루프를 죽이지 않음).
 */
export async function runChatDelegate(params: {
    args: Record<string, unknown>;
    /** 부모 채팅의 활성 도구(자기 자신 포함 가능 — 내부에서 제외). */
    chatTools: ToolDefinition[];
    userCtx: UserContext;
    signal?: AbortSignal;
}): Promise<string> {
    const subgoal = String(params.args.subgoal ?? '').trim();
    if (!subgoal) return 'Error: subgoal 이 필요합니다.';
    const role = typeof params.args.role === 'string' ? params.args.role : undefined;
    try {
        const selection = await routeToAgent(role ? `[${role}] ${subgoal}` : subgoal);
        const { prompt } = await getAgentSystemMessage(selection, String(params.userCtx.userId));
        const started = Date.now();
        const result = await runSubagent({
            client: createClient({ model: getModelForRole('chat') }),
            personaPrompt: prompt,
            subgoal,
            tools: buildSubagentTools(params.chatTools),
            userCtx: params.userCtx,
            taskId: '__chat__', // 정책 'none' 이라 승인 레지스트리 미사용 — 식별용 문자열일 뿐
            sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 0 },
            signal: params.signal,
            onTokens: (n) => logger.debug(`[ChatDelegate] 서브 토큰 +${n}`),
        });
        logger.info(`[ChatDelegate] 위임 완료 (${Date.now() - started}ms): "${subgoal.slice(0, 40)}"`);
        return result;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[ChatDelegate] 위임 실패: ${msg}`);
        return `Error: 전문가 위임 실패 — ${msg}. 직접 답변을 작성하세요.`;
    }
}
