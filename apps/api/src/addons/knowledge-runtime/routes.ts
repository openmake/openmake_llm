/**
 * Knowledge Space 라우트 — `/api/knowledge/*`(매니페스트가 마운트, add-on 게이트가 먼저 돈다).
 * 모든 라우트는 requireAuth(게스트 → 401). 인가는 서비스가 accessPredicate 로 SQL 안에서 판정한다.
 *
 * @module addons/knowledge-runtime/routes
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import type { ZodTypeAny } from 'zod';
import { requireAuth } from '../../auth';
import { success } from '../../utils/api-response';
import { asyncHandler, ValidationError } from '../../utils/error-handler';
import { resolveUserId, assertAdmin } from './http';
import { getDefaultLimits } from './config/profiles';
import { createSpaceSchema, updateSpaceSchema, updateProfileSchema, memoryInputSchema } from './schemas';
import * as spaces from './spaces/service';
import * as memories from './memories/service';
import * as documents from './documents/service';
import * as binding from './conversations/binding-service';
import { getChunkPreview } from './preview';
import { getCapabilities } from './capabilities';
import * as admin from './admin/service';
import { startReindex } from './embedding/index-manager';

/** Zod 파싱 — 실패하면 ValidationError(400). 첫 이슈 메시지를 사람이 읽게 붙인다. */
function parse<T>(schema: ZodTypeAny, data: unknown): T {
    const r = schema.safeParse(data);
    if (!r.success) {
        const first = r.error.issues[0];
        throw new ValidationError(`입력 검증 실패: ${first ? `${first.path.join('.') || 'body'} — ${first.message}` : '알 수 없는 오류'}`);
    }
    return r.data as T;
}

/**
 * 업로드 미들웨어 — 파일 크기 상한은 프로필(DB)에서 오므로 요청마다 기본 limits 를 읽어
 * multer 의 하드 캡으로 쓴다(정확한 space 별 상한은 서비스가 다시 검사한다). 단일 파일 파트 'file'.
 */
function uploadMiddleware(req: Request, res: Response, next: NextFunction): void {
    getDefaultLimits().then((limits) => {
        const mw = multer({
            storage: multer.memoryStorage(),
            limits: { fileSize: limits.maxFileBytes, files: 1 },
        }).single('file');
        mw(req, res, (err?: unknown) => (err ? next(err) : next()));
    }, next);
}

export const knowledgeRouter = Router();

// ── Capabilities ──
knowledgeRouter.get('/capabilities', requireAuth, asyncHandler(async (_req, res) => {
    res.json(success(await getCapabilities()));
}));

// ── Spaces ──
knowledgeRouter.get('/spaces', requireAuth, asyncHandler(async (req, res) => {
    res.json(success({ spaces: await spaces.listSpaces(resolveUserId(req)) }));
}));

knowledgeRouter.post('/spaces', requireAuth, asyncHandler(async (req, res) => {
    const body = parse<import('./schemas').CreateSpaceBody>(createSpaceSchema, req.body);
    const created = await spaces.createSpace(resolveUserId(req), body);
    res.status(201).json(success({ space: created }));
}));

knowledgeRouter.get('/spaces/:id', requireAuth, asyncHandler(async (req, res) => {
    res.json(success({ space: await spaces.getSpaceDetail(resolveUserId(req), req.params.id) }));
}));

knowledgeRouter.patch('/spaces/:id', requireAuth, asyncHandler(async (req, res) => {
    const body = parse<import('./schemas').UpdateSpaceBody>(updateSpaceSchema, req.body);
    res.json(success({ space: await spaces.updateSpace(resolveUserId(req), req.params.id, body) }));
}));

knowledgeRouter.delete('/spaces/:id', requireAuth, asyncHandler(async (req, res) => {
    await spaces.deleteSpace(resolveUserId(req), req.params.id);
    res.status(204).end();
}));

// ── Documents ──
knowledgeRouter.post('/spaces/:id/documents', requireAuth, uploadMiddleware, asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new ValidationError('업로드할 파일(file)이 없습니다');
    const doc = await documents.uploadDocument(resolveUserId(req), req.params.id, {
        buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size,
    });
    res.status(201).json(success({ document: doc }));
}));

