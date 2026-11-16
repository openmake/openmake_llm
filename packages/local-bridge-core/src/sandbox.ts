/**
 * exec OS 샌드박스 (macOS sandbox-exec) 프로파일 생성.
 *
 * 승인된 명령이라도 OS 레벨에서 ① 연결 폴더 밖 쓰기 ② 비밀 파일 읽기를 차단한다.
 * 승인 게이트(사용자 확인)의 백스톱 — 오승인·프롬프트 인젝션으로 새는 피해를 제한.
 * 읽기는 폭넓게 허용(개발 명령 호환), 네트워크도 허용(npm/git 필수) — 막는 축은 '파괴'와 '비밀'.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CACHE_SUBPATHS, GIT_CONFIG_READ_MAX, HOME_PRIVACY_SUBPATHS, PATH_PROBE_ENV_EXTRA_POSIX, SANDBOX_BIN, SANDBOX_PROFILE_MISSING_ERROR,
    LINK_HOP_MAX, SANDBOX_SPAWN_ERROR_PREFIX, SECRET_SUBPATHS, sbq, sbSub, TOOL_ANCESTOR_MAX, TOOL_ANCESTOR_READ_NAMES, TOOL_HOME_READ_SUBPATHS,
    TOOL_READ_EXTRA_MAX, TOOL_SECRET_SUBPATHS,
} from './constants';
import type { GitPaths } from './git-trust';

/** SBPL literal 용 정규화 — `path.join` 결과에서 끝 구분자를 뗀다(literal 은 글자 그대로 비교한다). */
function literalPath(p: string): string {
    return path.join(p).replace(/\/+$/, '') || '/';
}

/**
 * 도구 프로파일 홈 읽기의 연결 때 입력(설계 2026-11-16 D-15·D-18·D-19·§8) — 모두 FS 를 보는 층이 realpath 로 넘긴다.
 * top: 믿는 git 의 작업 트리 최상위(가드를 통과하고 root 와 다를 때만 다시 연다, 두 프로파일). extra: 추가 subpath(env 위치,
 * 허용 항목 심링크의 realpath 순서). literals: git 설정이 가리키는 파일. 가드·중복 제거·상한은 sandboxProfileText 가 건다.
 */
export interface ToolRead { top?: string | null; extra?: string[]; literals?: string[] }
/** 도구 프로파일이 홈에서 읽기를 여는 범위 — 프로파일을 만들 때 쓴 값 그대로(설계 D-22·§9 N2). */
export interface ReadScope { home: string; allow: string[]; literals: string[] }

function within(p: string, dir: string): boolean {
    const [a, d] = [literalPath(p), literalPath(dir)];
    return a === d || d === '/' || a.startsWith(d + '/');
}

/**
 * 가드(설계 §8 M1·§9 N3) — top·env 위치·심링크 realpath·git 설정 literal 이 같이 쓴다. 참이면 쓴다.
 * 버리는 것: ① 홈의 엄격한 하위가 아님(top 은 홈 밖이면 통과, 홈 자신·조상이면 버림) ② 개인 폴더 항목 자신이거나 그 조상
 * ③ 개인 폴더 항목 안(top 은 예외 — 사용자가 고른 폴더의 레포).
 */
export function readGuard(home: string, p: string, top = false): boolean {
    const items = HOME_PRIVACY_SUBPATHS.map((d) => path.join(home, d));
    if (top) return !within(home, p) && !items.some((i) => within(i, p));
    if (within(home, p) || !within(p, home)) return false;
    return !items.some((i) => within(i, p) || within(p, i));
}

/** 홈 밖에서 샌드박스 자식이 쓸 수 있는 임시 자리 — 프로파일이 쓰기를 여는 두 곳과 그 `/tmp`·`/var/folders` 표기. */
const TMP_WRITE_DIRS = ['/private/tmp', '/private/var/folders', '/tmp', '/var/folders'];

