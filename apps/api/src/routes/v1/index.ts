/**
 * ============================================================
 * API v1 Router - 버전 1 API 라우트 집계기
 * ============================================================
 *
 * 모든 v1 라우트를 /api/v1 접두사 아래에 마운트합니다.
 * API Key 인증 사용자를 위한 Rate Limit 미들웨어(TPM, x-ratelimit-* 헤더)를
 * 전역으로 적용하며, 향후 v2 도입 시 하위 호환을 보장합니다.
 *
 * @module routes/v1/index
 * @description
 * - GET    /api/v1/models        - 모델 목록 조회
 * - GET    /api/v1/usage         - API Key 전체 사용량 요약
 * - GET    /api/v1/usage/daily   - API Key 일별 사용량
 * - /api/v1/chat, /agents, /mcp, /usage, /metrics 등 서브 라우터 마운트
 *
 * @requires requireApiKey - API Key 인증 미들웨어
 * @requires rateLimitHeaders - OpenAI 호환 Rate Limit 헤더
 * @requires apiKeyTPMLimiter - TPM(Tokens Per Minute) 이중 제한
 */
import { Router } from 'express';
import { API_KEY_LIMITS } from '../../data/models/unified-database';

// Import existing routers
import chatRouter from '../chat.routes';
import agentRouter from '../agents.routes';
import { mcpRouter } from '../mcp.routes';
import usageRouter from '../usage.routes';
import metricsRouter from '../metrics.routes';
// documentsRouter / memoryRouter: 2026-05-19 제거
import webSearchRouter from '../web-search.routes';
import nodesRouter from '../nodes.routes';
import agentsMonitoringRouter from '../agents-monitoring.routes';
import { tokenMonitoringRouter } from '../token-monitoring.routes';
import auditRouter from '../audit.routes';
import researchRouter from '../research.routes';
import externalRouter from '../external.routes';
import { pushRouter } from '../push.routes';
import apiKeysRouter from '../api-keys.routes';
import openaiCompatRouter from '../openai-compat.routes';
import { listAvailableModels } from '../../chat/profile-resolver';
import { ExternalKeysRepository } from '../../data/repositories/external-keys-repo';
import { getPool } from '../../data/models/unified-database';
import { getProviderFallbackModels, resolveExternalModels } from '../../services/external-models-catalog';
import { createLogger } from '../../utils/logger';

const v1Log = createLogger('V1Models');
import { buildFullModelId } from '../../providers/i-provider';
import { success, unauthorized } from '../../utils/api-response';
import { requireApiKey, requireScope } from '../../middlewares/api-key-auth';
import { API_KEY_SCOPES } from '../../config/api-key-scopes';
import { apiKeyRateLimiter, apiKeyTPMLimiter } from '../../middlewares/api-key-limiter';
import { asyncHandler } from '../../utils/error-handler';
import { getApiKeyService } from '../../services/ApiKeyService';

const v1Router = Router();

// §4 Rate Limit 미들웨어 — API Key 인증 요청에만 동작 (비인증 자동 스킵)
// 전역 API 인증 미들웨어
v1Router.use(requireApiKey);

// 스코프 게이트 — v1 은 외부 개발자 추론 API 면이라 'chat' 스코프를 요구한다(와일드카드 '*'
// 포함 키는 통과). CLI 브리지 전용('bridge') 키는 여기서 차단돼 토큰 소진을 못 한다.
// CLI 는 /api/v1 을 쓰지 않고 /api/local-bridge·/api/agent-tasks 만 쓴다.
v1Router.use(requireScope(API_KEY_SCOPES.CHAT));

// API 키 기반 RPM 제한 (인증 이후에 적용되어 키 단위 카운트 보장)
v1Router.use(apiKeyRateLimiter);

// API 키 기반 TPM 제한 (인증 이후에 적용해야 사용자별 토큰 소비를 추적 가능)
// BUG-R4-001: requireApiKey 아래로 평가 순서 변경
v1Router.use(apiKeyTPMLimiter);

// ── 외부 API Key 사용자용 사용량 엔드포인트 ──
// NOTE: usageRouter보다 먼저 등록해야 Express가 API Key 핸들러를 우선 매칭함

/**
 * GET /api/v1/usage — API Key 전체 사용량 요약
 * 인증: API Key (X-API-Key 또는 Bearer)
 */
