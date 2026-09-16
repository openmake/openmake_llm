/**
 * 월 명세서 (F25 PR-5, 137) — 당월은 원장 on-demand 집계, 지난달은 물질화(멱등 upsert).
 * @module services/cost/statement-service
 */
import { createLogger } from '../../utils/logger';
import { getPool } from '../../data/models/unified-database';
import { CostLedgerRepository } from '../../data/repositories/cost-ledger-repository';
import { BillingStatementRepository, type StatementLine } from '../../data/repositories/billing-statement-repository';

const logger = createLogger('Statements');
export type StatementSubject = 'user' | 'org' | 'system';

export interface Statement {
    subjectType: StatementSubject; subjectId: string;
    periodStart: string; periodEnd: string;
    totalUsdMicros: number;
    lines: Array<{ kind: string; rateKey: string; unit: string; quantity: number; usdMicros: number }>;
    materialized: boolean;
}

/** PURE: 'YYYY-MM' → UTC 월 경계. 형식 오류는 null. */
export function monthRange(month: string): { from: Date; to: Date; periodStart: string; periodEnd: string } | null {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return null;
    const y = Number(m[1]); const mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    const from = new Date(Date.UTC(y, mo - 1, 1)); const to = new Date(Date.UTC(y, mo, 1));
    return { from, to, periodStart: from.toISOString().slice(0, 10), periodEnd: to.toISOString().slice(0, 10) };
}

export function currentMonth(now: number = Date.now()): string {
    const d = new Date(now); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 원장에서 즉시 집계. */
export async function buildStatement(subjectType: StatementSubject, subjectId: string, month: string): Promise<Statement | null> {
    const r = monthRange(month); if (!r) return null;
    const rows = await new CostLedgerRepository(getPool()).summarizeBySubject(subjectType, subjectId, r.from, r.to);
    const lines = rows.map((x) => ({ kind: x.kind, rateKey: x.rate_key, unit: x.unit, quantity: Number(x.quantity), usdMicros: Number(x.cost_usd_micros) }));
    return { subjectType, subjectId, periodStart: r.periodStart, periodEnd: r.periodEnd, totalUsdMicros: lines.reduce((n, l) => n + l.usdMicros, 0), lines, materialized: false };
}

/** 물질화본이 있으면 그것, 없으면 on-demand. */
export async function getStatement(subjectType: StatementSubject, subjectId: string, month: string): Promise<Statement | null> {
    const r = monthRange(month); if (!r) return null;
    const saved = await new BillingStatementRepository(getPool()).get(subjectType, subjectId, r.periodStart);
    if (saved) {
        return { subjectType, subjectId, periodStart: r.periodStart, periodEnd: r.periodEnd, totalUsdMicros: Number(saved.statement.total_usd_micros),
            lines: saved.lines.map((l) => ({ kind: l.kind, rateKey: l.rate_key, unit: l.unit, quantity: Number(l.quantity), usdMicros: Number(l.usd_micros) })), materialized: true };
    }
    return buildStatement(subjectType, subjectId, month);
}

/** 지난달(또는 지정 월) 명세서 물질화 — 사용자별 + system. 멱등. 반환은 생성 수. */
export async function materializeMonth(month: string): Promise<number> {
    const r = monthRange(month); if (!r) return 0;
    const ledger = new CostLedgerRepository(getPool()); const repo = new BillingStatementRepository(getPool());
    let n = 0;
    const toLines = (rows: Array<{ kind: string; rate_key: string; unit: string; quantity: string; cost_usd_micros: string }>): StatementLine[] =>
        rows.map((x) => ({ kind: x.kind, rate_key: x.rate_key, unit: x.unit, quantity: Number(x.quantity), usd_micros: Number(x.cost_usd_micros) }));
    for (const userId of await ledger.distinctUsers(r.from, r.to)) {
        const lines = toLines(await ledger.summarizeBySubject('user', userId, r.from, r.to));
        await repo.upsert('user', userId, r.periodStart, r.periodEnd, lines.reduce((s, l) => s + Number(l.usd_micros), 0), lines); n++;
    }
    const sys = toLines(await ledger.summarizeBySubject('system', 'system', r.from, r.to));
    await repo.upsert('system', 'system', r.periodStart, r.periodEnd, sys.reduce((s, l) => s + Number(l.usd_micros), 0), sys); n++;
    logger.info(`명세서 물질화 ${month}: ${n}건`);
    return n;
}

/** PURE: CSV 직렬화 (utils/csv.csvCell 로 수식 인젝션 방어). */
export function statementToCsv(st: Statement, csvCell: (v: unknown) => string): string {
    const head = ['kind', 'rate_key', 'unit', 'quantity', 'usd'].join(',');
    const rows = st.lines.map((l) => [l.kind, l.rateKey, l.unit, l.quantity, (l.usdMicros / 1_000_000).toFixed(6)].map(csvCell).join(','));
    return [head, ...rows, ['TOTAL', '', '', '', (st.totalUsdMicros / 1_000_000).toFixed(6)].map(csvCell).join(',')].join('\n') + '\n';
}
