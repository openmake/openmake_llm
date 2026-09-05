/**
 * buildManifestPrompt — 주입 합계 상한 (프롬프트 다이어트, 2026-09-05).
 *
 * 실측: backend-developer 는 배정 4개 합계 30.7K 자(≈9K 토큰)가 매 턴 실렸다.
 * priority 순으로 담다가 SKILL_MANIFEST_INJECT_MAX_CHARS 를 넘으면 나머지를 건너뛰되,
 * 첫 스킬은 상한과 무관하게 항상 주입한다.
 */
import { SkillManager } from '../skill-manager';

jest.mock('../../config/runtime-limits', () => ({
    ...jest.requireActual('../../config/runtime-limits'),
    SKILL_MANIFEST_INJECT_MAX_CHARS: 1000,
    SKILL_MANIFEST_PER_SKILL_MAX_CHARS: 700,
}));

const row = (id: string, chars: number) => ({
    id, version: '1.0.0', assigned_to: 'backend-developer',
    prompt_md: `${id.toUpperCase()}:` + 'x'.repeat(chars),
    manifest_yaml: `name: ${id}\ncategory: technology`,
});

let rows: ReturnType<typeof row>[] = [];
jest.mock('../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({ query: async () => ({ rows }) }) }),
}));

function manager(): SkillManager {
    const mgr = new SkillManager();
    (mgr as unknown as { repo: unknown }).repo = { getUserSkills: async () => [] };
    return mgr;
}

describe('buildManifestPrompt — 주입 합계 상한', () => {
    it('상한을 넘는 뒤쪽 스킬은 건너뛰고 skillNames 도 주입분만 남긴다', async () => {
        rows = [row('ecc-a', 600), row('ecc-b', 300), row('ecc-c', 300), row('sys', 50)];
        const out = await manager().buildManifestPrompt('backend-developer', undefined, 'technology');
        expect(out).not.toBeNull();
        // a(600)+b(300)=900 ≤ 1000, c 는 1200 초과로 건너뜀, sys(50) 는 950 이라 담김 (system 이 아닌 'sys' 는 priority 순)
        expect(out!.skillNames).toEqual(['ecc-a', 'ecc-b', 'sys']);
        expect(out!.prompt).toContain('ECC-A:');
        expect(out!.prompt).not.toContain('ECC-C:');
    });

    it('큰 스킬은 개별 상한으로 절단돼 뒤의 system 스킬이 밀려나지 않는다', async () => {
        rows = [row('huge', 5000), row('system-skill-backend', 100)];
        const out = await manager().buildManifestPrompt('backend-developer', undefined, 'technology');
        expect(out!.skillNames).toEqual(['system-skill-backend', 'huge']);
        expect(out!.prompt).toContain('... (truncated)');
        expect(out!.prompt).toContain('SYSTEM-SKILL-BACKEND:');
    });

    it('system 스킬은 priority 가 낮아도 먼저 담겨 상한에 밀려나지 않는다', async () => {
        rows = [row('ecc-a', 600), row('ecc-b', 350), row('system-skill-backend', 100)];
        const out = await manager().buildManifestPrompt('backend-developer', undefined, 'technology');
        expect(out!.skillNames).toEqual(['system-skill-backend', 'ecc-a']);
    });

    it('합계가 상한 이내면 전부 주입한다', async () => {
        rows = [row('a', 100), row('b', 100), row('c', 100)];
        const out = await manager().buildManifestPrompt('backend-developer', undefined, 'technology');
        expect(out!.skillNames).toEqual(['a', 'b', 'c']);
    });
});