/**
 * 연결 때 층이 이 심링크(사슬의 hop 하나)를 따라가도 되는가(설계 D-15 보완·보완 2, 코드 검증 R1 A1·R2 A1-R2) — 심링크의 자리가
 * 샌드박스 자식이 쓸 수 있는 자리 안이면 거짓이다(자식이 그 고리를 홈의 다른 폴더를 가리키게 바꿔 다음 연결의 읽기를 넓히는 길).
 * 연결 폴더·쓰기 허용된 git dir·common dir(`gitDirs`)은 늘 보고, 홈 안이면 홈의 `CACHE_SUBPATHS` 를, 홈 밖이면 임시 자리를
 * 더 본다(홈이 임시 폴더 아래인 테스트에서도 같은 판정).
 */
export function linkFollowable(home: string, root: string, gitDirs: string[], p: string): boolean {
    const places = within(p, home) ? CACHE_SUBPATHS.map((d) => path.join(home, d)) : TMP_WRITE_DIRS;
    return !within(p, root) && !gitDirs.some((g) => within(p, g)) && !places.some((d) => within(p, d));
}

/** 도구 프로파일 읽기 범위 안인가(설계 D-22·§9 N2) — 홈 밖은 닿는다. 홈 안은 허용 subpath·literal 안이어야 하고 비밀 목록 밖이어야 한다. */
export function reachable(scope: ReadScope, p: string): boolean {
    if (!within(p, scope.home)) return true;
    if ([...SECRET_SUBPATHS, ...TOOL_SECRET_SUBPATHS].some((s) => within(p, path.join(scope.home, s)))) return false;
    return scope.allow.some((a) => within(p, a)) || scope.literals.some((l) => literalPath(l) === literalPath(p));
}

/** 연결 폴더와 홈 사이 조상(홈의 엄격한 하위·root 의 엄격한 상위, root 에 가까운 것부터 상한까지)의 조상 이름 경로(설계 §8 M2). */
function ancestorReads(root: string, home: string): string[] {
    if (within(home, root) || !within(root, home)) return [];
    const out: string[] = [];
    let d = path.dirname(root);
    for (let n = 0; !within(home, d) && n < TOOL_ANCESTOR_MAX; n++, d = path.dirname(d)) {
        out.push(...TOOL_ANCESTOR_READ_NAMES.map((name) => path.join(d, name)));
    }
    return out;
}

/** 가드·중복 제거·상한을 건 추가 subpath 와 literal — literal 은 GIT_CONFIG_READ_MAX, 둘을 합쳐 TOOL_READ_EXTRA_MAX(앞에서부터). */
function guardedExtra(home: string, read: ToolRead): [string[], string[]] {
    const keep = (v: string[] = []): string[] => [...new Set(v.filter((p) => readGuard(home, p)))];
    const extra = keep(read.extra).slice(0, TOOL_READ_EXTRA_MAX);
    return [extra, keep(read.literals).slice(0, Math.min(GIT_CONFIG_READ_MAX, TOOL_READ_EXTRA_MAX - extra.length))];
}

/** D-19 다시 여는 subpath — root, 믿는 git dir, 따로인 common dir, 가드를 통과하고 root 와 다른 top(받은 표기 그대로). */
function reopen(root: string, g: GitPaths | null, home: string, top: string | null | undefined): string[] {
    const out = [root];
    if (g) {
        out.push(g.gitDir);
        const common = g.commonDir || g.gitDir;
        if (literalPath(common) !== literalPath(g.gitDir)) out.push(common);
    }
    if (top && readGuard(home, top, true) && literalPath(top) !== literalPath(root)) out.push(top);
    return out;
}

/** D-15 허용 줄의 subpath(허용 목록·조상 이름·추가)와 literal. */
function toolAllow(root: string, home: string, read: ToolRead): [string[], string[]] {
    const [extra, lits] = guardedExtra(home, read);
    return [[...TOOL_HOME_READ_SUBPATHS.map((d) => path.join(home, d)), ...ancestorReads(root, home), ...extra], lits];
}

