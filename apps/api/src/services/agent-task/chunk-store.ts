/**
 * Agent Task 청크 업로드 스토어 — Cloudflare 요청당 100MB 상한 우회용.
 *
 * 외부 경로(chat.openmake.cc)는 Cloudflare 무료 플랜이 요청 body 를 100MB 로 제한해
 * 단일 multipart/base64-JSON 으로는 대용량 첨부가 edge 413 으로 거절된다. 파일을
 * CHUNK_MAX_BYTES 이하 조각으로 나눠 올린 뒤(init → chunk×N → complete) uploadId 로
 * 작업 생성 시 참조(claim)하면, 요청당 크기가 상한 아래로 유지된다.
 *
 * 디스크 레이아웃(DB 미사용 — 서버 재시작에도 파일시스템만으로 이어짐):
 *   <UPLOAD_ROOT>/chunked/<uploadId>/meta.json   소유자·선언 크기·청크 수
 *   <UPLOAD_ROOT>/chunked/<uploadId>/chunk.<n>   수신된 n번째 조각
 *   <UPLOAD_ROOT>/chunked/<uploadId>/assembled   complete 시 조립된 원본
 *
 * claim 은 assembled 를 기존 upload-store 의 task 디렉토리 계약(finalizeUploadedFile)으로
 * 이동시키므로, 이후 흐름(추출·샌드박스 주입·task 삭제 시 정리)은 multipart 경로와 동일.
 *
 * @module services/agent-task/chunk-store
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AGENT_TASK_LIMITS, DOC_EXTRACT_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import { safeBaseName, finalizeUploadedFile, resolveStoredPath } from './upload-store';
import { extractAttachedDocuments } from '../chat-service/doc-extractor';
import type { AgentTaskInputFile } from './types';

const logger = createLogger('AgentTaskChunkStore');

const CHUNK_ROOT = path.join(path.resolve(AGENT_TASK_LIMITS.UPLOAD_ROOT), 'chunked');

/** uploadId 는 서버 발급 uuid 만 유효 — 경로 성분 주입 차단. */
const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ChunkedUploadMeta {
    userId: string;
    name: string;
    type?: string;
    size: number;
    totalChunks: number;
    createdAt: number;
}

/** 스토어 오류 — 라우트가 statusCode 로 HTTP 매핑. */
export class ChunkStoreError extends Error {
    constructor(message: string, public readonly statusCode: 400 | 403 | 404 | 409) {
        super(message);
        this.name = 'ChunkStoreError';
    }
}

function uploadDir(uploadId: string): string {
    if (!UPLOAD_ID_RE.test(uploadId)) throw new ChunkStoreError('유효하지 않은 uploadId 입니다', 400);
    return path.join(CHUNK_ROOT, uploadId);
}

async function loadMeta(uploadId: string, userId: string): Promise<ChunkedUploadMeta> {
    const dir = uploadDir(uploadId); // 형식 오류는 여기서 400 — 아래 catch(404)에 삼키지 않는다
    let raw: string;
    try {
        raw = await fs.readFile(path.join(dir, 'meta.json'), 'utf8');
    } catch {
        throw new ChunkStoreError('업로드를 찾을 수 없습니다 (만료되었거나 존재하지 않음)', 404);
    }
    const meta = JSON.parse(raw) as ChunkedUploadMeta;
    if (meta.userId !== userId) throw new ChunkStoreError('이 업로드에 대한 권한이 없습니다', 403);
    return meta;
}

/** TTL 지난 미클레임 업로드 청소 — init 때 기회적으로 호출(전용 스케줄러 불필요). */
async function cleanupStale(): Promise<void> {
    let entries: string[];
    try { entries = await fs.readdir(CHUNK_ROOT); } catch { return; }
    const cutoff = Date.now() - AGENT_TASK_LIMITS.CHUNK_UPLOAD_TTL_MS;
    for (const id of entries) {
        if (!UPLOAD_ID_RE.test(id)) continue;
        try {
            const st = await fs.stat(path.join(CHUNK_ROOT, id));
            if (st.mtimeMs < cutoff) {
                await fs.rm(path.join(CHUNK_ROOT, id), { recursive: true, force: true });
                logger.info(`[ChunkStore] 만료 업로드 정리: ${id}`);
            }
        } catch { /* 경합 삭제 등 — 무시 */ }
    }
}

