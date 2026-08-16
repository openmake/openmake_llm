/**
 * getSkillsForAgent 개인 스킬 카테고리 필터 회귀 테스트.
 *
 * 에이전트 선택 턴에서 user-assign 개인 스킬은 카테고리 일치 시에만 주입되는데,
 * 확장 설치 스킬 등 기본 카테고리 'general' 은 어떤 에이전트와도 일치하지 않아
 * 지정이 무의미했다 (2026-08-16). 'general' 은 카테고리 무관 통과해야 한다.
 */
import { SkillAssignmentRepository } from '../skill-assignment-repository';

function repoWithCapture() {
    const repo = new SkillAssignmentRepository({} as never);
    const calls: { sql: string; params: unknown[] }[] = [];
    (repo as unknown as { query: unknown }).query = (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return Promise.resolve({ rows: [], rowCount: 0 });
    };
    return { repo, calls };
}

describe('getSkillsForAgent — 개인 스킬 카테고리 필터', () => {
    it("에이전트 카테고리 지정 시 'general' 개인 스킬도 통과하는 조건을 포함한다", async () => {
        const { repo, calls } = repoWithCapture();
        await repo.getSkillsForAgent('ui-ux-designer', '3', 'design');
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toContain("OR s.category = 'general'");
        expect(calls[0].params).toEqual(expect.arrayContaining(['user:3', 'design']));
    });

    it('에이전트 카테고리 미지정 시 개인 스킬은 카테고리 필터 없이 포함된다', async () => {
        const { repo, calls } = repoWithCapture();
        await repo.getSkillsForAgent('ui-ux-designer', '3');
        expect(calls[0].sql).not.toContain('s.category =');
        expect(calls[0].params).toEqual(expect.arrayContaining(['user:3']));
    });
});
