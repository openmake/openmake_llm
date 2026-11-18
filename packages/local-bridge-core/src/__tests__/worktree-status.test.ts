/** removeVerdict — 적합성 `worktree.json` `statusVerdict` 밖의 경계(설계 2026-11-18 ignored-cleanup §2.1). */
import { WORKTREE_DISPOSABLE_DIRS } from '../constants';
import { removeVerdict } from '../worktree-status';

it.each(WORKTREE_DISPOSABLE_DIRS.map((d) => [d]))('버려도 되는 폴더 %s 는 clean', (d) => {
    expect(removeVerdict(`!! ${d}/\0`)).toBe('clean');
    expect(removeVerdict(`!! x/${d}/y.bin\0`)).toBe('clean');
});

it('끝 NUL 이 없어도 같은 판정이다', () => {
    expect(removeVerdict('!! x.zip')).toBe('ignored');
    expect(removeVerdict('!! node_modules/')).toBe('clean');
});

it('버려도 되는 폴더 이름이 파일 이름 자리에만 있으면 보존 쪽이다', () => {
    expect(removeVerdict('!! src/.venv\0')).toBe('ignored');
});