/** TTL 지난 미클레임 업로드 청소 — 보존 스윕 스케줄러(schedulers/index.ts)에서 주기 호출.
 *  init 시 기회적 청소만으로는 업로드가 끊긴 뒤 새 업로드가 없으면 영영 안 치워진다. */
export async function cleanupStaleChunkUploads(): Promise<void> {
    await cleanupStale();
}

/** 업로드 세션 시작 — 선언(파일명·크기·청크 수)을 기록하고 uploadId 발급. */
export async function initChunkedUpload(
    userId: string,
    decl: { name: string; type?: string; size: number; totalChunks: number },
): Promise<{ uploadId: string }> {
    const expectedChunks = Math.max(1, Math.ceil(decl.size / AGENT_TASK_LIMITS.CHUNK_MAX_BYTES));
    if (decl.totalChunks < expectedChunks) {
        throw new ChunkStoreError(
            `totalChunks(${decl.totalChunks})가 선언 크기 대비 부족합니다 — 청크당 최대 ${AGENT_TASK_LIMITS.CHUNK_MAX_BYTES} bytes`, 400);
    }
    void cleanupStale(); // 비동기 기회적 청소 — init 응답을 막지 않음
    const uploadId = uuidv4();
    const dir = uploadDir(uploadId);
    await fs.mkdir(dir, { recursive: true });
    const meta: ChunkedUploadMeta = {
        userId,
        name: safeBaseName(decl.name, 'file'),
        type: decl.type,
        size: decl.size,
        totalChunks: decl.totalChunks,
        createdAt: Date.now(),
    };
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta), 'utf8');
    return { uploadId };
}

/** 청크 저장 — 같은 index 재전송은 덮어쓰기(클라이언트 재시도 허용). */
export async function writeChunk(uploadId: string, userId: string, index: number, buf: Buffer): Promise<void> {
    const meta = await loadMeta(uploadId, userId);
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
        throw new ChunkStoreError(`청크 index 범위 오류 (0..${meta.totalChunks - 1})`, 400);
    }
    if (buf.length === 0) throw new ChunkStoreError('빈 청크는 허용되지 않습니다', 400);
    if (buf.length > AGENT_TASK_LIMITS.CHUNK_MAX_BYTES) {
        throw new ChunkStoreError(`청크가 너무 큽니다 (최대 ${AGENT_TASK_LIMITS.CHUNK_MAX_BYTES} bytes)`, 400);
    }
    await fs.writeFile(path.join(uploadDir(uploadId), `chunk.${index}`), buf);
}

/**
 * 조립 — 모든 청크를 순서대로 이어붙여 assembled 생성. 합계가 선언 크기와 다르면 409
 * (청크는 보존 — 누락분 재전송 후 다시 complete 가능). 이미 조립됐으면 멱등 성공.
 */
