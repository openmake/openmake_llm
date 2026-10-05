/**
 * 에이전트 작업 보존 스윕(Companion 설계 01장 — 작업 기록·감사 로그 90일, 화면 캡처 30일).
 *
 * 전체 스위치(AGENT_TASK_RETENTION_ENABLED)가 꺼져 있으면 아무것도 하지 않는다. 켜지면 (부팅 + 주기, schedulers/index.ts):
 *   1. 기록 — 끝난(completed·failed·cancelled) 지 RECORD_RETENTION_DAYS 지난 작업을 지운다. 저장소의 작업 삭제
 *      (deleteAgentTaskWithSteps)처럼 단계 → 작업 순으로 한 트랜잭션에서, 승인·승인 이벤트·작업 이벤트·도구 영수증·
 *      체크포인트·공유·하위 작업 단계는 FK ON DELETE CASCADE 로 같이 지워진다. 진행형(pending·queued·running·paused)은
 *      조건에서 빠지고, 삭제문에서도 상태를 다시 확인해 그 사이 재실행된 작업을 건드리지 않는다.
 *   2. 감사 로그 — audit_logs 중 resource_type='agent_task' 이고 같은 기간 지난 행. 다른 감사 로그는 건드리지 않는다
 *      (data/db-retention.ts 는 감사 로그를 지우지 않고 PII 만 익명화한다 — 그 정책은 그대로).
 *   3. 화면 캡처 — 서버 샌드박스 작업 공간(TASK_SANDBOX_ROOT/<작업>)의 이미지 파일 중 수정된 지 SCREENSHOT_RETENTION_DAYS
 *      지난 것. 진행형 작업의 작업 공간과 이미지가 아닌 파일·.git 은 남긴다. 작업 공간 디렉터리 자체는 기존
 *      reapStaleWorkspaces(TASK_SANDBOX_WORKSPACE_TTL_MS)가 지우므로 여기서는 지우지 않는다 — 이 단계는 그 TTL 을
 *      길게 잡았거나 샌드박스를 끈 뒤 남은 작업 공간에서 캡처만 기간 안으로 묶는 상한이다.
 * 업로드 원본은 기존 upload-retention(AGENT_TASK_UPLOAD_RETENTION_DAYS)이 회수한다 — 겹치지 않게 여기선 손대지 않는다.
 * 항목마다 BATCH_LIMIT 건까지만 지우고 남은 것은 다음 주기에. 지운 건수는 로그와 감사 기록(agent_task.retention_purged)에 남긴다.
 *
 * @module services/agent-task/task-retention
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Pool } from 'pg';
import { AGENT_TASK_RETENTION } from '../../config/runtime-limits';
import { getTaskSandboxConfig } from '../../config/task-sandbox';
import { sanitizeId } from '../task-sandbox/sandbox';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskRetention');

export type AgentTaskRetentionConfig = typeof AGENT_TASK_RETENTION;

export const RETENTION_AUDIT_ACTION = 'agent_task.retention_purged';
/** 정리 기록의 resource_type — 'agent_task' 와 달라야 다음 회차의 감사 로그 정리에 걸리지 않는다 */
const RETENTION_AUDIT_RESOURCE = 'agent_task_retention';
const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_SQL = `('completed', 'failed', 'cancelled')`;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
/** 작업 공간 안에서 들어가지 않는 디렉터리 — 스냅숏 저장소 등 */
const SKIP_DIRS = new Set(['.git', 'node_modules']);

interface RetentionResult { tasks: number; auditLogs: number; screenshots: number }

async function purgeTaskRecords(pool: Pool, cutoff: Date, limit: number): Promise<number> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query<{ id: string }>(
            `SELECT id FROM agent_tasks
              WHERE status IN ${TERMINAL_SQL} AND COALESCE(completed_at, updated_at) < $1
              ORDER BY COALESCE(completed_at, updated_at)
              LIMIT $2 FOR UPDATE SKIP LOCKED`,
            [cutoff, limit],
        );
        const ids = rows.map((r) => r.id);
        if (!ids.length) { await client.query('COMMIT'); return 0; }
        await client.query('DELETE FROM agent_task_steps WHERE task_id = ANY($1)', [ids]);
        const del = await client.query(`DELETE FROM agent_tasks WHERE id = ANY($1) AND status IN ${TERMINAL_SQL}`, [ids]);
        await client.query('COMMIT');
        return del.rowCount ?? 0;
    } catch (e) {
        await client.query('ROLLBACK').catch(() => { /* noop */ });
        logger.warn(`작업 기록 정리 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
        return 0;
    } finally {
        client.release();
    }
}

async function purgeTaskAuditLogs(pool: Pool, cutoff: Date, limit: number): Promise<number> {
    try {
        const r = await pool.query(
            `DELETE FROM audit_logs WHERE id IN (
                SELECT id FROM audit_logs WHERE resource_type = 'agent_task' AND timestamp < $1 ORDER BY timestamp LIMIT $2)`,
            [cutoff, limit],
        );
        return r.rowCount ?? 0;
    } catch (e) {
        logger.warn(`작업 감사 로그 정리 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
        return 0;
    }
}

