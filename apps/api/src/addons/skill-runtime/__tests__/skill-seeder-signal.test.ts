/**
 * Base 스킬 시드는 호스트 signal 로 중단된다 — 시작 시간 초과·프로세스 종료 뒤에 DB 를 계속 쓰지 않는다.
 */
const upsertSystemSkill = jest.fn(async (_id: string, _s: unknown) => undefined);
const assignSkillToAgent = jest.fn(async (_a: string, _s: string, _p: number) => undefined);
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../../../data/repositories/skill-repository', () => ({
    SkillRepository: jest.fn().mockImplementation(() => ({
        upsertSystemSkill: (id: string, s: unknown) => upsertSystemSkill(id, s),
        assignSkillToAgent: (a: string, s: string, p: number) => assignSkillToAgent(a, s, p),
    })),
}));

import { seedBaseSkills } from '../skill-seeder';

beforeEach(() => { jest.clearAllMocks(); });

describe('seedBaseSkills(signal)', () => {
    it('signal 이 없으면 종전대로 시스템 스킬 2개를 upsert 하고 general 에 배정한다', async () => {
        await seedBaseSkills();
        expect(upsertSystemSkill.mock.calls.map((c) => c[0])).toEqual(['system-skill-general', 'system-skill-author-guide']);
        expect(assignSkillToAgent).toHaveBeenCalledTimes(1);
    });

    it('이미 끊긴 signal 이면 DB 를 쓰지 않는다', async () => {
        await seedBaseSkills(AbortSignal.abort());
        expect(upsertSystemSkill).not.toHaveBeenCalled();
        expect(assignSkillToAgent).not.toHaveBeenCalled();
    });

    it('첫 스킬을 쓰는 도중 끊기면 다음 스킬은 쓰지 않는다', async () => {
        const ac = new AbortController();
        upsertSystemSkill.mockImplementationOnce(async () => { ac.abort(); });
        await seedBaseSkills(ac.signal);
        expect(upsertSystemSkill).toHaveBeenCalledTimes(1);
    });
});
