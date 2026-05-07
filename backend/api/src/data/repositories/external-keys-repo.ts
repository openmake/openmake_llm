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
 * @see backend/api/src/utils/token-crypto.ts
 * @see services/database/migrations/016_external_provider_integration.sql
 */
import { BaseRepository } from './base-repository';
import { encryptToken, decryptToken } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ExternalKeysRepo');

/**
 * 키 prefix 길이 — UI 표시용 처음 N글자
 */
const KEY_PREFIX_LENGTH = 12;

export type ExternalSdkType = 'anthropic' | 'openai-compatible';

/**
 * 평문 API 키를 받지 않는 안전 조회 결과 (UI/일반 로직용)
 */
export interface ExternalApiKeyRow {
    id: number;
    userId: string;
    providerId: string;
    sdkType: ExternalSdkType;
    displayName: string;
    baseUrl: string | null;
    keyPrefix: string;
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
    /** 평문 API 키 — repo 내부에서 즉시 암호화, 평문 보관 금지 */
    apiKey: string;
}

interface DbRow {
    id: number;
    user_id: string;
    provider_id: string;
    sdk_type: ExternalSdkType;
    display_name: string;
    base_url: string | null;
    encrypted_key: string;
    key_prefix: string;
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
        displayName: row.display_name,
        baseUrl: row.base_url,
        keyPrefix: row.key_prefix,
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
        const encrypted = encryptToken(input.apiKey);
        const prefix = buildKeyPrefix(input.apiKey);
        const result = await this.query<DbRow>(
            `INSERT INTO user_external_api_keys
                (user_id, provider_id, sdk_type, display_name, base_url, encrypted_key, key_prefix)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (user_id, provider_id) DO UPDATE SET
                sdk_type = EXCLUDED.sdk_type,
                display_name = EXCLUDED.display_name,
                base_url = EXCLUDED.base_url,
                encrypted_key = EXCLUDED.encrypted_key,
                key_prefix = EXCLUDED.key_prefix,
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