v1Router.get('/usage', requireApiKey, asyncHandler(async (req, res) => {
    const keyId = req.apiKeyId;
    const keyRecord = req.apiKeyRecord;

    if (!keyId || !keyRecord) {
        res.status(401).json(unauthorized('API Key required'));
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
            rpm: API_KEY_LIMITS.rpm,
            tpm: API_KEY_LIMITS.tpm,
            daily_requests: API_KEY_LIMITS.dailyRequests,
            monthly_requests: API_KEY_LIMITS.monthlyRequests,
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
        res.status(401).json(unauthorized('API Key required'));
        return;
    }

    const days = parseInt(req.query.days as string) || 7;
    const service = getApiKeyService();
    const stats = await service.getUsageStats(keyId, keyRecord.user_id);

    res.json(success({
        period: `last_${days}_days`,
        usage: {
            total_requests: stats?.totalRequests ?? 0,
            total_tokens: stats?.totalTokens ?? 0,
            last_used_at: stats?.lastUsedAt ?? null,
        },
        limits: {
            rpm: API_KEY_LIMITS.rpm,
            tpm: API_KEY_LIMITS.tpm,
            daily_requests: API_KEY_LIMITS.dailyRequests,
            monthly_requests: API_KEY_LIMITS.monthlyRequests,
        },
    }));
}));

// Mount all routes under v1
v1Router.use('/', openaiCompatRouter);
v1Router.use('/chat', chatRouter);
v1Router.use('/agents', agentRouter);
v1Router.use('/mcp', mcpRouter);
v1Router.use('/usage', usageRouter);
v1Router.use('/metrics', metricsRouter);
v1Router.use('/search', webSearchRouter);
v1Router.use('/nodes', nodesRouter);
v1Router.use('/monitoring', tokenMonitoringRouter);
v1Router.use('/agents-monitoring', agentsMonitoringRouter);
v1Router.use('/audit', auditRouter);
v1Router.use('/research', researchRouter);
v1Router.use('/external', externalRouter);
v1Router.use('/push', pushRouter);
v1Router.use('/api-keys', apiKeysRouter);

// §9 모델 목록 (외부 API Key 사용자용)
v1Router.get('/models', asyncHandler(async (req, res) => {
    const created = Math.floor(Date.now() / 1000);
    const models = listAvailableModels();
    const data: Array<Record<string, unknown>> = models.map(m => ({
        id: m.id,
        object: 'model',
        created,
        owned_by: 'openmake',
        name: m.name,
        description: m.description,
        capabilities: m.capabilities,
    }));

    // 외부 provider 모델 노출 (Phase 2, 2026-07-26): API 키 사용자가 등록한
    // BYO/OAuth provider 의 모델을 fullId 로 나열 — CLI/서드파티 클라이언트가
    // /v1/models 디스커버리만으로 'chatgpt:*' 등을 선택할 수 있게 한다.
    // 캐시(external_provider_models_cache, TTL) → 만료 시 provider 라이브 조회(+캐시 갱신) → fallback.
    // 웹 /api/models 와 같은 규칙(services/external-models-catalog). provider 하나의 실패는 fallback 으로 격리.
    const apiUserId = req.apiKeyRecord?.user_id?.toString() || null;
    if (apiUserId) {
        try {
            const repo = new ExternalKeysRepository(getPool());
            const keys = await repo.listByUser(apiUserId);
            // 실사용 불가 모델 제외 (083) — /api/models 와 동일 규칙
            const unusable = await repo.listUnusableModels(apiUserId).catch(() => new Set<string>());
            for (const keyRow of keys) {
                let list: Array<{ id?: string; fullId?: string }> | null;
                try {
                    list = await resolveExternalModels(repo, apiUserId, keyRow);
                } catch (err) {
                    v1Log.warn(`${keyRow.providerId} 모델 조회 실패 — fallback 사용: ${err instanceof Error ? err.message : err}`);
                    list = getProviderFallbackModels(keyRow.providerId);
                }
                if (!list) continue;
                for (const m of list) {
                    const fullId = m.fullId ?? buildFullModelId(keyRow.providerId, m.id ?? '');
                    if (!fullId) continue;
                    if (unusable.has(fullId)) continue;
                    data.push({
                        id: fullId,
                        object: 'model',
                        created,
                        owned_by: keyRow.providerId,
                    });
                }
            }
        } catch {
            // 외부 카탈로그 조회 실패는 로컬 목록 응답을 막지 않는다 (fail-open)
        }
    }

    res.json({ object: 'list', data });
}));

export default v1Router;
