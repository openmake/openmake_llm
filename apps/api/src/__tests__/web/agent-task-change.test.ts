/** 웹 승인·계획 변경 알림(apps/web/lib/agent-task-change.ts, HITL 2단계) — window 이벤트 발행·구독·해제. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
type Change = { taskId: string; approvalId?: string; reason: string };
const load = () => require('../../../../web/lib/agent-task-change') as {
    announceAgentTaskChange: (c: Change) => void;
    onAgentTaskChange: (h: (c: Change) => void) => () => void;
};

describe('web agent-task-change', () => {
    const g = globalThis as { window?: unknown };
    afterEach(() => { delete g.window; jest.resetModules(); });

    it('구독자는 발행된 변경을 받고, 해제 후에는 받지 않는다', () => {
        g.window = new EventTarget();
        const { announceAgentTaskChange, onAgentTaskChange } = load();
        const got: Change[] = [];
        const off = onAgentTaskChange((c) => got.push(c));
        announceAgentTaskChange({ taskId: 't1', approvalId: 'a1', reason: 'assigned' });
        off();
        announceAgentTaskChange({ taskId: 't1', reason: 'plan_edited' });
        expect(got).toEqual([{ taskId: 't1', approvalId: 'a1', reason: 'assigned' }]);
    });

    it('window 가 없는 환경(SSR)에서는 아무 일도 하지 않는다', () => {
        const { announceAgentTaskChange, onAgentTaskChange } = load();
        expect(() => announceAgentTaskChange({ taskId: 't1', reason: 'revoked' })).not.toThrow();
        expect(typeof onAgentTaskChange(() => undefined)).toBe('function');
    });
});
