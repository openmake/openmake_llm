/**
 * Agent Task 생성(POST /api/agent-tasks) 입력 처리 — agent-task.routes.ts 에서 분리 (max-lines 가드).
 *
 * - createBodyMw: JSON(validateWithSecurity) / multipart(multer 디스크 스트리밍) 본문 분기 미들웨어
 * - enforceTotalUploadSize: multer 뒤 파일 합계 상한 검사(초과 시 임시 파일 삭제 후 413)
 * - storeMultipartInputFiles: multipart 로 스트리밍된 원본을 task 디렉토리로 옮기고 입력 첨부 메타를 만든다
 *
 * @module routes/agent-task-create-inputs
 */
import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { badRequest } from '../utils/api-response';
import { decodeMultipartFilename } from '../utils/multipart-filename';
import { validateWithSecurity } from '../middlewares/validation';
import { createAgentTaskSchema } from '../schemas/agent-task.schema';
import type { AgentTaskInputFile } from '../services/AgentTaskService';
import { extractAttachedDocuments, isBinaryDocumentName } from '../services/chat-service/doc-extractor';
import { AGENT_TASK_LIMITS, FILE_ATTACH_LIMITS, DOC_EXTRACT_LIMITS } from '../config/runtime-limits';
import { ensureUploadTmpDir, finalizeUploadedFile, resolveStoredPath, safeBaseName } from '../services/agent-task/upload-store';

const uploadMw = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            ensureUploadTmpDir().then((d) => cb(null, d), (e) => cb(e as Error, ''));
        },
        filename: (_req, _file, cb) => cb(null, uuidv4()),
    }),
    limits: { fileSize: AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES, files: FILE_ATTACH_LIMITS.MAX_FILES },
}).array('files', FILE_ATTACH_LIMITS.MAX_FILES);

// body 상한은 express.json 파서와 동일 상수 공유 — validate 기본값(1MB)이 파서 상한을
// 무력화해 대용량 첨부가 "요청 본문이 너무 큽니다" 로 거부되던 정합 버그 방지.
const jsonValidateMw = validateWithSecurity(createAgentTaskSchema, {
    maxBodySizeBytes: AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES,
    preserveFormattingFields: ['goal', 'files'], // 첨부 텍스트(코드·CSV) 들여쓰기 보존 — 기본 정제는 연속 공백을 접는다
});

/** multer 의 fileSize 는 파일당 상한이라 파일 여러 개의 합은 막지 못한다 — 합계가
 *  REQUEST_BODY_MAX_BYTES 를 넘으면 이미 디스크에 쓴 임시 파일을 지우고 413. */
export function enforceTotalUploadSize(req: Request, res: Response, next: NextFunction) {
    const files = Array.isArray(req.files) ? req.files : [];
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total <= AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES) return next();
    void Promise.all(files.map((f) => fs.unlink(f.path).catch(() => undefined))).then(() => {
        res.status(413).json(badRequest(`첨부 파일 합계가 너무 큽니다 (최대 ${AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES} bytes)`));
    });
}

export function createBodyMw(req: Request, res: Response, next: NextFunction) {
    if (!req.is('multipart/form-data')) return jsonValidateMw(req, res, next);
    uploadMw(req, res, (err?: unknown) => {
        if (!err) return enforceTotalUploadSize(req, res, next);
        const msg = err instanceof multer.MulterError
            ? (err.code === 'LIMIT_FILE_SIZE'
                ? `첨부 파일이 너무 큽니다 (최대 ${AGENT_TASK_LIMITS.REQUEST_BODY_MAX_BYTES} bytes)`
                : `업로드 형식 오류: ${err.code}`)
            : (err instanceof Error ? err.message : String(err));
        res.status(400).json(badRequest(msg));
    });
}

export async function storeMultipartInputFiles(taskId: string, parts: Express.Multer.File[]): Promise<AgentTaskInputFile[]> {
    const stored: AgentTaskInputFile[] = [];
    for (const [i, p] of parts.entries()) {
        // busboy 가 latin1 로 넘긴 한글 파일명 복원 (이미 UTF-8 이면 고문자 부재로 무변환)
        const rawName = decodeMultipartFilename(p.originalname);
        const name = safeBaseName(rawName, `file_${i}`);
        const storedPath = await finalizeUploadedFile(taskId, p.path, rawName, i);
        const entry: AgentTaskInputFile = { name, type: p.mimetype, size: p.size, storedPath };
        // 생성 시점 추출은 30MB 이내만 — 대형 스캔 PDF OCR(파일당 ~2분)을 여기서 돌리면
        // 생성 응답이 Cloudflare 응답 한도(100s, 524)를 초과한다. 대형 파일 텍스트화는
        // 샌드박스 내 tesseract(에이전트 직접 OCR)가 담당.
        if (p.size <= DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE) {
            const probe: AgentTaskInputFile = {
                name, type: p.mimetype,
                data: (await fs.readFile(resolveStoredPath(storedPath))).toString('base64'),
            };
            await extractAttachedDocuments([probe]);
            if (typeof probe.content === 'string') {
                entry.content = probe.content;
                entry.truncated = probe.truncated;
                if (isBinaryDocumentName(name)) entry.extracted = true;
            }
        }
        stored.push(entry);
    }
    return stored;
}
