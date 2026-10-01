/**
 * Agent Task delegate 팩토리 — AgentTaskService 에서 분리 (파일 크기 가드).
 *
 * G4 위임: subgoal 을 적합 산업 전문가 페르소나에게 위임.
 *  - 기본(1-shot 자문): 재귀 루프 없이 텍스트 자문만.
 *  - SUBAGENT_ENABLED(5-1): depth=1 미니 tool-loop 로 승격 — 안전 도구 서브셋
 *    (호스트 화이트리스트, delegate 재귀 구조적 불가)으로 하위 목표를 실제 수행.
 *
 * @module services/agent-task/delegate
 */
import type { LLMClient } from '../../llm';
import type { ToolDefinition } from '../../llm/types';
import type { UserContext } from '../../tool-contract/types';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import type { DelegateFn } from '../task-sandbox/tools';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { routeToAgent } from '../../agents/keyword-router';
import { getAgentSystemMessage } from '../../agents/system-prompt';
import { createHash } from 'crypto';
import { runSubagent } from './subagent';
import { SubagentTrace, newTraceId, subagentLabel } from './subagent-trace';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AgentTaskSubagentStepRepository } from '../../data/repositories/agent-task-subagent-step-repository';
import type { ChatMessage } from '../../llm/types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskDelegate');

/** PURE: 위임 식별 키 — 재개된 부모가 같은 delegate 호출(같은 목표·역할)을 다시 실행할 때 주차된 서브 대화를 찾는다. */
export function subagentCheckpointKey(subgoal: string, role: string | undefined): string {
    return createHash('sha256').update(`delegate|${role ?? ''}|${subgoal}`).digest('hex');
}

export interface DelegateFactoryParams {
    client: LLMClient;
    userId: string;
    taskId: string;
    userCtx: UserContext;
    sandboxCfg: TaskSandboxConfig;
    /** 전체 MCP 카탈로그 — 서브에이전트 도구(extraTools 이름)를 여기서 선별. */
    mcpTools: ToolDefinition[];
    signal: AbortSignal;
    /** 서브 LLM 토큰을 부모 누적에 합산(부모 runaway 가드 공유). */
    onTokens: (n: number) => void;
    /** 승인 대기 시간을 부모 pausedMs 에 합산(4-1 pause-aware 일관). */
    onPausedMs: (ms: number) => void;
    /** 서브 안의 승인이 대기에 들어감 — 부모 작업 paused + 알림(부모 턴의 승인과 같은 발행). */
    onApprovalPending?: (toolName: string) => void;
    /** 그 대기가 유예 안에 결정됨 — 부모 작업을 running 으로 되돌린다. */
    onApprovalDecided?: () => void;
}

/** delegate 도구 핸들러 생성 — TaskRuntime 에 주입. */
export function buildDelegateFn(p: DelegateFactoryParams): DelegateFn {
    return async (subgoal: string, role?: string): Promise<string> => {
        const selection = await routeToAgent(role ? `[${role}] ${subgoal}` : subgoal);
        const { prompt } = await getAgentSystemMessage(selection, p.userId);
        if (AGENT_TASK_LIMITS.SUBAGENT_ENABLED) {
            // 서브 도구 = 부모 호스트 화이트리스트(extraTools)와 동일 선별(샌드박스 쓰기 도구 제외).
            const subTools = p.sandboxCfg.extraTools
                .map((n) => p.mcpTools.find((t) => t.function.name === n))
                .filter((t): t is ToolDefinition => !!t);
            // 승인 주차(173): 주차된 서브 대화가 있으면 그 지점에서 잇는다. 조회 실패는 처음부터 실행(fail-open).
            const repo = new AgentTaskSubagentStepRepository(getUnifiedDatabase().getPool());
            const ckptKey = subagentCheckpointKey(subgoal, role);
            const saved = await repo.loadCheckpoint(p.taskId, ckptKey).catch((e) => {
                logger.warn(`[${p.taskId}] 서브에이전트 체크포인트 조회 실패 — 처음부터 실행: ${e instanceof Error ? e.message : e}`);
                return null;
            });
            const trace = new SubagentTrace(p.taskId, saved?.trace_id ?? newTraceId(), 'delegate', 0,
                subagentLabel(role ?? selection.primaryAgent, subgoal), saved?.trace_seq ?? 0);
            if (!saved) { trace.queued(subgoal); trace.started(); }
            const result = await runSubagent({
                trace,
                client: p.client, personaPrompt: prompt, subgoal,
                tools: subTools, userCtx: p.userCtx, taskId: p.taskId,
                sandboxCfg: p.sandboxCfg, signal: p.signal,
                onTokens: p.onTokens, onPausedMs: p.onPausedMs,
                onApprovalPending: p.onApprovalPending, onApprovalDecided: p.onApprovalDecided,
                park: {
                    ...(saved ? { restored: { conversation: saved.conversation as ChatMessage[], turn: saved.turn, tokens: saved.tokens } } : {}),
                    save: (s) => repo.saveCheckpoint({
                        task_id: p.taskId, ckpt_key: ckptKey, conversation: s.conversation, turn: s.turn, tokens: s.tokens,
                        trace_id: trace.position.traceId, trace_seq: trace.position.nextSeq,
                    }),
                },
            });
            // 서브가 끝났다 — 주차로 던져진 경우(AgentTaskParked)는 여기 오지 않아 체크포인트가 남는다.
            await repo.deleteCheckpoint(p.taskId, ckptKey).catch(() => { /* 남아도 같은 위임이 다시 올 때만 쓰인다 */ });
            return result;
        }
        const r = await p.client.chat(
            [{ role: 'system', content: prompt }, { role: 'user', content: subgoal }],
            undefined, undefined, { think: false, signal: p.signal },
        );
        return r.content ?? '';
    };
}
