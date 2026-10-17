describe('AGENT_TASK_LONG_RUNNING — 기본값과 상한', () => {
    const load = (env: Record<string, string>) => {
        jest.resetModules();
        for (const [k, v] of Object.entries(env)) process.env[k] = v;
        return require('../agent-task-long-running').AGENT_TASK_LONG_RUNNING as typeof import('../agent-task-long-running').AGENT_TASK_LONG_RUNNING;
    };
    afterEach(() => {
        for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_TASK_LONG_RUNNING')) delete process.env[k];
    });

    it('기본값: 꺼짐, 8h/24h, 5M/20M, 12/48, 0.9, 2000', () => {
        const c = load({});
        expect(c.ENABLED).toBe(false);
        expect(c.DEFAULT_MS).toBe(8 * 60 * 60 * 1000);
        expect(c.MAX_MS).toBe(24 * 60 * 60 * 1000);
        expect(c.DEFAULT_TOKENS).toBe(5_000_000);
        expect(c.MAX_TOKENS).toBe(20_000_000);
        expect(c.DEFAULT_SEGMENTS).toBe(12);
        expect(c.MAX_SEGMENTS).toBe(48);
        expect(c.CONTINUE_AT_RATIO).toBe(0.9);
        expect(c.HANDOFF_TURN_MAX_CHARS).toBe(2000);
    });

    it('환경변수로 켜고 값을 바꾼다; 비율은 0.5~0.99 로 가둔다', () => {
        const c = load({ AGENT_TASK_LONG_RUNNING: 'true', AGENT_TASK_LONG_RUNNING_DEFAULT_MS: '3600000', AGENT_TASK_LONG_RUNNING_CONTINUE_AT_RATIO: '1.5' });
        expect(c.ENABLED).toBe(true);
        expect(c.DEFAULT_MS).toBe(3_600_000);
        expect(c.CONTINUE_AT_RATIO).toBe(0.99);
    });
});
