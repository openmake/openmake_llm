/** detectGit — 탐지 git 의 stderr·환경이 새지 않고, macOS 에서는 고정 인라인 프로파일 안에서 돈다. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { GIT_FIXED_ARGS, GIT_PROBE_PROFILE, SANDBOX_BIN, SANDBOX_ENABLED } from '../constants';
import { detectGit } from '../git-trust';

// 실제 git 을 그대로 부르되 넘긴 옵션을 볼 수 있게 감싼다(내장 모듈 속성은 spyOn 으로 바꿀 수 없다).
jest.mock('child_process', () => {
    const actual = jest.requireActual<typeof import('child_process')>('child_process');
    return { ...actual, execFileSync: jest.fn(actual.execFileSync) };
});

const SECRETS = { OMK_COMPANION_API_KEY: 'omk_live_secret', GITHUB_TOKEN: 'ghp_fake' };
let dir = '';
beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-gitprobe-')));
    Object.assign(process.env, SECRETS);
});
afterEach(() => {
    jest.clearAllMocks();
    for (const k of Object.keys(SECRETS)) delete process.env[k];
    fs.rmSync(dir, { recursive: true, force: true });
});

type Opts = { stdio?: unknown[]; env?: Record<string, string> };
const call = (n = 0): [string, string[], Opts] => (childProcess.execFileSync as jest.Mock).mock.calls[n] as [string, string[], Opts];

it('git 레포가 아니면 null 이고, git 의 stderr 를 부모 터미널에 물려주지 않는다', () => {
    expect(detectGit(dir)).toBeNull();
    expect(call()[2].stdio?.[2]).toBe('ignore');
});

it('git 레포면 git 디렉터리를 돌려준다 — 자식 환경에 비밀이 없고 고정 인자·인라인 프로파일로 띄운다', () => {
    childProcess.execFileSync('git', ['init', '-q'], { cwd: dir });
    (childProcess.execFileSync as jest.Mock).mockClear();
    expect(detectGit(dir)).toEqual({ gitDir: path.join(dir, '.git'), commonDir: path.join(dir, '.git') });
    const [file, args, opts] = call();
    for (const k of Object.keys(SECRETS)) expect(opts.env).not.toHaveProperty(k);
    expect(opts.env?.PATH).toBe(process.env.PATH);
    const gitArgs = [...GIT_FIXED_ARGS, 'rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir', '--show-toplevel'];
    if (SANDBOX_ENABLED) expect([file, args]).toEqual([SANDBOX_BIN, ['-p', GIT_PROBE_PROFILE, 'git', ...gitArgs]]);
    else expect([file, args]).toEqual(['git', gitArgs]);
});
