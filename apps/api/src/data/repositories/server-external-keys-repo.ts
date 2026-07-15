/**
 * @module data/repositories/server-external-keys-repo
 * @description 서버 공용(운영자 소유) 외부 LLM provider 키 저장소.
 *
 * Role-based Orchestration 2차 Phase A. 전역 role 매핑 전용 —
 * 사용자별 매핑/채팅 명시 선택은 user_external_api_keys(BYOK)만 사용한다.
 * 키 암호화는 utils/token-crypto SSoT (AES-256-GCM, TOKEN_ENCRYPTION_KEY) 재사용.
 *
 * @see db/migrations/070_server_external_api_keys.sql
 */
import { BaseRepository } from './base-repository';
import { encryptToken, decryptToken } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ServerExternalKeysRepo');

export interface ServerExternalKeyRow {
    providerId: string;
    baseUrl: string | null;
    isActive: boolean;
    dailyTokenLimit: number;
    monthlyTokenLimit: number | null;
    createdAt: Date;
    updatedAt: Date;
}

interface DbRow {
    provider_id: string;
    encrypted_key: string;
    base_url: string | null;
    is_active: boolean;
    daily_token_limit: string | number;
    monthly_token_limit: string | number | null;
    created_at: Date;
    updated_at: Date;
    [key: string]: unknown;
}

function toRow(row: DbRow): ServerExternalKeyRow {
    return {
        providerId: row.provider_id,
        baseUrl: row.base_url,
        isActive: row.is_active,
        dailyTokenLimit: Number(row.daily_token_limit),
        monthlyTokenLimit: row.monthly_token_limit === null ? null : Number(row.monthly_token_limit),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export class ServerExternalKeysRepository extends BaseRepository {
    async get(providerId: string): Promise<ServerExternalKeyRow | null> {
        const result = await this.query<DbRow>(
            `SELECT * FROM server_external_api_keys WHERE provider_id = $1`,
            [providerId],
        );
        return result.rows[0] ? toRow(result.rows[0]) : null;
    }

    async list(): Promise<ServerExternalKeyRow[]> {
        const result = await this.query<DbRow>(
            `SELECT * FROM server_external_api_keys ORDER BY provider_id`,
        );
        return result.rows.map(toRow);
    }

    /** 평문 키 반환 — 복호화 실패 시 null (호출자가 폴백 처리) */
    async decryptKey(providerId: string): Promise<string | null> {
        const result = await this.query<DbRow>(
            `SELECT encrypted_key FROM server_external_api_keys WHERE provider_id = $1`,
            [providerId],
        );
        const enc = result.rows[0]?.encrypted_key;
        if (!enc) return null;
        try {
            return decryptToken(enc);
        } catch (err) {
            logger.error(`서버 키 복호화 실패 (${providerId}):`, err);
            return null;
        }
    }

    /** 등록/갱신 — 평문 키는 즉시 암호화, daily 상한 필수 */
    async upsert(input: {
        providerId: string;
        apiKey: string;
        baseUrl?: string | null;
        dailyTokenLimit: number;
        monthlyTokenLimit?: number | null;
    }): Promise<ServerExternalKeyRow> {
        const encrypted = encryptToken(input.apiKey);
        const result = await this.query<DbRow>(
            `INSERT INTO server_external_api_keys
                (provider_id, encrypted_key, base_url, daily_token_limit, monthly_token_limit)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (provider_id) DO UPDATE SET
                encrypted_key = EXCLUDED.encrypted_key,
                base_url = EXCLUDED.base_url,
                daily_token_limit = EXCLUDED.daily_token_limit,
                monthly_token_limit = EXCLUDED.monthly_token_limit,
                is_active = TRUE,
                updated_at = now()
             RETURNING *`,
            [
                input.providerId,
                encrypted,
                input.baseUrl ?? null,
                input.dailyTokenLimit,
                input.monthlyTokenLimit ?? null,
            ],
        );
        return toRow(result.rows[0]);
    }

    async delete(providerId: string): Promise<boolean> {
        const result = await this.query(
            `DELETE FROM server_external_api_keys WHERE provider_id = $1`,
            [providerId],
        );
        return (result.rowCount ?? 0) > 0;
    }

    /** 서버 키 호출별 사용량 기록 (fire-and-forget 호출 전제 — throw 안 함) */
    async recordUsage(input: {
        providerId: string;
        modelId: string;
        role?: string;
        callerUserId?: string;
        inputTokens: number;
        outputTokens: number;
    }): Promise<void> {
        try {
            await this.query(
                `INSERT INTO server_external_key_usage
                    (provider_id, model_id, role, caller_user_id, input_tokens, output_tokens)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    input.providerId,
                    input.modelId,
                    input.role ?? null,
                    input.callerUserId ?? null,
                    input.inputTokens,
                    input.outputTokens,
                ],
            );
        } catch (err) {
            logger.warn(`서버 키 사용량 기록 실패 (무시): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
