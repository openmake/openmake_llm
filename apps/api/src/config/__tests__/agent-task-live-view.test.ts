/** 실시간 작업 화면 설정 — 기본값·env 끄기·러너 spec 모양·diff 제외 목록. */
const LIVE_ENV_KEYS = [
    'TASK_SANDBOX_LIVE_VIEW',
    'TASK_SANDBOX_LIVE_FRAME_INTERVAL_MS',
    'TASK_SANDBOX_LIVE_FRAME_MAX_BYTES',
    'TASK_SANDBOX_LIVE_TERMINAL_TAIL_CHARS',
    'TASK_SANDBOX_LIVE_TERMINAL_WRITE_MS',
    'AGENT_TASK_DIFF_INTERNAL_FILES',
];

function withEnv<T>(env: Record<string, string>, load: () => T): T {
    const saved: Record<string, string | undefined> = {};
    for (const k of LIVE_ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, env);
    try {
        let out: T | undefined;
        jest.isolateModules(() => { out = load(); });
        return out as T;
    } finally {
        for (const k of LIVE_ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
        }
    }
}

type LiveViewModule = typeof import('../agent-task-live-view');
const loadLiveView = (env: Record<string, string> = {}) =>
    withEnv(env, () => require('../agent-task-live-view') as LiveViewModule);

describe('config/agent-task-live-view', () => {
    it('기본값', () => {
        const { LIVE_VIEW } = loadLiveView();
        expect(LIVE_VIEW).toEqual({
            ENABLED: true,
            FRAME_FILE: '.live-frame.jpg',
            META_FILE: '.live-frame.json',
            TERMINAL_FILE: '.live-terminal.json',
            FRAME_MIN_INTERVAL_MS: 700,
            FRAME_MAX_BYTES: 2097152,
            TERMINAL_TAIL_CHARS: 16000,
            TERMINAL_WRITE_MS: 500,
        });
    });

    it('env 로 수치를 바꾼다', () => {
        const { LIVE_VIEW } = loadLiveView({
            TASK_SANDBOX_LIVE_FRAME_INTERVAL_MS: '1000',
            TASK_SANDBOX_LIVE_FRAME_MAX_BYTES: '4096',
            TASK_SANDBOX_LIVE_TERMINAL_TAIL_CHARS: '8000',
            TASK_SANDBOX_LIVE_TERMINAL_WRITE_MS: '250',
        });
        expect(LIVE_VIEW.FRAME_MIN_INTERVAL_MS).toBe(1000);
        expect(LIVE_VIEW.FRAME_MAX_BYTES).toBe(4096);
        expect(LIVE_VIEW.TERMINAL_TAIL_CHARS).toBe(8000);
        expect(LIVE_VIEW.TERMINAL_WRITE_MS).toBe(250);
    });

    it('TASK_SANDBOX_LIVE_VIEW=false 면 liveFrameSpec 은 null', () => {
        const { LIVE_VIEW, liveFrameSpec } = loadLiveView({ TASK_SANDBOX_LIVE_VIEW: 'false' });
        expect(LIVE_VIEW.ENABLED).toBe(false);
        expect(liveFrameSpec()).toBeNull();
    });

    it('liveFrameSpec 은 파일명과 간격을 싣는다', () => {
        const { liveFrameSpec } = loadLiveView();
        expect(liveFrameSpec()).toEqual({ framePath: '.live-frame.jpg', metaPath: '.live-frame.json', minIntervalMs: 700 });
    });

    it('CODE_DIFF_INTERNAL_FILES 기본값에 실시간 화면 파일 셋이 들어 있다', () => {
        const { CODE_DIFF_INTERNAL_FILES } = withEnv({}, () => require('../agent-task-tools') as typeof import('../agent-task-tools'));
        expect(CODE_DIFF_INTERNAL_FILES).toEqual(expect.arrayContaining([
            '/.browser-state.json', '/.omk-browser-session.mjs', '/_exec.py',
            '/.live-frame.jpg', '/.live-frame.json', '/.live-terminal.json',
            '/.live-frame.jpg.tmp', '/.live-frame.json.tmp', '/.live-terminal.json.tmp',
        ]));
    });
});
