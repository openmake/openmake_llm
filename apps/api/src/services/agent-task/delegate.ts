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
import type { UserContext } from '../../mcp/user-sandbox';
import type { TaskSandboxConfig } from '../../config/task-sandbox';
import type { DelegateFn } from '../task-sandbox/tools';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { routeToAgent } from '../../agents/keyword-router';
import { getAgentSystemMessage } from '../../agents/system-prompt';
import { runSubagent } from './subagent';

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
            return runSubagent({
                client: p.client, personaPrompt: prompt, subgoal,
                tools: subTools, userCtx: p.userCtx, taskId: p.taskId,
                sandboxCfg: p.sandboxCfg, signal: p.signal,
                onTokens: p.onTokens, onPausedMs: p.onPausedMs,
            });
        }
        const r = await p.client.chat(
            [{ role: 'system', content: prompt }, { role: 'user', content: subgoal }],
            undefined, undefined, { think: false, signal: p.signal },
        );
        return r.content ?? '';
    };
}
