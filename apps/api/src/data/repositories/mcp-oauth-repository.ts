/**
 * 원격 MCP OAuth 자격증명 저장소 (mcp_oauth_credentials, 마이그레이션 104).
 *
 * 사용자×서버 단위. 토큰·client_secret 은 AES-256-GCM(`utils/token-crypto`) 으로 암호화해
 * 저장하고 읽을 때 복호화한다 — 외부 provider BYOK 키와 같은 방식이다.
 *
 * ⚠️ `decryptToken` 은 fail-open 이다(복호화 실패 시 입력을 그대로 돌려줌). 토큰 JSON 파싱이
 *    실패하면 "토큰 없음" 으로 취급해 SDK 가 새 인가 흐름을 시작하게 한다 — 깨진 암호문을
 *    Bearer 로 보내는 것보다 재로그인이 낫다.
 *
 * @module data/repositories/mcp-oauth-repository
 */
import type { Pool } from 'pg';
import type { OAuthTokens, OAuthClientInformationFull } from '@modelcontextprotocol/client';
import { encryptToken, decryptToken } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('McpOAuthRepository');

interface Row {
    client_info: Record<string, unknown> | null;
    client_secret_enc: string | null;
    tokens_enc: string | null;
}

export class McpOAuthRepository {
    constructor(private readonly pool: Pool) {}

    async getClientInformation(serverId: string, userId: string): Promise<OAuthClientInformationFull | undefined> {
        const r = await this.pool.query<Row>(
            `SELECT client_info, client_secret_enc FROM mcp_oauth_credentials WHERE mcp_server_id = $1 AND user_id = $2`,
            [serverId, userId],
        );
        const row = r.rows[0];
        if (!row?.client_info || typeof row.client_info.client_id !== 'string') return undefined;
        const info = { ...row.client_info } as OAuthClientInformationFull;
        if (row.client_secret_enc) info.client_secret = decryptToken(row.client_secret_enc);
        return info;
    }

    async saveClientInformation(serverId: string, userId: string, info: OAuthClientInformationFull): Promise<void> {
        const { client_secret, ...rest } = info;
        await this.pool.query(
            `INSERT INTO mcp_oauth_credentials (mcp_server_id, user_id, client_info, client_secret_enc)
             VALUES ($1, $2, $3::jsonb, $4)
             ON CONFLICT (mcp_server_id, user_id) DO UPDATE
                SET client_info = EXCLUDED.client_info, client_secret_enc = EXCLUDED.client_secret_enc, updated_at = NOW()`,
            [serverId, userId, JSON.stringify(rest), client_secret ? encryptToken(client_secret) : null],
        );
    }

    async getTokens(serverId: string, userId: string): Promise<OAuthTokens | undefined> {
        const r = await this.pool.query<Row>(
            `SELECT tokens_enc FROM mcp_oauth_credentials WHERE mcp_server_id = $1 AND user_id = $2`,
            [serverId, userId],
        );
        const enc = r.rows[0]?.tokens_enc;
        if (!enc) return undefined;
        try {
            return JSON.parse(decryptToken(enc)) as OAuthTokens;
        } catch (e) {
            logger.warn(`토큰 복호화/파싱 실패 → 재인가 유도 s=${serverId} u=${userId}: ${e instanceof Error ? e.message : String(e)}`);
            return undefined;
        }
    }

    async saveTokens(serverId: string, userId: string, tokens: OAuthTokens): Promise<void> {
        const expiresAt = typeof tokens.expires_in === 'number' ? new Date(Date.now() + tokens.expires_in * 1000) : null;
        await this.pool.query(
            `INSERT INTO mcp_oauth_credentials (mcp_server_id, user_id, tokens_enc, token_expires_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (mcp_server_id, user_id) DO UPDATE
                SET tokens_enc = EXCLUDED.tokens_enc, token_expires_at = EXCLUDED.token_expires_at, updated_at = NOW()`,
            [serverId, userId, encryptToken(JSON.stringify(tokens)), expiresAt],
        );
    }

    /** 토큰만 지운다(client 등록은 보존) — SDK invalidateCredentials('tokens') 대응 */
    async clearTokens(serverId: string, userId: string): Promise<void> {
        await this.pool.query(
            `UPDATE mcp_oauth_credentials SET tokens_enc = NULL, token_expires_at = NULL, updated_at = NOW()
              WHERE mcp_server_id = $1 AND user_id = $2`,
            [serverId, userId],
        );
    }

    /** 전부 지운다(로그아웃 / invalidateCredentials('all')) */
    async clearAll(serverId: string, userId: string): Promise<void> {
        await this.pool.query(`DELETE FROM mcp_oauth_credentials WHERE mcp_server_id = $1 AND user_id = $2`, [serverId, userId]);
    }

    /** 목록 API 용 — 토큰을 가진 서버 id 집합 (복호화 없이 존재 여부만) */
    async listConnectedServerIds(userId: string, serverIds: string[]): Promise<Set<string>> {
        if (serverIds.length === 0) return new Set();
        const r = await this.pool.query<{ mcp_server_id: string }>(
            `SELECT mcp_server_id FROM mcp_oauth_credentials
              WHERE user_id = $1 AND mcp_server_id = ANY($2::text[]) AND tokens_enc IS NOT NULL`,
            [userId, serverIds],
        );
        return new Set(r.rows.map(x => x.mcp_server_id));
    }
}
