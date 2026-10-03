/**
 * 서브에이전트 최종 답 검사(finalCheck) — 어긋나면 교정을 한 번만 요청한다.
 */
jest.mock('../../../runtime-ports/tool-runtime', () => ({
    ...jest.requireActual('../../../runtime-ports/tool-runtime'),
    getToolRuntime: () => ({}),
}));
jest.mock('../task-steps', () => ({ runTool: jest.fn().mockResolvedValue('결과') }));
jest.mock('../../tool-parallel', () => ({ prefetchReadOnlyCalls: jest.fn().mockResolvedValue(new Map()) }));
jest.mock('../../task-sandbox/approval-gate', () => ({ requiresApproval: () => false, getApprovalRegistry: () => ({}) }));

import { runSubagent } from '../subagent';

const TOOL = { type: 'function', function: { name: 'web_search', description: '', parameters: {} } };

function run(chat: jest.Mock, finalCheck?: (t: string) => string | null) {
    const client = { requestTimeout: 120_000, derive: jest.fn(() => ({ chat })), chat: jest.fn() };
    return runSubagent({
        client, personaPrompt: 'persona', subgoal: '하위 목표', tools: [TOOL], userCtx: { userId: '3' }, taskId: 'task-1',
        sandboxCfg: { approvalPolicy: 'none', approvalTimeoutMs: 0 }, ...(finalCheck ? { finalCheck } : {}),
    } as never);
}

describe('runSubagent — 최종 답 검사와 1회 교정', () => {
    it('검사를 통과하면 추가 호출 없이 그대로 돌려준다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '{"ok":true}', metrics: {} });
        await expect(run(chat, () => null)).resolves.toBe('{"ok":true}');
        expect(chat).toHaveBeenCalledTimes(1);
    });

    it('어긋나면 교정 요청문을 대화에 싣고 도구 없이 한 번 더 부른다', async () => {
        const chat = jest.fn()
            .mockResolvedValueOnce({ content: '자유 형식', metrics: {} })
            .mockResolvedValueOnce({ content: '{"ok":true}', metrics: {} });
        const out = await run(chat, (t) => (t.startsWith('{') ? null : '형식에 맞게 다시'));
        expect(out).toBe('{"ok":true}');
        expect(chat).toHaveBeenCalledTimes(2);
        const [conversation, , , opts] = chat.mock.calls[1];
        // 대화 배열은 호출 뒤에도 이어 쓰인다 — 교정 요청문이 실렸는지만 본다.
        expect(conversation).toContainEqual({ role: 'user', content: '형식에 맞게 다시' });
        expect(opts.tools).toBeUndefined();
    });

    it('교정은 한 번뿐 — 또 어긋나도 더 부르지 않고 마지막 답을 돌려준다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '자유 형식', metrics: {} });
        const finalCheck = jest.fn(() => '형식에 맞게 다시');
        await expect(run(chat, finalCheck)).resolves.toBe('자유 형식');
        expect(chat).toHaveBeenCalledTimes(2);
        expect(finalCheck).toHaveBeenCalledTimes(1);
    });

    it('검사를 넘기지 않으면 현행과 같다', async () => {
        const chat = jest.fn().mockResolvedValue({ content: '자유 형식', metrics: {} });
        await expect(run(chat)).resolves.toBe('자유 형식');
        expect(chat).toHaveBeenCalledTimes(1);
    });
});
