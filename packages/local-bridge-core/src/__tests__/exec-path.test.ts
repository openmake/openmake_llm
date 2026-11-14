/**
 * exec PATH 계산의 두 자식(로그인 셸·mise)이 어디서·무엇에 싸여 뜨는가 — 설계 2026-11-14 D-13·D-6.
 * 병합 규칙(순서·중복·상대 항목)은 적합성 fixture `exec-path` 가 본다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveExecPath } from '../exec-path';

// os.homedir()(libuv 는 실제 환경의 HOME 을 읽는다)가 사례의 가짜 홈을 따라오게 한다 — 적합성 러너와 같은 방식.
jest.mock('os', () => {
    const actual = jest.requireActual<typeof import('os')>('os');
    return { ...actual, homedir: (): string => process.env.HOME ?? actual.homedir() };
});

const darwin = process.platform === 'darwin' ? it : it.skip;

function withEnv<T>(env: Record<string, string>, fn: () => T): T {
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

let tmp = '';
beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-exec-path-')));
    for (const d of ['home', 'zdot', 'root']) fs.mkdirSync(path.join(tmp, d));
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('로그인 셸 PATH 조회(D-13)', () => {
    // 사용자 로그인 rc 에 cwd 를 읽는 훅(mise activate·direnv)이 있으면 연결 폴더 설정이 샌드박스 밖에서 돈다 — 홈에서 띄운다.
    darwin('프로세스 cwd 가 아니라 홈에서 뜬다', () => {
        const home = path.join(tmp, 'home');
        fs.writeFileSync(path.join(tmp, 'zdot', '.zprofile'), `pwd -P > '${tmp}/login.cwd'\n`);
        withEnv({ HOME: home, ZDOTDIR: path.join(tmp, 'zdot'), SHELL: '/bin/zsh' }, () => resolveExecPath(path.join(tmp, 'root')));
        expect(fs.readFileSync(path.join(tmp, 'login.cwd'), 'utf8')).toBe(`${home}\n`);
    });
});
