/**
 * API Key 서비스
 * 
 * API Key 관련 비즈니스 로직 계층
 * - Key CRUD (생성, 조회, 수정, 삭제)
 * - Key 순환 (rotate)
 * - 사용량 추적
 */

import crypto from 'node:crypto';
import { getUnifiedDatabase, UserApiKey, UserApiKeyPublic, ApiKeyTier } from '../data/models/unified-database';
import { generateApiKey, hashApiKey, extractLast4, API_KEY_PREFIX } from '../auth/api-key-utils';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('ApiKeyService');

/** API Key 생성 파라미터 */
export interface CreateApiKeyParams {
    userId: string;
    name: string;
    description?: string;
    scopes?: string[];
    allowedModels?: string[];
    rateLimitTier?: ApiKeyTier;
    expiresAt?: string;
}

/** API Key 생성 결과 (평문 키 포함 — 최초 1회만 반환) */
export interface CreateApiKeyResult {
    /** 평문 API Key — 이 응답에서만 노출됨 */
    plainKey: string;
    /** 저장된 키 메타데이터 */
    apiKey: UserApiKeyPublic;
}

/** API Key 수정 파라미터 */
export interface UpdateApiKeyParams {
    name?: string;
    description?: string;
    scopes?: string[];
    allowedModels?: string[];
    rateLimitTier?: ApiKeyTier;
    isActive?: boolean;
    expiresAt?: string | null;
}

/**
 * UserApiKey에서 해시를 제거한 공개 정보 반환
 */
function toPublic(key: UserApiKey): UserApiKeyPublic {
    return {
        id: key.id,
        user_id: key.user_id,
        key_prefix: key.key_prefix,
        last_4: key.last_4,
        name: key.name,
        description: key.description,
        scopes: key.scopes,
        allowed_models: key.allowed_models,
        rate_limit_tier: key.rate_limit_tier,
        is_active: key.is_active,
        last_used_at: key.last_used_at,
        expires_at: key.expires_at,
        created_at: key.created_at,
        updated_at: key.updated_at,
        total_requests: key.total_requests,
        total_tokens: key.total_tokens,
    };
}

export class ApiKeyService {
    /**
     * 감사 로그 기록 (API Key CRUD 작업)
     */
    private async audit(action: string, userId: string, keyId: string, details?: Record<string, unknown>): Promise<void> {
        try {
            const db = getUnifiedDatabase();
            await db.logAudit({
                action: `api_key.${action}`,
                userId,
                resourceType: 'api_key',
                resourceId: keyId,
                details: details || {},
            });
        } catch (e) {
            logger.warn(`감사 로그 기록 실패: ${action}`, e);
        }
    }

    /**
     * 새 API Key 생성
     */
    async createKey(params: CreateApiKeyParams): Promise<CreateApiKeyResult> {
        const db = getUnifiedDatabase();
        const config = getConfig();

        // 사용자당 최대 키 수 확인
        const existingCount = await db.countUserApiKeys(params.userId);
        if (existingCount >= config.apiKeyMaxPerUser) {
            throw new ApiKeyError(
                `API key limit reached. Maximum ${config.apiKeyMaxPerUser} keys per user.`,
                'KEY_LIMIT_EXCEEDED'
            );
        }

        // 키 생성
        const plainKey = generateApiKey();
        const keyHash = hashApiKey(plainKey);
        const last4 = extractLast4(plainKey);
        const keyId = crypto.randomUUID();

        // §7 Security: Free tier 30일 자동 만료 강제
        let expiresAt = params.expiresAt;
        const tier = params.rateLimitTier || 'free';
        if (tier === 'free' && !expiresAt) {
            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            expiresAt = thirtyDaysFromNow.toISOString();
            logger.info(`Free tier 키 자동 만료 설정: ${expiresAt}`);
        }

        const created = await db.createApiKey({
            id: keyId,
            userId: params.userId,
            keyHash,
            keyPrefix: API_KEY_PREFIX,
            last4,
            name: params.name,
            description: params.description,
            scopes: params.scopes,
            allowedModels: params.allowedModels,
            rateLimitTier: params.rateLimitTier,
            expiresAt,
        });

        logger.info(`API Key 생성: user=${params.userId}, id=${keyId}, name=${params.name}`);

        await this.audit('create', params.userId, keyId, {
            name: params.name,
            tier: params.rateLimitTier || 'free',
            scopes: params.scopes,
        });

        return {
            plainKey,
            apiKey: toPublic(created),
        };
    }

