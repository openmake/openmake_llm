/**
 * 가드 발동 집계 CLI — 에이전트 작업 기록에서 가드·복구 장치가 실제로 몇 번 발동했는지 센다(읽기 전용).
 *
 *   npm run eval:guard-stats                              # 전체 기간·전체 사용자, 표
 *   npm run eval:guard-stats -- --since 30d               # 최근 30일(작업 생성 시각 기준)
 *   npm run eval:guard-stats -- --since 2026-10-01 --until 2026-10-04 --user <사용자 id>
 *   npm run eval:guard-stats -- --json                    # 표 대신 JSON
 *
 * 임계값(반복 가드·재촉·대기 등)을 고칠 근거를 운영 기록에서 얻기 위한 것이다. LLM 을 쓰지 않는다.
 * DB 접속은 .env 의 DATABASE_URL — 운영 서버에서도 같은 명령으로 돌린다. 연결을 읽기 전용으로 열고 SELECT 만 한다
 * (스키마 초기화·좀비 정리를 거치지 않으려고 UnifiedDatabase 를 쓰지 않는다).
 * 현상을 알아보는 표지는 guard-stats-markers.ts. 표지 문구가 생기기 전의 기록은 세지 못한다.
 *
 * @module evaluation/run-guard-stats
 */
import * as path from 'path';
import type { PoolClient } from 'pg';

require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

import { createGuardStepCounter, parseSince, summarizeGuardStats, type GuardStats, type GuardStepRow, type GuardTaskRow } from './guard-stats';
import {
    GUARD_STEP_MARKERS, GUARD_HANDOFF_SUMMARY_PREFIX, GUARD_SCHEDULE_MARKERS, GUARD_STATS_BATCH_ROWS, GUARD_RESTART_EVENT_REASON,
} from './guard-stats-markers';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Filter { since: Date | null; until: Date | null; userId: string | null }

/** 작업 테이블(별칭 t) 조건 — $1 since, $2 until, $3 user. */
const TASK_WHERE = '($1::timestamptz IS NULL OR t.created_at >= $1) AND ($2::timestamptz IS NULL OR t.created_at < $2) AND ($3::text IS NULL OR t.user_id = $3)';
const HANDOFF_IN = (col: string): string => `jsonb_typeof(${col}) = 'array' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(${col}) m WHERE m->>'role' = 'user' AND m->>'content' LIKE $4)`;

interface ExtraStats {
    /** 인계 요약이 체크포인트에 남은 작업 수. */
    handoffSummaryTasks: number | null;
    /** 예약 발화 이력의 outcome 별 건수(겹침 건너뛰기 = skipped). */
    scheduleRunsByOutcome: Record<string, number> | null;
    /** 지금 자동 비활성 상태인 예약 수(이력이 아니라 현재 상태 — 기간 필터가 적용되지 않는다). */
    schedulesAutoDisabledNow: number | null;
    /** 모델 미도달 재실행으로 만들어진 작업 수. */
    scheduleUnreachableRetryTasks: number | null;
    /** 승인 요청의 상태별 건수. */
    approvalsByStatus: Record<string, number> | null;
}

/** 선택 조회 — 마이그레이션이 덜 된 서버에서는 표나 컬럼이 없을 수 있다. 실패하면 null(집계 불가)로 둔다. */
async function optional<T>(run: () => Promise<T>): Promise<T | null> {
    try { return await run(); } catch { return null; }
}

