/**
 * MCP server Git ingest REST 라우터 (Phase 4).
 *
 * 엔드포인트:
 *   POST /import-from-git       — Git URL → draft INSERT
 *   GET  /drafts                — 본인 draft 목록
 *   POST /:id/approve           — draft → active (+ env override)
 *   POST /:id/reject            — draft → archived
 *
 * 보안:
 *   - 모든 엔드포인트 인증 필수 (req.userId 가정 — 상위 미들웨어가 처리)
 *   - approve/reject 는 본인 또는 admin
 *   - blockedByConvention=true 인 draft 는 approve 거부 (409)
 *   - required_env 의 모든 키는 placeholder 가 아닌 값으로 채워져야 함 (422)
 *
 * Rate limit: RL_MCP_INGEST (역할별 시간당 한도 — 남용 방지). import-from-git 만 적용.
 *
 * @module routes/mcp-server-ingest.routes
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { LLMClient } from '../llm/client';
import type { GitFetcher } from '../agents/git-ingest/git-fetcher';
import {
    importMcpServerFromGitSchema,
    approveMcpServerDraftSchema,
} from '../schemas/mcp-server-ingest.schema';
import { McpServerIngestService } from '../agents/git-ingest/mcp-server-ingest-service';
import { McpServerDraftRepository } from '../data/repositories/mcp-server-draft-repository';
import { RL_MCP_INGEST } from '../config/rate-limits';
import { MCP_INGEST } from '../config/constants';
import { createLogger } from '../utils/logger';
import { requireAuth } from '../auth';

const logger = createLogger('McpServerIngestRoutes');

export interface McpServerIngestRouterDeps {
    pool: Pool;
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
    llmClientFactory: (model: string) => LLMClient;
}

type McpIngestRole = 'user' | 'admin';

function resolveIngestRole(req: Request): McpIngestRole {
    return req.user?.role === 'admin' ? 'admin' : 'user';
}

function mcpIngestKey(req: Request): string {
    const uid = req.user
        ? ('userId' in req.user ? (req.user as { userId: string }).userId : req.user.id?.toString())
        : undefined;
    return uid ? `mcp-ingest:user:${uid}` : `mcp-ingest:ip:${ipKeyGenerator(req.ip || 'unknown')}`;
}

const mcpIngestLimiter = rateLimit({
    windowMs: RL_MCP_INGEST.windowMs,
    limit: (req: Request): number => RL_MCP_INGEST.limits[resolveIngestRole(req)],
    keyGenerator: mcpIngestKey,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response): void => {
        res.status(429).json({
            success: false,
            error: 'MCP_INGEST_RATE_LIMIT',
            message: 'MCP server import 요청 속도 제한에 걸렸습니다. 잠시 후 다시 시도하세요.',
        });
    },
    skipFailedRequests: true,
});

/**
 * Placeholder 검증 — env 값이 `${...}` 형태이거나 빈 문자열이면 placeholder.
 */
function isPlaceholder(value: string | undefined | null): boolean {
    if (!value) return true;
    return /^\$\{.+\}$/.test(value);
}

function extractUserId(req: Request): string | undefined {
    const direct = (req as Request & { userId?: string }).userId;
    if (direct) return direct;
    if (req.user) {
        if ('userId' in req.user) return (req.user as { userId: string }).userId;
        return req.user.id?.toString();
    }
    return undefined;
}

function requireMcpIngestAuth(req: Request, res: Response, next: NextFunction): void {
    if (extractUserId(req)) {
        next();
        return;
    }
    requireAuth(req, res, next).catch(next);
}

