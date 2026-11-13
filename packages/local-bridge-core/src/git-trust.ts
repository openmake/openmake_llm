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
import { GIT_FIXED_ARGS, GIT_PATH_DENIED_PREFIX, GIT_PROBE_PROFILE, GITFILE_MAX_BYTES, GIT_PROBE_TIMEOUT_MS, SANDBOX_BIN, SANDBOX_ENABLED } from './constants';
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

/**
 * realpath — **디스크의 실제 표기**(대소문자·유니코드 정규화)로. Node 의 `fs.realpathSync` 는 심링크만 풀고 입력 글자를 그대로
 * 두어, 연결 경로의 대소문자가 디스크와 다르면 git 이 답한 경로와 어긋났다(리뷰 F6). `.native` 와 `fs.promises.realpath`·Rust
 * `canonicalize` 는 실제 표기를 돌려준다.
 */
function real(p: string): string | null {
    try { return fs.realpathSync.native(p); } catch { return null; }
}

function within(p: string, dir: string): boolean {
    return p === dir || p.startsWith(dir + path.sep);
}

/**
 * 샌드박스 밖(이 프로세스)에서 git 메타 파일을 읽는다 — **일반 파일만**(lstat), max 바이트 이하만. FIFO·소켓·장치를 열면
 * 동기 읽기가 이벤트 루프를 멈춰 그 헬퍼의 모든 연결이 끊겼다(리뷰 N3). 심링크·없음·초과·실패는 null.
 */
export function readRegularFile(p: string, max = Infinity): string | null {
    try {
        const st = fs.lstatSync(p);
        return st.isFile() && st.size <= max ? fs.readFileSync(p, 'utf8') : null;
    } catch { return null; }
}

/**
 * gitfile(`gitdir: <경로>`) 이 가리키는 곳의 realpath — 상대 경로는 gitfile 이 있는 폴더 기준. 코어가 직접 읽어 해석한다:
 * 일반 파일·크기 상한 안·`gitdir: ` 로 시작하는 한 줄만 받는다(리뷰 N2·N3). git(`read_gitfile_gently`)처럼 끝의 `\r`·`\n` 은
 * 모두 떼고, `file` 이 심링크면 따라가 그 대상(일반 파일)을 읽는다 — 상대 경로는 대상이 아니라 `file` 자리 기준이다(git 실측, 리뷰 R3).
 */
function gitfileTarget(file: string): string | null {
    const at = real(file);
    const text = at === null ? null : readRegularFile(at, GITFILE_MAX_BYTES);
    if (!text?.startsWith('gitdir: ')) return null;
    const v = text.slice('gitdir: '.length).replace(/[\r\n]+$/, '');
    return v.includes('\n') || !v.trim() ? null : real(path.resolve(path.dirname(file), v.trim()));
}

