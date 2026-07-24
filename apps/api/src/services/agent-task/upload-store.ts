/**
 * Agent Task 입력 첨부 디스크 스토어 — multipart 업로드 원본의 보관/이동/정리.
 *
 * base64-in-JSON 전송의 근본 한계(V8 문자열 상한·파싱 메모리 스파이크·DB 비대화)를 피해,
 * multer 가 tmp/ 로 스트리밍한 파일을 task 확정 후 <root>/<taskId>/ 로 이동(rename)하고
 * DB 에는 상대 경로(storedPath)만 남긴다. task 삭제 시 removeTaskFiles 로 함께 정리.
 *
 * @module services/agent-task/upload-store
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskUploadStore');

const ROOT = path.resolve(AGENT_TASK_LIMITS.UPLOAD_ROOT);

/** multer destination — 업로드 진행 중 임시 보관 위치. */
export const UPLOAD_TMP_DIR = path.join(ROOT, 'tmp');

export async function ensureUploadTmpDir(): Promise<string> {
    await fs.mkdir(UPLOAD_TMP_DIR, { recursive: true });
    return UPLOAD_TMP_DIR;
}

/** 파일명 정규화 — 경로 성분 제거 + 제어문자 치환 (task-inputs 와 동일 규칙). */
export function safeBaseName(name: string, fallback: string): string {
    return ((name.split(/[\\/]/).pop() ?? '').replace(/\p{Cc}/gu, '_').trim()) || fallback;
}

/** taskId 하위 저장 디렉토리의 절대 경로. taskId 는 서버 생성 uuid 만 온다(경로 주입 불가). */
function taskDir(taskId: string): string {
    return path.join(ROOT, taskId);
}

/**
 * tmp 에 스트리밍된 업로드 파일을 task 디렉토리로 이동하고 상대 저장 경로를 반환.
 * 같은 파일시스템이므로 rename — 대용량도 즉시 완료.
 */
export async function finalizeUploadedFile(
    taskId: string,
    tmpPath: string,
    originalName: string,
    index: number,
): Promise<string> {
    const dir = taskDir(taskId);
    await fs.mkdir(dir, { recursive: true });
    const rel = `${index}_${safeBaseName(originalName, `file_${index}`)}`;
    await fs.rename(tmpPath, path.join(dir, rel));
    return path.join(taskId, rel);
}

/** storedPath(상대) → 절대 경로. ROOT 밖으로 나가는 경로는 거부(방어). */
export function resolveStoredPath(storedPath: string): string {
    const abs = path.resolve(ROOT, storedPath);
    if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
        throw new Error(`잘못된 저장 경로: ${storedPath}`);
    }
    return abs;
}

/** 업로드 임시 파일 제거 (검증 실패 등 롤백용). 실패는 로그만. */
export async function discardTmpFiles(tmpPaths: string[]): Promise<void> {
    for (const p of tmpPaths) {
        try { await fs.unlink(p); } catch { /* 이미 없음 */ }
    }
}

/** task 의 저장 파일 전체 정리 (task 삭제 시). 실패는 로그만 — 삭제 흐름을 막지 않는다. */
export async function removeTaskFiles(taskId: string): Promise<void> {
    try {
        await fs.rm(taskDir(taskId), { recursive: true, force: true });
    } catch (e) {
        logger.warn(`[UploadStore] task 파일 정리 실패 (${taskId}): ${e instanceof Error ? e.message : e}`);
    }
}
