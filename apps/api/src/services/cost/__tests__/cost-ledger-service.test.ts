/**
 * 단가 해석 우선순위 DB(정확) > DB(*) > 코드/env 폴백 > 0, 원장 행 계산.
 */
const listAll = jest.fn(async () => [] as Array<{ kind: string; rate_key: string; unit: string; usd_micros_per_unit: string }>);
const insert = jest.fn(async (_row: unknown) => undefined);
jest.mock('../../../data/repositories/cost-rate-repository', () => ({ CostRateRepository: jest.fn().mockImplementation(() => ({ listAll })) }));
jest.mock('../../../data/repositories/cost-ledger-repository', () => ({ CostLedgerRepository: jest.fn().mockImplementation(() => ({ insert })) }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));
jest.mock('../../org/membership-cache', () => ({ activeOrgFor: async () => ({ orgId: 'o1', orgRole: 'member' }) }));

import { resolveRateFromTable, fallbackRate, recordCostAsync, clearCostRateCache } from '../cost-ledger-service';
import { runWithCostSession } from '../../../utils/cost-attribution-context';
import { getKeyValueStore, resetKeyValueStoreForTests } from '../../../storage';
import { resetConfig } from '../../../config/env';
import { costMonthKey } from '../../../llm/user-quota';

describe('resolveRateFromTable', () => {
    const table = new Map<string, number>([['llm.local|qwen3.8-27b|token_in', 0.5], ['llm.local|*|token_out', 1.5]]);
    test('정확 일치 → 와일드카드 → 폴백', () => {
        expect(resolveRateFromTable(table, 'llm.local', 'qwen3.8-27b', 'token_in')).toBe(0.5);
        expect(resolveRateFromTable(table, 'llm.local', 'other', 'token_out')).toBe(1.5);
        expect(resolveRateFromTable(table, 'llm.local', 'other', 'token_in')).toBe(fallbackRate('llm.local', 'other', 'token_in'));
    });
    test('외부 폴백은 external-pricing 상수표, 미등록은 0', () => {
        expect(fallbackRate('llm.external', 'openrouter:openai/gpt-5', 'token_in')).toBeGreaterThan(0);
        expect(fallbackRate('llm.external', 'nowhere:model', 'token_in')).toBe(0);
        expect(fallbackRate('media.image.generate', 'x', 'image')).toBe(0);
    });
});

describe('recordCostAsync', () => {
    // 루트 .env·셸이 STORAGE_BACKEND=redis 여도 실제 Redis 에 쓰지 않도록(연결이 남아 워커가 끝나지 않는다)
    // 그리고 메모리 저장소 회귀를 검증하도록 백엔드를 메모리로 고정한다.
    const originalBackend = process.env.STORAGE_BACKEND;
    beforeEach(() => {
        process.env.STORAGE_BACKEND = 'memory';
        resetConfig();
        resetKeyValueStoreForTests();
        clearCostRateCache(); listAll.mockReset(); insert.mockReset(); listAll.mockResolvedValue([]);
    });
    afterEach(() => {
        if (originalBackend === undefined) delete process.env.STORAGE_BACKEND;
        else process.env.STORAGE_BACKEND = originalBackend;
        resetConfig();
        resetKeyValueStoreForTests();
    });
    test('DB 단가 × 수량 을 반올림해 적재하고 활성 조직을 귀속', async () => {
        listAll.mockResolvedValue([{ kind: 'llm.local', rate_key: '*', unit: 'token_in', usd_micros_per_unit: '2' }]);
        await recordCostAsync({ userId: 'u1', kind: 'llm.local', rateKey: 'm', unit: 'token_in', quantity: 1001, costOwner: 'user' });
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', orgId: 'o1', costUsdMicros: 2002, usdMicrosPerUnit: 2 }));
    });
    test('확정 비용이 있으면 단가 계산을 건너뛴다', async () => {
        await recordCostAsync({ userId: 'u1', kind: 'llm.external', rateKey: 'openrouter:x', unit: 'token_out', quantity: 10, costOwner: 'byok', directCostUsdMicros: 777 });
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ costUsdMicros: 777 }));
        expect(listAll).not.toHaveBeenCalled();
    });
    test('수량 0·게스트 처리', async () => {
        await recordCostAsync({ userId: 'guest', kind: 'llm.local', rateKey: 'm', unit: 'token_in', quantity: 0, costOwner: 'user' });
        expect(insert).not.toHaveBeenCalled();
        await recordCostAsync({ userId: 'guest', kind: 'llm.local', rateKey: 'm', unit: 'token_in', quantity: 5, costOwner: 'user' });
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ userId: null, orgId: null }));
    });
    test('비용 귀속 문맥 안에서 적재하면 그 세션 id 가 붙는다 — 외부 모델 사용분처럼 호출부가 세션을 모르는 경로', async () => {
        await runWithCostSession('task-1', () => recordCostAsync({ userId: 'u1', kind: 'llm.external', rateKey: 'openrouter:x', unit: 'token_out', quantity: 10, costOwner: 'byok', ctx: { feature: 'role:agent' } }));
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'task-1', feature: 'role:agent' }));
    });
    test('호출부가 준 세션 id 가 문맥보다 우선하고, 문맥 밖이면 null', async () => {
        await runWithCostSession('task-1', () => recordCostAsync({ userId: 'u1', kind: 'llm.local', rateKey: 'm', unit: 'token_in', quantity: 5, costOwner: 'user', ctx: { sessionId: 'explicit' } }));
        expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: 'explicit' }));
        await recordCostAsync({ userId: 'u1', kind: 'llm.local', rateKey: 'm', unit: 'token_in', quantity: 5, costOwner: 'user' });
        expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: null }));
    });

    test('메모리 저장소에서도 월 비용 버킷이 기록 직후 사라지지 않는다(62일 TTL 이 1ms 로 줄던 문제)', async () => {
        const now = Date.now();
        const store = getKeyValueStore();
        expect(store.backend).toBe('memory');
        const k = costMonthKey('u-bucket', now);
        await recordCostAsync({ userId: 'u-bucket', kind: 'llm.external', rateKey: 'openrouter:x', unit: 'token_out', quantity: 10, costOwner: 'byok', directCostUsdMicros: 500 }, now);
        await new Promise((r) => setTimeout(r, 20));
        expect(await store.get(k)).toBe(500);
    });
});
