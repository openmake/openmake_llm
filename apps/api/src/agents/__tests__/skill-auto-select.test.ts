/**
 * 스킬 자동 호출(LLM self-select) 단위 테스트 — buildSkillCatalog / buildSkillPromptForNames.
 * private repo 를 가짜 구현으로 주입해 DB 없이 순수 로직(포맷·매칭·dedup·권한·topK)을 검증.
 */
import { SkillManager } from '../skill-manager';
import type { AgentSkill } from '../../data/repositories/skill-repository';

function skill(partial: Partial<AgentSkill> & { id: string; name: string }): AgentSkill {
    return {
        description: '', content: 'CONTENT', category: 'general',
        isPublic: true, createdBy: 'owner1', status: 'active',
        createdAt: new Date(0), updatedAt: new Date(0),
        ...partial,
    } as unknown as AgentSkill;
}

function managerWithSkills(skills: AgentSkill[]): SkillManager {
    const mgr = new SkillManager();
    const fakeRepo = {
        searchSkills: async () => ({ skills, total: skills.length, limit: 200, offset: 0 }),
        getSkillById: async (id: string) => skills.find((s) => s.id === id) ?? null,
    };
    // private repo 주입 — ensureInitialized 가 doInit(DB) 건너뛰고 이 repo 사용
    (mgr as unknown as { repo: unknown }).repo = fakeRepo;
    return mgr;
}

describe('buildSkillCatalog', () => {
    it('이름: 설명 줄 목록으로 직렬화한다', async () => {
        const mgr = managerWithSkills([
            skill({ id: 's1', name: '전기 엔지니어', description: '회로, 전력 시스템' }),
            skill({ id: 's2', name: '보고서 작성', description: '' }),
        ]);
        const { catalog, count } = await mgr.buildSkillCatalog();
        expect(count).toBe(2);
        expect(catalog).toContain('- 전기 엔지니어: 회로, 전력 시스템');
        expect(catalog).toContain('- 보고서 작성'); // 설명 없으면 이름만
        expect(catalog).not.toContain('보고서 작성:'); // 빈 설명은 콜론 미부착
    });

    it('excludeIds(바인딩 스킬)는 카탈로그에서 제외한다 (dedup)', async () => {
        const mgr = managerWithSkills([
            skill({ id: 's1', name: 'A', description: 'aa' }),
            skill({ id: 's2', name: 'B', description: 'bb' }),
        ]);
        const { catalog, count } = await mgr.buildSkillCatalog({ excludeIds: new Set(['s1']) });
        expect(count).toBe(1);
        expect(catalog).toContain('- B:');
        expect(catalog).not.toContain('- A:');
    });

    it('이름의 위험 문자를 이스케이프하고 설명을 절단한다', async () => {
        const longDesc = 'x'.repeat(300);
        const mgr = managerWithSkills([
            skill({ id: 's1', name: 'a<b>"&', description: longDesc }),
        ]);
        const { catalog } = await mgr.buildSkillCatalog();
        expect(catalog).toContain('- ab'); // <>"& 제거
        expect(catalog).not.toContain('<b>');
        // SKILL_CATALOG_DESC_MAX 기본 120자 이하
        const descPart = catalog.split(': ')[1] ?? '';
        expect(descPart.length).toBeLessThanOrEqual(120);
    });
});

