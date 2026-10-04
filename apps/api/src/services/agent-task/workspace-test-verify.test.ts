jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ addAgentTaskStep: jest.fn(async () => undefined) }),
}));
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return { ...actual, AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, WORKSPACE_TEST_REPORT_MAX_CHARS: 60 } };
});
import { verifyWorkspaceTests, detectWorkspaceTestRunner, tailReport, RUNNER_COMMANDS, DETECT_PROBE } from './workspace-test-verify';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { ExecResult } from '../task-sandbox/executor';

function exec(stdout: string, exitCode = 0, stderr = '', timedOut = false): ExecResult {
    return { stdout, stderr, exitCode, truncated: false, timedOut, durationMs: 3 };
}
function runtime(impl: (cmd: string) => ExecResult | Promise<ExecResult>): { rt: TaskRuntime; cmds: string[] } {
    const cmds: string[] = [];
    const rt = {
        execRaw: jest.fn(async (cmd: string) => { cmds.push(cmd); return impl(cmd); }),
        detectTestRunnerNative: async () => null, // 서버 샌드박스 — 전용 탐지 없음
    } as unknown as TaskRuntime;
    return { rt, cmds };
}
const WROTE = new Set(['bash', 'str_replace_editor']);

describe('detectWorkspaceTestRunner', () => {
    it('프로브 출력 토큰으로 러너를 고른다', async () => {
        expect(await detectWorkspaceTestRunner(runtime(() => exec('npm\n')).rt)).toBe('npm');
        expect(await detectWorkspaceTestRunner(runtime(() => exec('pytest')).rt)).toBe('pytest');
        expect(await detectWorkspaceTestRunner(runtime(() => exec('none')).rt)).toBeNull();
        expect(await detectWorkspaceTestRunner(runtime(() => exec('')).rt)).toBeNull();
    });
    it('프로브는 npm 기본 자리표시자·node_modules 부재를 걸러내는 조건을 담는다', () => {
        expect(DETECT_PROBE).toContain('no test specified');
        expect(DETECT_PROBE).toContain('existsSync("node_modules")');
        expect(DETECT_PROBE).toContain('import pytest');
    });
});

describe('detectWorkspaceTestRunner — 실행기 전용 탐지(로컬 브리지)', () => {
    function native(answer: string | null, impl: (cmd: string) => ExecResult = () => exec('none')): { rt: TaskRuntime; cmds: string[] } {
        const r = runtime(impl);
        (r.rt as unknown as { detectTestRunnerNative: () => Promise<string | null> }).detectTestRunnerNative = async () => answer;
        return r;
    }
    it('실행기가 답하면 셸 프로브를 보내지 않는다(디바이스 확인 창이 뜨지 않는다)', async () => {
        const found = native('pytest');
        expect(await detectWorkspaceTestRunner(found.rt)).toBe('pytest');
        expect(found.cmds).toEqual([]);
        const none = native('none', () => exec('npm'));
        expect(await detectWorkspaceTestRunner(none.rt)).toBeNull();
        expect(none.cmds).toEqual([]);
    });
    it('실행기가 답하지 못하면(null) 종전 셸 프로브로 묻는다', async () => {
        const { rt, cmds } = native(null, () => exec('go'));
        expect(await detectWorkspaceTestRunner(rt)).toBe('go');
        expect(cmds).toEqual([DETECT_PROBE]);
    });
});

describe('verifyWorkspaceTests', () => {
    it('러너가 없으면 실행하지 않고 통과한다(리포트형 작업 무영향)', async () => {
        const { rt, cmds } = runtime(() => exec('none'));
        const r = await verifyWorkspaceTests(rt, 't1', WROTE, 5);
        expect(r).toEqual({ ran: false, ok: true, report: '', stepNumber: 5 });
        expect(cmds.length).toBe(1);
    });

    it('쓰기 도구를 안 쓴 작업은 프로브조차 하지 않는다', async () => {
        const { rt, cmds } = runtime(() => exec('npm'));
        const r = await verifyWorkspaceTests(rt, 't1', new Set(['grep_code', 'repo_map']), 5);
        expect(r.ran).toBe(false);
        expect(cmds.length).toBe(0);
    });

    it('러너 통과 → ran=true·ok=true, 스텝 1개 기록', async () => {
        const { rt, cmds } = runtime((cmd) => cmd === DETECT_PROBE ? exec('pytest') : exec('3 passed'));
        const r = await verifyWorkspaceTests(rt, 't1', WROTE, 5);
        expect(r.ran).toBe(true); expect(r.ok).toBe(true); expect(r.runner).toBe('pytest');
        expect(r.stepNumber).toBe(6);
        expect(cmds[1]).toBe(RUNNER_COMMANDS.pytest);
    });

    it('러너 실패 → ok=false 와 끝부분 리포트', async () => {
        const { rt } = runtime((cmd) => cmd === DETECT_PROBE ? exec('npm') : exec('a'.repeat(100) + '\nFAIL src/x.test.ts', 1));
        const r = await verifyWorkspaceTests(rt, 't1', WROTE, 0);
        expect(r.ok).toBe(false);
        expect(r.report).toContain('FAIL src/x.test.ts');
        expect(r.report).toContain('[exit=1]');
        expect(r.report).toContain('생략');
    });

    it('타임아웃도 실패로 본다', async () => {
        const { rt } = runtime((cmd) => cmd === DETECT_PROBE ? exec('go') : exec('', 0, '', true));
        expect((await verifyWorkspaceTests(rt, 't1', WROTE, 0)).ok).toBe(false);
    });

    it('증거의 러너가 감지된 러너와 같으면 실행하지 않는다(프로브만) — provenSkip', async () => {
        const { rt, cmds } = runtime((cmd) => cmd === DETECT_PROBE ? exec('pytest') : exec('3 passed'));
        const r = await verifyWorkspaceTests(rt, 't1', WROTE, 5, undefined, 'pytest');
        expect(r).toEqual({ ran: false, ok: true, report: '', stepNumber: 5, runner: 'pytest', provenSkip: true });
        expect(cmds).toEqual([DETECT_PROBE]);
    });

    it('증거의 러너가 감지된 러너와 다르면 그대로 실행한다(pytest 를 돌렸지만 게이트는 npm test)', async () => {
        const { rt, cmds } = runtime((cmd) => cmd === DETECT_PROBE ? exec('npm') : exec('FAIL', 1));
        const r = await verifyWorkspaceTests(rt, 't1', WROTE, 5, undefined, 'pytest');
        expect(r.ran).toBe(true); expect(r.ok).toBe(false); expect(r.provenSkip).toBeUndefined();
        expect(cmds[1]).toBe(RUNNER_COMMANDS.npm);
    });

    it('인프라 오류는 fail-open', async () => {
        const { rt } = runtime(() => { throw new Error('docker down'); });
        expect(await verifyWorkspaceTests(rt, 't1', WROTE, 2)).toEqual({ ran: false, ok: true, report: '', stepNumber: 2 });
    });
});

describe('tailReport', () => {
    it('상한 초과 시 끝부분을 남기고 생략 표기', () => {
        const t = tailReport('x'.repeat(50) + 'END', 10);
        expect(t.endsWith('END')).toBe(true);
        expect(t).toContain('생략');
    });
});
