/**
 * 절차 스킬 저장 — 같은 이름이면 새 행을 넣지 않고 갱신(버전 올림)하거나 거절하고, 직전 본문을 보존해 되돌린다.
 */
import { saveProceduralSkill, revertProceduralSkill, parseSpec, PROCEDURAL_CATEGORY, type ProceduralSpec } from './procedural-skill';
import type { SkillRepository, AgentSkill } from '../../data/repositories/skill-repository';

function fakeRepo(initial: AgentSkill[] = []) {
    const rows = [...initial];
    const repo = {
        createSkill: jest.fn(async (input: { name: string; description?: string; content: string; category?: string; createdBy?: string }) => {
            const row = { id: `skill-${rows.length + 1}`, name: input.name, description: input.description ?? '', content: input.content,
                category: input.category ?? 'general', isPublic: false, createdBy: input.createdBy, createdAt: new Date(), updatedAt: new Date() } as AgentSkill;
            rows.push(row);
            return row;
        }),
        updateSkill: jest.fn(async (id: string, input: { description?: string; content?: string }) => {
            const row = rows.find((r) => r.id === id);
            if (!row) return null;
            Object.assign(row, input);
            return row;
        }),
        searchSkills: jest.fn(async (o: { userId?: string; category?: string }) => {
            const skills = rows.filter((r) => r.category === o.category && (r.createdBy === o.userId || r.isPublic));
            return { skills, total: skills.length, limit: 50, offset: 0 };
        }),
    };
    return { rows, repo: repo as unknown as SkillRepository, mocks: repo };
}

const v1: ProceduralSpec = { kind: 'script', goal: '제곱 계산', lang: 'bash', code: 'echo 1' };
const v2: ProceduralSpec = { kind: 'script', goal: '제곱 계산', lang: 'bash', code: 'echo 2' };

describe('saveProceduralSkill', () => {
    it('처음 저장하면 새 행을 만들고 버전 1', async () => {
        const f = fakeRepo();
        expect(await saveProceduralSkill('u1', 'square', '제곱 계산', v1, {}, f.repo)).toEqual({ id: 'skill-1', version: 1, updated: false });
        expect(f.rows).toHaveLength(1);
        expect(f.rows[0].category).toBe(PROCEDURAL_CATEGORY);
    });

    it('같은 이름이 있는데 갱신 의사가 없으면 거절하고 기존 스킬을 알린다', async () => {
        const f = fakeRepo();
        await saveProceduralSkill('u1', 'square', '제곱 계산', v1, {}, f.repo);
        await expect(saveProceduralSkill('u1', ' Square ', '제곱 계산', v2, {}, f.repo)).rejects.toThrow(/skill-1/);
        expect(f.rows).toHaveLength(1);
        expect(parseSpec(f.rows[0].content)?.code).toBe('echo 1');
    });

    it('update 면 같은 행을 갱신하고 버전을 올리며 직전 본문을 보존한다', async () => {
        const f = fakeRepo();
        await saveProceduralSkill('u1', 'square', '제곱 계산', v1, {}, f.repo);
        expect(await saveProceduralSkill('u1', 'square', '제곱 계산', v2, { update: true }, f.repo)).toEqual({ id: 'skill-1', version: 2, updated: true });
        expect(f.rows).toHaveLength(1);
        const spec = parseSpec(f.rows[0].content);
        expect(spec?.code).toBe('echo 2');
        expect(spec?.version).toBe(2);
        expect(spec?.previous?.code).toBe('echo 1');
    });

    it('다른 사용자의 같은 이름 스킬은 건드리지 않고 새로 만든다', async () => {
        const f = fakeRepo();
        await saveProceduralSkill('u1', 'square', '제곱 계산', v1, {}, f.repo);
        expect((await saveProceduralSkill('u2', 'square', '제곱 계산', v2, { update: true }, f.repo)).updated).toBe(false);
        expect(f.rows).toHaveLength(2);
    });
});

describe('revertProceduralSkill', () => {
    it('직전 본문으로 되돌리고, 되돌리기 전 본문을 다시 보존한다(직전 본문은 한 단계만)', async () => {
        const f = fakeRepo();
        await saveProceduralSkill('u1', 'square', '제곱 계산', v1, {}, f.repo);
        await saveProceduralSkill('u1', 'square', '제곱 계산', v2, { update: true }, f.repo);
        expect(await revertProceduralSkill('u1', 'square', f.repo)).toEqual({ id: 'skill-1', version: 3, updated: true });
        const spec = parseSpec(f.rows[0].content);
        expect(spec?.code).toBe('echo 1');
        expect(spec?.previous?.code).toBe('echo 2');
        expect(spec?.previous?.previous).toBeUndefined();
    });

    it('보존된 직전 본문이 없으면 오류', async () => {
        const f = fakeRepo();
        await saveProceduralSkill('u1', 'square', '제곱 계산', v1, {}, f.repo);
        await expect(revertProceduralSkill('u1', 'square', f.repo)).rejects.toThrow();
        await expect(revertProceduralSkill('u1', 'nope', f.repo)).rejects.toThrow();
    });
});
