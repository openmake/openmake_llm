/**
 * 연결할 때 git 디렉터리를 "우리 폴더를 되가리킬 때만" 믿는다 — 설계 D-3.
 * 폴더 안은 에이전트가 쓸 수 있다. `.git` 을 다른 레포의 git 디렉터리로 돌려 두어도 다음 연결에서 그 레포의 쓰기가
 * 열리지 않아야 한다(I2). 폴더 밖 git 디렉터리는 에이전트가 쓸 수 없으므로 되가리킴을 위조할 수 없다.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { detectGit } from '../git-trust';

let tmp = '';
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-gittrust-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', '-c', 'protocol.file.allow=always', ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' },
    });
}
function makeRepo(rel: string): string {
    const repo = path.join(tmp, rel);
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'base');
    return repo;
}

const posix = process.platform === 'win32' ? describe.skip : describe;

posix('detectGit — 믿는 네 배치', () => {
    it('1. 레포 루트 연결', () => {
        const repo = makeRepo('repo');
        expect(detectGit(repo)).toEqual({ gitDir: `${repo}/.git`, commonDir: `${repo}/.git` });
    });

    it('1. 레포 하위 폴더 연결(git 디렉터리가 폴더 밖)', () => {
        const repo = makeRepo('repo');
        fs.mkdirSync(path.join(repo, 'apps', 'web'), { recursive: true });
        expect(detectGit(path.join(repo, 'apps', 'web'))).toEqual({ gitDir: `${repo}/.git`, commonDir: `${repo}/.git` });
    });

    it('2. linked worktree(gitfile, 공통 git 디렉터리가 따로)', () => {
        const repo = makeRepo('repo');
        git(repo, 'worktree', 'add', '-q', path.join(tmp, 'lw'), '-b', 'lw');
        expect(detectGit(path.join(tmp, 'lw'))).toEqual({ gitDir: `${repo}/.git/worktrees/lw`, commonDir: `${repo}/.git` });
    });

    it('3. 서브모듈(core.worktree 가 되가리킨다)', () => {
        makeRepo('sub');
        const sup = makeRepo('sup');
        git(sup, 'submodule', 'add', '-q', '../sub', 'm');
        expect(detectGit(path.join(sup, 'm'))).toEqual({ gitDir: `${sup}/.git/modules/m`, commonDir: `${sup}/.git/modules/m` });
    });

    it('4. git 디렉터리가 연결 폴더 안(gitfile 이 폴더 안 디렉터리를 가리킨다)', () => {
        const repo = makeRepo('repo');
        fs.renameSync(path.join(repo, '.git'), path.join(repo, 'store.git'));
        fs.writeFileSync(path.join(repo, '.git'), 'gitdir: store.git\n');
        expect(detectGit(repo)).toEqual({ gitDir: `${repo}/store.git`, commonDir: `${repo}/store.git` });
    });
});

posix('detectGit — 믿지 않는다(git 없음으로 본다)', () => {
    it('레포가 아니면 null', () => {
        fs.mkdirSync(path.join(tmp, 'plain'));
        expect(detectGit(path.join(tmp, 'plain'))).toBeNull();
    });

    it('되가리킴이 없는 gitfile — 다른 레포의 git 디렉터리를 가리킨다', () => {
        const other = makeRepo('other');
        const folder = path.join(tmp, 'folder');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, '.git'), `gitdir: ${other}/.git\n`);
        expect(detectGit(folder)).toBeNull();
    });

    it('다른 레포의 linked worktree 메타를 가리키는 gitfile(되가리킴이 다른 곳)', () => {
        const other = makeRepo('other');
        git(other, 'worktree', 'add', '-q', path.join(tmp, 'olw'), '-b', 'olw');
        const folder = path.join(tmp, 'folder');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, '.git'), `gitdir: ${other}/.git/worktrees/olw\n`);
        expect(detectGit(folder)).toBeNull();
    });

    it('core.worktree 가 연결 폴더를 감싸지 않는 서브모듈 git 디렉터리', () => {
        makeRepo('sub');
        const sup = makeRepo('sup');
        git(sup, 'submodule', 'add', '-q', '../sub', 'm');
        const folder = path.join(tmp, 'folder');
        fs.mkdirSync(folder);
        fs.writeFileSync(path.join(folder, '.git'), `gitdir: ${sup}/.git/modules/m\n`);
        expect(detectGit(folder)).toBeNull();
    });

    it('폴더 안 git 디렉터리의 commondir 가 폴더 밖을 가리킨다', () => {
        const other = makeRepo('other');
        const repo = makeRepo('repo');
        fs.writeFileSync(path.join(repo, '.git', 'commondir'), `${other}/.git\n`);
        expect(detectGit(repo)).toBeNull();
    });

    it('분리 git 디렉터리(--separate-git-dir, core.worktree 없음)는 되가리킴이 없어 믿지 않는다', () => {
        git(tmp, 'init', '-q', `--separate-git-dir=${tmp}/sep.git`, 'r1');
        expect(detectGit(path.join(tmp, 'r1'))).toBeNull();
    });
});
