/**
 * 작업 기록·화면 캡처 보존 스윕 유닛 테스트 — 전체 스위치 꺼짐이면 무동작, 끝난 지 N일 지난 끝난 작업만
 * 지우는 SQL 조건(상태·기준 시각·건수 상한), 지운 건수의 감사 기록, 작업 공간의 오래된 이미지 파일만 삭제
 * (진행 중·주차 중 작업의 작업 공간과 이미지가 아닌 파일은 남김). DB 는 모킹 — 실제 DB 에 연결하지 않는다.
 */
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Pool } from 'pg';

const logAudit = jest.fn().mockResolvedValue(undefined);
jest.mock('../../AuditService', () => ({ getAuditService: () => ({ logAudit }) }));

import { sweepAgentTaskRetention, type AgentTaskRetentionConfig } from '../task-retention';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
const WS_ROOT = path.join(os.tmpdir(), `task-retention-test-${process.pid}`);

const ON: AgentTaskRetentionConfig = {
    ENABLED: true, RECORD_RETENTION_DAYS: 90, SCREENSHOT_RETENTION_DAYS: 30, BATCH_LIMIT: 500,
    SCREENSHOT_EXTENSIONS: ['.png', '.jpg', '.jpeg', '.webp'],
};

interface Q { sql: string; params: unknown[] }

/** pool.query / pool.connect().query 를 모두 기록하는 모킹 풀. respond 로 SQL 별 응답을 정한다. */
function mockPool(respond: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number } = () => ({ rows: [], rowCount: 0 })) {
    const calls: Q[] = [];
    const run = jest.fn(async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return respond(sql, params); });
    const client = { query: run, release: jest.fn() };
    const pool = { query: run, connect: jest.fn(async () => client) } as unknown as Pool;
    return { pool, calls, client };
}

async function touch(file: string, ageDays: number): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'x');
    const t = new Date(NOW - ageDays * DAY);
    await fs.utimes(file, t, t);
}

async function exists(p: string): Promise<boolean> {
    try { await fs.stat(p); return true; } catch { return false; }
}

beforeEach(async () => {
    logAudit.mockClear();
    await fs.rm(WS_ROOT, { recursive: true, force: true });
    await fs.mkdir(WS_ROOT, { recursive: true });
});
afterAll(async () => { await fs.rm(WS_ROOT, { recursive: true, force: true }); });

