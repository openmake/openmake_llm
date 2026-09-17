/**
 * 평가 실행 이력 기록 (F26.1, 146) — 러너 공통. `OMK_EVAL_RECORD_DB=true`(nightly) 일 때만 DATABASE_URL 에 1행을 쓴다.
 * CI·로컬 임시 실행이 운영 DB 이력을 어지럽히지 않게 기본은 끈다. 기록 실패는 경고만(평가 결과·exit code 불변).
 *
 * @module evaluation/eval-run-recorder
 */
import * as childProcess from 'child_process';
import type { EvaluationSummary } from './types';
import type { EvalRunRecord } from '../data/repositories/eval-run-repository';

/** 실패 케이스 요약 상한 — summary JSONB 가 커지지 않게 */
const FAILED_CASES_MAX = 50;
const REASON_MAX_CHARS = 200;

/** PURE: 선형 보간 없는 nearest-rank 백분위. 빈 배열은 null. */
export function percentile(values: number[], p: number): number | null {
    const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!xs.length) return null;
    const rank = Math.min(xs.length - 1, Math.max(0, Math.ceil((p / 100) * xs.length) - 1));
    return Math.round(xs[rank]);
}

export interface CaseTiming { ttftMs?: number | null; totalMs: number; inputTokens?: number; outputTokens?: number }

/** PURE: 요약 + 케이스 계측 → eval_runs 행. */
export function buildEvalRunRecord(summary: EvaluationSummary, meta: {
    runner: string; mode: 'mock' | 'real'; gitHash?: string | null; model?: string | null; variant?: string | null; matrixRunId?: string | null;
    timings?: CaseTiming[]; extra?: Record<string, unknown>;
}): EvalRunRecord {
    const timings: CaseTiming[] = meta.timings ?? summary.results.map((r) => ({ totalMs: r.durationMs }));
    const ttfts = timings.map((t) => t.ttftMs).filter((v): v is number => typeof v === 'number');
    const totals = timings.map((t) => t.totalMs);
    const sumOrNull = (key: 'inputTokens' | 'outputTokens') => {
        const xs = timings.map((t) => t[key]).filter((v): v is number => typeof v === 'number');
        return xs.length ? xs.reduce((n, v) => n + v, 0) : null;
    };
    return {
        startedAt: summary.startedAt,
        completedAt: summary.completedAt,
        runner: meta.runner,
        mode: meta.mode,
        datasetVersion: summary.datasetVersion,
        gitHash: meta.gitHash ?? null,
        model: meta.model ?? null,
        variant: meta.variant ?? null,
        matrixRunId: meta.matrixRunId ?? null,
        totalCases: summary.totalCases,
        passedCases: summary.passedCases,
        passRate: summary.passRate,
        ttftP50Ms: percentile(ttfts, 50),
        ttftP95Ms: percentile(ttfts, 95),
        totalP50Ms: percentile(totals, 50),
        totalP95Ms: percentile(totals, 95),
        inputTokens: sumOrNull('inputTokens'),
        outputTokens: sumOrNull('outputTokens'),
        costUsdMicros: 0,
        summary: {
            failed: summary.results.filter((r) => !r.passed).slice(0, FAILED_CASES_MAX)
                .map((r) => ({ id: r.caseId, reason: (r.failureReason ?? '').slice(0, REASON_MAX_CHARS) })),
            ...(meta.extra ?? {}),
        },
    };
}

export function currentGitHash(): string | null {
    try { return childProcess.execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

export function isEvalRecordEnabled(): boolean {
    return process.env.OMK_EVAL_RECORD_DB === 'true' && !!process.env.DATABASE_URL;
}

/** 기록 — 비활성이면 null. 풀은 호출마다 열고 닫는다(CLI 1회성). */
export async function recordEvalRuns(records: EvalRunRecord[]): Promise<string[] | null> {
    if (!isEvalRecordEnabled() || !records.length) return null;
    const { Pool } = await import('pg');
    const { EvalRunRepository } = await import('../data/repositories/eval-run-repository');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
        const repo = new EvalRunRepository(pool);
        const ids: string[] = [];
        for (const r of records) ids.push(await repo.insert(r));
        return ids;
    } catch (e) {
        console.warn(`[eval-run-recorder] eval_runs 기록 실패(무시): ${e instanceof Error ? e.message : e}`);
        return null;
    } finally {
        await pool.end().catch(() => undefined);
    }
}
