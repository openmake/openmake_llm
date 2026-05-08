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
import { requireAuth, requireAdmin } from '../auth';
import { getModelHealthMonitor } from '../services/model-health-monitor';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import { AnthropicProvider } from '../providers/anthropic-provider';
import { OpenAICompatProvider } from '../providers/openai-compat-provider';
import { buildFullModelId } from '../providers/i-provider';
import { getProviderCatalogEntry } from '../config/external-providers';

const router = Router();
const logger = createLogger('ModelRoutes');

/**
 * Provider 별 fallback 모델 목록 — `/v1/models` API 호출 실패 또는 빈 배열 반환 시
 * 사용자가 채팅을 시작할 수 있도록 제공하는 known 모델 카탈로그.
 *
 * Gemini OpenAI 호환 endpoint 등 일부 provider 가 `/v1/models` 미구현인 경우 대응.
 */
function getProviderFallbackModels(
    providerId: string,
): Array<{ id: string; fullId: string; displayName: string; capabilities: Record<string, boolean> }> {
    const KNOWN_MODELS: Record<string, Array<{ id: string; displayName: string; capabilities: Record<string, boolean> }>> = {
        gemini: [
            { id: 'gemini-2.5-pro',           displayName: 'Gemini 2.5 Pro',           capabilities: { streaming: true, toolCalling: true, vision: true, thinking: false, embedding: false } },
            { id: 'gemini-2.5-flash',         displayName: 'Gemini 2.5 Flash',         capabilities: { streaming: true, toolCalling: true, vision: true, thinking: false, embedding: false } },
            { id: 'gemini-2.0-flash-exp',     displayName: 'Gemini 2.0 Flash (Exp)',   capabilities: { streaming: true, toolCalling: true, vision: true, thinking: false, embedding: false } },
        ],
        openrouter: [
            { id: 'openai/gpt-5',                    displayName: 'GPT-5',                       capabilities: { streaming: true, toolCalling: true, vision: true, thinking: false, embedding: false } },
            { id: 'anthropic/claude-opus-4.5',       displayName: 'Claude Opus 4.5',             capabilities: { streaming: true, toolCalling: true, vision: true, thinking: true, embedding: false } },
            { id: 'anthropic/claude-sonnet-4.6',     displayName: 'Claude Sonnet 4.6',           capabilities: { streaming: true, toolCalling: true, vision: true, thinking: true, embedding: false } },
            { id: 'google/gemini-2.5-pro',           displayName: 'Gemini 2.5 Pro (via OR)',     capabilities: { streaming: true, toolCalling: true, vision: true, thinking: false, embedding: false } },
            { id: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B',             capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
            { id: 'deepseek/deepseek-r1',            displayName: 'DeepSeek R1',                 capabilities: { streaming: true, toolCalling: true, vision: false, thinking: true, embedding: false } },
        ],
        groq: [
            { id: 'llama-3.3-70b-versatile',  displayName: 'Llama 3.3 70B (Versatile)',  capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
            { id: 'llama-3.1-8b-instant',     displayName: 'Llama 3.1 8B (Instant)',     capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
        ],
        together: [
            { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',  displayName: 'Llama 3.3 70B Turbo',  capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
            { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',           displayName: 'Qwen 2.5 72B Turbo',   capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
        ],
        mistral: [
            { id: 'mistral-large-latest',     displayName: 'Mistral Large',     capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
            { id: 'mistral-medium-latest',    displayName: 'Mistral Medium',    capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
            { id: 'codestral-latest',         displayName: 'Codestral',         capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false, embedding: false } },
        ],
        cohere: [
            { id: 'command-r-plus',           displayName: 'Command R+',        capabilities: { streaming: true, toolCalling: false, vision: false, thinking: false, embedding: false } },
            { id: 'command-r',                displayName: 'Command R',         capabilities: { streaming: true, toolCalling: false, vision: false, thinking: false, embedding: false } },
        ],
    };
    const known = KNOWN_MODELS[providerId];
    if (!known) return [];
    return known.map(m => ({
        id: m.id,
        fullId: buildFullModelId(providerId, m.id),
        displayName: m.displayName,
        capabilities: m.capabilities,
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
router.get('/models', asyncHandler(async (req: Request, res: Response) => {
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

    // 인증된 사용자는 외부 provider 키 등록분도 추가
    const userId = req.user && 'userId' in req.user
        ? (req.user as { userId: string }).userId
        : null;
    if (userId) {
        try {
            const repo = new ExternalKeysRepository(getPool());
            const userKeys = await repo.listByUser(userId);
            for (const keyRow of userKeys) {
                if (keyRow.sdkType === 'anthropic') {
                    const provider = new AnthropicProvider({ apiKey: 'placeholder', baseUrl: keyRow.baseUrl });
                    const list = await provider.listModels();
                    for (const m of list) {
                        models.push({
                            name: m.displayName,
                            modelId: m.fullId,
                            description: 'Anthropic — BYO key',
                            provider: 'anthropic',
                            capabilities: {
                                executionStrategy: 'single',
                                thinking: m.capabilities.thinking ? 'medium' : 'off',
                                discussion: false,
                                vision: m.capabilities.vision,
                                toolCalling: m.capabilities.toolCalling,
                                streaming: m.capabilities.streaming,
                            },
                        });
                    }
                }
                // openai-compatible 분기: provider 의 /v1/models 호출 (TTL 캐시 + 실패 격리)
                if (keyRow.sdkType === 'openai-compatible' && keyRow.baseUrl) {
                    try {
                        // 캐시 우선 조회 (EXTERNAL_MODELS_CACHE_TTL_MS, 기본 1h)
                        const cacheTtlMs = parseInt(
                            process.env.EXTERNAL_MODELS_CACHE_TTL_MS ?? '3600000',
                            10,
                        );
                        type CachedModel = { id: string; fullId: string; displayName: string; capabilities: Record<string, boolean> };
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
