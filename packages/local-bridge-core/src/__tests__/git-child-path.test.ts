/**
 * 코어가 자식에게 넘기는 PATH 는 어디서 왔든 절대경로 항목만 — 설계 2026-11-14 D-14(리뷰 r1 F1).
 * git 자식(worktree 연산·연결 시 탐지)은 exec PATH 가 아니라 프로세스 PATH 를 쓴다. 거기 상대 항목(`.`·`bin`)이 있으면
 * cwd(연결 폴더) 기준으로 풀려 폴더의 `git` 이 확인 없이 떴다. 샌드박스가 꺼져도(리눅스 CI) 도는 사례다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { collectDiagnostics } from '../diagnostics';
import { detectGit } from '../git-trust';
import { buildSandboxProfile } from '../sandbox';
import { handleWorktree } from '../worktree';
import type { BridgeResult } from '../types';

const posix = process.platform === 'win32' ? describe.skip : describe;

let root = '';
// "폴더 밖" 표식은 실제 홈 아래 임시 폴더 — 프로파일이 늘 여는 임시·캐시 경로 밖이다(tool-sandbox.test.ts 와 같다).
let outside = '';
let savedPath: string | undefined;
beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-git-child-path-')));
    outside = fs.mkdtempSync(path.join(fs.realpathSync(os.userInfo().homedir), '.omk-git-child-path-out-'));
    // 가짜 git·python3 — 폴더 안 호출 기록(샌드박스 안에서도 쓸 수 있다)과 폴더 밖 표식을 남기고, 폴더 안 디렉터리를 git 디렉터리로 답한다.
    fs.mkdirSync(path.join(root, 'store'));
    const fake = `#!/bin/sh\necho x >> '${root}/fake.calls'\ntouch '${outside}/fake.ran'\nprintf '%s\\n%s\\n%s\\n' '${root}/store' '${root}/store' '${root}'\n`;
    fs.mkdirSync(path.join(root, 'bin'));
    for (const f of ['git', 'bin/git', 'python3', 'bin/python3']) fs.writeFileSync(path.join(root, f), fake, { mode: 0o755 });
    savedPath = process.env.PATH;
    process.env.PATH = `.:bin:${savedPath ?? ''}`;
});
afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    for (const d of [root, outside]) fs.rmSync(d, { recursive: true, force: true });
});

function expectFakeNotRun(): void {
    expect(fs.existsSync(path.join(root, 'fake.calls'))).toBe(false);
    expect(fs.existsSync(path.join(outside, 'fake.ran'))).toBe(false);
}

const toolProfile = (): string | null | undefined => (SANDBOX_ENABLED ? buildSandboxProfile(root, null, true) : undefined);

posix('git 자식의 PATH 는 절대경로 항목만(D-14)', () => {
    it('연결 시 탐지(detectGit)가 폴더의 git 을 띄우지 않는다', () => {
        expect(detectGit(root)).toBeNull(); // 레포가 아닌 폴더 — 가짜 git 의 답이 신뢰 결과가 되지 않는다
        expectFakeNotRun();
    });

    it('worktree 연산(gitRun)이 폴더의 git 을 띄우지 않는다', async () => {
        const profile = toolProfile();
        const r = await new Promise<BridgeResult>((resolve, reject) => {
            handleWorktree({ kind: 'worktree', op: 'add', taskId: 'gitpath1-1111-2222-3333-444455556666' }, resolve, root, { root, git: null, profile })
                .catch(reject);
        });
        expect(r.ok).toBe(false);
        expectFakeNotRun();
    });

    it('도구의 PATH 폴백(exec PATH 없이 부른 진단)이 폴더의 python3 를 띄우지 않는다', async () => {
        fs.writeFileSync(path.join(root, 'x.py'), 'x = 1\n');
        await collectDiagnostics(root, [path.join(root, 'x.py')], undefined, toolProfile());
        expectFakeNotRun();
    });
});

// 프로세스 PATH 에 절대경로 항목이 하나도 없으면 거른 결과가 비고, POSIX 의 빈 PATH 는 현재 폴더(연결 폴더)다 —
// 고정 기본값 FALLBACK_CHILD_PATH 로 떨어져야 한다(설계 D-14 보완, 리뷰 r2 F4).
const NO_ABS_ENTRY: Array<[string, string | undefined]> = [['`.`', '.'], ['빈 값', ''], ['미설정', undefined]];
const setPath = (p: string | undefined): void => { if (p === undefined) delete process.env.PATH; else process.env.PATH = p; };

posix.each(NO_ABS_ENTRY)('프로세스 PATH 가 %s 이면 자식 PATH 는 기본값(D-14 보완)', (_label, p) => {
    it('연결 시 탐지가 폴더의 git 을 띄우지 않고, 진짜 git 이 레포가 아니라고 답한다', () => {
        setPath(p);
        expect(detectGit(root)).toBeNull();
        expectFakeNotRun();
    });

    it('레포면 진짜 git 이 그 git 디렉터리를 답한다', () => {
        execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore', env: { ...process.env, PATH: savedPath } });
        setPath(p);
        const dotGit = path.join(root, '.git');
        expect(detectGit(root)).toEqual({ gitDir: dotGit, commonDir: dotGit });
        expectFakeNotRun();
    });

    it('worktree 연산이 폴더의 git 을 띄우지 않는다', async () => {
        const profile = toolProfile();
        setPath(p);
        const r = await new Promise<BridgeResult>((resolve, reject) => {
            handleWorktree({ kind: 'worktree', op: 'add', taskId: 'gitpath1-1111-2222-3333-444455556666' }, resolve, root, { root, git: null, profile })
                .catch(reject);
        });
        expect(r.ok).toBe(false);
        expectFakeNotRun();
    });

    it('도구의 PATH 폴백이 폴더의 python3 를 띄우지 않는다', async () => {
        fs.writeFileSync(path.join(root, 'x.py'), 'x = 1\n');
        const profile = toolProfile();
        setPath(p);
        await collectDiagnostics(root, [path.join(root, 'x.py')], undefined, profile);
        expectFakeNotRun();
    });
});
