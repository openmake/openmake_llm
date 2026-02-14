import { BaseRepository, QueryParam } from './base-repository';
import type { ApiKeyTier, UserApiKey } from '../models/unified-database';

export class ApiKeyRepository extends BaseRepository {
    async recordApiUsage(date: string, apiKeyId: string, requests: number, tokens: number, errors: number, avgResponseTime: number, models: Record<string, unknown>) {
        return this.query(
            `INSERT INTO api_usage (date, api_key_id, requests, tokens, errors, avg_response_time, models)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT(date, api_key_id) DO UPDATE SET
                requests = api_usage.requests + EXCLUDED.requests,
                tokens = api_usage.tokens + EXCLUDED.tokens,
                errors = api_usage.errors + EXCLUDED.errors,
                avg_response_time = (api_usage.avg_response_time + EXCLUDED.avg_response_time) / 2,
                models = EXCLUDED.models,
                updated_at = NOW()`,
            [date, apiKeyId, requests, tokens, errors, avgResponseTime, JSON.stringify(models)]
        );
    }

    async getDailyUsage(days: number = 7) {
        const result = await this.query(
            `SELECT date, SUM(requests) as requests, SUM(tokens) as tokens, SUM(errors) as errors, AVG(avg_response_time) as avg_response_time
            FROM api_usage
            WHERE date >= to_char(CURRENT_DATE - ($1 || ' days')::interval, 'YYYY-MM-DD')
            GROUP BY date
            ORDER BY date DESC`,
            [days]
        );
        return result.rows;
    }

    async createApiKey(params: {
        id: string;
        userId: string;
        keyHash: string;
        keyPrefix: string;
        last4: string;
        name: string;
        description?: string;
        scopes?: string[];
        allowedModels?: string[];
        rateLimitTier?: ApiKeyTier;
        expiresAt?: string;
    }): Promise<UserApiKey> {
        const result = await this.query<UserApiKey>(
            `INSERT INTO user_api_keys 
            (id, user_id, key_hash, key_prefix, last_4, name, description, scopes, allowed_models, rate_limit_tier, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *`,
            [
                params.id,
                params.userId,
                params.keyHash,
                params.keyPrefix,
                params.last4,
                params.name,
                params.description || null,
                JSON.stringify(params.scopes || ['*']),
                JSON.stringify(params.allowedModels || ['*']),
                params.rateLimitTier || 'free',
                params.expiresAt || null
            ]
        );
        const row = result.rows[0];
        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        };
    }

    async getApiKeyByHash(keyHash: string): Promise<UserApiKey | undefined> {
        const result = await this.query<UserApiKey>(
            'SELECT * FROM user_api_keys WHERE key_hash = $1 AND is_active = TRUE',
            [keyHash]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        };
    }

    async getApiKeyById(keyId: string): Promise<UserApiKey | undefined> {
        const result = await this.query<UserApiKey>('SELECT * FROM user_api_keys WHERE id = $1', [keyId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        };
    }

    async listUserApiKeys(userId: string, options?: {
        includeInactive?: boolean;
        limit?: number;
        offset?: number;
    }): Promise<UserApiKey[]> {
        let query = 'SELECT * FROM user_api_keys WHERE user_id = $1';
        const params: QueryParam[] = [userId];
        let paramIdx = 2;

        if (!options?.includeInactive) {
            query += ' AND is_active = TRUE';
        }

        query += ' ORDER BY created_at DESC';

        if (options?.limit) {
            query += ` LIMIT $${paramIdx++}`;
            params.push(options.limit);
        }
        if (options?.offset) {
            query += ` OFFSET $${paramIdx++}`;
            params.push(options.offset);
        }

        const result = await this.query<UserApiKey>(query, params);
        return result.rows.map((row) => ({
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        }));
    }

    async updateApiKey(keyId: string, updates: {
        name?: string;
        description?: string;
        scopes?: string[];
        allowedModels?: string[];
        rateLimitTier?: ApiKeyTier;
        isActive?: boolean;
        expiresAt?: string | null;
    }): Promise<UserApiKey | undefined> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.name !== undefined) {
            sets.push(`name = $${paramIdx++}`);
            params.push(updates.name);
        }
        if (updates.description !== undefined) {
            sets.push(`description = $${paramIdx++}`);
            params.push(updates.description);
        }
        if (updates.scopes !== undefined) {
            sets.push(`scopes = $${paramIdx++}`);
            params.push(JSON.stringify(updates.scopes));
        }
        if (updates.allowedModels !== undefined) {
            sets.push(`allowed_models = $${paramIdx++}`);
            params.push(JSON.stringify(updates.allowedModels));
        }
        if (updates.rateLimitTier !== undefined) {
            sets.push(`rate_limit_tier = $${paramIdx++}`);
            params.push(updates.rateLimitTier);
        }
        if (updates.isActive !== undefined) {
            sets.push(`is_active = $${paramIdx++}`);
            params.push(updates.isActive);
        }
        if (updates.expiresAt !== undefined) {
            sets.push(`expires_at = $${paramIdx++}`);
            params.push(updates.expiresAt);
        }

        params.push(keyId);
        const result = await this.query<UserApiKey>(
            `UPDATE user_api_keys SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            params
        );

        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        };
    }

    async deleteApiKey(keyId: string): Promise<boolean> {
        const result = await this.query('DELETE FROM user_api_keys WHERE id = $1', [keyId]);
        return (result.rowCount || 0) > 0;
    }

    async rotateApiKey(keyId: string, newKeyHash: string, newLast4: string): Promise<UserApiKey | undefined> {
        const result = await this.query<UserApiKey>(
            `UPDATE user_api_keys 
            SET key_hash = $1, last_4 = $2, updated_at = NOW()
            WHERE id = $3 AND is_active = TRUE
            RETURNING *`,
            [newKeyHash, newLast4, keyId]
        );

        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            scopes: row.scopes || ['*'],
            allowed_models: row.allowed_models || ['*'],
            is_active: !!row.is_active
        };
    }

    async recordApiKeyUsage(keyId: string, tokens: number): Promise<void> {
        await this.query(
            `UPDATE user_api_keys 
            SET total_requests = total_requests + 1, 
                total_tokens = total_tokens + $1,
                last_used_at = NOW()
            WHERE id = $2`,
            [tokens, keyId]
        );
    }

    async getApiKeyUsageStats(keyId: string): Promise<{
        totalRequests: number;
        totalTokens: number;
        lastUsedAt: string | null;
    } | undefined> {
        const result = await this.query(
            'SELECT total_requests, total_tokens, last_used_at FROM user_api_keys WHERE id = $1',
            [keyId]
        );
        const row = result.rows[0] as { total_requests: number; total_tokens: number; last_used_at: string | null } | undefined;
        if (!row) return undefined;

        return {
            totalRequests: row.total_requests,
            totalTokens: row.total_tokens,
            lastUsedAt: row.last_used_at
        };
    }

    async countUserApiKeys(userId: string): Promise<number> {
        const result = await this.query('SELECT COUNT(*) as count FROM user_api_keys WHERE user_id = $1 AND is_active = TRUE', [userId]);
        const row = result.rows[0] as { count: string };
        return parseInt(row.count, 10);
    }
}
