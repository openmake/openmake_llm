/**
 * SkillRevisionRepository — 이력 기록·정리·조회, isRevisableChange 판정.
 */
import type { Pool } from 'pg';
import { SkillRevisionRepository, isRevisableChange } from '../../data/skill-revision-repository';
import { SKILL_REVISION_KEEP } from '../../../../config/constants';

jest.mock('../../../../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

const existing = { name: 'n', description: 'd', content: 'c', category: 'x' };

describe('isRevisableChange', () => {
    it('이름·설명·본문·분류가 바뀌면 true, 같거나 안 보내면 false', () => {
        expect(isRevisableChange(existing, { content: 'c2' })).toBe(true);
        expect(isRevisableChange(existing, { name: 'n2' })).toBe(true);
        expect(isRevisableChange(existing, { description: 'd2' })).toBe(true);
        expect(isRevisableChange(existing, { category: 'y' })).toBe(true);
        expect(isRevisableChange(existing, { content: 'c', name: 'n' })).toBe(false);
        expect(isRevisableChange(existing, {})).toBe(false);
    });
});

describe('SkillRevisionRepository', () => {
    const row = { id: '7', skill_id: 's1', name: 'n', description: null, content: 'old', category: 'x', replaced_by: 'u1', created_at: new Date('2026-11-20T00:00:00Z') };

    it('snapshot — 넣고 스킬당 KEEP 개만 남긴다', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [] });
        await new SkillRevisionRepository({ query } as unknown as Pool).snapshot({ id: 's1', ...existing }, 'u1');
        expect(String(query.mock.calls[0][0])).toContain('INSERT INTO skill_revisions');
        expect(query.mock.calls[0][1]).toEqual(['s1', 'n', 'd', 'c', 'x', 'u1']);
        expect(String(query.mock.calls[1][0])).toContain('DELETE FROM skill_revisions');
        expect(query.mock.calls[1][1]).toEqual(['s1', SKILL_REVISION_KEEP]);
    });

    it('list — 행을 DTO 로 바꾼다(최신순 SQL)', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [row] });
        const out = await new SkillRevisionRepository({ query } as unknown as Pool).list('s1');
        expect(String(query.mock.calls[0][0])).toContain('ORDER BY id DESC');
        expect(out).toEqual([{ id: '7', skillId: 's1', name: 'n', description: null, content: 'old', category: 'x', replacedBy: 'u1', createdAt: '2026-11-20T00:00:00.000Z' }]);
    });

    it('get — 숫자가 아닌 id 는 조회하지 않고 null, 없으면 null', async () => {
        const query = jest.fn().mockResolvedValue({ rows: [] });
        const repo = new SkillRevisionRepository({ query } as unknown as Pool);
        expect(await repo.get('s1', 'abc')).toBeNull();
        expect(query).not.toHaveBeenCalled();
        expect(await repo.get('s1', '9')).toBeNull();
        expect(query.mock.calls[0][1]).toEqual(['s1', '9']);
    });
});