async function collect(client: PoolClient, f: Filter): Promise<{ stats: GuardStats; extra: ExtraStats }> {
    const params = [f.since, f.until, f.userId];
    // 재시작 정리로 끊긴 작업 표시 — 전이 이력 표가 없는 서버(124 이전)에서는 표시 없이 센다.
    const tasks = await optional(async () => (await client.query<GuardTaskRow>(
        `SELECT t.id, t.status, t.failure_class, t.current_turn,
                EXISTS (SELECT 1 FROM agent_task_events e WHERE e.task_id = t.id AND e.reason = $4) AS restarted
           FROM agent_tasks t WHERE ${TASK_WHERE}`, [...params, GUARD_RESTART_EVENT_REASON])).rows)
        ?? (await client.query<GuardTaskRow>(
            `SELECT t.id, t.status, t.failure_class, t.current_turn FROM agent_tasks t WHERE ${TASK_WHERE}`, params)).rows;

    const stepTypes = [...new Set(GUARD_STEP_MARKERS.map((m) => m.stepType))];
    const counter = createGuardStepCounter();
    for (let cursor = 0; ;) {
        const rows = (await client.query<GuardStepRow & { id: number }>(
            `SELECT s.id, s.task_id, s.step_type, s.content FROM agent_task_steps s JOIN agent_tasks t ON t.id = s.task_id
             WHERE ${TASK_WHERE} AND s.step_type = ANY($4) AND s.id > $5 ORDER BY s.id LIMIT $6`,
            [...params, stepTypes, cursor, GUARD_STATS_BATCH_ROWS])).rows;
        counter.add(rows);
        if (rows.length < GUARD_STATS_BATCH_ROWS) break;
        cursor = rows[rows.length - 1].id;
    }
    const stats: GuardStats = { ...summarizeGuardStats(tasks, []), phenomena: counter.result() };

    const byKey = (rows: Array<{ k: string | null; n: string }>): Record<string, number> =>
        Object.fromEntries(rows.map((r) => [r.k ?? 'unknown', Number(r.n)]));
    const extra: ExtraStats = {
        handoffSummaryTasks: await optional(async () => Number((await client.query<{ n: string }>(
            `SELECT COUNT(DISTINCT x.task_id) AS n FROM (
                 SELECT c.task_id FROM agent_task_checkpoints c JOIN agent_tasks t ON t.id = c.task_id
                  WHERE ${TASK_WHERE} AND ${HANDOFF_IN('c.conversation')}
                 UNION
                 SELECT t.id FROM agent_tasks t WHERE ${TASK_WHERE} AND ${HANDOFF_IN("t.checkpoint->'conversation'")}
             ) x`, [...params, `${GUARD_HANDOFF_SUMMARY_PREFIX}%`])).rows[0].n)),
        scheduleRunsByOutcome: await optional(async () => byKey((await client.query<{ k: string; n: string }>(
            `SELECT t.outcome AS k, COUNT(*) AS n FROM agent_task_schedule_runs t WHERE ${TASK_WHERE} GROUP BY 1`, params)).rows)),
        schedulesAutoDisabledNow: await optional(async () => Number((await client.query<{ n: string }>(
            'SELECT COUNT(*) AS n FROM agent_task_schedules t WHERE t.disabled_reason IS NOT NULL AND ($1::text IS NULL OR t.user_id = $1)',
            [f.userId])).rows[0].n)),
        scheduleUnreachableRetryTasks: await optional(async () => Number((await client.query<{ n: string }>(
            `SELECT COUNT(*) AS n FROM agent_tasks t WHERE ${TASK_WHERE} AND t.create_idempotency_key LIKE $4`,
            [...params, GUARD_SCHEDULE_MARKERS.RETRY_FIRE_KEY_LIKE])).rows[0].n)),
        approvalsByStatus: await optional(async () => byKey((await client.query<{ k: string; n: string }>(
            `SELECT t.status AS k, COUNT(*) AS n FROM agent_task_approvals t WHERE ${TASK_WHERE} GROUP BY 1`, params)).rows)),
    };
    return { stats, extra };
}

function printTable(f: Filter, stats: GuardStats, extra: ExtraStats): void {
    const { tasks } = stats;
    const kv = (o: Record<string, number>): string => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') || '없음';
    const na = (v: number | null): string => (v === null ? '집계 불가(표·컬럼 없음)' : String(v));
    console.log(`\n가드 발동 집계 — 기간 ${f.since?.toISOString() ?? '처음'} ~ ${f.until?.toISOString() ?? '지금'}, 사용자 ${f.userId ?? '전체'}`);
    console.log(`작업 ${tasks.total}건 (재시작 정리로 끊긴 ${tasks.restartInterrupted}건은 상태·실패 분류에서 뺌) — 상태: ${kv(tasks.byStatus)} / 실패 분류: ${kv(tasks.byFailureClass)}`);
    const t = tasks.turns;
    console.log(`턴 수 — 최소 ${t.min} · 중앙 ${t.p50} · p90 ${t.p90} · 최대 ${t.max} · 평균 ${t.mean}`);
    console.log(`  분포(턴:작업 수) ${Object.entries(t.histogram).map(([k, n]) => `${k}:${n}`).join(' ') || '없음'}`);
    const width = Math.max(...stats.phenomena.map((p) => p.label.length));
    console.log(`\n${'현상'.padEnd(width + 2)}  발동  작업   작업 비율`);
    for (const p of stats.phenomena) {
        const rate = tasks.total > 0 ? `${((p.tasks / tasks.total) * 100).toFixed(1)}%` : '-';
        console.log(`${p.label.padEnd(width + 2)}  ${String(p.occurrences).padStart(4)}  ${String(p.tasks).padStart(4)}  ${rate.padStart(8)}`);
    }
    console.log(`\n인계 요약이 남은 작업: ${na(extra.handoffSummaryTasks)}`);
    console.log(`예약 발화 이력(outcome): ${extra.scheduleRunsByOutcome === null ? na(null) : kv(extra.scheduleRunsByOutcome)}`
        + ` — 겹침 건너뛰기 = ${GUARD_SCHEDULE_MARKERS.SKIPPED_OUTCOME}`);
    console.log(`예약 자동 비활성(현재 상태): ${na(extra.schedulesAutoDisabledNow)} · 모델 미도달 재실행 작업: ${na(extra.scheduleUnreachableRetryTasks)}`);
    console.log(`승인 요청(상태): ${extra.approvalsByStatus === null ? na(null) : kv(extra.approvalsByStatus)}`);
}

async function main(): Promise<void> {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 이 없습니다(.env)');
    const now = Date.now();
    const filter: Filter = {
        since: parseSince(argValue('--since'), now) ?? null,
        until: parseSince(argValue('--until'), now) ?? null,
        userId: argValue('--user') ?? null,
    };
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const client = await pool.connect();
    try {
        await client.query('SET default_transaction_read_only = on');
        const { stats, extra } = await collect(client, filter);
        if (process.argv.includes('--json')) console.log(JSON.stringify({ filter, ...stats, extra }, null, 2));
        else printTable(filter, stats, extra);
    } finally {
        client.release();
        await pool.end().catch(() => undefined);
    }
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('[guard-stats] 실패:', e instanceof Error ? e.message : e);
    process.exit(1);
});
