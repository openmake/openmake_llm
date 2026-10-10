/**
 * 고정 명령(셸 경로 탐색·테스트 러너 탐지·편집 후 진단)의 자식 환경 — exec 와 같은 allowlist 만 넘어가는지 본다.
 * 자식 자리에 "자기 env 를 파일로 남기는" 가짜 실행 파일을 두고, 부모 env 에 심은 가짜 비밀이 거기 없는지 확인한다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveExecPath } from '../exec-path';
import { detectTestRunner } from '../test-runner';
import { collectDiagnostics } from '../diagnostics';
import { gitRun, handleWorktree } from '../worktree';
import { detectGitDir } from '../sandbox';
import { execFileSync } from 'child_process';
import type { BridgeMsg, BridgeResult } from '../types';

const SECRETS = { OMK_COMPANION_API_KEY: 'omk_live_secret', FAKE_VENDOR_API_KEY: 'sk-fake', GITHUB_TOKEN: 'ghp_fake', OMK_BRIDGE_AUTO_APPROVE: '1' };

let base = '';
let bin = '';
let saved: NodeJS.ProcessEnv = {};

beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-fixed-env-')));
    bin = path.join(base, '.fakebin');
    fs.mkdirSync(bin);
    saved = { ...process.env };
    Object.assign(process.env, SECRETS);
});
afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    fs.rmSync(base, { recursive: true, force: true });
});

/** env 를 `<base>/<name>.env` 에 남기고 stdout 한 줄을 찍은 뒤 성공으로 끝나는 가짜 실행 파일. */
function fakeBin(name: string, stdout = ''): string {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/bin/sh\n/usr/bin/env > "${path.join(base, `${name}.env`)}"\nprintf '%s' "${stdout}"\n`);
    fs.chmodSync(p, 0o755);
    return p;
}

function childEnv(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(path.join(base, `${name}.env`), 'utf8').split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
    }
    return out;
}

function expectNoSecrets(env: Record<string, string>): void {
    for (const k of Object.keys(SECRETS)) expect(env).not.toHaveProperty(k);
}

const posix = process.platform === 'win32' ? describe.skip : describe;

posix('고정 명령의 자식 환경', () => {
    it('테스트 러너 탐지: python3 자식에 비밀이 없고 PATH·HOME 은 있다', async () => {
        fs.writeFileSync(path.join(base, 'test_a.py'), 'def test_a():\n    assert True\n');
        fakeBin('python3');
        expect(await detectTestRunner(base, bin)).toBe('pytest');
        const env = childEnv('python3');
        expectNoSecrets(env);
        expect(env.PATH).toBe(bin);
        expect(env.HOME).toBe(process.env.HOME);
    });

    it('편집 후 진단: python3 자식에 비밀이 없고 PATH·HOME 은 있다', async () => {
        const file = path.join(base, 'a.py');
        fs.writeFileSync(file, 'x = 1\n');
        fakeBin('python3');
        const r = await collectDiagnostics(base, [file], bin);
        expect(r.serverKind).toBe('py_compile');
        const env = childEnv('python3');
        expectNoSecrets(env);
        expect(env.PATH).toBe(bin);
        expect(env.HOME).toBe(process.env.HOME);
    });

    it('편집 후 진단: execPath 를 안 줘도 비밀 없이 프로세스 PATH 로 돈다', async () => {
        const file = path.join(base, 'a.py');
        fs.writeFileSync(file, 'x = 1\n');
        fakeBin('python3');
        process.env.PATH = `${bin}:${saved.PATH ?? ''}`;
        await collectDiagnostics(base, [file]);
        const env = childEnv('python3');
        expectNoSecrets(env);
        expect(env.PATH).toBe(process.env.PATH);
    });

    it('셸 경로 탐색: 로그인 셸·mise 자식에 비밀이 없고, 위치 변수는 넘어가며 결과 PATH 는 그대로 병합된다', () => {
        process.env.SHELL = fakeBin('loginshell', '/from/login/shell');
        fakeBin('mise', '/from/mise');
        process.env.PATH = `${bin}:/usr/bin:/bin`;
        process.env.MISE_DATA_DIR = '/custom/mise';
        process.env.XDG_CONFIG_HOME = '/custom/xdg';
        process.env.ZDOTDIR = '/custom/zdot';

        const parts = resolveExecPath(base).split(':');
        expect(parts[0]).toBe('/from/mise');
        expect(parts).toEqual(expect.arrayContaining(['/from/login/shell', bin, '/usr/bin', '/opt/homebrew/bin']));

        const shellEnv = childEnv('loginshell');
        expectNoSecrets(shellEnv);
        expect(shellEnv.HOME).toBe(process.env.HOME);
        expect(shellEnv.SHELL).toBe(process.env.SHELL);
        expect(shellEnv.PATH).toBe(process.env.PATH);
        expect(shellEnv.ZDOTDIR).toBe('/custom/zdot');

        const miseEnv = childEnv('mise');
        expectNoSecrets(miseEnv);
        expect(miseEnv.HOME).toBe(process.env.HOME);
        expect(miseEnv.PATH.split(':')).toEqual(expect.arrayContaining(['/from/login/shell', bin]));
        expect(miseEnv.MISE_DATA_DIR).toBe('/custom/mise');
        expect(miseEnv.XDG_CONFIG_HOME).toBe('/custom/xdg');
    });

    it('worktree git: git 자식에 비밀이 없고 PATH·HOME 은 있다', async () => {
        fakeBin('git');
        process.env.PATH = `${bin}:${saved.PATH ?? ''}`;
        expect((await gitRun(['status', '--porcelain'], base)).code).toBe(0);
        const env = childEnv('git');
        expectNoSecrets(env);
        expect(env.PATH).toBe(process.env.PATH);
        expect(env.HOME).toBe(process.env.HOME);
    });

    it('샌드박스 git 탐지: git 자식에 비밀이 없고 PATH·HOME 은 있다', () => {
        fakeBin('git', '/some/repo/.git');
        process.env.PATH = `${bin}:${saved.PATH ?? ''}`;
        expect(detectGitDir(base)).toBe('/some/repo/.git');
        const env = childEnv('git');
        expectNoSecrets(env);
        expect(env.PATH).toBe(process.env.PATH);
        expect(env.HOME).toBe(process.env.HOME);
    });

    it('worktree add: 레포의 post-checkout 훅에 비밀이 넘어가지 않는다', async () => {
        const repo = path.join(base, 'repo');
        fs.mkdirSync(repo);
        const git = (...a: string[]): void => { execFileSync('git', a, { cwd: repo, stdio: 'ignore' }); };
        git('init', '-q');
        git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
        const hook = path.join(repo, '.git', 'hooks', 'post-checkout');
        fs.writeFileSync(hook, `#!/bin/sh\n/usr/bin/env > "${path.join(base, 'hook.env')}"\n`);
        fs.chmodSync(hook, 0o755);

        const r = await new Promise<BridgeResult>((resolve) => { void handleWorktree({ op: 'add', taskId: 'abcdef12-hook' } as unknown as BridgeMsg, resolve, repo); });
        expect(r.ok).toBe(true);
        const env = childEnv('hook');
        expectNoSecrets(env);
        expect(env.HOME).toBe(process.env.HOME);
    });
});
