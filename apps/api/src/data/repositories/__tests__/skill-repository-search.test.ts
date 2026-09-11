/**
 * SkillRepository.searchSkills — excludeAgentPersonas 조건 (2026-09-11).
 * 페르소나 스킬은 skill-seeder 가 `system-skill-{agentId}` 로 만들어 그 에이전트에 배정한다.
 * count·data 두 쿼리가 같은 WHERE 를 써야 total 로 카탈로그 상한 초과를 판정할 수 있다.
 */
import { Pool } from 'pg';
import { SkillRepository, AGENT_PERSONA_SKILL_ID_PREFIX } from '../skill-repository';

jest.mock('../../retry-wrapper', () => ({
    withRetry: (fn: () => unknown) => fn(),
}));

function setup() {
    const query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
    return { query, repo: new SkillRepository({ query } as unknown as Pool) };
}

describe('SkillRepository.searchSkills excludeAgentPersonas', () => {
    it('켜면 count·data 쿼리 모두 자기 에이전트에 배정된 페르소나를 제외한다', async () => {
        const { query, repo } = setup();
        await repo.searchSkills({ status: 'active', userId: 'u3', excludeAgentPersonas: true });

        expect(query).toHaveBeenCalledTimes(2);
        for (const [sql, params] of query.mock.calls) {
            expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM agent_skill_assignments asa/);
            // userId $1 · status $2 다음 자리
            expect(sql).toMatch(/agent_skills\.id = \$3::text \|\| asa\.agent_id/);
            expect(params[2]).toBe(AGENT_PERSONA_SKILL_ID_PREFIX);
        }
    });

    it('지정하지 않으면 조건을 붙이지 않는다', async () => {
        const { query, repo } = setup();
        await repo.searchSkills({ status: 'active', userId: 'u3' });

        for (const [sql] of query.mock.calls) {
            expect(sql).not.toMatch(/agent_skill_assignments/);
        }
    });
});
