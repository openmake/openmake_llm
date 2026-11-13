/**
 * git 디렉터리 신뢰 판정과 git 금지 경로 — 설계 2026-11-14-bridge-unconfirmed-exec D-3·D-4.
 *
 * 연결 폴더 안은 에이전트가 쓸 수 있다. 폴더의 `.git`(gitfile) 을 다른 레포의 git 디렉터리로 돌려 두면 다음 연결에서
 * 그 레포의 쓰기가 프로파일에 열렸다(I2). 그래서 git 디렉터리는 **우리 폴더를 되가리킬 때만** 믿는다 — 폴더 밖
 * git 디렉터리는 에이전트가 쓸 수 없으므로 되가리킴을 위조할 수 없다. 믿는 배치(그 밖은 git 없음):
 *  1. `<top>/.git` 이 실제 디렉터리이고 그것이 git dir 이며 common dir 와 같다(일반 레포·하위 폴더 연결).
 *  2. gitfile + linked worktree: git dir 가 `<common>/worktrees/<이름>` 이고 그 안 `gitdir` 파일이 `<top>/.git` 을 가리킨다.
 *  3. gitfile + 서브모듈: common dir 와 같은 git dir 의 `core.worktree` 가 `top` 으로 풀린다.
 *  4. git dir·common dir 가 모두 연결 폴더 안이다(어차피 쓰기 가능한 곳).
 * 1~3 은 연결 폴더가 `top` 안이어야 하고, 2·3 은 `<top>/.git` gitfile 이 그 git dir 를 가리켜야 한다.
 *
 * 탐지 git 은 프로파일 파일을 쓰기 전에 돌므로 고정 인라인 프로파일(쓰기·네트워크 금지)로 감싼다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { GIT_FIXED_ARGS, GIT_PATH_DENIED_PREFIX, GIT_PROBE_PROFILE, GIT_PROBE_TIMEOUT_MS, SANDBOX_BIN, SANDBOX_ENABLED, WORKTREE_DIR } from './constants';
import { buildExecEnv } from './exec-env';

const fsp = fs.promises;

/** 믿기로 한 git 디렉터리(둘 다 realpath). 일반 레포·서브모듈은 둘이 같다. */
export interface GitPaths { gitDir: string; commonDir: string }

/** 탐지 git 하나 — 실패·시간 초과는 null. stderr 는 버린다(레포가 아닌 폴더의 fatal 문구가 부모 터미널로 새지 않게). */
function probe(args: string[], cwd: string): string | null {
    const argv = [...GIT_FIXED_ARGS, ...args];
    const [file, full] = SANDBOX_ENABLED ? [SANDBOX_BIN, ['-p', GIT_PROBE_PROFILE, 'git', ...argv]] : ['git', argv];
    try {
        // 자식 환경은 exec 와 같은 allowlist 로 제한한다(호스트 env 의 비밀을 넘기지 않는다).
        return execFileSync(file, full, {
            cwd, encoding: 'utf8', timeout: GIT_PROBE_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'],
            env: buildExecEnv(process.env, process.env.PATH ?? ''),
        });
    } catch { return null; }
}

function real(p: string): string | null {
    try { return fs.realpathSync(p); } catch { return null; }
}

function within(p: string, dir: string): boolean {
    return p === dir || p.startsWith(dir + path.sep);
}

/** gitfile(`gitdir: <경로>`) 이 가리키는 곳의 realpath — 상대 경로는 gitfile 이 있는 폴더 기준. */
function gitfileTarget(file: string): string | null {
    try {
        const m = /^gitdir: (.+)$/m.exec(fs.readFileSync(file, 'utf8'));
        return m ? real(path.resolve(path.dirname(file), m[1].trim())) : null;
    } catch { return null; }
}

/** linked worktree 메타의 `gitdir`(worktree 의 .git 을 가리킨다) — 상대 경로(worktree.useRelativePaths)는 메타 폴더 기준. */
function backlink(gitDir: string): string | null {
    try {
        const v = fs.readFileSync(path.join(gitDir, 'gitdir'), 'utf8').trim();
        return v ? real(path.resolve(gitDir, v)) : null;
    } catch { return null; }
}