/** dir 아래 이미지 파일 중 cutoff 보다 오래된 것을 budget 건까지 지운다. 지운 건수. */
async function removeOldImages(dir: string, cutoffMs: number, exts: ReadonlySet<string>, budget: number): Promise<number> {
    let removed = 0;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return 0; }
    for (const e of entries) {
        if (removed >= budget) break;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (!SKIP_DIRS.has(e.name)) removed += await removeOldImages(p, cutoffMs, exts, budget - removed);
        } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
            try {
                if ((await fs.stat(p)).mtimeMs < cutoffMs) { await fs.unlink(p); removed++; }
            } catch { /* 경합 삭제 등 — 무시 */ }
        }
    }
    return removed;
}

async function purgeWorkspaceScreenshots(pool: Pool, root: string, cutoffMs: number, cfg: AgentTaskRetentionConfig): Promise<number> {
    let dirs: string[];
    try { dirs = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return 0; }
    if (!dirs.length) return 0;
    let statusByDir: Map<string, string>;
    try {
        const { rows } = await pool.query<{ id: string; status: string }>('SELECT id, status FROM agent_tasks WHERE id = ANY($1)', [dirs]);
        statusByDir = new Map(rows.map((r) => [sanitizeId(r.id), r.status]));
    } catch (e) {
        logger.warn(`화면 캡처 정리용 작업 상태 조회 실패(건너뜀): ${e instanceof Error ? e.message : e}`);
        return 0;
    }
    const exts = new Set(cfg.SCREENSHOT_EXTENSIONS);
    let removed = 0;
    for (const d of dirs) {
        if (removed >= cfg.BATCH_LIMIT) break;
        const status = statusByDir.get(d);
        // 행이 없으면 지워진 작업의 남은 작업 공간 — 진행형만 보호한다
        if (status !== undefined && !TERMINAL.has(status)) continue;
        removed += await removeOldImages(path.join(root, d), cutoffMs, exts, cfg.BATCH_LIMIT - removed);
    }
    return removed;
}

/** 보존 스윕 1회. 항목별 실패는 삼켜 다른 항목을 막지 않는다. */
export async function sweepAgentTaskRetention(
    pool: Pool,
    opts: { now?: number; cfg?: AgentTaskRetentionConfig; workspaceRoot?: string } = {},
): Promise<RetentionResult> {
    const cfg = opts.cfg ?? AGENT_TASK_RETENTION;
    const result: RetentionResult = { tasks: 0, auditLogs: 0, screenshots: 0 };
    if (!cfg.ENABLED) return result;
    const now = opts.now ?? Date.now();

    if (cfg.RECORD_RETENTION_DAYS > 0) {
        const cutoff = new Date(now - cfg.RECORD_RETENTION_DAYS * DAY_MS);
        result.tasks = await purgeTaskRecords(pool, cutoff, cfg.BATCH_LIMIT);
        result.auditLogs = await purgeTaskAuditLogs(pool, cutoff, cfg.BATCH_LIMIT);
    }
    if (cfg.SCREENSHOT_RETENTION_DAYS > 0) {
        const root = opts.workspaceRoot ?? getTaskSandboxConfig().workspaceRoot;
        result.screenshots = await purgeWorkspaceScreenshots(pool, root, now - cfg.SCREENSHOT_RETENTION_DAYS * DAY_MS, cfg);
    }

    if (result.tasks || result.auditLogs || result.screenshots) {
        logger.info(`에이전트 작업 보존 정리: 작업 ${result.tasks} / 작업 감사 로그 ${result.auditLogs} / 화면 캡처 ${result.screenshots}`);
        try {
            const { getAuditService } = await import('../AuditService');
            await getAuditService().logAudit({
                action: RETENTION_AUDIT_ACTION,
                resourceType: RETENTION_AUDIT_RESOURCE,
                details: {
                    ...result,
                    recordRetentionDays: cfg.RECORD_RETENTION_DAYS,
                    screenshotRetentionDays: cfg.SCREENSHOT_RETENTION_DAYS,
                },
            });
        } catch (e) {
            logger.warn(`보존 정리 감사 기록 실패(무시): ${e instanceof Error ? e.message : e}`);
        }
    }
    return result;
}
