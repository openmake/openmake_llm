/**
 * Add-on 사용권(entitlement) — 켜짐 상태 × 조직 allowlist 의 AND (2026-09-19, S3).
 *
 * 조직 허용 목록의 계약이 여기 있다: allowlist 에 없는 add-on 은 전용 라우트 403,
 * 팩 스킬 주입 제외. 판정 실패는 state-unknown(라우트는 503). 스킬 주입 필터(entitledAddonIds)만 fail-open 을 유지한다.
 */
// 단건 판정은 엄격 조회, 스킬 주입 필터는 fail-open 조회를 쓴다 — 실제 하위 조회 실패는 entitlement-org-failure.test.ts
const resolveEffectivePolicy = jest.fn();
const resolveEffectivePolicyStrict = jest.fn();
jest.mock('../../org/effective-policy', () => ({
    resolveEffectivePolicy: (...a: unknown[]) => resolveEffectivePolicy(...a),
    resolveEffectivePolicyStrict: (...a: unknown[]) => resolveEffectivePolicyStrict(...a),
}));

const listRows = jest.fn();
jest.mock('../../../data/repositories/addon-state-repository', () => ({
    AddonStateRepository: jest.fn().mockImplementation(() => ({ list: listRows })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));

import { checkAddonEntitlement, entitledAddonIds } from '../entitlement';
import { __resetAddonStateCacheForTest, ensureAddonStates, isAddonEnabledSync } from '../addon-state';
import { recordAddonBootCandidates, resetAddonRuntimeStatusesForTest, setAddonRuntimeStatus } from '../../../addon-host/activation';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

beforeEach(() => {
    jest.clearAllMocks();
    __resetAddonStateCacheForTest();
    resetAddonRuntimeStatusesForTest();
    delete process.env[ENV_KEY];
    listRows.mockResolvedValue([
        { addon_id: 'industry-pack', state: 'enabled' },
        { addon_id: 'sleeping-pack', state: 'disabled' },
        { addon_id: 'broken-pack', state: 'failed' },
    ]);
    resolveEffectivePolicy.mockResolvedValue({ orgId: null });
    resolveEffectivePolicyStrict.mockResolvedValue({ orgId: null });
});

describe('checkAddonEntitlement', () => {
    it('켜져 있고 조직 제한이 없으면 ok', async () => {
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('부팅에 실패한(state=failed) add-on 은 failed — 조직 축은 보지 않는다', async () => {
        expect(await checkAddonEntitlement('broken-pack', 'u1')).toBe('failed');
        expect(resolveEffectivePolicyStrict).not.toHaveBeenCalled();
    });

    it('관리자가 DB 에서 끈 add-on 은 disabled', async () => {
        expect(await checkAddonEntitlement('sleeping-pack', 'u1')).toBe('disabled');
    });

    it('env 로 끈 add-on 은 DB 가 enabled 여도 disabled (비상 override 가 이긴다)', async () => {
        process.env[ENV_KEY] = 'industry-pack';
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('disabled');
    });

    it('조직 allowlist 에 없으면 not-entitled (조직 허용 목록 밖)', async () => {
        resolveEffectivePolicyStrict.mockResolvedValue({ orgId: 'org1', addonAllowlist: ['other-pack'] });
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('not-entitled');
    });

    it('조직 allowlist 에 있으면 ok', async () => {
        resolveEffectivePolicyStrict.mockResolvedValue({ orgId: 'org1', addonAllowlist: ['industry-pack'] });
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('사용자 없이(내부 호출) 부르면 조직 축은 보지 않는다', async () => {
        resolveEffectivePolicyStrict.mockResolvedValue({ orgId: 'org1', addonAllowlist: [] });
        expect(await checkAddonEntitlement('industry-pack')).toBe('ok');
        expect(resolveEffectivePolicyStrict).not.toHaveBeenCalled();
    });

    it('조직 정책 조회가 실패하면 state-unknown (허용으로 읽지 않는다)', async () => {
        resolveEffectivePolicyStrict.mockRejectedValue(new Error('DB 장애'));
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('state-unknown');
        expect(resolveEffectivePolicy).not.toHaveBeenCalled();
    });

    it('상태를 못 읽으면(DB 미초기화) state-unknown', async () => {
        listRows.mockRejectedValue(new Error('부팅 초기'));
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('state-unknown');
    });
});

describe('이 프로세스의 부팅 결과 (외부 리뷰 A4)', () => {
    it('부팅에 실패한 add-on 은 관리자가 DB 에서 다시 켜도(enabled) 재시작 전까지 failed', async () => {
        setAddonRuntimeStatus('industry-pack', 'failed', { code: 'migration_failed', reason: 'boom' });
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('failed');
        await ensureAddonStates();
        expect(isAddonEnabledSync('industry-pack')).toBe(false); // 순수 채팅 훅도 같은 판정
    });

    it('런타임 상태를 기록하지 않는 프로세스(별도 worker — not_loaded)는 DB 상태대로', async () => {
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
        setAddonRuntimeStatus('industry-pack', 'ready');
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('관리자가 끈 add-on 은 부팅 결과와 무관하게 disabled', async () => {
        setAddonRuntimeStatus('sleeping-pack', 'failed', { code: 'runtime_failed', reason: 'x' });
        expect(await checkAddonEntitlement('sleeping-pack', 'u1')).toBe('disabled');
    });

    it('부팅 때 꺼져 있다가(제외 — not_loaded) 나중에 켠 런타임 add-on 은 재시작 전까지 failed', async () => {
        recordAddonBootCandidates([{ addonId: 'industry-pack', requiresProcessBoot: true }]);
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('failed');
        setAddonRuntimeStatus('industry-pack', 'ready');
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('껐다 켰는데 재개하지 못한(stopped) 런타임 add-on 도 failed', async () => {
        recordAddonBootCandidates([{ addonId: 'industry-pack', requiresProcessBoot: true }]);
        setAddonRuntimeStatus('industry-pack', 'stopped');
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('failed');
        await ensureAddonStates();
        expect(isAddonEnabledSync('industry-pack')).toBe(false);
    });

    it('세울 것이 없는 add-on(라우트·콘텐츠만)은 부팅 때 꺼져 있었어도 켜는 즉시 ok(실시간 토글 유지)', async () => {
        recordAddonBootCandidates([{ addonId: 'industry-pack', requiresProcessBoot: false }]);
        expect(await checkAddonEntitlement('industry-pack', 'u1')).toBe('ok');
    });

    it('부팅 후보가 아니던 add-on(설치형 확장 등)은 DB 상태대로', async () => {
        recordAddonBootCandidates([{ addonId: 'other-pack', requiresProcessBoot: true }]);
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

    it('상태를 못 읽어도 스킬 주입 필터는 종전대로 막지 않는다(fail-open 유지)', async () => {
        listRows.mockRejectedValue(new Error('DB 장애'));
        const allowed = await entitledAddonIds(['industry-pack'], 'u1');
        expect([...allowed]).toEqual(['industry-pack']);
    });
});