/** 도구 프로파일이 읽기를 여는 범위 — 프로파일 텍스트와 같은 계산(설계 D-22 실행 전 훑기가 쓴다). */
export function toolReadScope(root: string, git: GitPaths | null, home: string, read: ToolRead = {}): ReadScope {
    const g = git?.gitDir ? git : null;
    const [allow, literals] = toolAllow(root, home, read);
    return { home, allow: [...allow, ...reopen(root, g, home, read.top)], literals };
}

const subs = (list: string[]): string => list.map((p) => `(subpath ${sbq(p)})`).join(' ');

/**
 * 프로파일 텍스트. 정책: 기본 allow → 쓰기는 폴더·임시·툴캐시로 제한, 비밀 경로는 읽기 차단.
 * (SBPL 은 last-match-wins 이라 deny 뒤에 allow 를 두어야 예외가 성립한다.)
 * tool: 확인 없이 뜨는 자식(worktree git·tsc·py_compile·pytest 탐지)용 **도구 프로파일** — exec 프로파일의 모든 줄 +
 * 홈 읽기 허용 목록(D-15, 나머지 홈은 메타데이터만) + 자격 파일 읽기 금지(`TOOL_SECRET_SUBPATHS`, 설계 D-7) + 비밀의 메타데이터
 * 금지(D-17) + `(deny network*)`(설계 D-1). exec 프로파일은 승인된 명령용이라 네트워크와 그 파일 읽기를 연다(npm·git push).
 * 두 프로파일 모두 개인 폴더 내용 읽기를 막고(D-16) 연결 폴더·git 디렉터리·top 은 다시 연다(D-19). 읽기 규칙은 `file-read*`
 * 로만, 구체 연산은 `file-read-metadata` 만 쓴다(구체 연산이 묶음 연산을 순서와 무관하게 이긴다, 설계 §2.3).
 * git: 연결 때 믿기로 한 git 디렉터리(git-trust.ts) — **쓰기 허용**. 레포 하위 폴더·linked worktree 를 연결하면 git
 * 디렉터리가 폴더 밖이라 git(커밋·인덱스) 쓰기를 열어 준다 — linked worktree 는 객체·참조가 common dir 에 있어 그쪽도 연다(E5).
 * protect: 끝 금지 줄을 걸 git 디렉터리들(하나에 한 줄) — 기본은 git. 믿지 않아도(탐지 실패) 연결 폴더의 `.git` 디렉터리와, 폴더 안을
 * 가리키는 gitfile·심링크의 대상은 지킨다(리뷰 F2·N2, `protectedGitDirs`).
 * read: 도구 프로파일 홈 읽기 입력(ToolRead) — 생략하면 비어 있다.
 */
export function sandboxProfileText(root: string, git: GitPaths | null, home: string, tool: boolean, protect: GitPaths[] = git ? [git] : [], read: ToolRead = {}): string {
    const g = git?.gitDir ? git : null; // 빈 문자열은 git 없음(종전 규칙)
    const common = g ? g.commonDir || g.gitDir : '';
    const separate = !!g && literalPath(common) !== literalPath(g.gitDir);
    const privacy = sbSub(home, HOME_PRIVACY_SUBPATHS);
    const toolRead = (): string[] => {
        const [allow, lits] = toolAllow(root, home, read);
        const items = [subs(allow), ...lits.map((l) => `(literal ${sbq(l)})`)].join(' ');
        return [`(deny file-read* (subpath ${sbq(home)}))`, `(allow file-read-metadata (subpath ${sbq(home)}))`, `(allow file-read* ${items})`];
    };
    return [
        '(version 1)',
        '(allow default)',
        '(deny file-write*)',
        `(allow file-write* (subpath ${sbq(root)}))`,
        ...(g ? [`(allow file-write* (subpath ${sbq(g.gitDir)}))`] : []),
        ...(separate ? [`(allow file-write* (subpath ${sbq(common)}))`] : []),
        '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))',
        `(allow file-write* ${sbSub(home, CACHE_SUBPATHS)})`,
        `(deny file-read* ${privacy})`,
        `(allow file-read-metadata ${privacy})`,
        ...(tool ? toolRead() : []),
        `(allow file-read* ${subs(reopen(root, g, home, read.top))})`,
        `(deny file-read* ${sbSub(home, SECRET_SUBPATHS)})`,
        ...(tool ? [`(deny file-read* ${sbSub(home, TOOL_SECRET_SUBPATHS)})`] : []),
        ...(tool ? [`(deny file-read-metadata ${sbSub(home, SECRET_SUBPATHS)} ${sbSub(home, TOOL_SECRET_SUBPATHS)})`] : []),
        ...(tool ? ['(deny network*)'] : []),
        ...protect.flatMap(gitDenyLine),
        '',
    ].join('\n');
}

