/**
 * Agent Task 서브에이전트 위임 (Phase 5-1).
 *
 * delegate 도구를 1-shot 자문에서 **depth=1 미니 tool-loop** 로 승격한다 — 서브에이전트가
 * 전문가 페르소나 + 안전 도구 서브셋(호스트 화이트리스트, 예: web_search)으로 하위 목표를
 * 실제 수행하고 결과를 반환한다. (SUBAGENT_ENABLED off 면 기존 1-shot 유지.)
 *
 * 폭주 가드(설계 원칙 — 재귀·비용 차단):
 *  - depth 1 고정: 서브에이전트 도구 목록에 delegate 없음(재위임 구조적 불가).
 *  - 턴 상한 SUBAGENT_MAX_TURNS(기본 3) · 위임당 토큰 상한 SUBAGENT_MAX_TOKENS.
 *  - 토큰은 onTokens 로 부모 totalTokens 에 합산 — 부모 runaway 가드도 함께 적용.
 *  - 도구는 부모와 동일한 HITL 승인 게이트 경유(정책 우회 없음) — 자동승인 task 면 즉시.
 *  - 샌드박스(쓰기) 도구는 제외 — 부모 컨테이너 상태를 서브가 변경하지 못함.
 *
 * @module services/agent-task/subagent
 */
import type { LLMClient } from '../../llm';
import type { ChatMessage, ToolDefinition } from '../../llm/types';
import { getUnifiedMCPClient } from '../../mcp/unified-client';
import type { UserContext } from '../../mcp/user-sandbox';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { requiresApproval, getApprovalRegistry } from '../task-sandbox/approval-gate';
import { runTool } from './task-steps';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskSubagent');

export interface SubagentParams {
    client: LLMClient;
    /** 전문가 페르소나 system prompt (keyword-router 가 고른 산업 agent). */
    personaPrompt: string;
    subgoal: string;
    /** 안전 도구 서브셋 — 부모의 호스트 화이트리스트(extraTools). delegate 류는 호출부가 제외. */
    tools: ToolDefinition[];
    userCtx: UserContext;
    /** 승인 레지스트리 키(에이전트 작업 taskId). 채팅 경로는 정책 'none' 이라 실사용 안 됨. */
    taskId: string;
    /** 승인 정책·대기 상한만 사용 — 채팅 경로는 {approvalPolicy:'none', approvalTimeoutMs:0} 전달. */
    sandboxCfg: Pick<TaskSandboxConfig, 'approvalPolicy' | 'approvalTimeoutMs'>;
    signal?: AbortSignal;
    /** 서브 LLM 호출 토큰을 부모 누적에 합산. */
    onTokens?: (n: number) => void;
    /** 승인 대기 시간을 부모 pausedMs 에 합산(4-1 pause-aware 일관). */
    onPausedMs?: (ms: number) => void;
}

/**
 * depth=1 미니 tool-loop 실행 — 최종 텍스트 반환. 실패는 문자열로 흡수(부모 luoop 를 죽이지 않음).
 */
export async function runSubagent(p: SubagentParams): Promise<string> {
    const maxTurns = AGENT_TASK_LIMITS.SUBAGENT_MAX_TURNS;
    const mcp = getUnifiedMCPClient();
    let tokens = 0;

    const conversation: ChatMessage[] = [
        {
            role: 'system',
            content: p.personaPrompt + '\n\n' + [
                '당신은 상위 자율 에이전트로부터 하위 목표를 위임받은 서브에이전트입니다.',
                `- 최대 ${maxTurns}턴 안에 끝내세요. 필요한 경우에만 도구를 쓰고, 즉시 답할 수 있으면 바로 답하세요.`,
                '- 다른 에이전트에게 재위임할 수 없습니다.',
                '- 최종 응답은 상위 에이전트가 그대로 활용할 간결·구체적인 결과여야 합니다.',
                // 스크립트 순수성 — qwen 이 한국어 답변에 한자(诸費用·以内 등)를 섞는 결함이
                // 서브 응답 경유로 유입되던 문제 차단(채팅 메인 경로 가드와 동일 정책, 라이브 관측).
                '- 위임 요청과 같은 언어로, 그 언어의 고유 문자만 사용해 답하세요 — 한국어 답변에 한자·'
                + '가나를 섞지 말고, 외래어·전문용어는 해당 언어로 음차하거나 번역하세요.',
            ].join('\n'),
        },
        { role: 'user', content: p.subgoal },
    ];

    try {
        for (let turn = 0; turn < maxTurns; turn++) {
            if (p.signal?.aborted) return 'Error: 상위 작업이 중단되었습니다.';
            // 마지막 턴엔 도구를 제거해 최종 답변을 강제(도구 호출로 끝나 결과가 없는 상황 방지).
            const lastTurn = turn === maxTurns - 1;
            const result = await p.client.chat(conversation, undefined, undefined, {
                tools: lastTurn || p.tools.length === 0 ? undefined : p.tools,
                signal: p.signal,
                think: false,
            });
            const used = (result.metrics?.prompt_tokens ?? 0) + (result.metrics?.completion_tokens ?? 0);
            tokens += used;
            p.onTokens?.(used);
            if (tokens > AGENT_TASK_LIMITS.SUBAGENT_MAX_TOKENS) {
                logger.warn(`[Subagent] 토큰 상한 초과 — 조기 종료 (${tokens})`);
                return result.content || '(서브에이전트 토큰 상한 도달 — 부분 결과 없음)';
            }

            conversation.push({
                role: 'assistant',
                content: result.content,
                ...(result.tool_calls && { tool_calls: result.tool_calls }),
            });
            if (!result.tool_calls || result.tool_calls.length === 0) {
                return result.content || '(서브에이전트가 빈 응답을 반환했습니다)';
            }

            for (const tc of result.tool_calls) {
                const name = tc.function.name;
                const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
                // 부모와 동일한 승인 게이트 — 정책 우회 없음(자동승인 task 면 즉시 approved).
                let approved = true;
                if (requiresApproval(p.sandboxCfg.approvalPolicy, name, args)) {
                    const r = await getApprovalRegistry().request(
                        { taskId: p.taskId, userId: String(p.userCtx.userId), toolName: name, args },
                        { timeoutMs: p.sandboxCfg.approvalTimeoutMs, signal: p.signal },
                    );
                    p.onPausedMs?.(r.waitedMs);
                    approved = r.decision === 'approved';
                }
                const toolResult = approved
                    ? await runTool(mcp, name, args, p.userCtx)
                    : `Error: 사용자가 도구 실행을 승인하지 않았습니다 (${name}).`;
                conversation.push({ role: 'tool', content: toolResult, tool_name: name, tool_call_id: tc.id });
            }
        }
        // 턴 소진 — 마지막 assistant 내용 반환.
        const last = [...conversation].reverse().find((m) => m.role === 'assistant');
        return (last?.content as string) || '(서브에이전트가 턴 상한에 도달했습니다)';
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`[Subagent] 실행 실패: ${msg}`);
        return `Error: 서브에이전트 실행 실패 — ${msg}`;
    }
}
