/**
 * 도구 바인딩은 **active 스킬만** 따라온다 (2026-09-20 라이브 검증에서 발견).
 *
 * 결함: `getActiveSkillBindings` 가 `skill_tool_bindings` → `agent_skill_assignments` 만 조인하고
 * `agent_skills.status` 를 보지 않았다. 확장을 지우거나 업데이트하면 구 스킬은 archived 가 되지만
 * 배정 행은 남으므로, **지운 스킬의 `denied` 바인딩이 계속 도구를 막았다**.
 */
import { SkillManager } from '../skill-manager';

let lastSql = '';
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getPool: () => ({
            query: async (sql: string) => { lastSql = sql; return { rows: [] }; },
        }),
    }),
}));

function manager(): SkillManager {
    const m = new SkillManager();
    (m as unknown as { repo: unknown }).repo = { getUserSkills: async () => [] };
    return m;
}

describe('getActiveSkillBindings', () => {
    it('agent_skills.status = active 를 조인 조건으로 건다', async () => {
        await manager().getActiveSkillBindings('__agent_task__', '3');

        const sql = lastSql.replace(/\s+/g, ' ');
        expect(sql).toContain('FROM skill_tool_bindings');
        // 이 두 조각이 사라지면 archived 스킬의 바인딩이 다시 새어 들어온다
        expect(sql).toContain('JOIN agent_skills ags ON ags.id = stb.skill_id');
        expect(sql).toContain("ags.status = 'active'");
    });
});
