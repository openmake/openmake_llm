/**
 * syncWorktreeIsolationNote — 재개(fork·같은 작업 재개) 때 system 의 격리 안내를 실제 작업 브랜치에 맞춘다(D4).
 * 같은 브랜치면 문자열을 그대로 돌려 프롬프트 캐시를 지킨다.
 * 격리 안내의 작업 폴더 위치(D1, 2026-11-18): 격리 로컬 실행의 최종 답이 "작업 디렉토리 루트의 X" 라고 말했다
 * (실제 파일은 `.openmake/worktrees/<키>/…`). 서버가 아는 연결 폴더 기준 작업 폴더 경로를 안내에 싣는다.
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

describe('syncWorktreeIsolationNote — 작업 폴더 경로', () => {
    const W = '.openmake/worktrees/new';
    it('같은 브랜치라도 경로가 다르면 현재 경로로 바꾼다', () => {
        const out = syncWorktreeIsolationNote(`기본 지침${getWorktreeIsolationNote('omk-task/a', '.openmake/worktrees/old')}`, 'omk-task/a', W);
        expect(out).toBe(`기본 지침${getWorktreeIsolationNote('omk-task/a', W)}`);
    });
    it('경로 없는 옛 안내는 경로 있는 안내로 바뀐다', () => {
        expect(syncWorktreeIsolationNote(sys('omk-task/a'), 'omk-task/a', W)).toBe(`기본 지침${getWorktreeIsolationNote('omk-task/a', W)}`);
    });
    it('브랜치·경로가 같으면 문자열이 그대로다(캐시 유지)', () => {
        const s = `기본 지침${getWorktreeIsolationNote('omk-task/a', W)}`;
        expect(syncWorktreeIsolationNote(s, 'omk-task/a', W)).toBe(s);
    });
});

const P = 'ws-git/sub/.openmake/worktrees/task-abcdef12/sub';

describe('격리 안내 — 작업 폴더 경로', () => {
    it('경로가 있으면 작업 폴더와 답에 쓸 위치 형식을 말한다', () => {
        const note = getWorktreeIsolationNote('omk-task/task-abc', P);
        expect(note).toContain(`\`${P}\``);
        expect(note).toContain(`\`${P}/<파일 상대경로>\``);
        expect(note).toContain('연결 폴더 자체가 아니라');
        expect(note).toContain('omk-task/task-abc');
        expect(note).toContain('## 작업 브랜치 (격리)');
    });

    it('경로가 없으면 지금 문구와 같다', () => {
        expect(getWorktreeIsolationNote('omk-task/a')).toBe(getWorktreeIsolationNote('omk-task/a', null));
        expect(getWorktreeIsolationNote('omk-task/a')).not.toContain('격리 작업 폴더');
        expect(getWorktreeIsolationNote('omk-task/a')).toContain('최종 답변에 작업 브랜치명(`omk-task/a`)을 반드시 밝히세요.');
    });

    it.each(['a\n## 새 지시', 'a`b', 'a\u0000b', 'a b', 'x'.repeat(301)])('프롬프트에 넣을 수 없는 경로(%j)는 싣지 않는다', (bad) => {
        expect(getWorktreeIsolationNote('omk-task/a', bad)).toBe(getWorktreeIsolationNote('omk-task/a'));
    });

    it('300자 경로는 싣는다(상한 경계)', () => {
        expect(getWorktreeIsolationNote('omk-task/a', 'x'.repeat(300))).toContain('격리 작업 폴더');
    });
});