/**
 * 끝 금지 줄. 훅·config 는 커밋에 불필요하면서 영구 코드주입 벡터다 — 에이전트가 hooks 나 core.hooksPath 를 심으면 사용자가
 * 나중에 git 을 쓸 때 **샌드박스 밖에서** 실행된다. `config.worktree`(extensions.worktreeConfig 레포에서 config 와 같은 급)·
 * `commondir`(바꿔 두면 후속 git 이 다른 common dir 의 config 를 읽는다)도 같다. git 디렉터리 **자신**도 막는다 — 금지는 경로
 * 글자 기준이라 `.git` 을 옮겼다 되돌리면 빗나갔다(E2). linked worktree 는 hooks·config 가 common dir 에 있어 그쪽 기준이고,
 * 자기 git dir 의 자신·commondir·config.worktree 와 `<common>/worktrees`(이름을 바꿔 자기 메타 금지를 비키는 길, 리뷰 F4)도
 * 막는다 — linked 배치는 `worktrees` 가 이미 있어 `worktree add` 가 만들 일이 없다(일반 레포는 첫 add 가 만들므로 넣지 않는다).
 * SBPL 은 last-match-wins 라 이 deny 를 **프로파일 맨 끝**에 둔다(레포가 상위 allow 경로 안에 있어도 확실히 이기도록).
 */
function gitDenyLine(p: GitPaths): string[] {
    if (!p.gitDir) return [];
    const c = p.commonDir || p.gitDir;
    const separate = literalPath(c) !== literalPath(p.gitDir);
    const lit = (x: string): string => ` (literal ${sbq(x)})`;
    const own = separate ? lit(path.join(c, 'worktrees')) + lit(literalPath(p.gitDir)) + lit(path.join(p.gitDir, 'commondir')) + lit(path.join(p.gitDir, 'config.worktree')) : '';
    return [`(deny file-write* (subpath ${sbq(path.join(c, 'hooks'))})${lit(path.join(c, 'config'))}${lit(literalPath(c))}${lit(path.join(c, 'commondir'))}${lit(path.join(c, 'config.worktree'))}${own})`];
}

/**
 * 연결 때 만든 프로파일 텍스트(실패 시 null — 호출측이 fail-closed). 파일로 쓰지 않는다 — `sandbox-exec -p <텍스트>` 로 넘긴다.
 * 파일이면 샌드박스 안의 자식이 고칠 수 있는 자리(CLI 는 `os.tmpdir()` — 프로파일이 쓰기를 연 `/private/var/folders`)에
 * 놓일 때 확인 없는 자식이 `(allow default)` 로 덮어써 다음 실행이 샌드박스 밖에서 돌았다(리뷰 F1). 호스트가 어디를 주든 같다.
 * 테스트 전용(제품은 `buildSandboxProfiles` 를 쓴다).
 */
export function buildSandboxProfile(root: string, git: GitPaths | null, tool: boolean, protect: GitPaths[] = git ? [git] : []): string | null {
    try {
        return sandboxProfileText(root, git, fs.realpathSync.native(os.homedir()), tool, protect);
    } catch {
        return null;
    }
}

