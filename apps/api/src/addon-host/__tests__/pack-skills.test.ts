import { BUILTIN_ADDON_IDS, BUILTIN_ADDON_KIND, BUILTIN_ADDON_SKILL_SOURCE_PATH } from '../builtin-registry';
import { installPackSkills, loadPackSkills } from '../pack-skills';
import { getIndustryAgentsData } from '../../agents/types';

const CONTENT_PACK_IDS = BUILTIN_ADDON_IDS.filter(id => BUILTIN_ADDON_KIND[id] === 'content');

function likeToRegExp(pattern: string | undefined): RegExp {
    if (!pattern) throw new Error('콘텐츠 팩에는 보관용 source_path 패턴이 있어야 한다');
    return new RegExp('^' + pattern.split('%').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
}

describe('팩 스킬 정의', () => {
    it.each([...CONTENT_PACK_IDS])('%s — id 가 겹치지 않고, 모든 sourcePath 가 그 팩의 보관 패턴에 걸린다', id => {
        const skills = loadPackSkills(id);
        expect(skills.length).toBeGreaterThan(0);
        expect(new Set(skills.map(s => s.id)).size).toBe(skills.length);
        const pattern = likeToRegExp(BUILTIN_ADDON_SKILL_SOURCE_PATH[id]);
        expect(skills.filter(s => !pattern.test(s.sourcePath)).map(s => s.id)).toEqual([]);
    });

    it('팩끼리 스킬 id·보관 패턴이 섞이지 않는다', () => {
        const all = CONTENT_PACK_IDS.flatMap(id => loadPackSkills(id).map(s => ({ pack: id, ...s })));
        expect(new Set(all.map(s => s.id)).size).toBe(all.length);
        for (const id of CONTENT_PACK_IDS) {
            const pattern = likeToRegExp(BUILTIN_ADDON_SKILL_SOURCE_PATH[id]);
            expect(all.filter(s => s.pack !== id && pattern.test(s.sourcePath)).map(s => s.id)).toEqual([]);
        }
    });

    it('산업 팩은 모든 산업 에이전트에 페르소나 스킬을 하나씩 배정한다', () => {
        const agentIds = Object.values(getIndustryAgentsData()).flatMap(c => c.agents.map(a => a.id)).sort();
        const assigned = loadPackSkills('industry-pack').map(s => s.assignToAgent).sort();
        expect(assigned).toEqual(agentIds);
    });
});

describe('installPackSkills', () => {
    it('모든 스킬을 upsert 하고 배정 대상만 배정하며, 한 건의 실패가 나머지를 막지 않는다', async () => {
        const skills = loadPackSkills('industry-pack');
        const upserted: string[] = [];
        const assigned: Array<[string, string, number | undefined]> = [];
        const store = {
            upsertSystemSkill: async (id: string, input: { isPublic?: boolean; sourcePath?: string }) => {
                if (id === skills[0].id) throw new Error('boom');
                expect(input.isPublic).toBe(true);
                upserted.push(id);
            },
            assignSkillToAgent: async (agentId: string, skillId: string, priority?: number) => { assigned.push([agentId, skillId, priority]); },
        };
        const result = await installPackSkills('industry-pack', store);
        expect(result.installed).toBe(skills.length - 1);
        expect(result.failed).toEqual([`${skills[0].id}: boom`]);
        expect(upserted).toHaveLength(skills.length - 1);
        expect(assigned).toContainEqual([skills[1].assignToAgent, skills[1].id, 0]);

        const utility = await installPackSkills('utility-pack', { ...store, assignSkillToAgent: async () => { throw new Error('배정되면 안 된다'); } });
        expect(utility.failed).toEqual([]);
    });
});

it('통합형 add-on 은 스킬을 싣지 않는다', () => {
    for (const id of BUILTIN_ADDON_IDS.filter(i => BUILTIN_ADDON_KIND[i] === 'integration')) {
        expect(loadPackSkills(id)).toEqual([]);
        expect(BUILTIN_ADDON_SKILL_SOURCE_PATH[id]).toBeUndefined();
    }
});
