/**
 * 재등록 생존 확인 시간(LOCAL_BRIDGE_REREGISTER_PROBE_MS, 2026-11-19) — 기본 5초, env 로 바꾼다. 숫자가 아니면 기본값.
 */
describe('LOCAL_BRIDGE.REREGISTER_PROBE_MS', () => {
    const saved = process.env.LOCAL_BRIDGE_REREGISTER_PROBE_MS;
    afterEach(() => {
        if (saved === undefined) delete process.env.LOCAL_BRIDGE_REREGISTER_PROBE_MS; else process.env.LOCAL_BRIDGE_REREGISTER_PROBE_MS = saved;
    });

    function load(): number {
        let v = 0;
        jest.isolateModules(() => { v = (require('../local-bridge') as typeof import('../local-bridge')).LOCAL_BRIDGE.REREGISTER_PROBE_MS; });
        return v;
    }

    it.each([[undefined, 5000], ['', 5000], ['abc', 5000], ['8000', 8000]])('env=%p → %p', (env, want) => {
        if (env === undefined) delete process.env.LOCAL_BRIDGE_REREGISTER_PROBE_MS; else process.env.LOCAL_BRIDGE_REREGISTER_PROBE_MS = env;
        expect(load()).toBe(want);
    });
});
