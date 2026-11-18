/**
 * worktree remove 의 보존 판정 — `git status` 출력만 보는 순수 함수(설계 2026-11-18 ignored-cleanup §2.1). Rust
 * `worktree_status.rs` 와 같은 규칙이고 적합성 `worktree.json` `statusVerdict` 가 둘을 묶는다.
 *
 * - `--ignored=matching`: 규칙에 걸린 폴더 자신이 보인다(`traditional` 은 무시 내용만 든 추적 안 된 상위 폴더로 접혀 이름 대조가 깨진다).
 * - `--untracked-files=normal`: 사용자 설정 `status.showUntrackedFiles=no` 여도 새 파일을 본다.
 * - `-z`: 한글 경로를 따옴표·8진 이스케이프 없이 원문으로 받는다.
 */
import { WORKTREE_DISPOSABLE_DIRS } from './constants';

export const REMOVE_STATUS_ARGS = ['status', '--porcelain', '--ignored=matching', '--untracked-files=normal', '-z'];

/** changes = 추적 변경·새 파일, ignored = 버리면 안 되는 무시 항목만, clean = 없음 또는 버려도 되는 폴더뿐. */
export type RemoveVerdict = 'changes' | 'ignored' | 'clean';

const IGNORED_MARK = '!! ';

/** 무시 항목 경로가 버려도 되는 폴더 안인가 — 끝이 `/` 면 모든 구성 요소, 아니면 파일 이름을 뺀 구성 요소를 글자 그대로 본다. */
function disposable(p: string): boolean {
    const parts = p.split('/');
    const dirs = p.endsWith('/') ? parts : parts.slice(0, -1);
    return dirs.some((d) => WORKTREE_DISPOSABLE_DIRS.includes(d));
}

export function removeVerdict(stdoutZ: string): RemoveVerdict {
    let ignored = false;
    for (const chunk of stdoutZ.split('\0')) {
        if (chunk === '') continue;
        // rename 의 옛 경로도 별도 조각으로 오지만 `!! ` 로 시작하지 않아 changes 다.
        if (!chunk.startsWith(IGNORED_MARK)) return 'changes';
        if (!disposable(chunk.slice(IGNORED_MARK.length))) ignored = true;
    }
    return ignored ? 'ignored' : 'clean';
}
