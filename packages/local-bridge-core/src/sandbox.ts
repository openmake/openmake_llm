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
import { execFileSync } from 'child_process';
import { CACHE_SUBPATHS, SECRET_SUBPATHS, sbq, sbSub } from './constants';

/**
 * 연결 폴더가 git 레포(하위 폴더 포함)면 레포의 .git 절대경로, 아니면 null.
 * 레포 **하위 폴더**를 연결하면 .git 이 폴더 밖에 있어 샌드박스가 git 쓰기를 막았다 —
 * 레포 루트를 연결했을 때는 이미 허용되던 쓰기라, 허용해도 권한이 새로 넓어지지 않는다
 * (같은 레포인데 연결 지점에 따라 동작이 갈리던 비일관성 해소. worktree 커밋의 index.lock 이
 * `.git/worktrees/<name>/` 에 생겨 2026-08-09 GUI 검증에서 실제 실패로 드러났다).
 */
export function detectGitDir(root: string): string | null {
    try {
        return execFileSync('git', ['rev-parse', '--absolute-git-dir'],
            { cwd: root, encoding: 'utf8', timeout: 5000 }).trim() || null;
    } catch { return null; }
}

/**
 * 연결 폴더 기준 sandbox-exec 프로파일을 생성해 경로를 반환한다(실패 시 null).
 * 정책: 기본 allow → 쓰기는 폴더·임시·툴캐시로 제한, 비밀 경로는 읽기 차단.
 * (SBPL 은 last-match-wins 이라 deny 뒤에 allow 를 두어야 예외가 성립한다.)
 */
export function writeSandboxProfile(root: string, gitDir: string | null, outFile: string): string | null {
    try {
        const home = fs.realpathSync(os.homedir());
        const profile = [
            '(version 1)',
            '(allow default)',
            '(deny file-write*)',
            `(allow file-write* (subpath ${sbq(root)}))`,
            // 레포 하위 폴더 연결 시 .git 은 폴더 밖 — git(커밋·인덱스) 쓰기를 열어준다(위 detectGitDir 주석).
            ...(gitDir ? [`(allow file-write* (subpath ${sbq(gitDir)}))`] : []),
            '(allow file-write* (subpath "/private/tmp") (subpath "/private/var/folders") (subpath "/dev"))',
            `(allow file-write* ${sbSub(home, CACHE_SUBPATHS)})`,
            `(deny file-read* ${sbSub(home, SECRET_SUBPATHS)})`,
            // 훅·config 는 커밋에 불필요하면서 영구 코드주입 벡터다 — 에이전트가 .git/hooks 나
            // core.hooksPath 를 심으면 사용자가 나중에 git 을 쓸 때 **샌드박스 밖에서** 실행된다.
            // SBPL 은 last-match-wins 라 이 deny 를 **프로파일 맨 끝**에 둔다(레포가 상위 allow
            // 경로 안에 있어도 확실히 이기도록 — /private/tmp 아래 레포로 실측 검증).
            // identity 설정이 필요하면 `git -c user.email=...` 인라인을 쓰면 된다.
            ...(gitDir ? [`(deny file-write* (subpath ${sbq(path.join(gitDir, 'hooks'))}) (literal ${sbq(path.join(gitDir, 'config'))}))`] : []),
            '',
        ].join('\n');
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, profile);
        return outFile;
    } catch {
        return null;
    }
}
