/**
 * SkillRepository.updateSkill — 본문 수정 시 기존 manifest_yaml 의 triggers 등을 보존한다 (2026-09-11).
 * 종전엔 yaml 을 name·description·category 3키로 다시 써서, 트리거로 게이트하던 스킬
 * (presentation-designer)이 본문 한 번 수정에 모든 턴 주입으로 풀릴 참이었다.
 */
import { Pool } from 'pg';
import { SkillRepository } from '../../data/skill-repository';
import { parseManifestTriggers } from '../../../../agents/manifest-triggers';

jest.mock('../../../../data/retry-wrapper', () => ({
    withRetry: (fn: () => unknown) => fn(),
}));

const skillRow = (content: string) => ({
    id: 'skill-1', name: 'deck', description: 'd', content, category: 'design',
    is_public: false, created_by: 'user-1', created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), source_repo: null, source_path: null,
    status: 'active', manifest_meta: null,
});

describe('SkillRepository.updateSkill — manifest yaml 보존', () => {
    it('본문을 바꿔도 최신 manifest 의 triggers 가 유지된다', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [skillRow('old')] }) // getSkillById
            .mockResolvedValueOnce({ rows: [] }) // INSERT skill_revisions (수정 직전 내용)
            .mockResolvedValueOnce({ rows: [] }) // DELETE 오래된 이력
            .mockResolvedValueOnce({ rows: [] }) // UPDATE agent_skills
            .mockResolvedValueOnce({ rows: [{ version: '1.0.3', manifest_yaml: 'name: deck\ncategory: design\ntriggers:\n  - "PPT"' }] })
            .mockResolvedValue({ rows: [skillRow('new')] }); // manifest upsert + getSkillById
        const repo = new SkillRepository({ query } as unknown as Pool);

        await repo.updateSkill('skill-1', { content: 'new' }, { userId: 'user-1', userRole: 'user' });

        const upsert = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO skill_manifests'));
        expect(upsert).toBeDefined();
        const params = upsert![1] as unknown[];
        expect(params[1]).toBe('1.0.3');
        expect(parseManifestTriggers(String(params[2]))).toEqual(['PPT']);
        expect(params[3]).toBe('new');
    });

    it('수정 직전 내용을 이력으로 남긴다 — 공개 여부만 바꾸면 남기지 않는다', async () => {
        const query = jest.fn().mockResolvedValueOnce({ rows: [skillRow('old')] }).mockResolvedValue({ rows: [skillRow('new')] });
        const repo = new SkillRepository({ query } as unknown as Pool);
        await repo.updateSkill('skill-1', { content: 'new' }, { userId: 'user-1', userRole: 'user' });
        const snap = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO skill_revisions'));
        expect(snap![1]).toEqual(['skill-1', 'deck', 'd', 'old', 'design', 'user-1']);

        query.mockReset();
        query.mockResolvedValueOnce({ rows: [skillRow('new')] }).mockResolvedValue({ rows: [skillRow('new')] });
        await repo.updateSkill('skill-1', { isPublic: true }, { userId: 'user-1', userRole: 'user' });
        expect(query.mock.calls.some(([sql]) => String(sql).includes('skill_revisions'))).toBe(false);
    });

    it('이력 기록이 실패해도 수정은 계속한다', async () => {
        const query = jest.fn(async (sql: string) => {
            if (sql.includes('INSERT INTO skill_revisions')) throw new Error('relation "skill_revisions" does not exist');
            if (sql.includes('UPDATE agent_skills')) return { rows: [] };
            return { rows: [skillRow('old')] };
        });
        const repo = new SkillRepository({ query } as unknown as Pool);
        await expect(repo.updateSkill('skill-1', { name: 'deck2' }, { userId: 'user-1', userRole: 'user' })).resolves.not.toBeNull();
        expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE agent_skills'))).toBe(true);
    });
});
