/**
 * 비용 원장 서비스 (F25 PR-1, 2026-09-17) — 단가 해석 + 원장 적재(fire-and-forget).
 *
 * 단가 해석 순서(DB > env/config > 0):
 *   1. cost_rates(kind, rate_key 정확 일치, unit)  2. cost_rates(kind, '*', unit)
 *   3. kind 별 코드 폴백 — llm.external 은 config/external-pricing 상수표, llm.local 은 env LOCAL_LLM_COST_*
 *   4. 0 (기록은 남기되 비용 0 — "미등록 = 무비용" 은 현행 동작과 같다)
 * 단가 캐시는 60초(LOCAL_LLM_COST.RATE_CACHE_TTL_MS), 관리자 변경 시 clearCostRateCache().
 * 적재 실패는 warn 만 — 회계가 채팅을 죽이지 않는다.
 *
 * @module services/cost/cost-ledger-service
 */
import { createLogger } from '../../utils/logger';
import { getPool } from '../../data/models/unified-database';
import { CostRateRepository } from '../../data/repositories/cost-rate-repository';
import { CostLedgerRepository, type CostLedgerInsert } from '../../data/repositories/cost-ledger-repository';
import { COST_RATE_WILDCARD, isCostKind, type CostKind, type CostOwner, type CostUnit } from '../../config/cost-kinds';
import { LOCAL_LLM_COST } from '../../config/cost-defaults';
import { getModelPricing } from '../../config/external-pricing';
import { getRequestId } from '../../utils/request-context';
import { activeOrgFor } from '../org/membership-cache';
import { getKeyValueStore } from '../../storage';
import { costMonthKey, COST_MONTH_TTL_MS } from '../../llm/user-quota';

const logger = createLogger('CostLedger');

/** 원장 귀속 컨텍스트 — 호출부가 아는 만큼만 채운다. */
export interface CostContext {
    feature?: string;
    sessionId?: string | null;
    agentId?: string | null;
    requestId?: string | null;
}

type RateTable = Map<string, number>; // `${kind}|${rateKey}|${unit}` → micros/unit
let rateCache: { at: number; table: RateTable } | null = null;

async function loadRates(now: number): Promise<RateTable> {
    if (rateCache && now - rateCache.at < LOCAL_LLM_COST.RATE_CACHE_TTL_MS) return rateCache.table;
    const table: RateTable = new Map();
    try {
        for (const r of await new CostRateRepository(getPool()).listAll()) {
            table.set(`${r.kind}|${r.rate_key}|${r.unit}`, Number(r.usd_micros_per_unit));
        }
    } catch (e) {
        logger.warn('단가표 조회 실패 (코드 폴백 사용):', e);
    }
    rateCache = { at: now, table };
    return table;
}

export function clearCostRateCache(): void { rateCache = null; }

/** PURE: 코드 폴백 단가 (micros/unit). USD per 1M tokens 는 곧 micros/token. */
export function fallbackRate(kind: CostKind, rateKey: string, unit: CostUnit): number {
    if (kind === 'llm.local') {
        if (unit === 'token_in') return LOCAL_LLM_COST.INPUT_USD_PER_1M;
        if (unit === 'token_out') return LOCAL_LLM_COST.OUTPUT_USD_PER_1M;
        return 0;
    }
    if (kind === 'llm.external') {
        const idx = rateKey.indexOf(':');
        if (idx <= 0) return 0;
        const p = getModelPricing(rateKey.slice(0, idx), rateKey.slice(idx + 1));
        if (!p) return 0;
        if (unit === 'token_in') return p.input;
        if (unit === 'token_out') return p.output;
        if (unit === 'token_think') return p.thinking ?? p.output;
    }
    return 0;
}

/** PURE: 표 → 단가 (정확 일치 → 와일드카드 → 폴백). */
export function resolveRateFromTable(table: RateTable, kind: CostKind, rateKey: string, unit: CostUnit): number {
    const exact = table.get(`${kind}|${rateKey}|${unit}`);
    if (exact !== undefined) return exact;
    const wild = table.get(`${kind}|${COST_RATE_WILDCARD}|${unit}`);
    if (wild !== undefined) return wild;
    return fallbackRate(kind, rateKey, unit);
}

export async function resolveRate(kind: CostKind, rateKey: string, unit: CostUnit, now: number = Date.now()): Promise<number> {
    return resolveRateFromTable(await loadRates(now), kind, rateKey, unit);
}

