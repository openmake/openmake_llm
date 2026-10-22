/**
 * 도구 결과 래퍼 기본값(W3 S4) — 운영(NODE_ENV=production)은 미설정이면 ON, dev/test 는 OFF, 명시 false 는 언제나 끈다.
 */
describe('AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_ENABLED — 운영 기본 ON', () => {
    const origEnv = process.env.NODE_ENV;
    const load = (nodeEnv: string, raw?: string): boolean => {
        jest.resetModules();
        process.env.NODE_ENV = nodeEnv;
        if (raw === undefined) delete process.env.AGENT_TASK_TOOL_RESULT_WRAP_ENABLED;
        else process.env.AGENT_TASK_TOOL_RESULT_WRAP_ENABLED = raw;
        return (require('../runtime-limits-agent-task') as typeof import('../runtime-limits-agent-task')).AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_ENABLED;
    };
    afterEach(() => {
        process.env.NODE_ENV = origEnv;
        delete process.env.AGENT_TASK_TOOL_RESULT_WRAP_ENABLED;
    });

    it('운영에서 미설정이면 켜지고, false 를 명시하면 꺼진다', () => {
        expect(load('production')).toBe(true);
        expect(load('production', 'false')).toBe(false);
    });

    it('dev/test 는 미설정이면 꺼진 채이고, true 를 명시하면 켜진다', () => {
        expect(load('test')).toBe(false);
        expect(load('development', 'true')).toBe(true);
    });
});
