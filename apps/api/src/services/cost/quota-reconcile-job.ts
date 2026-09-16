/**
 * 쿼터 정산 잡 (F25 PR-2) — 주/월 KV 버킷을 원장(cost_ledger, kind llm.local) 합계로 덮어써 예약 잔존·누수를 교정한다.
 * 크래시로 settle 이 빠지면 예약분이 버킷에 남는데, 시간 버킷은 TTL 로 소멸하지만 주/월은 오래 남는다.
 * 원장 합계가 0 인 사용자는 건드리지 않는다(면제·미기록 경로 보호). QUOTA_RECONCILE_ENABLED=false 로 끔.
 * @module services/cost/quota-reconcile-job
 */
import { createLogger } from '../../utils/logger';
import { getPool } from '../../data/models/unified-database';
import { getKeyValueStore } from '../../storage';
import { QUOTA_RESERVE } from '../../config/runtime-limits';
import { weekBucketKey, monthBucketKey, WEEK_TTL_MS, MONTH_TTL_MS, weekWindow, monthWindow } from '../../llm/user-quota';
import { materializeMonth, currentMonth } from './statement-service';

const logger = createLogger('QuotaReconcile');
let timer: NodeJS.Timeout | null = null;

interface Row { user_id: string; tokens: string }

async function sumLocalTokens(from: Date, to: Date): Promise<Row[]> {
    const r = await getPool().query<Row>(
        `SELECT user_id, SUM(quantity)::text AS tokens FROM cost_ledger
         WHERE kind = 'llm.local' AND unit IN ('token_in', 'token_out') AND user_id IS NOT NULL
           AND occurred_at >= $1 AND occurred_at < $2
         GROUP BY user_id`,
        [from.toISOString(), to.toISOString()],
    );
    return r.rows;
}

/** 1회 정산 — 반환은 갱신한 버킷 수. */
export async function reconcileQuotaBuckets(now: number = Date.now()): Promise<number> {
    const store = getKeyValueStore();
    let updated = 0;
    const windows: Array<{ range: { from: Date; to: Date }; key: (u: string) => string; ttl: number }> = [
        { range: weekWindow(now), key: (u) => weekBucketKey(u, now), ttl: WEEK_TTL_MS },
        { range: monthWindow(now), key: (u) => monthBucketKey(u, now), ttl: MONTH_TTL_MS },
    ];
    for (const w of windows) {
        for (const row of await sumLocalTokens(w.range.from, w.range.to)) {
            const tokens = Math.round(Number(row.tokens));
            if (!(tokens > 0)) continue;
            await store.set(w.key(row.user_id), tokens, w.ttl);
            updated++;
        }
    }
    return updated;
}

export function startQuotaReconcileJob(): void {
    if (!QUOTA_RESERVE.RECONCILE_ENABLED || timer) return;
    const run = async () => {
        try {
            const n = await reconcileQuotaBuckets();
            if (n > 0) logger.info(`쿼터 버킷 정산 ${n}건`);
        } catch (e) {
            logger.warn('쿼터 정산 실패 (다음 주기 재시도):', e);
        }
        try {
            // 지난달 명세서 물질화(137) — 멱등 upsert 라 매 주기 반복해도 안전
            const d = new Date(); const prev = currentMonth(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
            await materializeMonth(prev);
        } catch (e) {
            logger.warn('명세서 물질화 실패 (다음 주기 재시도):', e);
        }
    };
    timer = setInterval(run, QUOTA_RESERVE.RECONCILE_INTERVAL_MS);
    timer.unref?.();
    void run();
}

export function stopQuotaReconcileJob(): void {
    if (timer) { clearInterval(timer); timer = null; }
}
