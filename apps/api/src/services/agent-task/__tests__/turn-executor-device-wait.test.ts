/**
 * 턴 도구 실행 중 기기 대기 (Companion P1-4, 2026-10-04) — 로컬 기기가 사라지면 실패시키지 않고 주차한다.
 *   - 요청이 기기에 닿지 않았으면(rerunnable) 그 호출의 결과를 남기지 않고 주차 → 재개 때 다시 실행한다.
 *   - 보낸 뒤 끊겨 결과를 알 수 없으면(unknown) 결과 불명 안내를 **남기고** 주차 → 재개 때 다시 실행하지 않는다.
 */
const addAgentTaskStep = jest.fn(async () => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ addAgentTaskStep, updateAgentTask: async () => undefined }), getPool: () => ({}) }));
jest.mock('../../PushService', () => ({ getPushService: () => ({ sendPush: async () => undefined }) }));
jest.mock('../../task-sandbox/tools', () => ({ TASK_TERMINATE_SENTINEL: '__TERMINATE__' }));
const request = jest.fn();
const requiresApproval = jest.fn((..._a: unknown[]) => false);
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: (...a: unknown[]) => requiresApproval(...a), getApprovalRegistry: () => ({ request, isAutoApprove: () => false }) }));
jest.mock('../../task-sandbox/planning', () => ({ currentPlanStepIndex: () => undefined }));
const runTool = jest.fn();
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...a), isSearchTool: () => false }));
jest.mock('../tool-args', () => ({ prepareToolArgs: (a: unknown) => a }));
jest.mock('../../tool-parallel', () => ({ ...jest.requireActual('../../tool-parallel'), prefetchReadOnlyCalls: async () => new Map() }));
// 도구가 사용자에게 묻는 문맥(구 MCP elicitation)은 이제 도구 런타임 포트가 연다 — 그 문맥을 낚아챈다.
let elicitCtx: { ask(args: Record<string, unknown>): Promise<unknown> } | undefined;
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({
        runWithUserInputContext: (ctx: typeof elicitCtx, fn: () => Promise<unknown>) => { elicitCtx = ctx; return fn(); },
    }),
}));
const writeTurnCheckpoint = jest.fn(async () => undefined);
const markToolCallInFlight = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../turn-reentry', () => ({ writeTurnCheckpoint: (...a: unknown[]) => writeTurnCheckpoint(...(a as [])), markToolCallInFlight: (...a: unknown[]) => markToolCallInFlight(...a) }));
const markParked = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock('../../../data/repositories/agent-task-repository', () => ({ AgentTaskRepository: jest.fn().mockImplementation(() => ({ markParked: (...a: unknown[]) => markParked(...a) })) }));

import { executeTurnToolCalls } from '../turn-executor';
import { AgentTaskParked } from '../types';
import type { ChatMessage } from '../../../llm/types';

function input(overrides: Record<string, unknown>) {
    const conversation: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [] }];
    const update = jest.fn(async () => undefined);
    return {
        conversation, update,
        args: {
            toolCalls: [], taskRuntime: null, sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 1000 },
            extraToolNames: new Set<string>(), mcp: {}, userCtx: { userId: 'u1' }, userId: 'u1', taskId: 't1', turn: 4,
            conversation, usedTools: new Set<string>(), signal: new AbortController().signal,
            stepNumber: 10, searchCalls: 0, browserCalls: 0, pausedMs: 0, approvalTimeouts: 0,
            getCurStatus: () => 'paused', update, emitStep: jest.fn(), ...overrides,
        } as unknown as Parameters<typeof executeTurnToolCalls>[0],
    };
}

beforeEach(() => { jest.clearAllMocks(); elicitCtx = undefined; });


function runtime(results: Record<string, string>, losses: Record<string, 'rerunnable' | 'unknown' | null>) {
    let last: string | null = null;
    return {
        isTaskTool: () => true,
        executeTaskTool: jest.fn(async (name: string) => { last = name; return results[name] ?? 'ok'; }),
        consumeDeviceLoss: jest.fn(() => { const l = last ? losses[last] ?? null : null; last = null; return l; }),
        getPlanSnapshot: () => [],
        notifyApprovalPending: jest.fn(),
    };
}

