/**
 * 인바운드 웹훅 트리거 라우트 (F16.5, 2026-09-17, 마이그레이션 132)
 *
 * 관리(인증, mount `/api/agent-task-triggers`):
 *   GET    /                    내 트리거 목록(시크릿 없음)
 *   POST   /                    { name, templateId, approvalPolicy? } — 시크릿은 이 응답에 1회만
 *   PATCH  /:id                 { name?, enabled?, approvalPolicy? }
 *   POST   /:id/rotate-secret   새 시크릿 1회 노출
 *   DELETE /:id
 *
 * 수신(무인증, mount `/api/triggers` — 원문 본문 파서·CSRF 예외는 middlewares/setup·config/security):
 *   POST   /:triggerId          X-Openmake-Timestamp + X-Openmake-Signature(sha256=HMAC) [+ X-Openmake-Delivery]
 *     202 { taskId, queued } · 같은 전달 id 재전송 200 { duplicate } · 서명·만료·없음·비활성 모두 401(구분 안 함) · 발화 실패 422
 *
 * @module routes/agent-task-trigger.routes
 */
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../auth';
import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { validate } from '../middlewares/validation';
import { asyncHandler, AppError, ValidationError } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { encryptToken, decryptToken, isDecryptionFailure } from '../utils/token-crypto';
import { getPool } from '../data/models/unified-database';
import { AgentTaskTriggerRepository, type AgentTaskTrigger } from '../data/repositories/agent-task-trigger-repository';
import { AgentTaskTemplateRepository } from '../data/repositories/agent-task-template-repository';
import { TRIGGER_LIMITS } from '../config/runtime-limits';
import {
    generateTriggerSecret, verifyTriggerSignature, fireTrigger, templateReadable, TriggerFireError, TRIGGER_SIGNATURE_PREFIX,
} from '../services/agent-task/trigger-service';

const logger = createLogger('AgentTaskTriggerRoutes');
const repo = (): AgentTaskTriggerRepository => new AgentTaskTriggerRepository(getPool());

const APPROVAL_POLICIES = ['all', 'high-risk', 'none'] as const;
const createSchema = z.strictObject({
    name: z.string().trim().min(1).max(100),
    templateId: z.string().trim().min(1).max(200),
    approvalPolicy: z.enum(APPROVAL_POLICIES).optional(),
});
const updateSchema = z.strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    enabled: z.boolean().optional(),
    approvalPolicy: z.enum(APPROVAL_POLICIES).optional(),
});

/** 보내는 쪽이 알아야 할 서명 규칙 — 생성·재발급 응답에 함께 싣는다. */
function signingGuide(id: string) {
    return {
        endpoint: `/api/triggers/${id}`,
        timestampHeader: 'X-Openmake-Timestamp',
        signatureHeader: 'X-Openmake-Signature',
        deliveryHeader: 'X-Openmake-Delivery',
        scheme: `${TRIGGER_SIGNATURE_PREFIX}hex(HMAC-SHA256(secret, "<timestamp>.<raw body>"))`,
        windowSec: TRIGGER_LIMITS.SIGNATURE_WINDOW_SEC,
    };
}

async function loadOwned(req: Request, id: string): Promise<AgentTaskTrigger> {
    const t = await repo().get(id);
    if (!t) throw new AppError('트리거를 찾을 수 없습니다.', 404, true, 'NOT_FOUND');
    assertResourceOwnerOrAdmin(String(t.user_id), String(req.user!.id), req.user!.role || 'user');
    return t;
}

export const agentTaskTriggerRouter = Router();
agentTaskTriggerRouter.use(requireAuth);

agentTaskTriggerRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
    res.json(success({ triggers: await repo().listByUser(String(req.user!.id)) }));
}));

agentTaskTriggerRouter.post('/', validate(createSchema), asyncHandler(async (req: Request, res: Response) => {
    const userId = String(req.user!.id);
    const body = req.body as z.infer<typeof createSchema>;
    if (await repo().countByUser(userId) >= TRIGGER_LIMITS.MAX_PER_USER) throw new ValidationError(`트리거는 사용자당 ${TRIGGER_LIMITS.MAX_PER_USER}개까지입니다.`);
    const template = await new AgentTaskTemplateRepository(getPool()).get(body.templateId);
    if (!template || !(await templateReadable(template, userId))) throw new ValidationError('사용할 수 없는 템플릿입니다.');
    const id = uuidv4();
    const secret = generateTriggerSecret();
    await repo().create({ id, userId, templateId: body.templateId, name: body.name, secretEncrypted: encryptToken(secret), approvalPolicy: body.approvalPolicy ?? 'all' });
    logger.info(`[Trigger] 생성: ${id} (user ${userId}, template ${body.templateId})`);
    res.status(201).json(success({ trigger: await repo().get(id), secret, signing: signingGuide(id) }));
}));