knowledgeRouter.delete('/spaces/:id/documents/:docId', requireAuth, asyncHandler(async (req, res) => {
    await documents.deleteDocument(resolveUserId(req), req.params.id, req.params.docId);
    res.status(204).end();
}));

knowledgeRouter.post('/spaces/:id/documents/:docId/retry', requireAuth, asyncHandler(async (req, res) => {
    await documents.retryDocument(resolveUserId(req), req.params.id, req.params.docId);
    res.json(success({ retried: true }));
}));

// ── Space memories (수동 — 자동 추출 없음) ──
knowledgeRouter.get('/spaces/:id/memories', requireAuth, asyncHandler(async (req, res) => {
    res.json(success({ memories: await memories.listMemories(resolveUserId(req), req.params.id) }));
}));

knowledgeRouter.post('/spaces/:id/memories', requireAuth, asyncHandler(async (req, res) => {
    const body = parse<import('./schemas').MemoryInputBody>(memoryInputSchema, req.body);
    const memory = await memories.addMemory(resolveUserId(req), req.params.id, body.content);
    res.status(201).json(success({ memory }));
}));

knowledgeRouter.patch('/spaces/:id/memories/:memId', requireAuth, asyncHandler(async (req, res) => {
    const body = parse<import('./schemas').MemoryInputBody>(memoryInputSchema, req.body);
    const memory = await memories.updateMemory(resolveUserId(req), req.params.id, req.params.memId, body.content);
    res.json(success({ memory }));
}));

knowledgeRouter.delete('/spaces/:id/memories/:memId', requireAuth, asyncHandler(async (req, res) => {
    await memories.deleteMemory(resolveUserId(req), req.params.id, req.params.memId);
    res.status(204).end();
}));

// ── Conversation bindings ──
knowledgeRouter.post('/spaces/:id/conversations', requireAuth, asyncHandler(async (req, res) => {
    const out = await binding.createBoundConversation(resolveUserId(req), req.params.id);
    res.status(201).json(success(out));
}));

knowledgeRouter.put('/spaces/:id/conversations/:sessionId', requireAuth, asyncHandler(async (req, res) => {
    await binding.bindExistingConversation(resolveUserId(req), req.params.id, req.params.sessionId);
    res.status(204).end();
}));

knowledgeRouter.delete('/spaces/:id/conversations/:sessionId', requireAuth, asyncHandler(async (req, res) => {
    await binding.unbindConversation(resolveUserId(req), req.params.sessionId);
    res.status(204).end();
}));

knowledgeRouter.get('/bindings/:sessionId', requireAuth, asyncHandler(async (req, res) => {
    res.json(success(await binding.getBinding(resolveUserId(req), req.params.sessionId)));
}));

// ── Citation preview ──
knowledgeRouter.get('/spaces/:id/chunks/:chunkId', requireAuth, asyncHandler(async (req, res) => {
    res.json(success(await getChunkPreview(resolveUserId(req), req.params.id, req.params.chunkId)));
}));

// ── Admin (관리자 전용) ──
knowledgeRouter.get('/admin/status', requireAuth, asyncHandler(async (req, res) => {
    assertAdmin(req);
    res.json(success(await admin.getAdminStatus()));
}));

knowledgeRouter.get('/admin/profiles', requireAuth, asyncHandler(async (req, res) => {
    assertAdmin(req);
    res.json(success({ profiles: await admin.listProfiles() }));
}));

knowledgeRouter.put('/admin/profiles/:id', requireAuth, asyncHandler(async (req, res) => {
    assertAdmin(req);
    const body = parse<import('./schemas').UpdateProfileBody>(updateProfileSchema, req.body);
    res.json(success({ profile: await admin.updateProfile(req.params.id, body) }));
}));

knowledgeRouter.post('/admin/reindex', requireAuth, asyncHandler(async (req, res) => {
    assertAdmin(req);
    res.status(202).json(success(await startReindex()));
}));

knowledgeRouter.post('/admin/spaces/:id/rechunk', requireAuth, asyncHandler(async (req, res) => {
    assertAdmin(req);
    await admin.rechunkSpace(req.params.id);
    res.status(202).json(success({ queued: true }));
}));
