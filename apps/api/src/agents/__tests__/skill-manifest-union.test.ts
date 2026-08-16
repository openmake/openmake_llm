/**
 * buildManifestPrompt — 개인 지정(user-assign) 스킬 union 회귀 테스트 (2026-08-16).
 *
 * 확장 설치 스킬 등 agent_skills 에만 있고 skill_manifests 행이 없는 스킬은,
 * manifest 스킬이 하나라도 활성이면 legacy fallback 이 실행되지 않아 지정해도
 * 조용히 누락됐다. manifest 결과에 manifest 미보유 개인 지정 스킬을 union 한다.
 */
import { SkillManager } from '../skill-manager';
import type { AgentSkill } from '../../data/repositories/skill-repository';

const MANIFEST_ROWS = [{
    id: 'user-3-presentation-designer',
    prompt_md: 'PRESENT_RULES',
    manifest_yaml: '---\nname: presentation-designer\ncategory: design\n---',
}];

jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({
        getPool: () => ({ query: async () => ({ rows: MANIFEST_ROWS }) }),
    }),
}));

function skill(partial: Partial<AgentSkill> & { id: string; name: string }): AgentSkill {
    return {
        description: '', content: 'CONTENT', category: 'general',
        isPublic: false, createdBy: '3', status: 'active',
        createdAt: new Date(0), updatedAt: new Date(0),
        ...partial,
    } as unknown as AgentSkill;
}

function managerWithUserSkills(userSkills: AgentSkill[]): SkillManager {
    const mgr = new SkillManager();
    (mgr as unknown as { repo: unknown }).repo = {
        getUserSkills: async () => userSkills,
    };
    return mgr;
}

describe('buildManifestPrompt — 개인 지정 스킬 union', () => {
    it('manifest 미보유 개인 지정 스킬(general)을 에이전트 카테고리 턴에도 포함한다', async () => {
        const mgr = managerWithUserSkills([
            skill({ id: 'user-skill-x1', name: 'design-critique', content: 'CRITIQUE_RULES', category: 'general' }),
        ]);
        const out = await mgr.buildManifestPrompt('ui-ux-designer', '3', 'design');
        expect(out).not.toBeNull();
        expect(out!.skillNames).toEqual(expect.arrayContaining(['presentation-designer', 'design-critique']));
        expect(out!.prompt).toContain('CRITIQUE_RULES');
        expect(out!.prompt).toContain('PRESENT_RULES');
    });

    it('카테고리가 다른(비 general) 개인 지정 스킬은 union 에서 제외한다', async () => {
        const mgr = managerWithUserSkills([
            skill({ id: 'user-skill-x2', name: 'redis-tuning', content: 'REDIS', category: 'engineering' }),
        ]);
        const out = await mgr.buildManifestPrompt('ui-ux-designer', '3', 'design');
        expect(out!.skillNames).not.toContain('redis-tuning');
    });

    it('이미 manifest 로 주입된 스킬은 union 에서 중복 제외한다', async () => {
        const mgr = managerWithUserSkills([
            skill({ id: 'user-3-presentation-designer', name: 'presentation-designer', content: 'DUP' }),
        ]);
        const out = await mgr.buildManifestPrompt('ui-ux-designer', '3', 'design');
        expect(out!.skillNames.filter((n) => n === 'presentation-designer')).toHaveLength(1);
        expect(out!.prompt).not.toContain('DUP');
    });

    it('userId 없으면 union 하지 않는다 (기존 동작 유지)', async () => {
        const mgr = managerWithUserSkills([
            skill({ id: 'user-skill-x1', name: 'design-critique', content: 'CRITIQUE_RULES' }),
        ]);
        const out = await mgr.buildManifestPrompt('ui-ux-designer', undefined, 'design');
        expect(out!.skillNames).toEqual(['presentation-designer']);
    });
});
