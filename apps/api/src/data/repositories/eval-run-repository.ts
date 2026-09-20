/**
 * @module data/repositories/eval-run-repository
 * @description `eval_runs`(146) — 평가 실행 이력 적재·조회.
 */
import { BaseRepository } from './base-repository';

export interface EvalRunRecord {
    startedAt: string;
    completedAt: string;
    runner: string;
    mode: 'mock' | 'real';
    datasetVersion: string;
    gitHash?: string | null;
    model?: string | null;
    variant?: string | null;
    matrixRunId?: string | null;
    totalCases: number;
    passedCases: number;
    passRate: number;
    ttftP50Ms?: number | null;
    ttftP95Ms?: number | null;
    totalP50Ms?: number | null;
    totalP95Ms?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsdMicros?: number;
    summary: Record<string, unknown>;
}

export interface EvalRunRow {
    id: string;
    started_at: string;
    completed_at: string;
    runner: string;
    mode: string;
    dataset_version: string;
    git_hash: string | null;
    model: string | null;
    variant: string | null;
    matrix_run_id: string | null;
    total_cases: number;
    passed_cases: number;
    pass_rate: number;
    ttft_p50_ms: number | null;
    ttft_p95_ms: number | null;
    total_p50_ms: number | null;
    total_p95_ms: number | null;
    input_tokens: string | null;
    output_tokens: string | null;
    cost_usd_micros: string;
    summary?: Record<string, unknown>;
}

const LIST_COLUMNS = `id, started_at, completed_at, runner, mode, dataset_version, git_hash, model, variant, matrix_run_id, total_cases, passed_cases,
    pass_rate, ttft_p50_ms, ttft_p95_ms, total_p50_ms, total_p95_ms, input_tokens, output_tokens, cost_usd_micros`;

export class EvalRunRepository extends BaseRepository {
    async insert(r: EvalRunRecord): Promise<string> {
        const res = await this.query<{ id: string }>(
            `INSERT INTO eval_runs (started_at, completed_at, runner, mode, dataset_version, git_hash, model, variant, matrix_run_id,
                total_cases, passed_cases, pass_rate, ttft_p50_ms, ttft_p95_ms, total_p50_ms, total_p95_ms, input_tokens, output_tokens, cost_usd_micros, summary)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb) RETURNING id`,
            [r.startedAt, r.completedAt, r.runner, r.mode, r.datasetVersion, r.gitHash ?? null, r.model ?? null, r.variant ?? null, r.matrixRunId ?? null,
                r.totalCases, r.passedCases, r.passRate, r.ttftP50Ms ?? null, r.ttftP95Ms ?? null, r.totalP50Ms ?? null, r.totalP95Ms ?? null,
                r.inputTokens ?? null, r.outputTokens ?? null, r.costUsdMicros ?? 0, JSON.stringify(r.summary)],
        );
        return String(res.rows[0].id);
    }

    async list(opts: { runner?: string; mode?: string; limit: number }): Promise<EvalRunRow[]> {
        const r = await this.query<EvalRunRow>(
            `SELECT ${LIST_COLUMNS} FROM eval_runs
             WHERE ($1::text IS NULL OR runner = $1) AND ($2::text IS NULL OR mode = $2)
             ORDER BY completed_at DESC, id DESC LIMIT $3`,
            [opts.runner ?? null, opts.mode ?? null, opts.limit],
        );
        return r.rows;
    }

    /**
     * (variant, model) 별 **최신** 실모델 실행 — 팩 검증 표시용. 옛 통과가 최신 미달을 가리지 않게 최신 행만 본다.
     */
    async latestByVariantAndModel(runner: string): Promise<Array<{ variant: string; model: string; pass_rate: number; total_cases: number; completed_at: string }>> {
        const r = await this.query<{ variant: string; model: string; pass_rate: number; total_cases: number; completed_at: string }>(
            `SELECT DISTINCT ON (variant, model) variant, model, pass_rate, total_cases, completed_at
             FROM eval_runs
             WHERE runner = $1 AND mode = 'real' AND variant IS NOT NULL AND model IS NOT NULL
             ORDER BY variant, model, completed_at DESC`,
            [runner],
        );
        return r.rows;
    }

    async get(id: string): Promise<EvalRunRow | undefined> {
        const r = await this.query<EvalRunRow>(`SELECT ${LIST_COLUMNS}, summary FROM eval_runs WHERE id = $1`, [id]);
        return r.rows[0];
    }
}
