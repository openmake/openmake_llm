/**
 * 팩 스킬의 사용권 게이트 — 유료 팩 시뮬레이션 (2026-09-19, S3·S4).
 *
 * 계약: 조직이 add-on 사용권을 갖지 못하면 그 팩의 스킬은 **시스템 프롬프트에 실리지 않는다**.
 * Base 스킬(addon_id NULL)은 영향받지 않고, 판정 실패는 주입을 막지 않는다(fail-open).
 */
import { SkillManager } from '../skill-manager';

const row = (id: string, addonId: string | null) => ({
    id, version: '1.0.0', assigned_to: '__global__', addon_id: addonId,
    prompt_md: `${id.toUpperCase()}: 내용`,
    manifest_yaml: `name: ${id}\ncategory: general`,
});

let rows: ReturnType<typeof row>[] = [];
jest.mock('../../../data/models/unified-database', () => ({
    getUnifiedDatabase: () => ({ getPool: () => ({ query: async () => ({ rows }) }) }),
}));

const entitledAddonIds = jest.fn();
jest.mock('../../../services/addon/entitlement', () => ({
    entitledAddonIds: (...a: unknown[]) => entitledAddonIds(...a),
}));

function manager(): SkillManager {
    const mgr = new SkillManager();
    (mgr as unknown as { repo: unknown }).repo = { getUserSkills: async () => [] };
    return mgr;
}

beforeEach(() => { entitledAddonIds.mockReset(); });

describe('buildManifestPrompt — add-on 사용권', () => {
    it('사용권 있는 팩의 스킬은 그대로 주입된다', async () => {
        rows = [row('industry-a', 'industry-pack')];
        entitledAddonIds.mockResolvedValue(new Set(['industry-pack']));

        const out = await manager().buildManifestPrompt('__global__', 'u1', 'general');

        expect(out).not.toBeNull();
        expect(out!.prompt).toContain('INDUSTRY-A:');
        expect(entitledAddonIds).toHaveBeenCalledWith(['industry-pack'], 'u1');
    });

    it('사용권 없는 팩의 스킬은 빠진다 — 남은 게 없으면 주입 자체가 없다(유료 팩 미구매)', async () => {
        rows = [row('industry-a', 'industry-pack')];
        entitledAddonIds.mockResolvedValue(new Set<string>());

        expect(await manager().buildManifestPrompt('__global__', 'u1', 'general')).toBeNull();
    });

    it('Base 스킬(addon_id 없음)은 사용권과 무관하게 남는다', async () => {
        rows = [row('industry-a', 'industry-pack'), row('base-skill', null)];
        entitledAddonIds.mockResolvedValue(new Set<string>());

        const out = await manager().buildManifestPrompt('__global__', 'u1', 'general');

        expect(out).not.toBeNull();
        expect(out!.prompt).toContain('BASE-SKILL:');
        expect(out!.prompt).not.toContain('INDUSTRY-A:');
    });

    it('팩 스킬이 하나도 없으면 사용권 조회를 하지 않는다', async () => {
        rows = [row('base-skill', null)];

        const out = await manager().buildManifestPrompt('__global__', 'u1', 'general');

        expect(out).not.toBeNull();
        expect(entitledAddonIds).not.toHaveBeenCalled();
    });

    it('사용권 판정이 실패하면 주입을 유지한다(fail-open)', async () => {
        rows = [row('industry-a', 'industry-pack')];
        entitledAddonIds.mockRejectedValue(new Error('정책 조회 실패'));

        const out = await manager().buildManifestPrompt('__global__', 'u1', 'general');

        expect(out).not.toBeNull();
        expect(out!.prompt).toContain('INDUSTRY-A:');
    });
});
