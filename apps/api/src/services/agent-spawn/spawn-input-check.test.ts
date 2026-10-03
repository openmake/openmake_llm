/**
 * spawn_agents — 위임 입력 품질 검사와 자가 보고 안내.
 */
jest.mock('../task-sandbox/approval-gate', () => ({
    ...jest.requireActual('../task-sandbox/approval-gate'),
    getApprovalRegistry: () => ({ isAutoApprove: () => false }),
}));
const runSubagentMock = jest.fn();
jest.mock('../agent-task/subagent', () => ({ runSubagent: (p: unknown) => runSubagentMock(p) }));
jest.mock('../../llm', () => ({ createClient: jest.fn(() => ({})) }));

import { runSpawnAgents } from './spawn-agents';
import { AGENT_DELEGATION } from '../../config/agent-task-delegation';

const base = {
    client: {} as never, tools: [], userCtx: { userId: 'u1', role: 'user' } as never, taskId: '__chat__',
    sandboxCfg: { approvalPolicy: 'none' as const, approvalTimeoutMs: 0 },
};
const GOOD = '2026년 3분기 서울 아파트 실거래가 추이를 조사해 요약';
const flags = AGENT_DELEGATION as { INPUT_CHECK_ENABLED: boolean; SELF_REPORT_NOTICE_ENABLED: boolean };

beforeEach(() => {
    jest.clearAllMocks();
    runSubagentMock.mockResolvedValue('결과');
});

describe('runSpawnAgents — 위임 입력 품질 검사', () => {
    it('빈 껍데기 태스크가 섞여 있으면 아무것도 돌리지 않고 태스크별 이유를 돌려준다', async () => {
        const out = await runSpawnAgents({ ...base, args: { tasks: [{ prompt: GOOD }, { prompt: '위 작업 계속' }, { prompt: '환율' }] } });
        expect(runSubagentMock).not.toHaveBeenCalled();
        expect(out).toMatch(/^Error:/);
        expect(out).toMatch(/태스크 2: .*맥락/);
        expect(out).toMatch(/태스크 3: .*2자/);
        expect(out).not.toContain('태스크 1:');
    });

    it('검사를 끄면 종전대로 실행한다', async () => {
        flags.INPUT_CHECK_ENABLED = false;
        try {
            const out = await runSpawnAgents({ ...base, args: { tasks: [{ prompt: '위 작업 계속' }] } });
            expect(out).not.toMatch(/^Error:/);
            expect(runSubagentMock).toHaveBeenCalledTimes(1);
        } finally { flags.INPUT_CHECK_ENABLED = true; }
    });
});

describe('runSpawnAgents — 자가 보고 안내', () => {
    it('결과 머리에 "자가 보고이니 중요한 사실은 확인하라"는 안내를 싣는다', async () => {
        const out = await runSpawnAgents({ ...base, args: { tasks: [{ prompt: GOOD }] } });
        expect(out).toContain('자가 보고');
        expect(out.indexOf('자가 보고')).toBeLessThan(out.indexOf('### 태스크 1/1'));
    });

    it('끄면 싣지 않는다', async () => {
        flags.SELF_REPORT_NOTICE_ENABLED = false;
        try {
            expect(await runSpawnAgents({ ...base, args: { tasks: [{ prompt: GOOD }] } })).not.toContain('자가 보고');
        } finally { flags.SELF_REPORT_NOTICE_ENABLED = true; }
    });
});