export function mcpServerIngestRouter(deps: McpServerIngestRouterDeps): Router {
    const router = Router();

    router.use(requireMcpIngestAuth);

    router.post('/import-from-git', mcpIngestLimiter, async (req: Request, res: Response) => {
        try {
            if (!MCP_INGEST.enabled) {
                res.status(503).json({ success: false, error: 'MCP_INGEST_DISABLED' });
                return;
            }
            const userId = extractUserId(req);
            const role = req.user?.role;
            if (!userId) {
                res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
                return;
            }

            const parsed = importMcpServerFromGitSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({
                    success: false,
                    error: 'VALIDATION_FAILED',
                    details: parsed.error.issues,
                });
                return;
            }

            const svc = new McpServerIngestService({
                pool: deps.pool,
                fetcherFactory: deps.fetcherFactory,
                llmClientFactory: deps.llmClientFactory,
            });

            const result = await svc.import({
                ...parsed.data,
                userId,
                isAdmin: role === 'admin',
            });
            res.json({ success: true, data: result });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`import-from-git fail: ${msg}`);
            if (msg.startsWith('INVALID_GIT_URL')) {
                res.status(400).json({ success: false, error: 'INVALID_GIT_URL' }); return;
            }
            if (msg.startsWith('NO_MCPSERVER_FOUND')) {
                res.status(404).json({ success: false, error: 'NO_MCPSERVER_FOUND' }); return;
            }
            if (msg.startsWith('INVALID_MCPSERVER_MANIFEST')) {
                res.status(422).json({ success: false, error: 'INVALID_MCPSERVER_MANIFEST', message: msg }); return;
            }
            if (msg.startsWith('DRAFT_LIMIT_EXCEEDED')) {
                res.status(429).json({ success: false, error: 'DRAFT_LIMIT_EXCEEDED' }); return;
            }
            res.status(500).json({ success: false, error: 'INGEST_FAILED', message: msg });
        }
    });

    router.get('/drafts', async (req: Request, res: Response) => {
        try {
            const userId = extractUserId(req);
            if (!userId) {
                res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
                return;
            }
            const repository = new McpServerDraftRepository(deps.pool);
            const drafts = await repository.listDrafts(userId, 50);
            res.json({ success: true, data: drafts });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ success: false, error: 'LIST_FAILED', message: msg });
        }
    });

    router.post('/:id/approve', async (req: Request, res: Response) => {
        try {
            const userId = extractUserId(req);
            const role = req.user?.role;
            if (!userId) {
                res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
                return;
            }

            const parsed = approveMcpServerDraftSchema.safeParse(req.body || {});
            if (!parsed.success) {
                res.status(400).json({ success: false, error: 'VALIDATION_FAILED', details: parsed.error.issues });
                return;
            }

            const repository = new McpServerDraftRepository(deps.pool);
            const draft = await repository.getById(req.params.id);
            if (!draft) {
                res.status(404).json({ success: false, error: 'DRAFT_NOT_FOUND' });
                return;
            }
            if (draft.user_id !== userId && role !== 'admin') {
                res.status(403).json({ success: false, error: 'FORBIDDEN' });
                return;
            }
            if (draft.status !== 'draft') {
                res.status(409).json({ success: false, error: 'NOT_DRAFT', status: draft.status });
                return;
            }

            const findings = (draft.manifest_meta as { conventionFindings?: Array<{ severity: string }> } | null)?.conventionFindings;
            const blocked = Array.isArray(findings) && findings.some(f => f.severity === 'error');
            if (blocked) {
                res.status(409).json({
                    success: false,
                    error: 'CONVENTION_BLOCKED',
                    message: '위험 명령 패턴이 감지되어 승인할 수 없습니다. 매니페스트를 수정 후 재 import 하세요.',
                });
                return;
            }

            const requiredEnv = ((draft.manifest_meta as { requiredEnv?: string[] } | null)?.requiredEnv) || [];
            const mergedEnv: Record<string, string> = { ...(draft.env || {}), ...(parsed.data.envOverrides || {}) };
            const missing = requiredEnv.filter(k => isPlaceholder(mergedEnv[k]));
            if (missing.length > 0) {
                res.status(422).json({
                    success: false,
                    error: 'REQUIRED_ENV_MISSING',
                    missing,
                });
                return;
            }

            const approved = await repository.approve({
                id: req.params.id,
                userId,
                isAdmin: role === 'admin',
                envOverrides: parsed.data.envOverrides,
                enableImmediately: parsed.data.enableImmediately !== false,
            });
            if (!approved) {
                res.status(404).json({ success: false, error: 'APPROVE_FAILED' });
                return;
            }
            logger.info(`mcp-server approved: ${req.params.id} (user=${userId})`);
            res.json({ success: true, data: approved });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ success: false, error: 'APPROVE_ERROR', message: msg });
        }
    });

    router.post('/:id/reject', async (req: Request, res: Response) => {
        try {
            const userId = extractUserId(req);
            const role = req.user?.role;
            if (!userId) {
                res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
                return;
            }

            const repository = new McpServerDraftRepository(deps.pool);
            const draft = await repository.getById(req.params.id);
            if (!draft) {
                res.status(404).json({ success: false, error: 'DRAFT_NOT_FOUND' });
                return;
            }
            if (draft.user_id !== userId && role !== 'admin') {
                res.status(403).json({ success: false, error: 'FORBIDDEN' });
                return;
            }

            const rejected = await repository.reject(req.params.id, userId, role === 'admin');
            if (!rejected) {
                res.status(409).json({ success: false, error: 'NOT_DRAFT', status: draft.status });
                return;
            }
            logger.info(`mcp-server rejected: ${req.params.id} (user=${userId})`);
            res.json({ success: true, data: rejected });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.status(500).json({ success: false, error: 'REJECT_ERROR', message: msg });
        }
    });

    return router;
}