/**
 * env 로 옮긴 mise 위치 후보(설계 §8 M2·§9 L5) — `PATH_PROBE_ENV_EXTRA_POSIX` 순서로 `XDG_*` 넷은 값 + `/mise`, `MISE_` 항목은
 * 값 그대로(`MISE_SHARED_INSTALL_DIRS` 는 `:` 로 나눈다). 절대경로만, realpath 전. `ZDOTDIR` 는 넣지 않는다.
 */
export function miseEnvDirs(env: Record<string, string | undefined>): string[] {
    const out: string[] = [];
    for (const name of PATH_PROBE_ENV_EXTRA_POSIX) {
        const v = env[name];
        if (v === undefined) continue;
        for (const x of (name === 'MISE_SHARED_INSTALL_DIRS' ? v.split(':') : [v]).filter((p) => p.startsWith('/'))) {
            if (name.startsWith('XDG_')) out.push(path.join(x, 'mise'));
            else if (name.startsWith('MISE_')) out.push(path.join(x));
        }
    }
    return out;
}

/** 연결 때 도구 프로파일 홈 읽기 입력(FS 를 보기 전) — top, env 위치 후보, git 설정이 가리키는 파일. */
export interface ReadInputs { top?: string | null; envDirs?: string[]; gitConfig?: string[] }
/** 연결 때 만든 두 프로파일 텍스트와 도구 프로파일의 읽기 범위. */
export interface Profiles { exec: string; tool: string; scope: ReadScope }

function realOrNull(p: string): string | null {
    try { return fs.realpathSync.native(p); } catch { return null; }
}

/**
 * 심링크를 hop 단위로 푼다(설계 D-15 보완 2, 코드 검증 R2 A1-R2) — 끝 대상(심링크가 아닌 것)의 경로, 아니면 null.
 * 버리는 것: 없는 경로·끊긴 링크, dirname 이 심링크를 거침(중간 구성 요소), 거치는 심링크 하나라도 쓸 수 있는 자리 안
 * (`linkFollowable`), 심링크가 `LINK_HOP_MAX` 개를 넘음. 끝 대상의 자리는 가드가 본다.
 */
function followLink(home: string, root: string, gitDirs: string[], p: string): string | null {
    let cur = path.resolve('/', p);
    for (let hop = 0; hop <= LINK_HOP_MAX; hop++) {
        const dir = path.dirname(cur);
        if (realOrNull(dir) !== dir) return null;
        let st: fs.Stats;
        try { st = fs.lstatSync(cur); } catch { return null; }
        if (!st.isSymbolicLink()) return cur;
        if (hop === LINK_HOP_MAX || !linkFollowable(home, root, gitDirs, cur)) return null;
        let target: string;
        try { target = fs.readlinkSync(cur); } catch { return null; }
        cur = path.resolve(dir, target);
    }
    return null;
}

/** env 위치의 홈 표기를 realpath 홈으로 맞춘다(설계 D-15 보완 2) — 받은 홈(`spelled`) 안이 아니면 그대로. */
function inRealHome(home: string, spelled: string, p: string): string {
    const rel = path.relative(spelled, p);
    return rel === '..' || rel.startsWith('../') ? p : path.join(home, rel);
}

/**
 * 입력을 realpath 로 — env 위치(없으면 버림), 허용 항목 가운데 심링크인 것(dotfiles), git 설정 파일. 가드는 순수 함수가 건다.
 * env 위치·허용 항목은 `followLink` 로 푼다(쓸 수 있는 자리의 고리·중간 구성 요소 심링크는 따라가지 않는다).
 */
function toolRead(home: string, spelled: string, root: string, git: GitPaths | null, inputs: ReadInputs): ToolRead {
    const gitDirs = git ? [git.gitDir, git.commonDir].filter((d) => d !== '') : [];
    const follow = (p: string): string | null => followLink(home, root, gitDirs, p);
    const extra = (inputs.envDirs ?? []).map((p) => follow(inRealHome(home, spelled, p))).filter((p): p is string => p !== null);
    for (const d of TOOL_HOME_READ_SUBPATHS) {
        const p = path.join(home, d);
        const r = follow(p);
        if (r !== null && r !== p) extra.push(r);
    }
    const literals = (inputs.gitConfig ?? []).map(realOrNull).filter((p): p is string => p !== null);
    return { top: inputs.top ?? null, extra, literals };
}

