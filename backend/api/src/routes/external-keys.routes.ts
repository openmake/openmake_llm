/**
 * ============================================================
 * External LLM Keys Routes — 외부 provider BYO API 키 관리
 * ============================================================
 *
 * Anthropic / OpenAI 호환 endpoint 등 외부 LLM provider 의 API 키를
 * 사용자별로 등록·갱신·삭제·검증하는 REST API.
 *
 * 보안 정책:
 *   - 모든 엔드포인트 JWT 인증 필수 (게스트 차단)
 *   - 평문 API 키는 등록(POST) 시에만 요청 본문으로 전달, 응답은 prefix 만 노출
 *   - base_url 입력 시 SSRF 가드(security/ssrf-guard.ts)로 사설 IP/localhost 차단
 *
 * 라우트:
 *   - GET    /api/external-keys                    — 카탈로그 + 사용자 등록 키 목록
 *   - POST   /api/external-keys/:providerId        — 키 등록/갱신 (upsert)
 *   - DELETE /api/external-keys/:providerId        — 키 비활성화 (소프트 삭제)
 *   - POST   /api/external-keys/:providerId/validate — 키 검증 (Phase 3+ 구현)
 *
 * @module routes/external-keys.routes
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest, unauthorized, notFound } from '../utils/api-response';
import { ExternalKeysRepository } from '../data/repositories/external-keys-repo';
import { getPool } from '../data/models/unified-database';
import {
    EXTERNAL_PROVIDER_CATALOG,
    getProviderCatalogEntry,
} from '../config/external-providers';
import { validateOutboundUrl } from '../security/ssrf-guard';
import { AnthropicProvider } from '../providers/anthropic-provider';
import { OpenAICompatProvider } from '../providers/openai-compat-provider';
import type { IProvider } from '../providers/i-provider';
import { createLogger } from '../utils/logger';

const router = Router();
const logger = createLogger('ExternalKeysRoutes');

let repoInstance: ExternalKeysRepository | null = null;

function getRepo(): ExternalKeysRepository {
    if (!repoInstance) {
        repoInstance = new ExternalKeysRepository(getPool());
    }
    return repoInstance;
}

function getUserId(req: Request): string | null {
    if (req.user && 'userId' in req.user) {
        return (req.user as { userId: string }).userId;
    }
    if (req.user && 'id' in req.user) {
        return String((req.user as { id: unknown }).id);
    }
    return null;
}

const upsertKeySchema = z.object({
    sdk_type: z.enum(['anthropic', 'openai-compatible']),
    display_name: z.string().min(1).max(128),
    base_url: z.string().regex(/^https?:\/\//, 'must be http(s) URL').optional().nullable(),
    api_key: z.string().min(8).max(512),
});

router.get('/',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('User ID not found.'));
            return;
        }

        const userKeys = await getRepo().listByUser(userId);
        const userKeysByProvider = new Map(userKeys.map((k) => [k.providerId, k]));

        const catalog = EXTERNAL_PROVIDER_CATALOG.map((entry) => {
            const userKey = userKeysByProvider.get(entry.id);
            return {
                provider_id: entry.id,
                display_name: entry.displayName,
                sdk_type: entry.sdkType,
                default_base_url: entry.defaultBaseUrl,
                key_prefix_pattern: entry.keyPrefixPattern,
                enabled: entry.enabled,
                sort_order: entry.sortOrder,
                help_text: entry.helpText,
                user_key: userKey
                    ? {
                          display_name: userKey.displayName,
                          key_prefix: userKey.keyPrefix,
                          base_url: userKey.baseUrl,
                          last_validated_at: userKey.lastValidatedAt,
                          last_validation_ok: userKey.lastValidationOk,
                          last_validation_error: userKey.lastValidationError,
                          last_used_at: userKey.lastUsedAt,
                          created_at: userKey.createdAt,
                          updated_at: userKey.updatedAt,
                      }
                    : null,
            };
        }).sort((a, b) => a.sort_order - b.sort_order);

        res.json(success({ providers: catalog }));
    }),
);

router.post('/:providerId',
    requireAuth,
    validate(upsertKeySchema),
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('User ID not found.'));
            return;
        }

        const providerId = req.params.providerId;
        const catalogEntry = getProviderCatalogEntry(providerId);
        if (!catalogEntry) {
            res.status(404).json(notFound(`Unknown provider: ${providerId}`));
            return;
        }

        if (req.body.sdk_type !== catalogEntry.sdkType) {
            res.status(400).json(
                badRequest(
                    `Provider '${providerId}'의 sdk_type 은 '${catalogEntry.sdkType}'여야 합니다`,
                ),
            );
            return;
        }

        if (req.body.base_url) {
            try {
                await validateOutboundUrl(req.body.base_url);
            } catch (err) {
                const msg = err instanceof Error ? err.message : 'invalid base_url';
                res.status(400).json(badRequest(`base_url 차단: ${msg}`));
                return;
            }
        }

        const row = await getRepo().upsert({
            userId,
            providerId,
            sdkType: req.body.sdk_type,
            displayName: req.body.display_name,
            baseUrl: req.body.base_url ?? null,
            apiKey: req.body.api_key,
        });

        logger.info(`외부 키 등록: user=${userId} provider=${providerId}`);
        res.status(201).json(
            success({
                provider_id: row.providerId,
                display_name: row.displayName,
                key_prefix: row.keyPrefix,
                base_url: row.baseUrl,
                created_at: row.createdAt,
                updated_at: row.updatedAt,
            }),
        );
    }),
);

router.delete('/:providerId',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('User ID not found.'));
            return;
        }

        const providerId = req.params.providerId;
        const removed = await getRepo().deactivate(userId, providerId);
        if (!removed) {
            res.status(404).json(notFound('Key not found or already inactive'));
            return;
        }
        logger.info(`외부 키 삭제: user=${userId} provider=${providerId}`);
        res.json(success({ deleted: true, provider_id: providerId }));
    }),
);

router.get('/usage/recent',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('User ID not found.'));
            return;
        }
        const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
        const recent = await getRepo().listRecentUsage(userId, limit);
        res.json(success({
            usage: recent.map((r) => ({
                provider_id: r.providerId,
                model_id: r.modelId,
                occurred_at: r.occurredAt,
                input_tokens: r.inputTokens,
                output_tokens: r.outputTokens,
                duration_ms: r.durationMs,
                finish_reason: r.finishReason,
            })),
        }));
    }),
);

router.post('/:providerId/validate',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('User ID not found.'));
            return;
        }

        const providerId = req.params.providerId;
        const existing = await getRepo().getByUserAndProvider(userId, providerId);
        if (!existing) {
            res.status(404).json(notFound('Key not registered'));
            return;
        }

        // 평문 키 복호화 후 적절한 provider 인스턴스로 validateCredentials() 호출
        const plaintextKey = await getRepo().decryptKey(userId, providerId);
        if (!plaintextKey) {
            res.status(500).json(badRequest('키 복호화 실패'));
            return;
        }

        let provider: IProvider;
        if (existing.sdkType === 'anthropic') {
            provider = new AnthropicProvider({ apiKey: plaintextKey, baseUrl: existing.baseUrl });
        } else if (existing.sdkType === 'openai-compatible') {
            if (!existing.baseUrl) {
                res.status(400).json(
                    badRequest(`'${providerId}' 키에 base_url 이 등록되지 않았습니다`),
                );
                return;
            }
            provider = new OpenAICompatProvider({
                providerId,
                apiKey: plaintextKey,
                baseUrl: existing.baseUrl,
            });
        } else {
            res.status(400).json(
                badRequest(`알 수 없는 sdk_type: ${existing.sdkType}`),
            );
            return;
        }

        const result = await provider.validateCredentials();
        await getRepo().recordValidation(userId, providerId, {
            ok: result.ok,
            error: result.ok ? null : (result.error ?? 'Validation failed'),
        });

        logger.info(
            `외부 키 검증: user=${userId} provider=${providerId} ok=${result.ok} latency=${result.latencyMs}ms`,
        );

        if (!result.ok) {
            res.status(400).json(
                badRequest(result.error || '검증 실패 — 키 또는 base_url 을 확인하세요'),
            );
            return;
        }

        res.json(success({
            provider_id: providerId,
            ok: true,
            latency_ms: result.latencyMs,
        }));
    }),
);

export default router;
