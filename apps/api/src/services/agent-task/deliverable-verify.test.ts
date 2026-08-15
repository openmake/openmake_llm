// VERIFY_MODE 는 .env 의 AGENT_TASK_VERIFY_MODE 에 좌우된다(운영 'run').
// 이 스위트는 기본 모드(syntax: py_compile · node --check)를 검증하므로 고정해 결정적으로 만든다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, VERIFY_MODE: 'syntax' },
    };
});

import { verifyCodeArtifacts } from './deliverable-verify';
import type { TaskRuntime } from '../task-sandbox/runtime';
import type { ExtractedArtifact } from '../../llm/artifact-parser';
import type { ExecResult } from '../task-sandbox/sandbox';

function artifact(partial: Partial<ExtractedArtifact>): ExtractedArtifact {
    return { id: 'a', kind: 'code', title: 't', lang: 'python', content: 'print(1)', ...partial };
}

/** exec 결과를 스텁하고 실행된 명령을 기록하는 가짜 runtime. */
function fakeRuntime(execImpl: (cmd: string) => ExecResult): {
    runtime: TaskRuntime;
    writes: Array<{ path: string; content: string }>;
    cmds: string[];
    deletes: string[];
} {
    const writes: Array<{ path: string; content: string }> = [];
    const cmds: string[] = [];
    const deletes: string[] = [];
    const runtime = {
        writeWorkspaceFile: async (path: string, content: string | Buffer) => {
            writes.push({ path, content: String(content) });
        },
        execRaw: async (cmd: string): Promise<ExecResult> => {
            cmds.push(cmd);
            return execImpl(cmd);
        },
        deleteWorkspaceFile: async (path: string) => {
            deletes.push(path);
        },
    } as unknown as TaskRuntime;
    return { runtime, writes, cmds, deletes };
}

const OK: ExecResult = { stdout: '', stderr: '', exitCode: 0, truncated: false, timedOut: false, durationMs: 5 };
const FAIL: ExecResult = { stdout: '', stderr: 'SyntaxError: invalid syntax', exitCode: 1, truncated: false, timedOut: false, durationMs: 5 };

describe('verifyCodeArtifacts', () => {
    it('검사 대상 없음(마크다운) → ok', async () => {
        const { runtime, cmds } = fakeRuntime(() => OK);
        const r = await verifyCodeArtifacts(runtime, [artifact({ kind: 'markdown', lang: null })]);
        expect(r.ok).toBe(true);
        expect(cmds).toHaveLength(0);
    });

    it('파이썬 통과 → ok, py_compile 실행', async () => {
        const { runtime, cmds } = fakeRuntime(() => OK);
        const r = await verifyCodeArtifacts(runtime, [artifact({ lang: 'python' })]);
        expect(r.ok).toBe(true);
        expect(cmds[0]).toContain('py_compile');
    });

    it('문법 오류 → ok=false + stderr 리포트', async () => {
        const { runtime } = fakeRuntime(() => FAIL);
        const r = await verifyCodeArtifacts(runtime, [artifact({ lang: 'python', title: '분석 스크립트' })]);
        expect(r.ok).toBe(false);
        expect(r.report).toContain('SyntaxError');
        expect(r.report).toContain('분석 스크립트');
    });

    it('검증 프로브 파일은 검사 후 삭제된다 (성공·실패 모두)', async () => {
        const ok = fakeRuntime(() => OK);
        await verifyCodeArtifacts(ok.runtime, [artifact({ lang: 'python' })]);
        expect(ok.deletes).toEqual(['.verify_0.py']);
        const fail = fakeRuntime(() => FAIL);
        await verifyCodeArtifacts(fail.runtime, [artifact({ lang: 'python' })]);
        expect(fail.deletes).toEqual(['.verify_0.py']);
    });

    it('js 는 node --check 로 검사', async () => {
        const { runtime, cmds } = fakeRuntime(() => OK);
        await verifyCodeArtifacts(runtime, [artifact({ lang: 'js', content: 'const x=1' })]);
        expect(cmds[0]).toContain('node --check');
    });

    it('검사 불가 언어(ts) → 통과(스킵)', async () => {
        const { runtime, cmds } = fakeRuntime(() => FAIL);
        const r = await verifyCodeArtifacts(runtime, [artifact({ lang: 'typescript' })]);
        expect(r.ok).toBe(true);
        expect(cmds).toHaveLength(0);
    });

    it('execRaw throw → fail-open(ok)', async () => {
        const { runtime } = fakeRuntime(() => { throw new Error('docker down'); });
        const r = await verifyCodeArtifacts(runtime, [artifact({ lang: 'python' })]);
        expect(r.ok).toBe(true);
    });

    it('aborted signal → 즉시 ok', async () => {
        const { runtime, cmds } = fakeRuntime(() => OK);
        const ac = new AbortController();
        ac.abort();
        const r = await verifyCodeArtifacts(runtime, [artifact({ lang: 'python' })], ac.signal);
        expect(r.ok).toBe(true);
        expect(cmds).toHaveLength(0);
    });
});
