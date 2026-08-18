/**
 * Agent Task 업로드 보존 스윕 — 무기한 쌓이던 업로드 원본의 회수 경로.
 *
 * removeTaskFiles 는 생성 롤백과 task 삭제에서만 불려 완료된 task 의 원본이 디스크에
 * 무기한 남았다. 이 스윕이 (부팅 + 주기, schedulers/index.ts) 다음 셋을 정리한다:
 *   1. 종료(completed/failed/cancelled) 후 보존기간(UPLOAD_RETENTION_MS)이 지난 task 의
 *      원본 디렉토리 — DB 메타(input_files 추출텍스트·input_images base64)는 유지.
 *   2. DB 행이 없는 고아 디렉토리(task 삭제 시 rm 실패 잔재) — 생성 직후 "디렉토리는
 *      있으나 행은 아직" 경합 창을 피하려고 mtime 이 보존기간을 지난 것만.
 *   3. tmp/ 의 오래된 multer 잔재(업로드 중단·크래시) — CHUNK_UPLOAD_TTL_MS 기준.
 *
 * @module services/agent-task/upload-retention
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Pool } from 'pg';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { removeTaskFiles, UPLOAD_TMP_DIR } from './upload-store';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskUploadRetention');

const ROOT = path.resolve(AGENT_TASK_LIMITS.UPLOAD_ROOT);
/** task 디렉토리가 아닌 고정 하위 경로 — 스윕 대상에서 제외. */
const NON_TASK_DIRS = new Set(['tmp', 'chunked']);
/** 원본 회수 대상 상태 — 진행형(pending/running/paused)은 절대 건드리지 않는다. */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

export interface UploadRetentionResult {
    /** 보존기간 경과로 원본을 회수한 task 수 */
    sweptTasks: number;
    /** DB 행이 없어 제거한 고아 디렉토리 수 */
    orphanDirs: number;
    /** tmp/ 에서 제거한 잔재 파일 수 */
    tmpFiles: number;
}

/** tmp/ 잔재 청소 — 업로드 중단으로 남은 multer 스트리밍 파일. */
async function sweepTmpFiles(now: number): Promise<number> {
    let entries: string[];
    try { entries = await fs.readdir(UPLOAD_TMP_DIR); } catch { return 0; }
    const cutoff = now - AGENT_TASK_LIMITS.CHUNK_UPLOAD_TTL_MS;
    let removed = 0;
    for (const name of entries) {
        const p = path.join(UPLOAD_TMP_DIR, name);
        try {
            const st = await fs.stat(p);
            if (st.isFile() && st.mtimeMs < cutoff) {
                await fs.unlink(p);
                removed++;
            }
        } catch { /* 경합 삭제 등 — 무시 */ }
    }
    return removed;
}

/**
 * 업로드 보존 스윕 1회 실행. 실패는 항목 단위로 삼켜 스윕 전체를 죽이지 않는다.
 * UPLOAD_RETENTION_MS <= 0 이면 원본 회수는 건너뛰고 tmp/ 청소만 수행.
 */
export async function sweepExpiredTaskUploads(pool: Pool, now = Date.now()): Promise<UploadRetentionResult> {
    const result: UploadRetentionResult = { sweptTasks: 0, orphanDirs: 0, tmpFiles: 0 };
    result.tmpFiles = await sweepTmpFiles(now);

    const retentionMs = AGENT_TASK_LIMITS.UPLOAD_RETENTION_MS;
    if (retentionMs <= 0) return result;

    let entries;
    try { entries = await fs.readdir(ROOT, { withFileTypes: true }); } catch { return result; }
    const taskIds = entries
        .filter((e) => e.isDirectory() && !NON_TASK_DIRS.has(e.name))
        .map((e) => e.name);
    if (!taskIds.length) return result;

    const { rows } = await pool.query<{ id: string; status: string; finished_at: Date | string | null }>(
        `SELECT id, status, COALESCE(completed_at, updated_at) AS finished_at
           FROM agent_tasks WHERE id = ANY($1)`,
        [taskIds],
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const cutoff = now - retentionMs;

    for (const id of taskIds) {
        const row = byId.get(id);
        if (row) {
            if (!TERMINAL_STATUSES.has(row.status) || !row.finished_at) continue;
            if (new Date(row.finished_at).getTime() >= cutoff) continue;
            await removeTaskFiles(id);
            result.sweptTasks++;
        } else {
            try {
                const st = await fs.stat(path.join(ROOT, id));
                if (st.mtimeMs >= cutoff) continue;
                await fs.rm(path.join(ROOT, id), { recursive: true, force: true });
                result.orphanDirs++;
            } catch { /* 경합 삭제 등 — 무시 */ }
        }
    }
    if (result.sweptTasks || result.orphanDirs) {
        logger.info(`[UploadRetention] 원본 회수 ${result.sweptTasks}건 / 고아 디렉토리 ${result.orphanDirs}건`);
    }
    return result;
}