export interface CostEntry {
    userId: string | undefined | null;
    kind: CostKind;
    rateKey: string;
    unit: CostUnit;
    quantity: number;
    costOwner: CostOwner;
    /** provider 가 준 확정 비용(micros) — 있으면 단가 계산 대신 채택 */
    directCostUsdMicros?: number;
    ctx?: CostContext;
    meta?: Record<string, unknown>;
    idempotencyKey?: string | null;
}

/** 원장 1행 적재 (fire-and-forget). quantity 0 은 기록하지 않는다. */
export function recordCost(entry: CostEntry): void {
    void recordCostAsync(entry).catch((e) => logger.warn(`원장 적재 실패 (무시): ${entry.kind}/${entry.rateKey}`, e));
}

export async function recordCostAsync(entry: CostEntry, now: number = Date.now()): Promise<void> {
    if (!isCostKind(entry.kind) || !(entry.quantity > 0)) return;
    const userId = entry.userId && entry.userId !== 'guest' ? String(entry.userId) : null;
    const rate = entry.directCostUsdMicros !== undefined
        ? entry.directCostUsdMicros / entry.quantity
        : await resolveRate(entry.kind, entry.rateKey, entry.unit, now);
    const cost = entry.directCostUsdMicros !== undefined ? Math.round(entry.directCostUsdMicros) : Math.round(rate * entry.quantity);
    const orgId = userId ? (await activeOrgFor(userId, now))?.orgId ?? null : null;
    const row: CostLedgerInsert = {
        userId, orgId, kind: entry.kind, rateKey: entry.rateKey, unit: entry.unit, quantity: entry.quantity,
        usdMicrosPerUnit: rate, costUsdMicros: cost, costOwner: entry.costOwner,
        agentId: entry.ctx?.agentId ?? null, sessionId: entry.ctx?.sessionId ?? null,
        requestId: entry.ctx?.requestId ?? getRequestId() ?? null, feature: entry.ctx?.feature ?? null,
        meta: entry.meta, idempotencyKey: entry.idempotencyKey ?? null,
    };
    await new CostLedgerRepository(getPool()).insert(row);
    // 월 비용 버킷(136) — 사용자·조직 비용 예산 검사 재료. cost_owner 가 byok(사용자 본인 과금)여도 예산 관점에선 지출이다.
    if (userId && cost > 0) {
        try {
            const store = getKeyValueStore();
            const k = costMonthKey(userId, now);
            await store.incrBy(k, cost); await store.expire(k, COST_MONTH_TTL_MS);
        } catch (e) { logger.warn('월 비용 버킷 누적 실패 (무시):', e); }
    }
}

/** LLM 토큰 비용 — 입력·출력(·사고) 토큰을 unit 별 행으로 적재. 로컬은 kind llm.local(rate_key=모델 id), 외부는 llm.external(rate_key=fullId). */
export function recordLlmCost(input: {
    userId: string | undefined | null;
    model: string;            // 로컬 bare id 또는 외부 fullId('provider:model')
    external: boolean;
    promptTokens: number;
    completionTokens: number;
    thinkingTokens?: number;
    costOwner: CostOwner;
    /** provider 가 준 확정 비용(micros, 합계) — 출력 토큰 행에 실린다 */
    directCostUsdMicros?: number;
    ctx?: CostContext;
}): void {
    const kind: CostKind = input.external ? 'llm.external' : 'llm.local';
    const base = { userId: input.userId, kind, rateKey: input.model, costOwner: input.costOwner, ctx: input.ctx };
    if (input.directCostUsdMicros !== undefined) {
        // 확정 비용은 한 행으로(수량 = 총 토큰) — 단가 재계산 없음
        recordCost({ ...base, unit: 'token_out', quantity: input.promptTokens + input.completionTokens + (input.thinkingTokens ?? 0),
            directCostUsdMicros: input.directCostUsdMicros, meta: { promptTokens: input.promptTokens, completionTokens: input.completionTokens } });
        return;
    }
    recordCost({ ...base, unit: 'token_in', quantity: input.promptTokens });
    recordCost({ ...base, unit: 'token_out', quantity: input.completionTokens });
    if (input.thinkingTokens) recordCost({ ...base, unit: 'token_think', quantity: input.thinkingTokens });
}
