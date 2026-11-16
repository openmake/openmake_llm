/**
 * 홈 읽기 좁히기 실측(설계 2026-11-16 §5) — 연결 때 만든 실제 프로파일 텍스트로 `sandbox-exec` 를 띄워 읽기·stat 의 허용·거절을
 * 본다. 홈은 임시 홈(realpath)이다. Rust `tests/home_read_sandbox.rs` 와 같은 사례.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { SANDBOX_ENABLED } from '../constants';
import { gitConfigReads, type GitPaths } from '../git-trust';
import { buildSandboxProfiles, type Profiles, type ReadInputs } from '../sandbox';

let work = '';
let home = '';

beforeEach(() => {
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-home-read-')));
    home = path.join(work, 'home');
    fs.mkdirSync(home);
});
afterEach(() => { fs.rmSync(work, { recursive: true, force: true }); });

const file = (rel: string, text = 'x'): string => {
    const p = path.join(work, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
};
const profiles = (root: string, git: GitPaths | null = null, inputs: ReadInputs = {}): Profiles => {
    fs.mkdirSync(root, { recursive: true });
    const built = buildSandboxProfiles(root, git, git ? [git] : [], inputs, home);
    if (!built) throw new Error('프로파일 없음');
    return built;
};
const ok = (profile: string, cmd: string[]): boolean =>
    spawnSync('/usr/bin/sandbox-exec', ['-p', profile, ...cmd], { stdio: 'ignore' }).status === 0;
const cat = (profile: string, p: string): boolean => ok(profile, ['/bin/cat', p]);
const stat = (profile: string, p: string): boolean => ok(profile, ['/usr/bin/stat', p]);

const sbDescribe = SANDBOX_ENABLED ? describe : describe.skip;

sbDescribe('홈 읽기 좁히기 — 실제 sandbox-exec', () => {
    it('D-15·D-16·D-17: 도구 프로파일은 허용 목록만 읽고, exec 프로파일은 개인 폴더만 막는다', () => {
        file('home/notes.txt');
        file('home/.gitconfig', '[user]\n');
        file('home/Desktop/x');
        file('home/.ssh/x');
        file('home/.npmrc');
        const site = file('home/Library/Python/3.9/lib/python/site-packages/pytest/__init__.py', '');
        const p = profiles(path.join(work, 'root'));
        expect(cat(p.tool, path.join(home, 'notes.txt'))).toBe(false);
        expect(ok(p.tool, ['/bin/ls', home])).toBe(false);
        expect(stat(p.tool, path.join(home, 'notes.txt'))).toBe(true);
        expect(cat(p.tool, path.join(home, '.gitconfig'))).toBe(true);
        expect(cat(p.tool, site)).toBe(true); // pytest 탐지가 붙이는 사용자 site
        expect(stat(p.tool, path.join(home, '.ssh/x'))).toBe(false);
        expect(stat(p.tool, path.join(home, '.npmrc'))).toBe(false);
        expect(cat(p.tool, path.join(home, 'Desktop/x'))).toBe(false);
        expect(cat(p.exec, path.join(home, 'notes.txt'))).toBe(true);
        expect(cat(p.exec, path.join(home, '.npmrc'))).toBe(true);
        expect(cat(p.exec, path.join(home, 'Desktop/x'))).toBe(false);
        expect(stat(p.exec, path.join(home, 'Desktop'))).toBe(true);
        expect(cat(p.exec, path.join(home, '.ssh/x'))).toBe(false);
    });

    it('D-16·D-19: 연결 폴더가 개인 폴더 안이면 그 안은 읽히고 형제는 거절(두 프로파일)', () => {
        file('home/Documents/proj/a.txt');
        file('home/Documents/other.txt');
        const p = profiles(path.join(home, 'Documents/proj'));
        for (const prof of [p.exec, p.tool]) {
            expect(cat(prof, path.join(home, 'Documents/proj/a.txt'))).toBe(true);
            expect(cat(prof, path.join(home, 'Documents/other.txt'))).toBe(false);
        }
    });

    it('D-17·D-19: 연결 폴더가 홈 자신이어도 비밀은 읽기·stat 모두 거절(두 프로파일)', () => {
        file('home/.ssh/x');
        file('home/notes.txt');
        const p = profiles(home);
        for (const prof of [p.exec, p.tool]) {
            expect(cat(prof, path.join(home, '.ssh/x'))).toBe(false);
            expect(stat(prof, path.join(home, '.ssh/x'))).toBe(false);
            expect(cat(prof, path.join(home, 'notes.txt'))).toBe(true);
        }
    });

    it('D-19·§8 M1: 하위 폴더 연결은 top 이 있어야 상위 설정을 읽고, 가드에 걸린 top(홈)은 버린다', () => {
        const baseCfg = file('home/work/repo/tsconfig.base.json', '{}');
        file('home/work/repo/packages/app/a.ts', '');
        file('home/notes.txt');
        const root = path.join(home, 'work/repo/packages/app');
        expect(cat(profiles(root).tool, baseCfg)).toBe(false);
        const withTop = profiles(root, null, { top: path.join(home, 'work/repo') });
        expect(cat(withTop.tool, baseCfg)).toBe(true);
        expect(withTop.scope.allow).toContain(path.join(home, 'work/repo'));
        expect(cat(profiles(root, null, { top: home }).tool, path.join(home, 'notes.txt'))).toBe(false);
    });

    it('§8 M2: 연결 폴더와 홈 사이 조상의 버전 파일은 읽히고 같은 자리의 다른 파일은 거절', () => {
        const tv = file('home/work/.tool-versions', 'node 22\n');
        const notes = file('home/work/notes.txt');
        const p = profiles(path.join(home, 'work/proj'));
        expect(cat(p.tool, tv)).toBe(true);
        expect(cat(p.tool, notes)).toBe(false);
    });

    it('D-15 심링크·§8 M2 env 위치: realpath 가 홈의 엄격한 하위면 들어가고 홈 자신·홈 밖·개인 폴더 안이면 안 들어간다', () => {
        const dotCfg = file('home/dot/mise/config.toml', '');
        file('outside/mise/config.toml', '');
        file('home/Documents/mise-data/x', '');
        file('home/xdg/mise/config.toml', '');
        fs.mkdirSync(path.join(home, '.config'));
        fs.symlinkSync(path.join(home, 'dot/mise'), path.join(home, '.config/mise'));
        fs.symlinkSync(path.join(work, 'outside/mise'), path.join(home, '.mise'));
        fs.symlinkSync(home, path.join(home, 'mise'));
        const p = profiles(path.join(work, 'root'), null, {
            envDirs: [path.join(home, 'xdg/mise'), path.join(home, 'Documents/mise-data'), path.join(home, 'missing')],
        });
        expect(p.scope.allow).toContain(path.join(home, 'dot/mise'));
        expect(p.scope.allow).toContain(path.join(home, 'xdg/mise'));
        expect(p.scope.allow).not.toContain(path.join(work, 'outside/mise'));
        expect(p.scope.allow).not.toContain(path.join(home, 'Documents/mise-data'));
        expect(p.scope.allow).not.toContain(home);
        expect(cat(p.tool, dotCfg)).toBe(true);
    });

    it('D-18·§8 M4: 전역 git 설정의 include·excludesFile 은 literal 이 있어야 도구 git 이 읽는다', () => {
        file('home/.gitconfig', '[include]\n\tpath = ~/.gitconfig.local\n[core]\n\texcludesFile = ~/.gitignore_global\n');
        file('home/.gitconfig.local', '[user]\n\tname = t\n');
        file('home/.gitignore_global', 'ignored.txt\n');
        const root = path.join(work, 'repo');
        fs.mkdirSync(root);
        const env = { HOME: home, PATH: '/usr/bin:/bin:/opt/homebrew/bin', GIT_CONFIG_NOSYSTEM: '1' };
        execFileSync('git', ['init', '-q'], { cwd: root, env });
        file('repo/ignored.txt');
        file('repo/kept.txt');
        const git = { gitDir: path.join(root, '.git'), commonDir: path.join(root, '.git') };
        const status = (profile: string) => spawnSync('/usr/bin/sandbox-exec', ['-p', profile, 'git', 'status', '--porcelain'], { cwd: root, env, encoding: 'utf8' });
        expect(status(profiles(root, git).tool).status).not.toBe(0);
        // 코어의 탐지 git 은 프로세스 환경을 쓴다 — 이 사례만 HOME 을 임시 홈으로 바꾼다.
        const saved = { HOME: process.env.HOME, NOSYS: process.env.GIT_CONFIG_NOSYSTEM };
        process.env.HOME = home;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        let found: string[];
        try { found = gitConfigReads(root, home); } finally {
            if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
            if (saved.NOSYS === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = saved.NOSYS;
        }
        expect(found).toContain(path.join(home, '.gitconfig.local'));
        const r = status(profiles(root, git, { gitConfig: found }).tool);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('kept.txt');
        expect(r.stdout).not.toContain('ignored.txt');
    });
});