agentTaskTriggerRouter.patch('/:id', validate(updateSchema), asyncHandler(async (req: Request, res: Response) => {
    const t = await loadOwned(req, req.params.id);
    await repo().update(t.id, req.body as z.infer<typeof updateSchema>);
    res.json(success({ trigger: await repo().get(t.id) }));
}));

agentTaskTriggerRouter.post('/:id/rotate-secret', asyncHandler(async (req: Request, res: Response) => {
    const t = await loadOwned(req, req.params.id);
    const secret = generateTriggerSecret();
    await repo().rotateSecret(t.id, encryptToken(secret));
    logger.info(`[Trigger] 시크릿 재발급: ${t.id} (by ${req.user!.id})`);
    res.json(success({ trigger: await repo().get(t.id), secret, signing: signingGuide(t.id) }));
}));

agentTaskTriggerRouter.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
    const t = await loadOwned(req, req.params.id);
    await repo().delete(t.id);
    res.json(success({ id: t.id, deleted: true }));
}));

/** 트리거별 분당 상한 — 서명 검증 전에 건다(무효 요청 폭주도 DB·HMAC 비용이다). */
const receiverLimiter = rateLimit({
    windowMs: 60_000,
    limit: TRIGGER_LIMITS.PER_MINUTE,
    keyGenerator: (req: Request) => `trigger:${req.params.triggerId}`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response): void => {
        res.status(429).json({ success: false, error: 'TRIGGER_RATE_LIMIT', message: '트리거 호출 속도 제한에 걸렸습니다.' });
    },
});

const UNAUTHORIZED = (): AppError => new AppError('서명을 확인할 수 없습니다.', 401, true, 'TRIGGER_SIGNATURE_INVALID');

export const triggerReceiverRouter = Router();

triggerReceiverRouter.post('/:triggerId', receiverLimiter, asyncHandler(async (req: Request, res: Response) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const trigger = await repo().getForVerification(req.params.triggerId);
    const secret = trigger?.enabled ? decryptToken(trigger.secret_encrypted) : '';
    const verdict = trigger?.enabled && secret && !isDecryptionFailure(secret)
        ? verifyTriggerSignature({ secret, timestamp: req.get('X-Openmake-Timestamp'), signature: req.get('X-Openmake-Signature'), rawBody, nowMs: Date.now() })
        : 'bad';
    if (verdict !== 'ok') {
        logger.warn(`[Trigger] 수신 거부(${trigger ? (trigger.enabled ? verdict : 'disabled') : 'unknown'}): ${req.params.triggerId}`);
        throw UNAUTHORIZED();
    }
    const deliveryId = req.get('X-Openmake-Delivery')?.slice(0, 200) || undefined;
    if (!(await repo().claimDelivery(trigger!.id, deliveryId))) {
        res.status(200).json(success({ duplicate: true, deliveryId }));
        return;
    }
    try {
        const { taskId, queued } = await fireTrigger(trigger!, rawBody);
        logger.info(`[Trigger] 발화: ${trigger!.id} → task ${taskId}${queued ? ' (대기열)' : ''}`);
        res.status(202).json(success({ taskId, queued }));
    } catch (e) {
        const reason = e instanceof TriggerFireError ? e.message : 'task_create_failed';
        const { disabled } = await repo().recordFailure(trigger!.id, e instanceof Error ? e.message : String(e), TRIGGER_LIMITS.DISABLE_AFTER_FAILURES);
        logger.warn(`[Trigger] 발화 실패: ${trigger!.id} — ${e instanceof Error ? e.message : e}${disabled ? ' (연속 실패로 비활성)' : ''}`);
        throw new AppError(`트리거를 실행하지 못했습니다(${reason}).`, 422, true, 'TRIGGER_FIRE_FAILED');
    }
}));
