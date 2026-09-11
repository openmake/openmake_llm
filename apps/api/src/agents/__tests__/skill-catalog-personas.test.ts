/**
 * load_skill 카탈로그 — 페르소나 제외·상한 초과 경고 (2026-09-11).
 *
 * 페르소나 스킬("○○ 전문 스킬")은 자기 에이전트에 이미 자동 주입되는데 카탈로그에도 실려 매 턴
 * ~2.2K 토큰(101줄)을 먹었다. 카탈로그는 이름순 상한(200)에 199 로 닿아 있어, 초과분이 경고 없이
 * 빠질 참이었다.
 */
jest.mock('../../utils/logger', () => {
    const shared = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    return { createLogger: () => shared, __shared: shared };
});

import { SkillManager } from '../skill-manager';
import type { AgentSkill } from '../../data/repositories/skill-repository';

const logger = (jest.requireMock('../../utils/logger') as { __shared: { warn: jest.Mock } }).__shared;

function skill(id: string, name: string): AgentSkill {
    return {
        id, name, description: 'd', content: 'C', category: 'general',
        isPublic: true, createdBy: 'owner1', status: 'active',
        createdAt: new Date(0), updatedAt: new Date(0),
    } as unknown as AgentSkill;
}

function managerWith(Manager: typeof SkillManager, skills: AgentSkill[], total = skills.length) {
    const searchSkills = jest.fn(async () => ({ skills, total, limit: 200, offset: 0 }));
    const mgr = new Manager();
    // private repo 주입 — ensureInitialized 가 DB 초기화를 건너뛴다
    (mgr as unknown as { repo: unknown }).repo = { searchSkills };
    return { mgr, searchSkills };
}

describe('카탈로그 페르소나 제외', () => {
    it('카탈로그와 load_skill 조회가 같은 조건(페르소나 제외)으로 검색한다', async () => {
        const { mgr, searchSkills } = managerWith(SkillManager, [skill('s1', 'A')]);
        await mgr.buildSkillCatalog({ userId: 'u3' });
        await mgr.buildSkillPromptForNames(['A'], 'u3');

        expect(searchSkills).toHaveBeenCalledTimes(2);
        for (const call of searchSkills.mock.calls as unknown as Array<[Record<string, unknown>]>) {
            expect(call[0]).toEqual(expect.objectContaining({ excludeAgentPersonas: true }));
        }
    });

    it("SKILL_CATALOG_EXCLUDE_PERSONAS='false' 면 종전처럼 페르소나도 싣는다 (롤백 경로)", async () => {
        const prev = process.env.SKILL_CATALOG_EXCLUDE_PERSONAS;
        process.env.SKILL_CATALOG_EXCLUDE_PERSONAS = 'false';
        let Isolated!: typeof SkillManager;
        jest.isolateModules(() => {
            Isolated = jest.requireActual<typeof import('../skill-manager')>('../skill-manager').SkillManager;
        });
        if (prev === undefined) delete process.env.SKILL_CATALOG_EXCLUDE_PERSONAS;
        else process.env.SKILL_CATALOG_EXCLUDE_PERSONAS = prev;

        const { mgr, searchSkills } = managerWith(Isolated, []);
        await mgr.buildSkillCatalog();
        expect(searchSkills).toHaveBeenCalledWith(expect.objectContaining({ excludeAgentPersonas: false }));
    });
});

describe('카탈로그 상한 초과 경고', () => {
    const capWarnings = () => logger.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('카탈로그 상한'));
    beforeEach(() => logger.warn.mockClear());

    it('상한을 넘으면 빠진 개수를 경고하고, 같은 대상 수로는 반복하지 않는다', async () => {
        const { mgr } = managerWith(SkillManager, [skill('s1', 'A'), skill('s2', 'B')], 205);
        await mgr.buildSkillCatalog();
        await mgr.buildSkillCatalog();

        expect(capWarnings()).toHaveLength(1);
        expect(capWarnings()[0]).toContain('203개');
    });

    it('상한 안이면 경고하지 않는다', async () => {
        const { mgr } = managerWith(SkillManager, [skill('s1', 'A')], 1);
        await mgr.buildSkillCatalog();
        expect(capWarnings()).toHaveLength(0);
    });
});