describe('buildSkillPromptForNames', () => {
    const skills = [
        skill({ id: 's1', name: '전기 엔지니어', content: 'ELEC' }),
        skill({ id: 's2', name: '보고서 작성', content: 'REPORT' }),
        skill({ id: 's3', name: 'Korean Medical Law', content: 'MEDLAW' }),
    ];

    it('정확한 이름(대소문자 무관)으로 매칭해 content 를 주입한다', async () => {
        const mgr = managerWithSkills(skills);
        const { prompt, matched } = await mgr.buildSkillPromptForNames(['전기 엔지니어']);
        expect(matched).toEqual(['전기 엔지니어']);
        expect(prompt).toContain('ELEC');
    });

    it('slug 로도 매칭한다 (korean-medical-law → Korean Medical Law)', async () => {
        const mgr = managerWithSkills(skills);
        const { matched } = await mgr.buildSkillPromptForNames(['korean-medical-law']);
        expect(matched).toEqual(['Korean Medical Law']);
    });

    it('topK 로 선택 개수를 제한한다', async () => {
        const mgr = managerWithSkills(skills);
        const { matched } = await mgr.buildSkillPromptForNames(
            ['전기 엔지니어', '보고서 작성', 'Korean Medical Law'], undefined, 2,
        );
        expect(matched).toHaveLength(2);
    });

    it('중복 이름은 한 번만 선택한다 (dedup)', async () => {
        const mgr = managerWithSkills(skills);
        const { matched } = await mgr.buildSkillPromptForNames(['전기 엔지니어', '전기 엔지니어']);
        expect(matched).toEqual(['전기 엔지니어']);
    });

    it('비공개 스킬은 소유자가 아니면 제외한다', async () => {
        const priv = [skill({ id: 'p1', name: '비공개', content: 'SECRET', isPublic: false, createdBy: 'owner1' })];
        const mgr = managerWithSkills(priv);
        const asOther = await mgr.buildSkillPromptForNames(['비공개'], 'someone-else');
        expect(asOther.matched).toHaveLength(0);
        const asOwner = await mgr.buildSkillPromptForNames(['비공개'], 'owner1');
        expect(asOwner.matched).toEqual(['비공개']);
    });

    it('미매칭·빈 입력은 빈 결과를 반환한다', async () => {
        const mgr = managerWithSkills(skills);
        expect((await mgr.buildSkillPromptForNames([])).matched).toHaveLength(0);
        expect((await mgr.buildSkillPromptForNames(['없는스킬'])).matched).toHaveLength(0);
    });
});

describe('buildSkillPromptForIds 권한 필터 (camelCase 회귀)', () => {
    it('비공개 스킬은 비소유자에게 빈 프롬프트를 반환한다', async () => {
        const priv = [skill({ id: 'p1', name: '비공개', content: 'SECRET', isPublic: false, createdBy: 'owner1' })];
        const mgr = managerWithSkills(priv);
        // 버그(snake_case 읽기) 시절엔 isPublic 이 undefined→공개로 오판해 SECRET 노출됐음
        expect(await mgr.buildSkillPromptForIds(['p1'], 'someone-else')).toBe('');
        expect(await mgr.buildSkillPromptForIds(['p1'], 'owner1')).toContain('SECRET');
    });

    it('공개 스킬은 누구에게나 주입된다', async () => {
        const pub = [skill({ id: 'g1', name: '공개', content: 'OPEN', isPublic: true })];
        const mgr = managerWithSkills(pub);
        expect(await mgr.buildSkillPromptForIds(['g1'], 'anyone')).toContain('OPEN');
    });
});

describe('searchSkills userId 전파 (비공개 확장 스킬 포함, 2026-08-16)', () => {
    function managerWithSpy(skills: AgentSkill[]) {
        const mgr = new SkillManager();
        const searchSkills = jest.fn(async () => ({ skills, total: skills.length, limit: 200, offset: 0 }));
        (mgr as unknown as { repo: unknown }).repo = { searchSkills };
        return { mgr, searchSkills };
    }

    it('buildSkillCatalog 이 userId 를 repo 검색에 전달한다', async () => {
        const { mgr, searchSkills } = managerWithSpy([skill({ id: 's1', name: 'A' })]);
        await mgr.buildSkillCatalog({ userId: 'u3' });
        expect(searchSkills).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u3' }));
    });

    it('buildSkillPromptForNames 가 userId 를 repo 검색에 전달한다', async () => {
        const { mgr, searchSkills } = managerWithSpy([skill({ id: 's1', name: 'A' })]);
        await mgr.buildSkillPromptForNames(['A'], 'u3');
        expect(searchSkills).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u3' }));
    });
});
