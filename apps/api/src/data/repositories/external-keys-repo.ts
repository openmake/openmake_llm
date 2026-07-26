/**
 * @module data/repositories/external-keys-repo
 * @description 사용자별 외부 LLM provider BYO API 키 데이터 접근 계층
 *
 * `user_external_api_keys` 테이블 CRUD 및 검증 메타데이터 갱신을 담당합니다.
 * 평문 API 키는 절대 DB 저장하지 않으며 utils/token-crypto.ts 의 AES-256-GCM
 * 암호화를 거쳐 `encrypted_key` 컬럼에 'v1:iv:ct:tag' 단일 문자열로 보관합니다.
 *
 * 노출 정책:
 *   - 일반 조회(get/list)는 항상 `encrypted_key`/`api_key`를 반환하지 않음
 *   - 평문이 필요한 호출 경로(provider streamChat 등)에서만 `decryptKey()` 호출
 *   - UI 노출은 `key_prefix`(예: 'sk-ant-test-...')만 사용
 *
 * @see apps/api/src/utils/token-crypto.ts
 * @see db/migrations/016_external_provider_integration.sql
 */
import { BaseRepository } from './base-repository';
import { encryptToken, decryptToken } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ExternalKeysRepo');

/**
 * 키 prefix 길이 — UI 표시용 처음 N글자
 */
const KEY_PREFIX_LENGTH = 12;

/** DB key_prefix 컬럼 상한 (VARCHAR(16), 마이그레이션 016) — 초과 시 INSERT 실패 */
const KEY_PREFIX_COLUMN_MAX = 16;

export type ExternalSdkType = 'anthropic' | 'openai-compatible';

/**
 * 키 인증 방식 (마이그레이션 082).
 * - 'api_key': encrypted_key = 평문 API 키 암호화 (기존 동작)
 * - 'oauth':   encrypted_key = OAuth 세션 JSON 암호화 (ChatGPT 디바이스 플로우)
 */
export type ExternalAuthMethod = 'api_key' | 'oauth';

/**
 * 평문 API 키를 받지 않는 안전 조회 결과 (UI/일반 로직용)
 */