/** linked worktree 메타의 `gitdir`(worktree 의 .git 을 가리킨다) — 상대 경로(worktree.useRelativePaths)는 메타 폴더 기준. 일반 파일만. */
function backlink(gitDir: string): string | null {
    const v = readRegularFile(path.join(gitDir, 'gitdir'), GITFILE_MAX_BYTES)?.trim();
    return v ? real(path.resolve(gitDir, v)) : null;
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

/**
 * 믿지 않아도(탐지 실패·불신) 지킬 git 디렉터리 — 연결 폴더의 `.git` 이 (심링크 아닌) 디렉터리면 그것(리뷰 F2), gitfile·심링크면
 * 가리키는 디렉터리의 realpath 가 연결 폴더 안일 때 그것(리뷰 N2 — `.git/HEAD` 를 깨 탐지를 실패시키면 보호가 빠졌다). 폴더 밖을
 * 가리키면 대상은 어차피 쓰기가 열리지 않는다(`.git` 자신은 파일 kind 의 이름 가드가 막는다). 쓰기 허용은 하지 않고 프로파일 금지
 * 줄·파일 kind 가드만 건다. root 는 realpath. git 을 띄우지 않고 파일만 본다.
 */
export function rootGitDir(root: string): GitPaths | null {
    const dotGit = path.join(root, '.git');
    let st: fs.Stats;
    try { st = fs.lstatSync(dotGit); } catch { return null; }
    if (st.isDirectory()) return { gitDir: dotGit, commonDir: dotGit };
    // gitfile(심링크가 가리키는 gitfile 포함, 리뷰 R3)이면 그 대상, 디렉터리를 가리키는 심링크면 그 디렉터리.
    const target = gitfileTarget(dotGit) ?? (st.isSymbolicLink() ? real(dotGit) : null);
    if (!target || !within(target, root)) return null;
    try { return fs.statSync(target).isDirectory() ? { gitDir: target, commonDir: target } : null; } catch { return null; }
}

/** 항목이 있는가(lstat — 파일·디렉터리·심링크·끊긴 심링크). */
function lexists(p: string): boolean {
    try { fs.lstatSync(p); return true; } catch { return false; }
}

/**
 * 연결 폴더 루트에 `HEAD` 항목이 있으면(lstat — 끊긴 심링크 포함) 루트 자신 — `.git` 이 없으면 사용자 git 은 루트를 git 디렉터리로
 * 읽을 수 있다(리뷰 R2·S1, `objects`·`refs` 는 파일 kind 로 만들 수 있어 조건에 넣지 않는다). 연결 때 목록에 넣어 프로파일 금지 줄을
 * 건다. 파일 kind 가드는 요청마다 다시 본다(D-11). root 는 realpath.
 */
function bareRoot(root: string): GitPaths | null {
    return lexists(path.join(root, 'HEAD')) ? { gitDir: root, commonDir: root } : null;
}

/** 지킬 git 디렉터리 목록 — 믿는 git·`rootGitDir`·`HEAD` 가 있는 루트(겹치면 하나). 프로파일 금지 줄과 파일 kind 가드가 건다. */
export function protectedGitDirs(git: GitPaths | null, root: string): GitPaths[] {
    return [git, rootGitDir(root), bareRoot(root)]
        .filter((x, i, a): x is GitPaths => !!x && a.findIndex((y) => y?.gitDir === x.gitDir && y?.commonDir === x.commonDir) === i);
}

/** 존재하는 최근접 조상의 realpath + 나머지 — 없는 파일을 쓰는 경우도 실제 위치로 본다. `created` 는 새로 생길 이름들(위에서 아래로). */
async function resolveReal(abs: string): Promise<{ real: string; created: string[] }> {
    const created: string[] = [];
    let probeAt = abs;
    while (!(await fsp.lstat(probeAt).then(() => true, () => false))) {
        created.unshift(path.basename(probeAt));
        probeAt = path.dirname(probeAt);
    }
    return { real: path.join(await fsp.realpath(probeAt), ...created), created };
}

/**
 * ASCII 대소문자 접기 — macOS 기본 볼륨은 대소문자를 무시해 `.git/COMMONDIR` 가 `commondir` 로 읽힌다(리뷰 F3). 없는 이름은
 * realpath 가 실제 표기로 바꿔 주지 못하므로 비교를 접어서 한다. 보호 이름이 모두 ASCII 라 ASCII 만 접는다(TS·Rust 같은 결과).
 * 대소문자를 구분하는 볼륨에서 `.git/CONFIG` 같은 이름까지 막는 것은 감수한다.
 */
function foldCase(s: string): string {
    return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** git 디렉터리 하나 아래에서 막는 이름 — 프로파일 끝 금지 줄과 같다. */
const GIT_DENIED_NAMES = ['config', 'commondir', 'config.worktree'];

/** 파일 kind 가드가 보는 것 — 연결 폴더 realpath 와 연결 때 정한 지킬 git 디렉터리들. */
export interface GitGuard { root: string; dirs: GitPaths[] }

/**
 * git 디렉터리 바로 아래 첫 이름에 ASCII 가 아닌 글자가 있는가 — APFS 는 유니코드 대소문자 접기로 이름을 찾아 아직 없는
 * `conﬁg`(U+FB01)·`config.worKtree`(U+212A)를 git 이 `config`·`config.worktree` 로 읽었다(리뷰 R1). git 디렉터리 최상위 이름은
 * 모두 ASCII 라 접기 표 없이 막는다. 둘째 이름부터(`refs/heads/한글` 등)는 보지 않는다.
 */
function nonAsciiFirstName(r: string, d: string): boolean {
    return r !== d && within(r, d) && /[^\x00-\x7f]/.test(r.slice(d.length + 1).split(path.sep)[0]);
}

/** git 디렉터리 하나(접은 표기)에 대해 막는 자리인가 — 자신·금지 이름·`hooks` 아래·비ASCII 첫 이름, delete 는 그것을 품은 상위 폴더도. */
function deniedUnder(r: string, d: string, del: boolean): boolean {
    return r === d || GIT_DENIED_NAMES.some((n) => r === path.join(d, n)) || within(r, path.join(d, 'hooks')) || nonAsciiFirstName(r, d) || (del && within(d, r));
}

/**
 * 규칙 3 의 폴더째 지우기 — 지울 대상이 (심링크 아닌) 디렉터리면 하위 트리에 `HEAD` 항목(ASCII 접기, 파일·심링크·디렉터리 무엇이든)이
 * 있는가. `.git` 구성 요소(ASCII 접기) 안은 들어가지 않고(규칙 1 은 `HEAD` 유무에 기대지 않는다 — 중첩 레포 폴더는 지운다), 심링크는
 * 따라가지 않으며, 첫 `HEAD` 에서 멈춘다. 폴더를 읽지 못하면 있다고 본다(막는 쪽 — 지우기도 그 폴더에서 실패한다). 상한은 두지 않는다:
 * 심링크를 따라가지 않아 트리는 유한하고, 훑기는 지우기가 어차피 하는 나열보다 적으며, 둘 다 파일 kind 시간 제한 안에서 돈다.
 */
async function headBelow(target: string): Promise<boolean> {
    if (!(await fsp.lstat(target).then((s) => s.isDirectory(), () => false))) return false;
    const stack = [target];
    for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
        let entries: fs.Dirent[];
        try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return true; }
        for (const e of entries) {
            const n = foldCase(e.name);
            if (n === 'head') return true;
            if (n !== '.git' && e.isDirectory()) stack.push(path.join(dir, e.name));
        }
    }
    return false;
}

