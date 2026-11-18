/**
 * syncWorktreeIsolationNote — 재개(fork·같은 작업 재개) 때 system 의 격리 안내를 실제 작업 브랜치에 맞춘다(D4).
 * 같은 브랜치면 문자열을 그대로 돌려 프롬프트 캐시를 지킨다.
 */
import { syncWorktreeIsolationNote } from '../agent-task-isolation-note';
import { getWorktreeIsolationNote, WORKTREE_ISOLATION_HEADING } from '../agent-task-prompt';

const sys = (b: string): string => `기본 지침${getWorktreeIsolationNote(b)}`;

describe('syncWorktreeIsolationNote', () => {
    it('다른 브랜치를 말하면 바꾼다 — 옛 이름이 남지 않는다', () => {
        const out = syncWorktreeIsolationNote(sys('omk-task/aaaaaaaa'), 'omk-task/bbbbbbbb');
        expect(out).toContain('omk-task/bbbbbbbb');
        expect(out).not.toContain('omk-task/aaaaaaaa');
        expect(out.startsWith('기본 지침')).toBe(true);
        expect(out.split(WORKTREE_ISOLATION_HEADING).length).toBe(2);
    });
    it('같은 브랜치면 문자열이 그대로다(캐시 유지)', () => {
        expect(syncWorktreeIsolationNote(sys('omk-task/a'), 'omk-task/a')).toBe(sys('omk-task/a'));
    });
    it('같은 브랜치면 뒤에 다른 구획이 있어도 그대로다', () => {
        const s = `${sys('omk-task/a')}\n\n## 다른 구획\n- 유지`;
        expect(syncWorktreeIsolationNote(s, 'omk-task/a')).toBe(s);
    });
    it('격리가 없으면(null) 구획을 뺀다', () => {
        expect(syncWorktreeIsolationNote(sys('omk-task/a'), null)).toBe('기본 지침');
    });
    it('구획이 없고 브랜치가 있으면 붙인다', () => {
        expect(syncWorktreeIsolationNote('기본 지침', 'omk-task/a')).toBe(sys('omk-task/a'));
    });
    it('구획도 브랜치도 없으면 그대로', () => {
        expect(syncWorktreeIsolationNote('기본 지침', null)).toBe('기본 지침');
    });
    it('구획 뒤에 다른 "## " 구획이 있으면 그 구획은 남긴다', () => {
        const out = syncWorktreeIsolationNote(`${sys('omk-task/a')}\n\n## 다른 구획\n- 유지`, 'omk-task/b');
        expect(out).toContain('## 다른 구획\n- 유지');
        expect(out).not.toContain('omk-task/a');
        expect(out).toContain('omk-task/b');
    });
});
