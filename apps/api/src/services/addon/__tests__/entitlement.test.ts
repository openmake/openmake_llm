/**
 * Add-on 사용권(entitlement) — 켜짐 상태 × 조직 allowlist 의 AND (2026-09-19, S3).
 *
 * 유료 팩의 계약이 여기 있다: 구매하지 않은 조직(allowlist 에 없는 add-on)은 전용 라우트 403,
 * 팩 스킬 주입 제외. 판정 실패는 fail-open(막지 않는다).
 */
const resolveEffectivePolicy = jest.fn();
jest.mock('../../org/effective-policy', () => ({ resolveEffectivePolicy: (...a: unknown[]) => resolveEffectivePolicy(...a) }));

const listRows = jest.fn();
jest.mock('../../../data/repositories/addon-state-repository', () => ({
    AddonStateRepository: jest.fn().mockImplementation(() => ({ list: listRows })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

import { checkAddonEntitlement, entitledAddonIds } from '../entitlement';
import { clearAddonStateCache } from '../addon-state';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

beforeEach(() => {
    jest.clearAllMocks();
    clearAddonStateCache();
    delete process.env[ENV_KEY];
    listRows.mockResolvedValue([
        { addon_id: 'industry-pack', state: 'enabled' },
        { addon_id: 'sleeping-pack', state: 'disabled' },
    ]);
    resolveEffectivePolicy.mockResolvedValue({ orgId: null });
});

describe('checkAddonEntitlement', () => {
    it('켜져 있고 조직 제한이 없으면 ok', async () => {
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('관리자가 DB 에서 끈 add-on 은 disabled', async () => {
        expect(await checkAddonEntitlement('sleeping-pack', 'u1')).toBe('disabled');
    });

    it('env 로 끈 add-on 은 DB 가 enabled 여도 disabled (비상 override 가 이긴다)', async () => {
        process.env[ENV_KEY] = 'industry-pack';
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('disabled');
    });

    it('조직 allowlist 에 없으면 not-entitled (유료 팩 미구매)', async () => {
        resolveEffectivePolicy.mockResolvedValue({ orgId: 'org1', addonAllowlist: ['other-pack'] });
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('not-entitled');
    });

    it('조직 allowlist 에 있으면 ok', async () => {
        resolveEffectivePolicy.mockResolvedValue({ orgId: 'org1', addonAllowlist: ['industry-pack'] });
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('사용자 없이(내부 호출) 부르면 조직 축은 보지 않는다', async () => {
        resolveEffectivePolicy.mockResolvedValue({ orgId: 'org1', addonAllowlist: [] });
        expect(await checkAddonEntitlement('industry-pack')).toBe('ok');
        expect(resolveEffectivePolicy).not.toHaveBeenCalled();
    });

    it('정책 조회가 실패해도 막지 않는다(fail-open)', async () => {
        resolveEffectivePolicy.mockRejectedValue(new Error('DB 장애'));
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('상태를 못 읽어도(DB 미초기화) 막지 않는다', async () => {
        listRows.mockRejectedValue(new Error('부팅 초기'));
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });
});

describe('entitledAddonIds', () => {
    it('끈 것과 allowlist 밖을 함께 걸러 낸다 (정책 조회는 1회)', async () => {
        resolveEffectivePolicy.mockResolvedValue({ orgId: 'org1', addonAllowlist: ['industry-pack'] });
        const allowed = await entitledAddonIds(['industry-pack', 'sleeping-pack', 'unknown-pack'], 'u1');
        expect([...allowed]).toEqual(['industry-pack']);
        expect(resolveEffectivePolicy).toHaveBeenCalledTimes(1);
    });

    it('빈 입력은 조회 없이 빈 집합', async () => {
        expect([...(await entitledAddonIds([], 'u1'))]).toEqual([]);
        expect(resolveEffectivePolicy).not.toHaveBeenCalled();
    });
});
