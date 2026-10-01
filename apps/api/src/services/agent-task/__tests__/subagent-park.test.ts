/**
 * 서브에이전트 안의 승인 주차 — 유예를 넘긴 승인 대기는 서브 대화를 저장하고 AgentTaskParked 를 던져
 * 부모 작업이 delegate 호출 지점에서 주차되게 한다. 재개 때는 저장된 대화에서 결과 없는 호출만 이어서 실행한다
 * (이미 끝난 호출·LLM 호출을 반복하지 않는다).
 */
const runTool = jest.fn();
jest.mock('../task-steps', () => ({ runTool: (...a: unknown[]) => runTool(...a) }));
jest.mock('../../tool-parallel', () => ({ prefetchReadOnlyCalls: async () => new Map() }));
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({}),
}));
const request = jest.fn();
jest.mock('../../task-sandbox/approval-gate', () => ({
    requiresApproval: (_p: unknown, name: string) => name === 'web_fetch',
    getApprovalRegistry: () => ({ request: (...a: unknown[]) => request(...a), isAutoApprove: () => false }),
}));

import { runSubagent, type SubagentResumeState } from '../subagent';
import { AgentTaskParked } from '../types';
import type { ChatMessage } from '../../../llm/types';

const call = (id: string, name: string) => ({ type: 'function' as const, id, function: { name, arguments: { q: id } } });
const tools = [
    { type: 'function', function: { name: 'web_search', description: '', parameters: {} } },
    { type: 'function', function: { name: 'web_fetch', description: '', parameters: {} } },
];
function setup(replies: Array<Record<string, unknown>>) {
    const chat = jest.fn();
    for (const r of replies) chat.mockResolvedValueOnce({ metrics: { prompt_tokens: 3, completion_tokens: 2 }, ...r });
    const client = { requestTimeout: 1000, derive: () => ({ chat }) };
    const base = {
        client, personaPrompt: 'persona', subgoal: '하위 목표', tools, userCtx: { userId: 'u1' }, taskId: 't1',
        sandboxCfg: { approvalPolicy: 'all', approvalTimeoutMs: 60_000 },
    };
    return { chat, base };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('runSubagent — 승인 주차', () => {
    it('승인이 주차되면 그때까지의 대화를 저장하고 AgentTaskParked 를 던진다', async () => {
        const { chat, base } = setup([{ content: '', tool_calls: [call('s1', 'web_search'), call('s2', 'web_fetch')] }]);
        runTool.mockResolvedValue('검색 결과');
        request.mockResolvedValue({ decision: 'rejected', reason: 'parked', waitedMs: 9 });
        const saved: SubagentResumeState[] = [];
        const paused = jest.fn();
        await expect(runSubagent({ ...base, onPausedMs: paused, park: { save: async (s: SubagentResumeState) => { saved.push(JSON.parse(JSON.stringify(s))); } } } as never))
            .rejects.toBeInstanceOf(AgentTaskParked);

        expect(chat).toHaveBeenCalledTimes(1);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'web_fetch' }), expect.objectContaining({ parkable: true }));
        expect(runTool).toHaveBeenCalledTimes(1); // s1 만 실행 — 주차된 s2 는 실행 전
        expect(paused).toHaveBeenCalledWith(9);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ turn: 0, tokens: 5 });
        const conv = saved[0].conversation;
        expect(conv.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
        expect(conv[3]).toMatchObject({ tool_call_id: 's1', content: '검색 결과' });
    });

    it('재개하면 저장된 턴의 LLM 호출·끝난 도구를 반복하지 않고 남은 호출부터 이어간다', async () => {
        const { chat, base } = setup([{ content: '최종 답변' }]);
        const restored: SubagentResumeState = {
            turn: 0, tokens: 5,
            conversation: [
                { role: 'system', content: 'persona' }, { role: 'user', content: '하위 목표' },
                { role: 'assistant', content: '', tool_calls: [call('s1', 'web_search'), call('s2', 'web_fetch')] },
                { role: 'tool', content: '검색 결과', tool_name: 'web_search', tool_call_id: 's1' },
            ] as ChatMessage[],
        };
        request.mockResolvedValue({ decision: 'approved', waitedMs: 0 });
        runTool.mockResolvedValue('본문');
        const save = jest.fn();
        const out = await runSubagent({ ...base, park: { restored, save } } as never);

        expect(out).toBe('최종 답변');
        expect(runTool).toHaveBeenCalledTimes(1);
        expect(runTool.mock.calls[0][1]).toBe('web_fetch');
        expect(chat).toHaveBeenCalledTimes(1); // 저장된 턴은 다시 묻지 않고 다음 턴만
        const sent = chat.mock.calls[0][0] as ChatMessage[];
        expect(sent.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(['s1', 's2']);
        expect(save).not.toHaveBeenCalled();
    });

    it('주차 저장소를 주지 않으면(채팅 경로) 승인은 주차 가능으로 요청하지 않는다', async () => {
        const { base } = setup([{ content: '', tool_calls: [call('s2', 'web_fetch')] }, { content: '끝' }]);
        request.mockResolvedValue({ decision: 'approved', waitedMs: 0 });
        runTool.mockResolvedValue('본문');
        await runSubagent(base as never);
        expect(request.mock.calls[0][1].parkable).toBeFalsy();
    });

    it('대화 저장이 실패해도 주차한다(재개 때 처음부터 다시 — 슬롯은 반납)', async () => {
        const { base } = setup([{ content: '', tool_calls: [call('s2', 'web_fetch')] }]);
        request.mockResolvedValue({ decision: 'rejected', reason: 'parked', waitedMs: 1 });
        await expect(runSubagent({ ...base, park: { save: async () => { throw new Error('db down'); } } } as never))
            .rejects.toBeInstanceOf(AgentTaskParked);
    });
});
