/**
 * ============================================================
 * Model Routes - 모델 정보 API 라우트
 * ============================================================
 *
 * LLM 모델 정보 조회를 위한 REST API 엔드포인트입니다.
 * model-roles 레지스트리 기반으로 실제 사용 중인 로컬 모델을 반환합니다.
 *
 * @module routes/model.routes
 * @description
 * - GET /api/model - 현재 사용 중인 로컬 모델 정보
 * - GET /api/models - 사용 가능한 모델 목록 (model-roles 기반 단일 모델)
 * - GET /api/models/health - 모델 헬스체크 (admin only, 로컬 모델 환경에서는 stub)
 */

import { Router, Request, Response } from 'express';
import { success } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { createLogger } from '../utils/logger';
import { getModelForRole } from '../config/model-roles';
import { MODEL_CAPABILITY_PRESETS } from '../config/model-defaults';
import { requireAuth, requireAdmin, optionalAuth } from '../auth';
import { getModelHealthMonitor } from '../services/model-health-monitor';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import { OpenAICompatProvider } from '../providers/openai-compat-provider';
import { buildFullModelId } from '../providers/i-provider';
import { getProviderCatalogEntry } from '../config/external-providers';

const router = Router();
const logger = createLogger('ModelRoutes');

/**
 * Provider 별 fallback 모델 목록 — `/v1/models` API 호출 실패 또는 빈 배열 반환 시
 * 사용자가 채팅을 시작할 수 있도록 제공하는 known 모델 카탈로그.
 *
 * 모델 카탈로그는 No-Hardcoding 정책에 따라 `config/external-providers.ts` 의
 * `EXTERNAL_PROVIDER_CATALOG[].fallbackModels` 에 외부화되어 있습니다.
 */
function getProviderFallbackModels(
    providerId: string,
): Array<{ id: string; fullId: string; displayName: string; capabilities: Record<string, boolean>; isFree?: boolean }> {
    const entry = getProviderCatalogEntry(providerId);
    if (!entry?.fallbackModels?.length) return [];
    return entry.fallbackModels.map(m => ({
        id: m.id,
        fullId: buildFullModelId(providerId, m.id),
        displayName: m.displayName,
        capabilities: m.capabilities,
        isFree: m.isFree ?? false,
    }));
}

/**
 * GET /model
 * 현재 모델 정보 API (프론트엔드 settings.js 호출용)
 * model-roles 레지스트리의 chat 역할 모델을 반환합니다.
 */
router.get('/model', asyncHandler(async (_req: Request, res: Response) => {
    const modelId = getModelForRole('chat');
    res.json(success({
        model: modelId,
        modelId,
        provider: 'ollama-local'
    }));
}));

/**
 * GET /models
 * 사용 가능한 모델 목록 API
 * model-roles 레지스트리의 chat 역할 모델을 반환합니다.
 * capabilities 는 MODEL_CAPABILITY_PRESETS 의 가장 긴 prefix 매칭으로 조회합니다.
 */
