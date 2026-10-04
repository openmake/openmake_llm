/** detectGitDir — git 레포가 아닌 폴더에서 git 의 오류 문구가 사용자 터미널로 새지 않아야 한다. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { detectGitDir } from '../sandbox';

// 실제 git 을 그대로 부르되 넘긴 옵션을 볼 수 있게 감싼다(내장 모듈 속성은 spyOn 으로 바꿀 수 없다).
jest.mock('child_process', () => {
    const actual = jest.requireActual<typeof import('child_process')>('child_process');
    return { ...actual, execFileSync: jest.fn(actual.execFileSync) };
});

let dir = '';
beforeEach(() => { dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-gitprobe-'))); });
afterEach(() => { jest.clearAllMocks(); fs.rmSync(dir, { recursive: true, force: true }); });

it('git 레포가 아니면 null 이고, git 의 stderr 를 부모 터미널에 물려주지 않는다', () => {
    expect(detectGitDir(dir)).toBeNull();
    const opts = (childProcess.execFileSync as jest.Mock).mock.calls[0][2] as { stdio?: unknown[] };
    expect(opts.stdio?.[2]).toBe('ignore');
});

it('git 레포면 .git 절대경로를 돌려준다', () => {
    childProcess.execFileSync('git', ['init', '-q'], { cwd: dir });
    expect(detectGitDir(dir)).toBe(path.join(dir, '.git'));
});
