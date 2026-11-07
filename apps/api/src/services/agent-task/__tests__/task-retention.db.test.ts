/**
 * 에이전트 작업 보존·체크포인트 압축 SQL(#1658) — **실제 Postgres** 로 지울 행과 남길 행을 가른다. 모킹 SQL 문자열 검사(task-retention.test.ts)가
 * 보지 못하는 상태·기준 시각(COALESCE(completed_at, updated_at))·조인·배치(오래된 것부터) 조건을 픽스처로 확인한다.
 *
 * TEST_DATABASE_URL(격리 시험 DB) 이 없으면 skip — 코어 스키마(db/init + db/migrations)를 그 DB 에 적용한다.
 * 시험 DB 에 다른 파일의 행이 있을 수 있어 반환 건수 대신 이 파일이 만든 행의 존재로 판정하고, 배치 순서 검사는 아주 오래된 시각을 쓴다.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

// 정리 감사 기록은 전역 풀을 쓰는 AuditService 로 간다 — 이 시험의 관심사가 아니다
jest.mock('../../AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }) }));

import { MigrationRunner } from '../../../data/migrations/runner';
import { sweepAgentTaskRetention, type AgentTaskRetentionConfig } from '../task-retention';

const DB_DIR = path.resolve(__dirname, '../../../../../../db');
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);

const BASE: AgentTaskRetentionConfig = {
    ENABLED: true, DRY_RUN: false, RECORD_RETENTION_DAYS: 0, SCREENSHOT_RETENTION_DAYS: 0, BATCH_LIMIT: 1000,
    SCREENSHOT_EXTENSIONS: ['.png'], CHECKPOINT_COMPACT_ENABLED: false, CHECKPOINT_COMPACT_AFTER_MS: DAY, DEFAULT_ON: false,
};

describeOrSkip('에이전트 작업 보존·체크포인트 압축 SQL (실제 Postgres, #1658)', () => {
    let pool: Pool;
    const userId = `ret1658-${randomUUID()}`;
    const auditTag = `ret1658-${randomUUID()}`;

    beforeAll(async () => {
        pool = new Pool({ connectionString: CONN, max: 4 });
        const has = await pool.query(`SELECT to_regclass('public.agent_tasks') AS t`);
        if (!has.rows[0].t) {
            await pool.query(fs.readFileSync(path.join(DB_DIR, 'init/001-extensions.sql'), 'utf8'));
            await pool.query(fs.readFileSync(path.join(DB_DIR, 'init/002-schema.sql'), 'utf8'));
        }
        await new MigrationRunner(pool, { dir: path.join(DB_DIR, 'migrations') }).applyPending();
        await pool.query(`INSERT INTO users (id, username, password_hash) VALUES ($1, $1, 'x')`, [userId]);
    }, 120_000);

    afterAll(async () => {
        if (!pool) return;
        // 이 파일이 만든 것만 지운다 — 작업·단계·체크포인트는 사용자 FK CASCADE
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        await pool.query('DELETE FROM audit_logs WHERE resource_id LIKE $1', [`${auditTag}%`]);
        await pool.end();
    });

    async function task(status: string, at: { completed?: Date | null; updated: Date }): Promise<string> {
        const id = randomUUID();
        await pool.query(
            `INSERT INTO agent_tasks (id, user_id, goal, status, completed_at, updated_at) VALUES ($1, $2, '목표', $3, $4, $5)`,
            [id, userId, status, at.completed ?? null, at.updated]);
        return id;
    }
    const step = (taskId: string) => pool.query(`INSERT INTO agent_task_steps (task_id, step_number, step_type, content) VALUES ($1, 0, 'assistant', 'x')`, [taskId]);
    async function checkpoints(taskId: string, turns: number[]): Promise<void> {
        for (const t of turns) await pool.query(`INSERT INTO agent_task_checkpoints (task_id, turn, conversation) VALUES ($1, $2, '[]'::jsonb)`, [taskId, t]);
    }
    async function existing(ids: string[]): Promise<Set<string>> {
        const { rows } = await pool.query<{ id: string }>('SELECT id FROM agent_tasks WHERE id = ANY($1)', [ids]);
        return new Set(rows.map((r) => r.id));
    }
    async function turnsOf(taskId: string): Promise<number[]> {
        const { rows } = await pool.query<{ turn: number }>('SELECT turn FROM agent_task_checkpoints WHERE task_id = $1 ORDER BY turn', [taskId]);
        return rows.map((r) => r.turn);
    }
    async function audit(resourceType: string, at: Date): Promise<string> {
        const rid = `${auditTag}-${randomUUID()}`;
        await pool.query(`INSERT INTO audit_logs (action, resource_type, resource_id, timestamp) VALUES ('x', $1, $2, $3)`, [resourceType, rid, at]);
        return rid;
    }
    async function auditLeft(rids: string[]): Promise<Set<string>> {
        const { rows } = await pool.query<{ resource_id: string }>('SELECT resource_id FROM audit_logs WHERE resource_id = ANY($1)', [rids]);
        return new Set(rows.map((r) => r.resource_id));
    }

    describe('작업 기록·감사 로그 정리 (RECORD_RETENTION_DAYS=90)', () => {
        const cfg = { ...BASE, RECORD_RETENTION_DAYS: 90 };

        it('끝난 지 90일 지난 끝난 작업만 단계·체크포인트와 함께 지우고, 진행형·최근 작업은 남긴다 — dry-run 은 세기만 한다', async () => {
            const old = 100 * DAY;
            const gone = {
                completed: await task('completed', { completed: ago(old), updated: ago(old) }),
                failedNoCompletedAt: await task('failed', { completed: null, updated: ago(old) }), // completed_at 없으면 updated_at 기준
                cancelled: await task('cancelled', { completed: ago(old), updated: ago(old) }),
            };
            const kept = {
                running: await task('running', { updated: ago(old) }),
                paused: await task('paused', { updated: ago(old) }),
                queued: await task('queued', { updated: ago(old) }),
                pending: await task('pending', { updated: ago(old) }),
                recentCompleted: await task('completed', { completed: ago(10 * DAY), updated: ago(10 * DAY) }),
                // 끝난 시각이 최근이면 updated_at 이 오래돼도 남긴다(COALESCE 는 completed_at 우선)
                recentlyFinishedOldUpdate: await task('failed', { completed: ago(10 * DAY), updated: ago(old) }),
            };
            await step(gone.completed);
            await checkpoints(gone.completed, [0, 1]);
            await step(kept.running);
            const all = [...Object.values(gone), ...Object.values(kept)];

            const dry = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...cfg, DRY_RUN: true } });
            expect(dry.tasks).toBeGreaterThanOrEqual(3);
            expect((await existing(all)).size).toBe(all.length); // dry-run 은 지우지 않는다

            await sweepAgentTaskRetention(pool, { now: NOW, cfg });
            const left = await existing(all);
            for (const id of Object.values(gone)) expect(left.has(id)).toBe(false);
            for (const id of Object.values(kept)) expect(left.has(id)).toBe(true);
            // 지운 작업의 단계·체크포인트도 같이 사라지고, 남긴 작업의 단계는 그대로다
            expect((await pool.query('SELECT 1 FROM agent_task_steps WHERE task_id = $1', [gone.completed])).rowCount).toBe(0);
            expect(await turnsOf(gone.completed)).toEqual([]);
            expect((await pool.query('SELECT 1 FROM agent_task_steps WHERE task_id = $1', [kept.running])).rowCount).toBe(1);
        });

        it('BATCH_LIMIT 만큼만, 가장 오래 끝난 작업부터 지운다', async () => {
            const oldest = await task('completed', { completed: new Date('1999-01-01T00:00:00Z'), updated: new Date('1999-01-01T00:00:00Z') });
            const next = await task('completed', { completed: new Date('1999-01-02T00:00:00Z'), updated: new Date('1999-01-02T00:00:00Z') });
            await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...cfg, BATCH_LIMIT: 1 } });
            const left = await existing([oldest, next]);
            expect(left.has(oldest)).toBe(false);
            expect(left.has(next)).toBe(true); // 다음 주기 몫
            await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...cfg, BATCH_LIMIT: 1 } });
            expect((await existing([next])).size).toBe(0);
        });

        it("감사 로그는 resource_type='agent_task' 이고 90일 지난 것만 지운다(다른 종류·정리 기록·최근 것은 남긴다)", async () => {
            const gone = await audit('agent_task', ago(100 * DAY));
            const kept = [
                await audit('agent_task', ago(10 * DAY)),
                await audit('user', ago(100 * DAY)),
                await audit('agent_task_retention', ago(100 * DAY)),
            ];
            await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...cfg, DRY_RUN: true } });
            expect((await auditLeft([gone, ...kept])).size).toBe(4);
            await sweepAgentTaskRetention(pool, { now: NOW, cfg });
            const left = await auditLeft([gone, ...kept]);
            expect(left.has(gone)).toBe(false);
            for (const rid of kept) expect(left.has(rid)).toBe(true);
        });
    });

    describe('체크포인트 압축 (끝난 지 1일 지난 끝난 작업, 마지막 턴만 남김)', () => {
        const cfg = { ...BASE, CHECKPOINT_COMPACT_ENABLED: true, CHECKPOINT_COMPACT_AFTER_MS: DAY };

        it('끝난 작업은 마지막 턴만 남기고, 진행형·최근에 끝난 작업·체크포인트 하나뿐인 작업은 그대로 둔다', async () => {
            const finished = await task('completed', { completed: ago(2 * DAY), updated: ago(2 * DAY) });
            const failedNoCompletedAt = await task('failed', { completed: null, updated: ago(2 * DAY) });
            const running = await task('running', { updated: ago(2 * DAY) });
            const recent = await task('completed', { completed: ago(60 * 60 * 1000), updated: ago(60 * 60 * 1000) });
            const single = await task('cancelled', { completed: ago(2 * DAY), updated: ago(2 * DAY) });
            await checkpoints(finished, [0, 1, 2]);
            await checkpoints(failedNoCompletedAt, [3, 5]);
            await checkpoints(running, [0, 1]);
            await checkpoints(recent, [0, 1]);
            await checkpoints(single, [4]);

            await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...cfg, DRY_RUN: true } });
            expect(await turnsOf(finished)).toEqual([0, 1, 2]); // dry-run 은 지우지 않는다

            await sweepAgentTaskRetention(pool, { now: NOW, cfg });
            expect(await turnsOf(finished)).toEqual([2]);
            expect(await turnsOf(failedNoCompletedAt)).toEqual([5]);
            expect(await turnsOf(running)).toEqual([0, 1]);
            expect(await turnsOf(recent)).toEqual([0, 1]);
            expect(await turnsOf(single)).toEqual([4]);
            // 작업 행 자체는 압축 대상이 아니다
            expect((await existing([finished, failedNoCompletedAt])).size).toBe(2);
        });

        it('BATCH_LIMIT 작업만, 가장 오래 끝난 작업부터 압축하고 dry-run 건수가 그 배치의 지울 행 수와 같다', async () => {
            const oldest = await task('completed', { completed: new Date('1998-01-01T00:00:00Z'), updated: new Date('1998-01-01T00:00:00Z') });
            const next = await task('completed', { completed: new Date('1998-01-02T00:00:00Z'), updated: new Date('1998-01-02T00:00:00Z') });
            await checkpoints(oldest, [0, 1, 2]);
            await checkpoints(next, [0, 1]);
            const one = { ...cfg, BATCH_LIMIT: 1 };

            const dry = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...one, DRY_RUN: true } });
            expect(dry.checkpoints).toBe(2); // oldest 의 turn 0·1

            const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: one });
            expect(r.checkpoints).toBe(2);
            expect(await turnsOf(oldest)).toEqual([2]);
            expect(await turnsOf(next)).toEqual([0, 1]); // 다음 주기 몫
            await sweepAgentTaskRetention(pool, { now: NOW, cfg: one });
            expect(await turnsOf(next)).toEqual([1]);
        });
    });
});
