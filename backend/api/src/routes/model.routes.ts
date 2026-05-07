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
import { buildFullModelId } from '../providers/i-provider';

const router = Router();
const logger = createLogger('ModelRoutes');

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
        provider: 'ollama' | 'anthropic' | 'openai-compatible';
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
                // openai-compatible 은 동적 /v1/models 조회가 비용 — 사용자가 모델 직접 입력하는
                // 자유 형식으로 둠 (Phase 5 후속 개선 가능)
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