/**
 * 파일 kind(write·delete·브라우저 저장) 가드 — git 이 저장소로 인식하는 구조를 만들거나 고치지 못한다(설계 D-11, 깊이 무관·요청
 * 시점 판정). git 은 목록이 아니라 구조(`.git` 항목, `HEAD` 가 있는 git 디렉터리 꼴)로 저장소를 찾으므로 가드도 구조를 본다:
 *  1. 연결 폴더 기준 경로에 `.git` 구성 요소가 있으면 거절 — `.git` 자신(만들기·지우기)과 그 아래 전부(worktree 의 `.git` 포함, D-4).
 *  2. 대상의 조상 폴더(연결 폴더까지) 중 `HEAD` 항목이 지금 있는(lstat) 폴더와 연결 때 정한 목록의 git 디렉터리(HEAD 유무 무관 —
 *     탐지 실패·깨진 HEAD 에서도 남는다)마다, 그 바로 아래 금지 이름·`hooks` 아래·비ASCII 첫 이름이면 거절(delete 는 목록의 git
 *     디렉터리 자신·상위 폴더도). linked 배치의 `<common>/worktrees` 도 거절한다.
 *  3. 파일 kind 는 `HEAD` 항목의 유무를 바꾸지 못한다 — 아직 없는 `HEAD` 를 새로 만드는 쓰기와, `HEAD` 자신 또는 하위 트리
 *     (`.git` 구성 요소 밖)에 `HEAD` 항목이 있는 폴더를 지우는 것을 거절(이미 있는 `HEAD` 의 내용 쓰기는 종전대로). 지우기는
 *     원자적이지 않아 폴더째 지우기가 도중에 멈추면 `HEAD` 만 없어지고 구조가 남는다(리뷰 6차 U1). 2 의 표식을 파일 kind 가
 *     움직이지 못하게 한다 — 만들기는 "`config` 먼저, `HEAD` 나중", 지우기는 "linked worktree 의 common dir 에서 `HEAD` 를 지운
 *     뒤 `config`"(리뷰 5차 T1) 순서를 닫는다. `HEAD` 는 APFS 에 다른 표기가 없어(실측) ASCII 접기로 충분하다.
 * 비교는 대상의 realpath 와 "부모의 realpath + 마지막 이름" 둘로 하고(심링크 자리 자체도 막는다), 대소문자를 접어서 한다.
 */
export async function assertGitPathAllowed(guard: GitGuard, abs: string, rel: string | undefined, del: boolean): Promise<void> {
    const { real, created } = await resolveReal(abs);
    const lexReal = path.join((await resolveReal(path.dirname(abs))).real, path.basename(abs));
    const [r, lex, root] = [real, lexReal, guard.root].map(foldCase);
    const dotGit = [r, lex].some((p) => path.relative(root, p).split(path.sep).includes('.git'));
    const headEntry = del
        ? foldCase(path.basename(lexReal)) === 'head' || await headBelow(lexReal)
        : created.some((n) => foldCase(n) === 'head');
    const dirs: string[] = [];
    let parentRename = false;
    for (const git of guard.dirs) {
        const [g, c] = [foldCase(git.gitDir), foldCase(git.commonDir)];
        dirs.push(g, c);
        parentRename ||= g !== c && (r === path.join(c, 'worktrees') || lex === path.join(c, 'worktrees'));
    }
    for (const p of [real, lexReal]) {
        for (let d = path.dirname(p); within(d, guard.root); d = path.dirname(d)) {
            if (lexists(path.join(d, 'HEAD'))) dirs.push(foldCase(d));
            if (d === guard.root) break;
        }
    }
    const denied = [...new Set(dirs)].some((d) => deniedUnder(r, d, del) || deniedUnder(lex, d, del));
    if (dotGit || headEntry || denied || parentRename) throw new Error(`${GIT_PATH_DENIED_PREFIX}${rel}`);
}
