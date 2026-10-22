/**
 * 위임 도구(delegate·spawn_agents)와 add-on 기여 도구 — tools.ts 에서 분리 (max-lines 가드).
 *
 * @module services/task-sandbox/tools-delegation
 */
import { AgentTaskParked } from '../agent-task/types';
import type { MCPToolDefinition, MCPToolResult } from '../../tool-contract/types';
import type { ContributedAgentTaskTool } from '../chat-service/turn-integrations';
import type { DelegateFn } from './tools';
import {
    SPAWN_AGENTS_TOOL_NAME,
    SPAWN_AGENTS_TOOL_DESCRIPTION,
    SPAWN_AGENTS_PARAMETERS_SCHEMA,
    type SpawnFn,
} from '../agent-spawn/spawn-agents';

/** tools.ts 의 공용 도우미 — 결과 포맷·인자 문자열화. */
interface DelegationToolHelpers {
    textResult: (text: string, isError?: boolean) => MCPToolResult;
    str: (v: unknown) => string;
}

/** [delegate, spawn_agents(spawn 주입 시), ...기여 도구] — 노출 순서는 종전 그대로. */
export function createDelegationTools(
    delegate: DelegateFn | undefined,
    spawn: SpawnFn | undefined,
    contributed: readonly ContributedAgentTaskTool[],
    contributedCtx: { userId: string },
    h: DelegationToolHelpers,
): MCPToolDefinition[] {
    // ── G4 멀티에이전트: 전문가 위임(자문) ──
    const delegateTool: MCPToolDefinition = {
        tool: {
            name: 'delegate',
            description: '특정 하위 문제를 적합한 산업 전문가(금융/법률/엔지니어링/의료/과학 등)에게 위임해 ' +
                '전문 자문을 받습니다. 자문 결과를 참고해 당신이 직접 다음 작업을 수행하세요. ' +
                '전문 지식·검토·판단이 필요한 단계에서 사용하세요.',
            inputSchema: {
                type: 'object',
                properties: {
                    subgoal: { type: 'string', description: '전문가에게 위임할 구체적 하위 문제/질문' },
                    role: { type: 'string', description: '원하는 전문 분야(선택, 예: finance/legal/engineering)' },
                },
                required: ['subgoal'],
            },
        },
        handler: async (args): Promise<MCPToolResult> => {
            const subgoal = h.str(args.subgoal).trim();
            if (!subgoal) return h.textResult('subgoal 이 필요합니다.', true);
            if (!delegate) return h.textResult('위임 기능을 사용할 수 없습니다.', true);
            try {
                const advice = await delegate(subgoal, h.str(args.role) || undefined);
                return h.textResult(advice);
            } catch (e) {
                if (e instanceof AgentTaskParked) throw e; // 서브에이전트 승인 주차(173) — 부모가 받아 주차한다
                return h.textResult(`전문가 위임 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    // ── 병렬 fan-out: spawn_agents — 독립 하위 작업 N개 병렬 위임 (services/agent-spawn).
    //    AGENT_SPAWN.ENABLED 시에만 AgentTaskService 가 spawn 을 전달 → 미전달이면 도구 자체 미노출. ──
    const spawnAgentsTool: MCPToolDefinition = {
        tool: {
            name: SPAWN_AGENTS_TOOL_NAME,
            description: SPAWN_AGENTS_TOOL_DESCRIPTION,
            inputSchema: SPAWN_AGENTS_PARAMETERS_SCHEMA,
        },
        handler: async (args): Promise<MCPToolResult> => {
            if (!spawn) return h.textResult('병렬 위임 기능을 사용할 수 없습니다.', true);
            try {
                return h.textResult(await spawn(args as Record<string, unknown>));
            } catch (e) {
                return h.textResult(`병렬 위임 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    };

    // ── add-on 기여 도구 — 실패해도 예외를 던지지 않고 오류 결과를 돌려준다(스텝 중단 방지) ──
    const contributedTools: MCPToolDefinition[] = contributed.map((c) => ({
        tool: c.tool,
        handler: async (args): Promise<MCPToolResult> => {
            try {
                const r = await c.run(args as Record<string, unknown>, contributedCtx);
                return h.textResult(r.text, r.isError === true);
            } catch (e) {
                return h.textResult(`${c.tool.name} 실패: ${e instanceof Error ? e.message : String(e)}`, true);
            }
        },
    }));

    return [delegateTool, ...(spawn ? [spawnAgentsTool] : []), ...contributedTools];
}
