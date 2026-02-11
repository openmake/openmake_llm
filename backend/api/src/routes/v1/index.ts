/**
 * API v1 Router
 * Aggregates all v1 routes with /api/v1 prefix
 * 
 * This router provides backward compatibility while establishing
 * a versioned API structure for future versions.
 */
import { Router } from 'express';

// Import existing routers
import chatRouter from '../chat.routes';
import agentRouter from '../agents.routes';
import { mcpRouter } from '../mcp.routes';
import usageRouter from '../usage.routes';
import metricsRouter from '../metrics.routes';
import documentsRouter from '../documents.routes';
import webSearchRouter from '../web-search.routes';
import nodesRouter from '../nodes.routes';
import agentsMonitoringRouter from '../agents-monitoring.routes';
import { tokenMonitoringRouter } from '../token-monitoring.routes';
import { memoryRouter } from '../memory.routes';
import auditRouter from '../audit.routes';
import researchRouter from '../research.routes';
import canvasRouter from '../canvas.routes';
import externalRouter from '../external.routes';
import marketplaceRouter from '../marketplace.routes';
import { pushRouter } from '../push.routes';
import apiKeysRouter from '../api-keys.routes';
import { listAvailableModels } from '../../chat/profile-resolver';
import { success } from '../../utils/api-response';
import { requireApiKey } from '../../middlewares/api-key-auth';
import { rateLimitHeaders } from '../../middlewares/rate-limit-headers';
import { apiKeyTPMLimiter } from '../../middlewares/api-key-limiter';
import { asyncHandler } from '../../utils/error-handler';
import { getApiKeyService } from '../../services/ApiKeyService';

const v1Router = Router();

// §4 Rate Limit 미들웨어 — API Key 인증 요청에만 동작 (비인증 자동 스킵)
v1Router.use(rateLimitHeaders);     // OpenAI 호환 x-ratelimit-* 헤더
v1Router.use(apiKeyTPMLimiter);     // TPM 이중 제한

// Mount all routes under v1
v1Router.use('/chat', chatRouter);
v1Router.use('/agents', agentRouter);
v1Router.use('/mcp', mcpRouter);
v1Router.use('/usage', usageRouter);
v1Router.use('/metrics', metricsRouter);
v1Router.use('/documents', documentsRouter);
v1Router.use('/search', webSearchRouter);
v1Router.use('/nodes', nodesRouter);
v1Router.use('/monitoring', tokenMonitoringRouter);
v1Router.use('/agents-monitoring', agentsMonitoringRouter);
v1Router.use('/memory', memoryRouter);
v1Router.use('/audit', auditRouter);
v1Router.use('/research', researchRouter);
v1Router.use('/canvas', canvasRouter);
v1Router.use('/external', externalRouter);
v1Router.use('/marketplace', marketplaceRouter);
v1Router.use('/push', pushRouter);
v1Router.use('/api-keys', apiKeysRouter);

// §9 Brand Model 목록 (외부 API Key 사용자용)
v1Router.get('/models', (_req, res) => {
    const models = listAvailableModels();
    res.json(success({
        object: 'list',
        data: models.map(m => ({
            id: m.id,
            object: 'model',
            name: m.name,
            description: m.description,
            capabilities: m.capabilities,
        })),
    }));
});

// ── 외부 API Key 사용자용 사용량 엔드포인트 ──

/**
 * GET /api/v1/usage — API Key 전체 사용량 요약
 * 인증: API Key (X-API-Key 또는 Bearer)
 */
v1Router.get('/usage', requireApiKey, asyncHandler(async (req, res) => {
    const keyId = req.apiKeyId;
    const keyRecord = req.apiKeyRecord;

    if (!keyId || !keyRecord) {
        res.status(401).json(success({ error: 'API Key required' }));
        return;
    }

    const service = getApiKeyService();
    const stats = await service.getUsageStats(keyId, keyRecord.user_id);

    res.json(success({
        usage: {
            total_requests: stats?.totalRequests ?? 0,
            total_tokens: stats?.totalTokens ?? 0,
            last_used_at: stats?.lastUsedAt ?? null,
        },
        limits: {
            tier: keyRecord.rate_limit_tier || 'free',
        },
    }));
}));

/**
 * GET /api/v1/usage/daily — API Key 일별 사용량
 * 인증: API Key (X-API-Key 또는 Bearer)
 * 쿼리: ?days=7
 */
v1Router.get('/usage/daily', requireApiKey, asyncHandler(async (req, res) => {
    const keyId = req.apiKeyId;
    const keyRecord = req.apiKeyRecord;

    if (!keyId || !keyRecord) {
        res.status(401).json(success({ error: 'API Key required' }));
        return;
    }

    const days = parseInt(req.query.days as string) || 7;
    const service = getApiKeyService();
    const stats = await service.getUsageStats(keyId, keyRecord.user_id);

    // 현재 DB에는 일별 분리 통계가 없으므로 전체 통계를 반환하고
    // 향후 daily breakdown 테이블 추가 시 확장 예정
    res.json(success({
        period: `last_${days}_days`,
        usage: {
            total_requests: stats?.totalRequests ?? 0,
            total_tokens: stats?.totalTokens ?? 0,
            last_used_at: stats?.lastUsedAt ?? null,
        },
        limits: {
            tier: keyRecord.rate_limit_tier || 'free',
        },
    }));
}));

export default v1Router;
