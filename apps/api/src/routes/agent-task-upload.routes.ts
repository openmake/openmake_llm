/**
 * ============================================================
 * Agent Task 청크 업로드 라우트 — Cloudflare 100MB 상한 우회
 * ============================================================
 *
 * 외부 경로(chat.openmake.cc)는 Cloudflare 무료 플랜의 요청당 100MB 상한 때문에
 * 대용량 첨부가 edge 413 으로 거절된다. 이 라우트는 파일을 청크 단위로 수신해
 * 서버에서 조립하고, 작업 생성(POST /api/agent-tasks)이 uploadId 로 참조한다.
 *
 * - POST   /api/agent-task-uploads                    - 업로드 세션 시작 (선언)
 * - PUT    /api/agent-task-uploads/:id/chunks/:index  - 청크 전송 (octet-stream)
 * - POST   /api/agent-task-uploads/:id/complete       - 조립 완료
 * - DELETE /api/agent-task-uploads/:id                - 중단/폐기
 *
 * @module routes/agent-task-upload.routes
 */
import express, { Router, Request, Response } from 'express';
import { success, badRequest } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { AGENT_TASK_LIMITS } from '../config/runtime-limits';
import { chunkedUploadInitSchema, type ChunkedUploadInitInput } from '../schemas/agent-task.schema';
import {
    initChunkedUpload, writeChunk, completeChunkedUpload, abortChunkedUpload,
    ChunkStoreError,
} from '../services/agent-task/chunk-store';

const router = Router();
router.use(requireAuth);

/** ChunkStoreError → HTTP 매핑. 그 외는 asyncHandler 가 error-handler 로 위임. */
function sendStoreError(res: Response, e: unknown): boolean {
    if (e instanceof ChunkStoreError) {
        res.status(e.statusCode).json(badRequest(e.message));
        return true;
    }
    return false;
}

router.post('/', validate(chunkedUploadInitSchema), asyncHandler(async (req: Request, res: Response) => {
    const decl = req.body as ChunkedUploadInitInput;
    try {
        const { uploadId } = await initChunkedUpload(String(req.user!.id), decl);
        res.status(201).json(success({ uploadId, chunkMaxBytes: AGENT_TASK_LIMITS.CHUNK_MAX_BYTES }));
    } catch (e) {
        if (!sendStoreError(res, e)) throw e;
    }
}));

// 청크 본문은 octet-stream 전용 raw 파서 — 전역 express.json(1mb)은 content-type 불일치로
// 이 요청을 건드리지 않는다. 파서 상한 초과는 413 으로 떨어지며 청크 재분할로 해소 가능.
router.put(
    '/:uploadId/chunks/:index',
    express.raw({ type: 'application/octet-stream', limit: AGENT_TASK_LIMITS.CHUNK_MAX_BYTES }),
    asyncHandler(async (req: Request, res: Response) => {
        if (!Buffer.isBuffer(req.body)) {
            return res.status(400).json(badRequest('Content-Type: application/octet-stream 으로 전송하세요'));
        }
        const index = Number(req.params.index);
        try {
            await writeChunk(req.params.uploadId, String(req.user!.id), index, req.body);
            res.json(success({ received: index, bytes: req.body.length }));
        } catch (e) {
            if (!sendStoreError(res, e)) throw e;
        }
    }),
);

router.post('/:uploadId/complete', asyncHandler(async (req: Request, res: Response) => {
    try {
        const file = await completeChunkedUpload(req.params.uploadId, String(req.user!.id));
        res.json(success({ file }));
    } catch (e) {
        if (!sendStoreError(res, e)) throw e;
    }
}));

router.delete('/:uploadId', asyncHandler(async (req: Request, res: Response) => {
    try {
        await abortChunkedUpload(req.params.uploadId, String(req.user!.id));
        res.json(success({ message: '업로드가 폐기되었습니다' }));
    } catch (e) {
        if (!sendStoreError(res, e)) throw e;
    }
}));

export default router;
export { router as agentTaskUploadRouter };