/** git dir 의 config 의 core.worktree — 상대 경로는 git dir 기준. */
function coreWorktree(gitDir: string, cwd: string): string | null {
    const v = probe(['config', '--file', path.join(gitDir, 'config'), '--get', 'core.worktree'], cwd)?.trim();
    return v ? real(path.resolve(gitDir, v)) : null;
}

/**
 * 연결 폴더의 git 디렉터리를 구해 믿을 때만 돌려준다(레포가 아니거나 믿지 않으면 null — git 없음).
 * 연결할 때 한 번 부른다. 결과는 코어가 보관해 프로파일·worktree 대조·파일 kind 가드에 쓴다.
 */
export function detectGit(root: string): GitPaths | null {
    const out = probe(['rev-parse', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir', '--show-toplevel'], root);
    const [gRaw, cRaw, topRaw] = (out ?? '').split('\n');
    if (!gRaw || !cRaw || !topRaw) return null;
    const [rootReal, gitDir, commonDir, top] = [real(root), real(gRaw), real(cRaw), real(topRaw)];
    if (!rootReal || !gitDir || !commonDir || !top) return null;
    const found = { gitDir, commonDir };
    if (within(gitDir, rootReal) && within(commonDir, rootReal)) return found; // 4
    if (!within(rootReal, top)) return null;
    const dotGit = path.join(top, '.git');
    let st: fs.Stats;
    try { st = fs.lstatSync(dotGit); } catch { return null; }
    if (st.isDirectory()) return real(dotGit) === gitDir && commonDir === gitDir ? found : null; // 1
    if (!st.isFile() || gitfileTarget(dotGit) !== gitDir) return null;
    if (path.dirname(gitDir) === path.join(commonDir, 'worktrees')) return backlink(gitDir) === real(dotGit) ? found : null; // 2
    return commonDir === gitDir && coreWorktree(gitDir, rootReal) === top ? found : null; // 3
}

/** 존재하는 최근접 조상의 realpath + 나머지 — 없는 파일을 쓰는 경우도 실제 위치로 본다. */
async function resolveReal(abs: string): Promise<string> {
    const rest: string[] = [];
    let probeAt = abs;
    while (!(await fsp.lstat(probeAt).then(() => true, () => false))) {
        rest.unshift(path.basename(probeAt));
        probeAt = path.dirname(probeAt);
    }
    return path.join(await fsp.realpath(probeAt), ...rest);
}

/** `<…>/.openmake/worktrees/<id>/.git` 또는 그 아래 — worktree 의 gitfile 을 바꾸면 worktree git 이 가짜 git 디렉터리를 쓴다(E1c). */
function isWorktreeGit(p: string): boolean {
    const seg = p.split(path.sep);
    const wt = WORKTREE_DIR.split('/');
    for (let i = 0; i + wt.length + 1 < seg.length; i++) {
        if (wt.every((w, j) => seg[i + j] === w) && seg[i + wt.length + 1] === '.git') return true;
    }
    return false;
}

/**
 * 파일 kind(write·delete) 가드 — 대상의 실제 위치가 보관한 git dir·common dir 자신·`config`·`commondir`·`hooks` 아래이거나 worktree 의
 * `.git` 이면 거절한다(exec 프로파일과 같은 금지를 지킨다). delete 는 git 디렉터리를 품은 상위 폴더도 거절한다.
 * git 없음(git === null)이면 가드가 없다(기존 동작).
 */
export async function assertGitPathAllowed(git: GitPaths | null, abs: string, rel: string | undefined, del: boolean): Promise<void> {
    if (!git) return;
    const r = await resolveReal(abs);
    const denied = [...new Set([git.gitDir, git.commonDir])].some((d) => {
        const hooks = path.join(d, 'hooks');
        return r === d || r === path.join(d, 'config') || r === path.join(d, 'commondir') || within(r, hooks) || (del && within(d, r));
    });
    if (denied || isWorktreeGit(r)) throw new Error(`${GIT_PATH_DENIED_PREFIX}${rel}`);
}