describe('executeTurnToolCalls — 기기 대기', () => {
    it('요청이 기기에 닿지 않았으면 결과를 남기지 않고 device_wait 로 주차한다', async () => {
        const taskRuntime = runtime({ file_ops: 'Error: 연결된 로컬 디바이스가 없습니다' }, { file_ops: 'rerunnable' });
        const { args, conversation, update } = input({
            taskRuntime, getCurStatus: () => 'running',
            toolCalls: [
                { id: 'c1', function: { name: 'grep_code', arguments: { pattern: 'x' } } },
                { id: 'c2', function: { name: 'file_ops', arguments: { op: 'write', path: 'a.txt' } } },
                { id: 'c3', function: { name: 'bash', arguments: { command: 'ls' } } },
            ],
        });
        await expect(executeTurnToolCalls(args)).rejects.toBeInstanceOf(AgentTaskParked);
        expect(conversation.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['c1']);
        expect(addAgentTaskStep).toHaveBeenCalledTimes(1);
        expect(taskRuntime.executeTaskTool).toHaveBeenCalledTimes(2); // c3 는 실행하지 않는다
        expect(writeTurnCheckpoint).toHaveBeenCalledWith('t1', conversation, 3, taskRuntime);
        expect(update).toHaveBeenCalledWith({ status: 'paused' });
        expect(markParked).toHaveBeenCalledWith('t1', 'device_wait');
    });

    it('보낸 뒤 끊겨 결과를 알 수 없으면 안내를 기록한 뒤 주차한다 — 재개 때 다시 실행하지 않는다', async () => {
        const taskRuntime = runtime({ bash: '이 요청(exec)은 기기와의 연결이 끊겨 결과를 알 수 없습니다.' }, { bash: 'unknown' });
        const { args, conversation } = input({
            taskRuntime, getCurStatus: () => 'running',
            toolCalls: [
                { id: 'c1', function: { name: 'bash', arguments: { command: 'npm run deploy' } } },
                { id: 'c2', function: { name: 'bash', arguments: { command: 'echo next' } } },
            ],
        });
        await expect(executeTurnToolCalls(args)).rejects.toBeInstanceOf(AgentTaskParked);
        const tools = conversation.filter((m) => m.role === 'tool');
        expect(tools.map((m) => m.tool_call_id)).toEqual(['c1']);
        expect(String(tools[0].content)).toContain('결과를 알 수 없습니다');
        expect(addAgentTaskStep).toHaveBeenCalledWith(expect.objectContaining({ toolCallId: 'c1' }));
        expect(taskRuntime.executeTaskTool).toHaveBeenCalledTimes(1);
        expect(markParked).toHaveBeenCalledWith('t1', 'device_wait');
    });

    it('기기가 그대로면 주차하지 않는다', async () => {
        const taskRuntime = runtime({}, {});
        const { args, conversation } = input({
            taskRuntime, getCurStatus: () => 'running',
            toolCalls: [{ id: 'c1', function: { name: 'bash', arguments: { command: 'ls' } } }],
        });
        await expect(executeTurnToolCalls(args)).resolves.toMatchObject({ terminated: false });
        expect(conversation.filter((m) => m.role === 'tool')).toHaveLength(1);
        expect(markParked).not.toHaveBeenCalled();
    });

    it('consumeDeviceLoss 가 없는 실행기(서버 샌드박스)는 종전대로 동작한다', async () => {
        const taskRuntime = { isTaskTool: () => true, executeTaskTool: jest.fn(async () => 'ok'), getPlanSnapshot: () => [], notifyApprovalPending: jest.fn() };
        const { args } = input({ taskRuntime, getCurStatus: () => 'running', toolCalls: [{ id: 'c1', function: { name: 'bash', arguments: {} } }] });
        await expect(executeTurnToolCalls(args)).resolves.toMatchObject({ terminated: false });
        expect(markParked).not.toHaveBeenCalled();
    });
});