router.get('/models', optionalAuth, asyncHandler(async (req: Request, res: Response) => {
    const chatModel = getModelForRole('chat');

    // MODEL_CAPABILITY_PRESETS에서 가장 긴 prefix 매칭으로 capabilities 조회
    const lower = chatModel.toLowerCase();
    let caps = { toolCalling: true, thinking: false, vision: false, streaming: true };
    let bestPrefix = '';
    for (const [prefix, presetCaps] of Object.entries(MODEL_CAPABILITY_PRESETS)) {
        if (lower.includes(prefix) && prefix.length > bestPrefix.length) {
            bestPrefix = prefix;
            caps = presetCaps;
        }
    }

    type ModelEntry = {
        name: string;
        modelId: string;
        description: string;
        provider: string;
        capabilities: {
            executionStrategy: 'single';
            thinking: 'off' | 'medium';
            discussion: boolean;
            vision: boolean;
            toolCalling: boolean;
            streaming: boolean;
        };
        isFree?: boolean;
        pricing?: { input: number; output: number };
    };

    const models: ModelEntry[] = [{
        name: chatModel,
        modelId: buildFullModelId('ollama', chatModel),
        description: `Local Ollama model (${chatModel})`,
        provider: 'ollama',
        capabilities: {
            executionStrategy: 'single',
            thinking: caps.thinking ? 'medium' : 'off',
            discussion: false,
            vision: caps.vision,
            toolCalling: caps.toolCalling,
            streaming: caps.streaming,
        },
    }];

    // 인증된 사용자는 외부 provider 키 등록분도 추가.
    // optionalAuth 가 PublicUser(id) 를 req.user 에 부착 — JWT payload(userId)가 아님.
    // 둘 다 체크 (방어적): JWT payload 변형 또는 다른 미들웨어 변형 대응.
    const userObj = req.user as Record<string, unknown> | undefined;
    const userId = userObj
        ? String(userObj.id ?? userObj.userId ?? '') || null
        : null;
    if (userId) {
        try {
            const repo = new ExternalKeysRepository(getPool());
            const userKeys = await repo.listByUser(userId);
            for (const keyRow of userKeys) {
                // openai-compatible 분기: provider 의 /v1/models 호출 (TTL 캐시 + 실패 격리)
                if (keyRow.sdkType === 'openai-compatible' && keyRow.baseUrl) {
                    try {
                        // 캐시 우선 조회 (EXTERNAL_MODELS_CACHE_TTL_MS, 기본 1h)
                        const cacheTtlMs = parseInt(
                            process.env.EXTERNAL_MODELS_CACHE_TTL_MS ?? '3600000',
                            10,
                        );
                        type CachedModel = {
                            id: string;
                            fullId: string;
                            displayName: string;
                            capabilities: Record<string, boolean>;
                            isFree?: boolean;
                            pricing?: { input: number; output: number };
                        };
                        const cached = await repo.getCachedModels(userId, keyRow.providerId, cacheTtlMs);
                        let list: CachedModel[] | null = cached as CachedModel[] | null;

                        if (!list || list.length === 0) {
                            const plaintextKey = await repo.decryptKey(userId, keyRow.providerId);
                            if (!plaintextKey) continue;
                            const provider = new OpenAICompatProvider({
                                providerId: keyRow.providerId,
                                apiKey: plaintextKey,
                                baseUrl: keyRow.baseUrl,
                            });
                            const fresh = await provider.listModels();
                            list = fresh.map((m) => ({
                                id: m.id,
                                fullId: m.fullId,
                                displayName: m.displayName,
                                capabilities: m.capabilities as unknown as Record<string, boolean>,
                                isFree: m.isFree,
                                pricing: m.pricing,
                            }));
                            // 빈 배열은 캐싱 안 함 (stale 영구화 방지) + provider별 fallback 모델 보강
                            if (list.length === 0) {
                                list = getProviderFallbackModels(keyRow.providerId);
                                if (list.length > 0) {
                                    logger.warn(`${keyRow.providerId} /v1/models 빈 배열 — fallback ${list.length}개 사용 (캐싱 skip)`);
                                }
                            } else {
                                await repo.putCachedModels(userId, keyRow.providerId, list);
                            }
                        }

                        const catalogDisplay = getProviderCatalogEntry(keyRow.providerId)?.displayName ?? keyRow.providerId;
                        if (!list) continue;
                        for (const m of list) {
                            const caps = m.capabilities;
                            models.push({
                                name: m.displayName,
                                modelId: m.fullId,
                                description: `${catalogDisplay} — BYO key`,
                                provider: keyRow.providerId,
                                capabilities: {
                                    executionStrategy: 'single',
                                    thinking: caps.thinking ? 'medium' : 'off',
                                    discussion: false,
                                    vision: !!caps.vision,
                                    toolCalling: !!caps.toolCalling,
                                    streaming: !!caps.streaming,
                                },
                                isFree: m.isFree,
                                pricing: m.pricing,
                            });
                        }
                    } catch (err) {
                        logger.warn(`${keyRow.providerId} /v1/models 조회 실패: ${err instanceof Error ? err.message : err}`);
                    }
                }
            }
        } catch (err) {
            logger.warn(`외부 모델 카탈로그 조회 실패: ${err instanceof Error ? err.message : err}`);
        }
    }

    res.json(success({
        defaultModel: buildFullModelId('ollama', chatModel),
        models,
    }));
}));

// ============================================================
// Cloud 모델 헬스체크 (ModelHealthMonitor 서비스에 위임)
// ============================================================

/**
 * GET /models/health
 *
 * Cloud 모델 × API Key 매트릭스를 실측 ping합니다.
 *
 * Query:
 *  - full=true   : 모든 키 × 모든 모델 (기본: 현재 활성 키 1개)
 *  - model=<tag> : 특정 모델만 체크
 *  - timeout=<ms>: 개별 요청 타임아웃 (기본 30000, 최대 60000)
 *
 * Auth: requireAuth + requireAdmin (대량 API 호출 비용 방지)
 */
router.get(
    '/models/health',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const full = req.query.full === 'true';
        const modelFilter = typeof req.query.model === 'string' ? req.query.model : undefined;
        const rawTimeout = Number(req.query.timeout);
        const timeoutMs = Number.isFinite(rawTimeout) ? rawTimeout : undefined;

        try {
            const snapshot = await getModelHealthMonitor().runCheck({
                full,
                model: modelFilter,
                timeoutMs,
            });
            res.json(success(snapshot));
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('헬스체크 실행 실패:', message);
            res.status(503).json({ success: false, error: message });
        }
    }),
);

/**
 * GET /models/health/snapshot
 *
 * 주기 스케줄러가 저장한 최신 스냅샷을 즉시 반환합니다 (ping 안 함).
 * Admin UI의 자동 새로고침에 사용합니다.
 */
router.get(
    '/models/health/snapshot',
    requireAuth,
    requireAdmin,
    asyncHandler(async (_req: Request, res: Response) => {
        const snapshot = getModelHealthMonitor().getSnapshot();
        if (!snapshot) {
            res.json(
                success({
                    available: false,
                    message: '아직 헬스체크 스냅샷이 생성되지 않았습니다. 주기 스케줄러 실행을 기다리거나 /models/health로 즉시 실행하세요.',
                }),
            );
            return;
        }
        res.json(success({ available: true, ...snapshot }));
    }),
);

export default router;