    /**
     * 사용자의 API Key 목록 조회
     */
    async listKeys(userId: string, options?: {
        includeInactive?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<UserApiKeyPublic[]> {
        const db = getUnifiedDatabase();
        const keys = await db.listUserApiKeys(userId, options);
        return keys.map(toPublic);
    }

    /**
     * 단일 API Key 조회
     */
    async getKey(keyId: string, userId: string): Promise<UserApiKeyPublic | null> {
        const db = getUnifiedDatabase();
        const key = await db.getApiKeyById(keyId);

        if (!key || key.user_id !== userId) {
            return null;
        }

        return toPublic(key);
    }

    /**
     * API Key 수정
     */
    async updateKey(keyId: string, userId: string, updates: UpdateApiKeyParams): Promise<UserApiKeyPublic | null> {
        const db = getUnifiedDatabase();

        // 소유권 확인
        const existing = await db.getApiKeyById(keyId);
        if (!existing || existing.user_id !== userId) {
            return null;
        }

        const updated = await db.updateApiKey(keyId, {
            name: updates.name,
            description: updates.description,
            scopes: updates.scopes,
            allowedModels: updates.allowedModels,
            rateLimitTier: updates.rateLimitTier,
            isActive: updates.isActive,
            expiresAt: updates.expiresAt,
        });

        if (!updated) {
            return null;
        }

        logger.info(`API Key 수정: id=${keyId}, user=${userId}`);
        await this.audit('update', userId, keyId, updates as Record<string, unknown>);
        return toPublic(updated);
    }

    /**
     * API Key 삭제
     */
    async deleteKey(keyId: string, userId: string): Promise<boolean> {
        const db = getUnifiedDatabase();

        // 소유권 확인
        const existing = await db.getApiKeyById(keyId);
        if (!existing || existing.user_id !== userId) {
            return false;
        }

        const deleted = await db.deleteApiKey(keyId);
        if (deleted) {
            logger.info(`API Key 삭제: id=${keyId}, user=${userId}`);
            await this.audit('delete', userId, keyId);
        }
        return deleted;
    }

    /**
     * API Key 순환 (rotate)
     * 기존 키를 무효화하고 새 키 발급
     */
    async rotateKey(keyId: string, userId: string): Promise<CreateApiKeyResult | null> {
        const db = getUnifiedDatabase();

        // 소유권 확인
        const existing = await db.getApiKeyById(keyId);
        if (!existing || existing.user_id !== userId) {
            return null;
        }

        if (!existing.is_active) {
            throw new ApiKeyError('Cannot rotate an inactive key.', 'KEY_INACTIVE');
        }

        // 새 키 생성 + DB 업데이트
        const newPlainKey = generateApiKey();
        const newKeyHash = hashApiKey(newPlainKey);
        const newLast4 = extractLast4(newPlainKey);

        const rotated = await db.rotateApiKey(keyId, newKeyHash, newLast4);
        if (!rotated) {
            return null;
        }

        logger.info(`API Key 순환: id=${keyId}, user=${userId}`);
        await this.audit('rotate', userId, keyId);

        return {
            plainKey: newPlainKey,
            apiKey: toPublic(rotated),
        };
    }

    /**
     * API Key 사용량 기록 (요청 완료 후 호출)
     */
    async recordUsage(keyId: string, tokens: number): Promise<void> {
        const db = getUnifiedDatabase();
        await db.recordApiKeyUsage(keyId, tokens);
    }

    /**
     * API Key 사용량 통계 조회
     */
    async getUsageStats(keyId: string, userId: string): Promise<{
        totalRequests: number;
        totalTokens: number;
        lastUsedAt: string | null;
    } | null> {
        const db = getUnifiedDatabase();

        // 소유권 확인
        const existing = await db.getApiKeyById(keyId);
        if (!existing || existing.user_id !== userId) {
            return null;
        }

        const stats = await db.getApiKeyUsageStats(keyId);
        return stats || null;
    }
}

/**
 * API Key 서비스 에러
 */
export class ApiKeyError extends Error {
    public readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// 싱글톤 인스턴스
let serviceInstance: ApiKeyService | null = null;

export function getApiKeyService(): ApiKeyService {
    if (!serviceInstance) {
        serviceInstance = new ApiKeyService();
    }
    return serviceInstance;
}
