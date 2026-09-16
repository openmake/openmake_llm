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
    beforeEach(() => { clearCostRateCache(); listAll.mockReset(); insert.mockReset(); listAll.mockResolvedValue([]); });
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
});
