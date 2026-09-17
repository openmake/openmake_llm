/**
 * @module data/repositories/slo-repository
 * @description SLO SLI 집계(chat_requests·agent_tasks·eval_runs)와 `slo_snapshots`(145) 적재·조회.
 */
import { BaseRepository } from './base-repository';
import type { RatioCounts, SloEvaluation } from '../../monitoring/slo-evaluator';

type WindowCounts = Map<number, RatioCounts>;

interface CountRow { w: number; total: string; bad: string }

function toMap(rows: CountRow[]): WindowCounts {
    return new Map(rows.map((r) => [Number(r.w), { total: Number(r.total), bad: Number(r.bad) }]));
}

export interface SloSnapshotRow {
    computed_at: string;
    slo_id: string;
    window_hours: number;
    target: number;
    sli_value: number | null;
    sample_count: number;
    budget_remaining: number | null;
    burn_rate_fast: number | null;
    burn_rate_slow: number | null;
    state: string;
}

export class SloRepository extends BaseRepository {
    /** 채팅 가용성 — 사용자 중단(aborted)은 분모에서 뺀다. */
    async chatAvailabilityCounts(windowsHours: number[]): Promise<WindowCounts> {
        const r = await this.query<CountRow>(
            `SELECT w, count(c.request_id) AS total, count(c.request_id) FILTER (WHERE c.status = 'error') AS bad
             FROM unnest($1::float8[]) AS w
             LEFT JOIN chat_requests c ON c.started_at >= NOW() - make_interval(secs => w * 3600) AND c.status IN ('ok', 'error')
             GROUP BY w`,
            [windowsHours.map(String)],
        );
        return toMap(r.rows);
    }

    /** 첫 토큰 지연 — 성공 요청 중 ttft 가 있는 것, 임계 초과가 bad. */
    async chatTtftCounts(windowsHours: number[], thresholdMs: number): Promise<WindowCounts> {
        const r = await this.query<CountRow>(
            `SELECT w, count(c.request_id) AS total, count(c.request_id) FILTER (WHERE c.ttft_ms > $2) AS bad
             FROM unnest($1::float8[]) AS w
             LEFT JOIN chat_requests c ON c.started_at >= NOW() - make_interval(secs => w * 3600) AND c.status = 'ok' AND c.ttft_ms IS NOT NULL
             GROUP BY w`,
            [windowsHours.map(String), thresholdMs],
        );
        return toMap(r.rows);
    }

    async chatTtftP95(windowHours: number): Promise<number | null> {
        const r = await this.query<{ p95: number | null }>(
            `SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY ttft_ms)::float8 AS p95 FROM chat_requests
             WHERE started_at >= NOW() - make_interval(secs => $1 * 3600) AND status = 'ok' AND ttft_ms IS NOT NULL`,
            [windowHours],
        );
        return r.rows[0]?.p95 ?? null;
    }

    /** 에이전트 작업 성공 — 창 안에 끝난(completed/failed) 작업, failed 가 bad(취소는 제외). */
    async agentTaskCounts(windowsHours: number[]): Promise<WindowCounts> {
        const r = await this.query<CountRow>(
            `SELECT w, count(t.id) AS total, count(t.id) FILTER (WHERE t.status = 'failed') AS bad
             FROM unnest($1::float8[]) AS w
             LEFT JOIN agent_tasks t ON COALESCE(t.completed_at, t.updated_at) >= NOW() - make_interval(secs => w * 3600) AND t.status IN ('completed', 'failed')
             GROUP BY w`,
            [windowsHours.map(String)],
        );
        return toMap(r.rows);
    }

    /** 최근 실모델(real) 전체 평가 통과율 — eval_runs(146) 가 없으면 null. mock·태그 부분 실행(variant 있음)은 SLO 대상이 아니다. */
    async latestEvalPass(runner: string, windowHours: number): Promise<{ passRate: number; totalCases: number; completedAt: string } | null> {
        const exists = await this.query<{ ok: boolean }>(`SELECT to_regclass('public.eval_runs') IS NOT NULL AS ok`);
        if (!exists.rows[0]?.ok) return null;
        const r = await this.query<{ pass_rate: number; total_cases: number; completed_at: string }>(
            `SELECT pass_rate, total_cases, completed_at FROM eval_runs
             WHERE runner = $1 AND mode = 'real' AND variant IS NULL AND completed_at >= NOW() - make_interval(secs => $2 * 3600)
             ORDER BY completed_at DESC LIMIT 1`,
            [runner, windowHours],
        );
        const row = r.rows[0];
        return row ? { passRate: Number(row.pass_rate), totalCases: Number(row.total_cases), completedAt: row.completed_at } : null;
    }

    async insertSnapshots(evals: SloEvaluation[]): Promise<void> {
        for (const e of evals) {
            await this.query(
                `INSERT INTO slo_snapshots (slo_id, window_hours, target, sli_value, sample_count, budget_remaining, burn_rate_fast, burn_rate_slow, state)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [e.sloId, e.windowHours, e.target, e.sliValue, e.sampleCount, e.budgetRemaining,
                    Number.isFinite(e.burnRateFast ?? 0) ? e.burnRateFast : null, Number.isFinite(e.burnRateSlow ?? 0) ? e.burnRateSlow : null, e.state],
            );
        }
    }

    /** 일별 마지막 스냅샷(SLO·날짜별 1행) — 추이 표. */
    async dailyHistory(days: number): Promise<SloSnapshotRow[]> {
        const r = await this.query<SloSnapshotRow>(
            `SELECT DISTINCT ON (slo_id, date_trunc('day', computed_at)) computed_at, slo_id, window_hours, target, sli_value, sample_count,
                    budget_remaining, burn_rate_fast, burn_rate_slow, state
             FROM slo_snapshots WHERE computed_at >= NOW() - make_interval(days => $1)
             ORDER BY slo_id, date_trunc('day', computed_at) DESC, computed_at DESC`,
            [days],
        );
        return r.rows;
    }

    async purge(retentionDays: number): Promise<number> {
        const r = await this.query('DELETE FROM slo_snapshots WHERE computed_at < NOW() - make_interval(days => $1)', [retentionDays]);
        return r.rowCount ?? 0;
    }
}
