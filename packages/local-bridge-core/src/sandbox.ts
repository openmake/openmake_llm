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
import { CACHE_SUBPATHS, SANDBOX_BIN, SANDBOX_PROFILE_MISSING_ERROR, SECRET_SUBPATHS, sbq, sbSub } from './constants';
import type { GitPaths } from './git-trust';

/** SBPL literal 용 정규화 — `path.join` 결과에서 끝 구분자를 뗀다(literal 은 글자 그대로 비교한다). */
function literalPath(p: string): string {
    return path.join(p).replace(/\/+$/, '') || '/';
}

/**
 * 프로파일 텍스트. 정책: 기본 allow → 쓰기는 폴더·임시·툴캐시로 제한, 비밀 경로는 읽기 차단.
 * (SBPL 은 last-match-wins 이라 deny 뒤에 allow 를 두어야 예외가 성립한다.)
 * tool: 확인 없이 뜨는 자식(worktree git·tsc·py_compile·pytest 탐지)용 **도구 프로파일** — exec 프로파일의 모든 줄 +
 * `(deny network*)`(설계 D-1). exec 프로파일은 승인된 명령용이라 네트워크를 연다(npm·git push).
 * git: 연결 때 믿기로 한 git 디렉터리(git-trust.ts) — **쓰기 허용**. 레포 하위 폴더·linked worktree 를 연결하면 git
 * 디렉터리가 폴더 밖이라 git(커밋·인덱스) 쓰기를 열어 준다 — linked worktree 는 객체·참조가 common dir 에 있어 그쪽도 연다(E5).
 * protect: 끝 금지 줄을 걸 git 디렉터리 — 기본은 git. 믿지 않아도(탐지 실패) 연결 폴더의 `.git` 디렉터리는 지킨다(리뷰 F2).
 */
export function sandboxProfileText(root: string, git: GitPaths | null, home: string, tool: boolean, protect: GitPaths | null = git): string {
    const g = git?.gitDir ? git : null; // 빈 문자열은 git 없음(종전 규칙)
    const common = g ? g.commonDir || g.gitDir : '';
    const separate = !!g && literalPath(common) !== literalPath(g.gitDir);
    return [
        '(version 1)',
        '(allow default)',
        '(deny file-write*)',
        `(allow file-write* (subpath ${sbq(root)}))`,
        ...(g ? [`(allow file-write* (subpath ${sbq(g.gitDir)}))`] : []),
        ...(separate ? [`(allow file-write* (subpath ${sbq(common)}))`] : []),
        '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))',
        `(allow file-write* ${sbSub(home, CACHE_SUBPATHS)})`,
        `(deny file-read* ${sbSub(home, SECRET_SUBPATHS)})`,
        ...(tool ? ['(deny network*)'] : []),
        ...gitDenyLine(protect),
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
function gitDenyLine(protect: GitPaths | null): string[] {
    const p = protect?.gitDir ? protect : null;
    if (!p) return [];
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
 */
export function buildSandboxProfile(root: string, git: GitPaths | null, tool: boolean, protect: GitPaths | null = git): string | null {
    try {
        return sandboxProfileText(root, git, fs.realpathSync.native(os.homedir()), tool, protect);
    } catch {
        return null;
    }
}

/** 샌드박스가 켜졌는데 프로파일이 없어 도구 자식을 띄우지 않았다 — 코어가 exec 와 같은 문구로 그 요청을 거절한다. */
export class SandboxProfileMissingError extends Error {
    constructor() { super(SANDBOX_PROFILE_MISSING_ERROR); }
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

/** profile 은 프로파일 **텍스트**다(`sandbox-exec -p` — 파일을 거치지 않는다, 리뷰 F1). */
export function wrapInSandbox(file: string, args: string[], profile: string | null | undefined): { file: string; args: string[] } {
    if (profile === undefined) return { file, args };
    if (profile === null) throw new SandboxProfileMissingError();
    return { file: SANDBOX_BIN, args: ['-p', profile, file, ...args] };
}
