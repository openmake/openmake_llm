import { buildDraftQuery } from '../skill-draft-query';

describe('buildDraftQuery', () => {
    it('target=user — created_by 조건 + userId 파라미터', () => {
        const q = buildDraftQuery({ target: 'user', userId: 'u1' });
        expect(q.countSql).toContain("status = 'draft'");
        expect(q.countSql).toContain('created_by = $1');
        expect(q.params).toEqual(['u1']);
        expect(q.dataParams).toEqual(['u1', 50, 0]);
    });

    it('target=user 인데 userId 없으면 throw (남의 draft 노출 방지)', () => {
        expect(() => buildDraftQuery({ target: 'user' })).toThrow('userId 필수');
    });

    it('target=system — created_by IS NULL, 파라미터 없음', () => {
        const q = buildDraftQuery({ target: 'system' });
        expect(q.countSql).toContain('created_by IS NULL');
        expect(q.params).toEqual([]);
        expect(q.dataParams).toEqual([100 - 50, 0]);  // limit 기본 50, offset 0
    });

    it('target=all — status 조건만', () => {
        const q = buildDraftQuery({ target: 'all' });
        expect(q.countSql).toContain("status = 'draft'");
        expect(q.countSql).not.toContain('created_by');
    });

    // 확장별 묶음을 위해 목록 쿼리만 JOIN 한다 (count 는 JOIN 불필요)
    it('목록 쿼리는 확장 이름을 LEFT JOIN 으로 싣는다', () => {
        const q = buildDraftQuery({ target: 'all' });
        expect(q.dataSql).toContain('LEFT JOIN user_extensions');
        expect(q.dataSql).toContain('e.name AS extension_name');
        expect(q.dataSql).toContain('s.extension_id');
        expect(q.countSql).not.toContain('JOIN');
    });

    it('JOIN 쿼리의 WHERE 는 별칭이 붙는다 (컬럼 모호성 방지)', () => {
        const q = buildDraftQuery({ target: 'user', userId: 'u1' });
        expect(q.dataSql).toContain("s.status = 'draft'");
        expect(q.dataSql).toContain('s.created_by = $1');
    });

    it('limit 상한 100, offset 음수 방지', () => {
        expect(buildDraftQuery({ target: 'all', limit: 500 }).limit).toBe(100);
        expect(buildDraftQuery({ target: 'all', offset: -10 }).offset).toBe(0);
    });
});