/** 연결 때 프로파일 두 개(exec·도구)와 읽기 범위 — 홈 realpath 가 실패하면 null(fail-closed). home 은 테스트가 바꾼다. */
export function buildSandboxProfiles(root: string, git: GitPaths | null, protect: GitPaths[], inputs: ReadInputs, homeDir = os.homedir()): Profiles | null {
    const home = realOrNull(homeDir);
    if (home === null) return null;
    const read = toolRead(home, homeDir, root, git, inputs);
    return {
        exec: sandboxProfileText(root, git, home, false, protect, read),
        tool: sandboxProfileText(root, git, home, true, protect, read),
        scope: toolReadScope(root, git, home, read),
    };
}

/** 샌드박스가 켜졌는데 프로파일이 없어 도구 자식을 띄우지 않았다 — 코어가 exec 와 같은 문구로 그 요청을 거절한다. */
export class SandboxProfileMissingError extends Error {
    constructor() { super(SANDBOX_PROFILE_MISSING_ERROR); }
}

/** 감싼 자식에서 sandbox-exec 가 실행 파일을 띄우지 못했다(71) — 프로파일 문제가 아니라 재연결로 풀리지 않는다(설계 D-8). 이름은 basename. */
export class SandboxSpawnError extends Error {
    constructor(file: string) { super(`${SANDBOX_SPAWN_ERROR_PREFIX}(${path.basename(file)}).`); }
}

/**
 * 확인 없이 처리하는 도구(test_runner 탐지·lsp_diagnostics)가 띄우는 자식을 exec 와 같은 프로파일로 감싼다.
 * 그 자식(폴더의 node_modules/.bin/tsc, cwd 가 폴더인 python3)은 폴더의 코드를 실행할 수 있다 — 에이전트가 파일
 * 쓰기만으로 확인·차단 목록을 지나므로, 적어도 exec 와 같은 OS 경계(폴더 밖 쓰기·비밀 읽기 차단) 안에 둔다.
 * profile: undefined = 샌드박스 꺼짐(감싸지 않음, OMK_BRIDGE_SANDBOX=0·비 macOS), null = 켜졌지만 프로파일 없음
 * → 띄우지 않고 SandboxProfileMissingError(fail-closed). 셸을 거치지 않는다.
 */
/**
 * 감싼 자식에서 sandbox-exec **자체**가 실패했나 — 프로파일 문법 오류(종료 코드 65 — `-p` 도 같다, 2026-11-14 실측), 실행 파일 execvp 실패(71).
 * 그때 stderr 는 `sandbox-exec:` 로 시작한다. 진단·탐지가 이를 "깨끗함/없음"으로 삼키지 않게 호출측이 프로파일 없음과
 * 같은 거절로 바꾼다(실행 파일이 PATH 에 없는 71 은 호출측이 감싸기 전에 걸러 낸다 — python3 찾기).
 */
export function sandboxExecFailed(wrapped: boolean, code: unknown, stderr: string): boolean {
    return wrapped && (code === 65 || code === 71) && stderr.startsWith('sandbox-exec:');
}

/** sandboxExecFailed 일 때의 거절 — 71 은 띄우지 못한 실행 파일 이름으로, 65 는 프로파일 없음과 같은 문구로(설계 D-8). */
export function sandboxExecError(code: unknown, file: string): Error {
    return code === 71 ? new SandboxSpawnError(file) : new SandboxProfileMissingError();
}

/** profile 은 프로파일 **텍스트**다(`sandbox-exec -p` — 파일을 거치지 않는다, 리뷰 F1). */
export function wrapInSandbox(file: string, args: string[], profile: string | null | undefined): { file: string; args: string[] } {
    if (profile === undefined) return { file, args };
    if (profile === null) throw new SandboxProfileMissingError();
    return { file: SANDBOX_BIN, args: ['-p', profile, file, ...args] };
}
