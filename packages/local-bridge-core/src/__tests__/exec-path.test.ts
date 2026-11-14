/**
 * exec PATH 계산의 두 자식(로그인 셸·mise)이 어디서·무엇에 싸여 뜨는가 — 설계 2026-11-14 D-13·D-6.
 * 병합 규칙(순서·중복·상대 항목)은 적합성 fixture `exec-path` 가 본다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { BridgeCore } from '../core';
import { onPath, resolveExecPath } from '../exec-path';
import { buildSandboxProfile } from '../sandbox';
import type { BridgeMsg, BridgeResult } from '../types';

// os.homedir()(libuv 는 실제 환경의 HOME 을 읽는다)가 사례의 가짜 홈을 따라오게 한다 — 적합성 러너와 같은 방식.
jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

const darwin = process.platform === 'darwin' ? it : it.skip;
const sandboxed = SANDBOX_ENABLED ? it : it.skip;
// 실제 mise 사례 — mise 가 PATH 에 없으면 건너뛴다(CI ubuntu 에는 샌드박스·mise 가 없다).
const withMise = SANDBOX_ENABLED && onPath('mise', process.env.PATH ?? '') ? it : it.skip;

function withEnv<T>(env: Record<string, string>, fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

async function withEnvAsync<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    try { return await fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

let tmp = '';
let root = '';
// "폴더 밖" 대상은 실제 홈 아래 임시 폴더 — 프로파일이 늘 여는 임시·캐시 경로 밖이다(tool-sandbox.test.ts 와 같다).
let outside = '';
beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-exec-path-')));
    for (const d of ['home', 'zdot', 'root']) fs.mkdirSync(path.join(tmp, d));
    root = path.join(tmp, 'root');
    outside = fs.mkdtempSync(path.join(fs.realpathSync(os.userInfo().homedir), '.omk-exec-path-out-'));
});
afterEach(() => { for (const d of [tmp, outside]) fs.rmSync(d, { recursive: true, force: true }); });

/** 가짜 mise — 표식을 만들고(실패해도 계속) 경로 한 줄을 낸다. 로그인 셸은 없는 파일로 둬 PATH 앞의 가짜만 찾게 한다. */
function fakeMiseEnv(mark: string): Record<string, string> {
    const bin = path.join(tmp, 'fakebin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'mise'), `#!/bin/sh\ntouch '${mark}'\necho /m/fake\n`, { mode: 0o755 });
    return { PATH: `${bin}:/usr/bin:/bin`, SHELL: path.join(tmp, 'no-such-shell') };
}

describe('로그인 셸 PATH 조회(D-13)', () => {
    // 사용자 로그인 rc 에 cwd 를 읽는 훅(mise activate·direnv)이 있으면 연결 폴더 설정이 샌드박스 밖에서 돈다 — 홈에서 띄운다.
    darwin('프로세스 cwd 가 아니라 홈에서 뜬다', () => {
        const home = path.join(tmp, 'home');
        fs.writeFileSync(path.join(tmp, 'zdot', '.zprofile'), `pwd -P > '${tmp}/login.cwd'\n`);
        withEnv({ HOME: home, ZDOTDIR: path.join(tmp, 'zdot'), SHELL: '/bin/zsh' }, () => resolveExecPath(root));
        expect(fs.readFileSync(path.join(tmp, 'login.cwd'), 'utf8')).toBe(`${home}\n`);
    });
});

describe('로그인 셸 자식의 PATH(D-14)', () => {
    it('프로세스 PATH 의 상대 항목(`.`·`bin`)을 넘기지 않는다', () => {
        const [sh, mark] = [path.join(tmp, 'login-sh'), path.join(tmp, 'login.path')];
        fs.writeFileSync(sh, `#!/bin/sh\nprintf %s "$PATH" > '${mark}'\nprintf %s "$PATH"\n`, { mode: 0o755 });
        withEnv({ HOME: path.join(tmp, 'home'), PATH: '.:bin:/usr/bin:/bin', SHELL: sh }, () => resolveExecPath(root, null));
        expect(fs.readFileSync(mark, 'utf8')).toBe('/usr/bin:/bin');
    });
});

describe('PATH 조회 자식의 stderr(D-6 보완)', () => {
    // 감싼 mise 는 상태를 못 써 경고를 보통 낸다(실측 n4) — 에이전트가 쓴 설정 내용이 CLI 사용자의 터미널로 가지 않게 버린다.
    // 자식이 부모의 stderr(fd 2)를 물려받는지는 프로세스 밖에서만 보인다 — 자식 node 로 resolveExecPath 를 불러 stderr 를 잡는다.
    it('로그인 셸·mise 가 stderr 에 쓴 글자가 부모 stderr 로 새지 않는다', () => {
        const bin = path.join(tmp, 'fakebin');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'mise'), '#!/bin/sh\necho MISE-STDERR >&2\necho /m/fake\n', { mode: 0o755 });
        const sh = path.join(tmp, 'login-sh');
        fs.writeFileSync(sh, '#!/bin/sh\necho LOGIN-STDERR >&2\nprintf %s /usr/bin\n', { mode: 0o755 });
        const mod = JSON.stringify(path.join(__dirname, '..', 'exec-path'));
        const r = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e',
            `process.stdout.write(require(${mod}).resolveExecPath(${JSON.stringify(root)}))`], {
            cwd: path.join(__dirname, '..', '..'), encoding: 'utf8',
            env: { ...process.env, HOME: path.join(tmp, 'home'), PATH: `${bin}:/usr/bin:/bin`, SHELL: sh },
        });
        expect({ status: r.status, first: r.stdout.split(':')[0], stderr: r.stderr }).toEqual({ status: 0, first: '/m/fake', stderr: '' });
    });
});