describe('sweepAgentTaskRetention', () => {
    it('전체 스위치가 꺼져 있으면 DB 도 파일도 건드리지 않는다', async () => {
        const { pool, calls } = mockPool();
        await touch(path.join(WS_ROOT, 't-old', 'shot.png'), 100);
        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, ENABLED: false }, workspaceRoot: WS_ROOT });
        expect(r).toEqual({ tasks: 0, auditLogs: 0, screenshots: 0 });
        expect(calls).toHaveLength(0);
        expect(await exists(path.join(WS_ROOT, 't-old', 'shot.png'))).toBe(true);
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('끝난(completed·failed·cancelled) 작업 중 끝난 지 90일 지난 것만 건수 상한 안에서 지운다', async () => {
        const { pool, calls } = mockPool((sql) => {
            if (/SELECT id FROM agent_tasks/.test(sql)) return { rows: [{ id: 'a' }, { id: 'b' }] };
            if (/DELETE FROM agent_tasks/.test(sql)) return { rows: [], rowCount: 2 };
            return { rows: [], rowCount: 0 };
        });
        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, SCREENSHOT_RETENTION_DAYS: 0 }, workspaceRoot: WS_ROOT });
        expect(r.tasks).toBe(2);

        const select = calls.find((c) => /SELECT id FROM agent_tasks/.test(c.sql))!;
        expect(select.sql).toMatch(/status IN \('completed', 'failed', 'cancelled'\)/);
        expect(select.sql).toMatch(/COALESCE\(completed_at, updated_at\) < \$1/);
        expect(select.sql).toMatch(/LIMIT \$2/);
        expect(select.sql).toMatch(/FOR UPDATE SKIP LOCKED/);
        expect((select.params[0] as Date).getTime()).toBe(NOW - 90 * DAY);
        expect(select.params[1]).toBe(500);

        // 저장소의 작업 삭제와 같은 순서: 단계 → 작업(승인·이벤트·영수증 등은 FK CASCADE)
        const sqls = calls.map((c) => c.sql);
        const iSteps = sqls.findIndex((s) => /DELETE FROM agent_task_steps WHERE task_id = ANY\(\$1\)/.test(s));
        const iTasks = sqls.findIndex((s) => /DELETE FROM agent_tasks WHERE id = ANY\(\$1\)/.test(s));
        expect(iSteps).toBeGreaterThan(-1);
        expect(iTasks).toBeGreaterThan(iSteps);
        expect(calls[iTasks].sql).toMatch(/status IN \('completed', 'failed', 'cancelled'\)/);
        expect(calls[iTasks].params[0]).toEqual(['a', 'b']);
        expect(sqls).toContain('COMMIT');
    });

    it('지울 작업이 없으면 삭제문을 보내지 않는다', async () => {
        const { pool, calls } = mockPool();
        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, SCREENSHOT_RETENTION_DAYS: 0 }, workspaceRoot: WS_ROOT });
        expect(r.tasks).toBe(0);
        expect(calls.some((c) => /DELETE FROM agent_tasks/.test(c.sql))).toBe(false);
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('삭제 중 오류면 되돌리고 0건으로 끝낸다', async () => {
        const { pool, calls, client } = mockPool((sql) => {
            if (/SELECT id FROM agent_tasks/.test(sql)) return { rows: [{ id: 'a' }] };
            if (/DELETE FROM agent_task_steps/.test(sql)) throw new Error('boom');
            return { rows: [], rowCount: 0 };
        });
        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, SCREENSHOT_RETENTION_DAYS: 0 }, workspaceRoot: WS_ROOT });
        expect(r.tasks).toBe(0);
        expect(calls.map((c) => c.sql)).toContain('ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });

    it('작업 관련 감사 로그(resource_type=agent_task)만 같은 기간으로 지운다', async () => {
        const { pool, calls } = mockPool((sql) => (/DELETE FROM audit_logs/.test(sql) ? { rows: [], rowCount: 3 } : { rows: [], rowCount: 0 }));
        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, SCREENSHOT_RETENTION_DAYS: 0 }, workspaceRoot: WS_ROOT });
        expect(r.auditLogs).toBe(3);
        const del = calls.find((c) => /DELETE FROM audit_logs/.test(c.sql))!;
        expect(del.sql).toMatch(/resource_type = 'agent_task'/);
        expect(del.sql).toMatch(/timestamp < \$1/);
        expect((del.params[0] as Date).getTime()).toBe(NOW - 90 * DAY);
        expect(del.params[1]).toBe(500);
        // 지운 건수를 감사 기록에 남긴다 — 다음 회차에 지워지지 않도록 다른 resource_type
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'agent_task.retention_purged',
            resourceType: 'agent_task_retention',
            details: expect.objectContaining({ tasks: 0, auditLogs: 3, screenshots: 0 }),
        }));
    });

    it('기록 보존 0 이면 작업·감사 로그 삭제를 건너뛴다', async () => {
        const { pool, calls } = mockPool();
        await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, RECORD_RETENTION_DAYS: 0, SCREENSHOT_RETENTION_DAYS: 0 }, workspaceRoot: WS_ROOT });
        expect(calls).toHaveLength(0);
    });

    it('끝난 작업의 작업 공간에서 30일 지난 이미지 파일만 지우고 나머지는 남긴다', async () => {
        await touch(path.join(WS_ROOT, 'done', 'shot-old.png'), 31);
        await touch(path.join(WS_ROOT, 'done', 'sub', 'deep-old.JPG'), 40);
        await touch(path.join(WS_ROOT, 'done', 'shot-new.png'), 5);
        await touch(path.join(WS_ROOT, 'done', 'report.md'), 60);
        await touch(path.join(WS_ROOT, 'done', '.git', 'objects', 'x.png'), 60);
        await touch(path.join(WS_ROOT, 'running', 'shot-old.png'), 60);
        await touch(path.join(WS_ROOT, 'parked', 'shot-old.png'), 60);
        await touch(path.join(WS_ROOT, 'gone', 'shot-old.webp'), 60); // DB 행 없음(삭제된 작업)
        const { pool } = mockPool((sql) => (/SELECT id, status FROM agent_tasks/.test(sql)
            ? { rows: [{ id: 'done', status: 'completed' }, { id: 'running', status: 'running' }, { id: 'parked', status: 'paused' }] }
            : { rows: [], rowCount: 0 }));

        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, RECORD_RETENTION_DAYS: 0 }, workspaceRoot: WS_ROOT });
        expect(r.screenshots).toBe(3);
        expect(await exists(path.join(WS_ROOT, 'done', 'shot-old.png'))).toBe(false);
        expect(await exists(path.join(WS_ROOT, 'done', 'sub', 'deep-old.JPG'))).toBe(false);
        expect(await exists(path.join(WS_ROOT, 'gone', 'shot-old.webp'))).toBe(false);
        expect(await exists(path.join(WS_ROOT, 'done', 'shot-new.png'))).toBe(true);
        expect(await exists(path.join(WS_ROOT, 'done', 'report.md'))).toBe(true);
        expect(await exists(path.join(WS_ROOT, 'done', '.git', 'objects', 'x.png'))).toBe(true);
        expect(await exists(path.join(WS_ROOT, 'running', 'shot-old.png'))).toBe(true);
        expect(await exists(path.join(WS_ROOT, 'parked', 'shot-old.png'))).toBe(true);
    });

    it('화면 캡처 삭제도 건수 상한을 넘지 않는다', async () => {
        for (let i = 0; i < 5; i++) await touch(path.join(WS_ROOT, 'done', `s${i}.png`), 60);
        const { pool } = mockPool((sql) => (/SELECT id, status/.test(sql) ? { rows: [{ id: 'done', status: 'failed' }] } : { rows: [], rowCount: 0 }));
        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, RECORD_RETENTION_DAYS: 0, BATCH_LIMIT: 2 }, workspaceRoot: WS_ROOT });
        expect(r.screenshots).toBe(2);
    });

    it('작업 공간 루트가 없으면 화면 캡처 단계는 0건', async () => {
        const { pool } = mockPool();
        const r = await sweepAgentTaskRetention(pool, { now: NOW, cfg: { ...ON, RECORD_RETENTION_DAYS: 0 }, workspaceRoot: path.join(WS_ROOT, 'missing') });
        expect(r.screenshots).toBe(0);
    });
});