export interface ExternalApiKeyRow {
    id: number;
    userId: string;
    providerId: string;
    sdkType: ExternalSdkType;
    authMethod: ExternalAuthMethod;
    displayName: string;
    baseUrl: string | null;
    keyPrefix: string;
    /** OAuth 계정 식별자 (auth_method='oauth' 전용, 복호화 없이 노출 가능) */
    oauthAccountId: string | null;
    /** OAuth access token 만료 시각 (auth_method='oauth' 전용) */
    oauthExpiresAt: Date | null;
    isActive: boolean;
    lastValidatedAt: Date | null;
    lastValidationOk: boolean | null;
    lastValidationError: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface UpsertExternalApiKeyInput {
    userId: string;
    providerId: string;
    sdkType: ExternalSdkType;
    displayName: string;
    baseUrl?: string | null;
    /** 평문 API 키 또는 OAuth 세션 JSON — repo 내부에서 즉시 암호화, 평문 보관 금지 */
    apiKey: string;
    /** 인증 방식 — 미지정 시 'api_key' */
    authMethod?: ExternalAuthMethod;
    /** OAuth 계정 식별자 (authMethod='oauth' 시) */
    oauthAccountId?: string | null;
    /** OAuth access token 만료 시각 (authMethod='oauth' 시) */
    oauthExpiresAt?: Date | null;
}

interface DbRow {
    id: number;
    user_id: string;
    provider_id: string;
    sdk_type: ExternalSdkType;
    auth_method: ExternalAuthMethod;
    display_name: string;
    base_url: string | null;
    encrypted_key: string;
    key_prefix: string;
    oauth_account_id: string | null;
    oauth_expires_at: Date | null;
    is_active: boolean;
    last_validated_at: Date | null;
    last_validation_ok: boolean | null;
    last_validation_error: string | null;
    last_used_at: Date | null;
    created_at: Date;
    updated_at: Date;
    [key: string]: unknown;
}

function buildKeyPrefix(plaintext: string): string {
    if (plaintext.length <= KEY_PREFIX_LENGTH) {
        return plaintext;
    }
    return `${plaintext.slice(0, KEY_PREFIX_LENGTH)}...`;
}

function toRow(row: DbRow): ExternalApiKeyRow {
    return {
        id: row.id,
        userId: row.user_id,
        providerId: row.provider_id,
        sdkType: row.sdk_type,
        authMethod: row.auth_method ?? 'api_key',
        displayName: row.display_name,
        baseUrl: row.base_url,
        keyPrefix: row.key_prefix,
        oauthAccountId: row.oauth_account_id ?? null,
        oauthExpiresAt: row.oauth_expires_at ?? null,
        isActive: row.is_active,
        lastValidatedAt: row.last_validated_at,
        lastValidationOk: row.last_validation_ok,
        lastValidationError: row.last_validation_error,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class ExternalKeysRepository extends BaseRepository {
    /**
     * 사용자의 provider별 API 키를 등록 또는 갱신합니다.
     * (user_id, provider_id) UNIQUE 제약으로 자동 upsert.
     *
     * 평문 키는 즉시 암호화되며 `encrypted_key` 컬럼에만 저장됩니다.
     */
    async upsert(input: UpsertExternalApiKeyInput): Promise<ExternalApiKeyRow> {
        const authMethod: ExternalAuthMethod = input.authMethod ?? 'api_key';
        const encrypted = encryptToken(input.apiKey);
        // OAuth 세션 JSON 은 prefix 로 노출하면 페이로드 조각이 새므로 계정 기반 표시로 대체.
        // key_prefix 컬럼은 VARCHAR(16) — 'oauth:' (6자) + 계정 앞 10자로 상한을 지킨다.
        const prefix = authMethod === 'oauth'
            ? `oauth:${(input.oauthAccountId ?? 'session').slice(0, KEY_PREFIX_COLUMN_MAX - 6)}`
            : buildKeyPrefix(input.apiKey);
        const result = await this.query<DbRow>(
            `INSERT INTO user_external_api_keys
                (user_id, provider_id, sdk_type, display_name, base_url, encrypted_key, key_prefix,
                 auth_method, oauth_account_id, oauth_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (user_id, provider_id) DO UPDATE SET
                sdk_type = EXCLUDED.sdk_type,
                display_name = EXCLUDED.display_name,
                base_url = EXCLUDED.base_url,
                encrypted_key = EXCLUDED.encrypted_key,
                key_prefix = EXCLUDED.key_prefix,
                auth_method = EXCLUDED.auth_method,
                oauth_account_id = EXCLUDED.oauth_account_id,
                oauth_expires_at = EXCLUDED.oauth_expires_at,
                is_active = TRUE,
                last_validated_at = NULL,
                last_validation_ok = NULL,
                last_validation_error = NULL,
                updated_at = now()
             RETURNING *`,
            [
                input.userId,
                input.providerId,
                input.sdkType,
                input.displayName,
                input.baseUrl ?? null,
                encrypted,
                prefix,
                authMethod,
                input.oauthAccountId ?? null,
                input.oauthExpiresAt?.toISOString() ?? null,
            ],
        );
        const row = result.rows[0];
        if (!row) {
            throw new Error('upsert returned no row');
        }
        logger.info(`외부 키 upsert: user=${input.userId} provider=${input.providerId}`);
        return toRow(row);
    }

    /**
     * 사용자가 등록한 모든 provider 키 목록 (평문 미반환)
     */
    async listByUser(userId: string): Promise<ExternalApiKeyRow[]> {
        const result = await this.query<DbRow>(
            `SELECT * FROM user_external_api_keys
             WHERE user_id = $1 AND is_active = TRUE
             ORDER BY provider_id ASC`,
            [userId],
        );
        return result.rows.map(toRow);
    }

    /**
     * 특정 (user, provider) 쌍의 키 메타데이터 조회 (평문 미반환)
     */
    async getByUserAndProvider(
        userId: string,
        providerId: string,
    ): Promise<ExternalApiKeyRow | null> {
        const result = await this.query<DbRow>(
            `SELECT * FROM user_external_api_keys
             WHERE user_id = $1 AND provider_id = $2 AND is_active = TRUE`,
            [userId, providerId],
        );
        const row = result.rows[0];
        return row ? toRow(row) : null;
    }

    /**
     * 평문 API 키 복호화 — provider 호출 직전에만 사용해야 합니다.
     * 호출 결과는 메모리 외부로 유출되지 않도록 주의 (로그/에러 메시지 금지).
     *
     * @returns 평문 키 또는 null (키 미등록 / 비활성)
     */
    async decryptKey(userId: string, providerId: string): Promise<string | null> {
        const result = await this.query<DbRow>(
            `SELECT encrypted_key FROM user_external_api_keys
             WHERE user_id = $1 AND provider_id = $2 AND is_active = TRUE`,
            [userId, providerId],
        );
        const row = result.rows[0];
        if (!row) return null;
        return decryptToken(row.encrypted_key);
    }

    /**
     * OAuth 세션 갱신 (refresh token rotate) 후 암호화 페이로드·만료 메타를 갱신합니다.
     * 평문 세션 JSON 은 즉시 암호화되며 로그에 남기지 않습니다.
     */
    async updateOAuthSession(
        userId: string,
        providerId: string,
        input: {
            /** 평문 OAuth 세션 JSON (repo 내부에서 즉시 암호화) */
            plaintextSession: string;
            oauthExpiresAt: Date | null;
            oauthAccountId?: string | null;
        },
    ): Promise<void> {
        const encrypted = encryptToken(input.plaintextSession);
        await this.query(
            `UPDATE user_external_api_keys
             SET encrypted_key = $3,
                 oauth_expires_at = $4,
                 oauth_account_id = COALESCE($5, oauth_account_id),
                 updated_at = now()
             WHERE user_id = $1 AND provider_id = $2 AND is_active = TRUE`,
            [
                userId,
                providerId,
                encrypted,
                input.oauthExpiresAt?.toISOString() ?? null,
                input.oauthAccountId ?? null,
            ],
        );
        logger.debug(`OAuth 세션 갱신: user=${userId} provider=${providerId}`);
    }

    /**
     * 검증(/validate) 결과를 기록합니다.
     */
    async recordValidation(
        userId: string,
        providerId: string,
        result: { ok: boolean; error?: string | null },
    ): Promise<void> {
        await this.query(
            `UPDATE user_external_api_keys
             SET last_validated_at = now(),
                 last_validation_ok = $3,
                 last_validation_error = $4,
                 updated_at = now()
             WHERE user_id = $1 AND provider_id = $2`,
            [userId, providerId, result.ok, result.ok ? null : (result.error ?? null)],
        );
    }

    /**
     * provider 호출 직후 last_used_at 갱신 (validation 메타와 분리)
     */
    async touchLastUsed(userId: string, providerId: string): Promise<void> {
        await this.query(
            `UPDATE user_external_api_keys
             SET last_used_at = now()
             WHERE user_id = $1 AND provider_id = $2`,
            [userId, providerId],
        );
    }

    /**
     * 외부 provider 호출 사용량 레코드 1건 적재 (external_provider_usage 테이블).
     *
     * cost_usd_micros 는 호출자가 사전 계산하여 전달 (provider 별 단가표는
     * config 또는 별도 service 에서 관리 예정 — Phase 5+ 후속 개선).
     */
    async recordUsage(input: {
        userId: string;
        providerId: string;
        modelId: string;
        inputTokens: number;
        outputTokens: number;
        thinkingTokens?: number;
        costUsdMicros?: number;
        durationMs?: number;
        finishReason?: string;
        errorCode?: string;
    }): Promise<void> {
        await this.query(
            `INSERT INTO external_provider_usage
                (user_id, provider_id, model_id, input_tokens, output_tokens,
                 thinking_tokens, cost_usd_micros, duration_ms, finish_reason, error_code)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
                input.userId,
                input.providerId,
                input.modelId,
                input.inputTokens,
                input.outputTokens,
                input.thinkingTokens ?? null,
                input.costUsdMicros ?? 0,
                input.durationMs ?? null,
                input.finishReason ?? null,
                input.errorCode ?? null,
            ],
        );
    }

    /**
     * 사용자의 최근 외부 provider 사용량 조회 (UI 표시용).
     * 최근 N건의 호출 메타 + 누적 토큰/비용을 반환.
     */
    async listRecentUsage(
        userId: string,
        limit: number = 50,
    ): Promise<Array<{
        providerId: string;
        modelId: string;
        occurredAt: Date;
        inputTokens: number;
        outputTokens: number;
        costUsdMicros: number;
        durationMs: number | null;
        finishReason: string | null;
    }>> {
        const result = await this.query<{
            provider_id: string;
            model_id: string;
            occurred_at: Date;
            input_tokens: number;
            output_tokens: number;
            cost_usd_micros: string | number;
            duration_ms: number | null;
            finish_reason: string | null;
        }>(
            `SELECT provider_id, model_id, occurred_at, input_tokens, output_tokens,
                    cost_usd_micros, duration_ms, finish_reason
             FROM external_provider_usage
             WHERE user_id = $1
             ORDER BY occurred_at DESC
             LIMIT $2`,
            [userId, limit],
        );
        return result.rows.map((r) => ({
            providerId: r.provider_id,
            modelId: r.model_id,
            occurredAt: r.occurred_at,
            inputTokens: r.input_tokens,
            outputTokens: r.output_tokens,
            // pg 의 BIGINT 는 string 으로 들어올 수 있음 — Number 로 정규화
            costUsdMicros: typeof r.cost_usd_micros === 'string'
                ? Number(r.cost_usd_micros)
                : r.cost_usd_micros,
            durationMs: r.duration_ms,
            finishReason: r.finish_reason,
        }));
    }

    /**
     * 외부 provider 모델 카탈로그 캐시 조회 (external_provider_models_cache).
     *
     * @param ttlMs 캐시 TTL — 이보다 오래된 항목은 stale 처리 (null 반환)
     * @returns 캐시 적중 시 models JSON 배열, 미스 또는 stale 시 null
     */
    async getCachedModels(
        userId: string,
        providerId: string,
        ttlMs: number,
    ): Promise<unknown[] | null> {
        const result = await this.query<{ models_json: unknown[]; cached_at: Date }>(
            `SELECT models_json, cached_at FROM external_provider_models_cache
             WHERE user_id = $1 AND provider_id = $2`,
            [userId, providerId],
        );
        const row = result.rows[0];
        if (!row) return null;
        const ageMs = Date.now() - new Date(row.cached_at).getTime();
        if (ageMs > ttlMs) return null;
        return Array.isArray(row.models_json) ? row.models_json : null;
    }

    /**
     * 모델 실사용 가능 여부 기록 (마이그레이션 083).
     *
     * provider 의 /v1/models 는 계정 권한과 무관하게 전체 카탈로그를 주므로
     * (Ollama Cloud 구독 전용 403, NVIDIA 계정별 404 등) 실제 호출 결과로
     * 사용 가능 여부를 학습해 목록에서 걸러낸다.
     */
    async markModelAvailability(input: {
        userId: string;
        providerId: string;
        modelId: string;
        usable: boolean;
        reason?: string | null;
    }): Promise<void> {
        await this.query(
            `INSERT INTO external_model_availability
                (user_id, provider_id, model_id, usable, reason, checked_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (user_id, provider_id, model_id) DO UPDATE SET
                usable = EXCLUDED.usable,
                reason = EXCLUDED.reason,
                checked_at = now()`,
            [
                input.userId,
                input.providerId,
                input.modelId,
                input.usable,
                input.reason ? input.reason.slice(0, 300) : null,
            ],
        );
    }

    /**
     * 사용 불가로 판정된 모델 id 집합 (목록 필터용).
     * providerId 생략 시 사용자 전체 provider 를 대상으로 `provider:model` 키로 반환.
     */
    async listUnusableModels(userId: string, providerId?: string): Promise<Set<string>> {
        const result = providerId
            ? await this.query<{ provider_id: string; model_id: string }>(
                `SELECT provider_id, model_id FROM external_model_availability
                 WHERE user_id = $1 AND provider_id = $2 AND usable = FALSE`,
                [userId, providerId],
            )
            : await this.query<{ provider_id: string; model_id: string }>(
                `SELECT provider_id, model_id FROM external_model_availability
                 WHERE user_id = $1 AND usable = FALSE`,
                [userId],
            );
        return new Set(result.rows.map((r) => `${r.provider_id}:${r.model_id}`));
    }

    /** provider 재등록·키 교체 시 판정 초기화 (권한이 달라질 수 있음) */
    async clearModelAvailability(userId: string, providerId: string): Promise<void> {
        await this.query(
            `DELETE FROM external_model_availability WHERE user_id = $1 AND provider_id = $2`,
            [userId, providerId],
        );
    }

    /**
     * 캐시 무효화 — 키 등록·갱신·삭제 시 호출하여 stale 카탈로그 제거.
     */
    async invalidateCachedModels(userId: string, providerId: string): Promise<void> {
        await this.query(
            `DELETE FROM external_provider_models_cache
             WHERE user_id = $1 AND provider_id = $2`,
            [userId, providerId],
        );
    }

    /**
     * 외부 provider 모델 카탈로그 캐시 갱신 (upsert).
     */
    async putCachedModels(
        userId: string,
        providerId: string,
        models: unknown[],
    ): Promise<void> {
        await this.query(
            `INSERT INTO external_provider_models_cache (user_id, provider_id, cached_at, models_json)
             VALUES ($1, $2, now(), $3)
             ON CONFLICT (user_id, provider_id) DO UPDATE SET
                cached_at = now(),
                models_json = EXCLUDED.models_json`,
            [userId, providerId, JSON.stringify(models)],
        );
    }

    /**
     * 사용자별 일별 사용량 집계 — UsageModal 차트 / 비용 추이용.
     *
     * @param days 조회 일수 (기본 30일)
     * @returns 날짜별 + provider별 토큰/비용 합산
     */
    async listDailyUsage(
        userId: string,
        days: number = 30,
    ): Promise<Array<{
        day: string;
        providerId: string;
        callCount: number;
        inputTokens: number;
        outputTokens: number;
        costUsdMicros: number;
    }>> {
        const result = await this.query<{
            day: string;
            provider_id: string;
            call_count: string;
            input_tokens: string;
            output_tokens: string;
            cost_usd_micros: string;
        }>(
            `SELECT
                to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                provider_id,
                COUNT(*)::text AS call_count,
                SUM(input_tokens)::text AS input_tokens,
                SUM(output_tokens)::text AS output_tokens,
                SUM(cost_usd_micros)::text AS cost_usd_micros
             FROM external_provider_usage
             WHERE user_id = $1
               AND occurred_at > NOW() - ($2 || ' days')::interval
             GROUP BY day, provider_id
             ORDER BY day DESC, provider_id ASC`,
            [userId, days.toString()],
        );
        return result.rows.map((r) => ({
            day: r.day,
            providerId: r.provider_id,
            callCount: Number(r.call_count),
            inputTokens: Number(r.input_tokens),
            outputTokens: Number(r.output_tokens),
            costUsdMicros: Number(r.cost_usd_micros),
        }));
    }

    /**
     * 키 삭제 (소프트 비활성화) — DB row는 audit를 위해 보존하고 is_active=false 처리.
     */
    async deactivate(userId: string, providerId: string): Promise<boolean> {
        const result = await this.query(
            `UPDATE user_external_api_keys
             SET is_active = FALSE, updated_at = now()
             WHERE user_id = $1 AND provider_id = $2 AND is_active = TRUE`,
            [userId, providerId],
        );
        return (result.rowCount ?? 0) > 0;
    }
}