/**
 * 실제 mise 의 상태(신뢰·추적 기록)는 폴더 밖 임시 폴더에 둔다 — 사용자의 `~/.local/state/mise` 에 남기지 않고, 프로파일이 쓰기를
 * 열지 않은 자리라 감싼 mise 는 실제처럼 상태를 못 쓴다(실측 n4).
 */
const miseState = (): Record<string, string> => ({ MISE_STATE_DIR: path.join(outside, 'mise-state') });

describe('mise bin-paths 는 도구 프로파일 안에서(D-6)', () => {
    it('undefined(샌드박스 꺼짐)면 감싸지 않고 띄운다', () => {
        const mark = path.join(outside, 'mise.ran');
        const got = withEnv(fakeMiseEnv(mark), () => resolveExecPath(root, undefined));
        expect({ ran: fs.existsSync(mark), first: got.split(':')[0] }).toEqual({ ran: true, first: '/m/fake' });
    });

    it('null(켜졌는데 프로파일 없음)이면 mise 를 띄우지 않고 기본 PATH 만 쓴다', () => {
        const mark = path.join(tmp, 'mise.ran');
        const got = withEnv(fakeMiseEnv(mark), () => resolveExecPath(root, null));
        expect({ ran: fs.existsSync(mark), hasMise: got.split(':').includes('/m/fake') }).toEqual({ ran: false, hasMise: false });
    });

    sandboxed('프로파일이면 그 안에서 띄운다 — 폴더 밖에 못 쓰고 출력은 그대로 앞에 둔다', () => {
        const mark = path.join(outside, 'mise.ran');
        const profile = buildSandboxProfile(root, null, true);
        const got = withEnv(fakeMiseEnv(mark), () => resolveExecPath(root, profile));
        expect({ ran: fs.existsSync(mark), first: got.split(':')[0] }).toEqual({ ran: false, first: '/m/fake' });
    });

    // I1 재현(설계 실측 m1·m3) — 신뢰된 설정의 exec() 가 감싸지 않으면 폴더 밖에 쓰고, 도구 프로파일 안에서는 못 쓴다.
    withMise('신뢰된 mise.toml 의 exec() 가 폴더 밖에 쓰지 못한다', () => {
        const mark = path.join(outside, 'mise.mark');
        const cfg = path.join(root, 'mise.toml');
        fs.writeFileSync(cfg, `[env]\nOMK_PROBE = "{{ exec(command='touch ${mark}; echo v') }}"\n`);
        withEnv(miseState(), () => {
            // env 를 넘긴다 — jest 의 process.env 를 바꿔도 child_process 의 기본 환경(실제 프로세스)에는 닿지 않는다.
            execFileSync('mise', ['trust', cfg], { stdio: 'ignore', env: process.env });
            try {
                resolveExecPath(root, undefined); // 대조 — 설정이 실제로 실행되는 사례인지
                const control = fs.existsSync(mark);
                fs.rmSync(mark, { force: true });
                resolveExecPath(root, buildSandboxProfile(root, null, true));
                expect({ control, wrapped: fs.existsSync(mark) }).toEqual({ control: true, wrapped: false });
            } finally {
                execFileSync('mise', ['trust', '--untrust', cfg], { stdio: 'ignore', env: process.env });
            }
        });
    });

    // 실측 n3~n5 — 감싼 bin-paths 는 상태 파일을 못 써 경고만 내고 같은 경로를 낸다.
    withMise('감싼 bin-paths 가 감싸지 않은 것과 같은 PATH 를 낸다', () => {
        withEnv(miseState(), () => {
            expect(resolveExecPath(root, buildSandboxProfile(root, null, true))).toBe(resolveExecPath(root, undefined));
        });
    });

    // 코어의 세 PATH 계산 자리(exec·lsp_diagnostics·test_runner)가 도구 프로파일을 넘긴다 — 연결 때 만든 그 프로파일이다.
    sandboxed.each<[string, BridgeMsg]>([
        ['exec', { kind: 'exec', command: 'true' }],
        ['lsp_diagnostics', { kind: 'lsp_diagnostics', paths: [] }],
        ['test_runner', { kind: 'test_runner', path: '.' }],
    ])('코어 %s 의 PATH 계산도 도구 프로파일 안에서 mise 를 띄운다', async (_k, msg) => {
        const mark = path.join(outside, 'mise.ran');
        const r = await withEnvAsync(fakeMiseEnv(mark), async () => {
            const core = new BridgeCore({ folder: root, confirm: async () => 'yes', sandboxProfileDir: path.join(tmp, 'prof') });
            core.prepare();
            return new Promise<BridgeResult>((resolve, reject) => { core.handleExec(msg, resolve).catch(reject); });
        });
        expect({ ok: r.ok, ran: fs.existsSync(mark) }).toEqual({ ok: true, ran: false });
    });
});