export async function completeChunkedUpload(
    uploadId: string, userId: string,
): Promise<{ name: string; type?: string; size: number }> {
    const meta = await loadMeta(uploadId, userId);
    const dir = uploadDir(uploadId);
    const assembled = path.join(dir, 'assembled');
    if (await fs.stat(assembled).then(() => true, () => false)) {
        return { name: meta.name, type: meta.type, size: meta.size };
    }
    let total = 0;
    for (let i = 0; i < meta.totalChunks; i++) {
        const st = await fs.stat(path.join(dir, `chunk.${i}`)).catch(() => null);
        if (!st) throw new ChunkStoreError(`청크 ${i} 미수신 — 재전송 후 다시 완료 요청하세요`, 409);
        total += st.size;
    }
    if (total !== meta.size) {
        throw new ChunkStoreError(`크기 불일치 — 선언 ${meta.size}, 수신 ${total} bytes`, 409);
    }
    const partial = `${assembled}.partial`;
    await fs.rm(partial, { force: true });
    for (let i = 0; i < meta.totalChunks; i++) {
        await fs.appendFile(partial, await fs.readFile(path.join(dir, `chunk.${i}`)));
    }
    await fs.rename(partial, assembled);
    for (let i = 0; i < meta.totalChunks; i++) {
        await fs.rm(path.join(dir, `chunk.${i}`), { force: true });
    }
    logger.info(`[ChunkStore] 조립 완료: ${uploadId} (${meta.name}, ${meta.size} bytes, ${meta.totalChunks} chunks)`);
    return { name: meta.name, type: meta.type, size: meta.size };
}

/**
 * 작업 생성 시 참조 소모 — assembled 를 task 디렉토리로 이동(storedPath 반환) 후
 * 업로드 디렉토리 정리. complete 전이면 409.
 */
export async function claimChunkedUpload(
    uploadId: string, userId: string, taskId: string, index: number,
): Promise<{ name: string; type?: string; size: number; storedPath: string }> {
    const meta = await loadMeta(uploadId, userId);
    const dir = uploadDir(uploadId);
    const assembled = path.join(dir, 'assembled');
    if (!(await fs.stat(assembled).then(() => true, () => false))) {
        throw new ChunkStoreError('완료(complete)되지 않은 업로드는 첨부할 수 없습니다', 409);
    }
    const storedPath = await finalizeUploadedFile(taskId, assembled, meta.name, index);
    await fs.rm(dir, { recursive: true, force: true });
    return { name: meta.name, type: meta.type, size: meta.size, storedPath };
}

/** 업로드 중단/폐기 — 소유자 검증 후 디렉토리 제거. */
export async function abortChunkedUpload(uploadId: string, userId: string): Promise<void> {
    await loadMeta(uploadId, userId);
    await fs.rm(uploadDir(uploadId), { recursive: true, force: true });
}

/**
 * 작업 생성 라우트용 고수준 헬퍼 — 업로드 참조 목록을 일괄 claim 하고
 * AgentTaskInputFile 로 변환한다. 추출 정책은 multipart 경로와 동일:
 * DOC_EXTRACT 상한 이하만 텍스트 추출 병행, 초과 파일은 원본만 샌드박스로 전달.
 * claim index 는 1000+ — multipart parts 의 0-기반 index 와 파일명 충돌 방지.
 */
export async function claimUploadsAsInputFiles(
    refs: Array<{ uploadId: string; type?: string }>,
    userId: string,
    taskId: string,
): Promise<AgentTaskInputFile[]> {
    const out: AgentTaskInputFile[] = [];
    for (const [i, ref] of refs.entries()) {
        const c = await claimChunkedUpload(ref.uploadId, userId, taskId, 1000 + i);
        const entry: AgentTaskInputFile = { name: c.name, type: c.type ?? ref.type, size: c.size, storedPath: c.storedPath };
        // 생성 시점 추출은 30MB 이내만 — 대형 스캔 OCR 로 생성 응답이 CF 100s(524)를 넘지
        // 않도록. 대형 파일은 샌드박스 내 tesseract 로 에이전트가 직접 OCR(운영 철학: LLM 주체).
        if (c.size <= DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE) {
            const probe: AgentTaskInputFile = {
                name: c.name, type: entry.type,
                data: (await fs.readFile(resolveStoredPath(c.storedPath))).toString('base64'),
            };
            await extractAttachedDocuments([probe]);
            if (typeof probe.content === 'string') {
                entry.content = probe.content;
                entry.truncated = probe.truncated;
                entry.extracted = true;
            }
        }
        out.push(entry);
    }
    return out;
}
