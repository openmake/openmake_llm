/**
 * 원격 MCP 사전 등록 OAuth 클라이언트 저장소 (mcp_catalog_oauth_clients, 마이그레이션 155 — 계획 R-3).
 *
 * 동적 등록을 받지 않는 인가 서버(GitHub·Google)용으로 운영자가 입력한 client_id·secret 을 카탈로그 항목당 1개 둔다.
 * secret 은 `utils/token-crypto` 암호문만 저장하고, 읽을 때 복호화에 실패하면(키 부재·손상) secret 없이 돌려준다 —
 * 암호문을 자격증명으로 보내 조용히 실패하는 것보다 "secret 없음" 으로 토큰 교환이 명확히 실패하는 편이 낫다.
 *
 * @module data/repositories/mcp-catalog-oauth-client-repository
 */
import type { Pool } from 'pg';
import { encryptToken, decryptToken, isDecryptionFailure } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('McpCatalogOAuthClientRepository');

export type StaticTokenEndpointAuthMethod = 'client_secret_post' | 'client_secret_basic' | 'none';

export interface StaticOAuthClient {
    catalogId: string;
    clientId: string;
    clientSecret?: string;
    tokenEndpointAuthMethod?: StaticTokenEndpointAuthMethod;
    scope?: string;
    authorizationParams: Record<string, string>;
}

/** 관리자 화면용 — secret 원문 대신 보유 여부만 */
export interface StaticOAuthClientView extends Omit<StaticOAuthClient, 'clientSecret'> {
    hasSecret: boolean;
    updatedAt: string;
}

interface Row {
    catalog_id: string;
    client_id: string;
    client_secret_enc: string | null;
    token_endpoint_auth_method: StaticTokenEndpointAuthMethod | null;
    scope: string | null;
    authorization_params: Record<string, string> | null;
    updated_at: string;
}

const COLUMNS = 'catalog_id, client_id, client_secret_enc, token_endpoint_auth_method, scope, authorization_params, updated_at::text';

export class McpCatalogOAuthClientRepository {
    constructor(private readonly pool: Pool) {}

    /** 카탈로그 항목으로 조회(복호화 포함) */
    async get(catalogId: string): Promise<StaticOAuthClient | undefined> {
        const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM mcp_catalog_oauth_clients WHERE catalog_id = $1`, [catalogId]);
        return r.rows[0] ? this.toClient(r.rows[0]) : undefined;
    }

    /** 사용자 설치 서버(mcp_servers.catalog_template_id)로 조회 — provider 가 쓴다 */
    async getForServer(serverId: string): Promise<StaticOAuthClient | undefined> {
        const r = await this.pool.query<Row>(
            `SELECT c.catalog_id, c.client_id, c.client_secret_enc, c.token_endpoint_auth_method, c.scope, c.authorization_params, c.updated_at::text
             FROM mcp_servers s JOIN mcp_catalog_oauth_clients c ON c.catalog_id = s.catalog_template_id
             WHERE s.id = $1`,
            [serverId],
        );
        return r.rows[0] ? this.toClient(r.rows[0]) : undefined;
    }

    async getView(catalogId: string): Promise<StaticOAuthClientView | undefined> {
        const r = await this.pool.query<Row>(`SELECT ${COLUMNS} FROM mcp_catalog_oauth_clients WHERE catalog_id = $1`, [catalogId]);
        const row = r.rows[0];
        if (!row) return undefined;
        return {
            catalogId: row.catalog_id,
            clientId: row.client_id,
            hasSecret: !!row.client_secret_enc,
            ...(row.token_endpoint_auth_method ? { tokenEndpointAuthMethod: row.token_endpoint_auth_method } : {}),
            ...(row.scope ? { scope: row.scope } : {}),
            authorizationParams: row.authorization_params ?? {},
            updatedAt: row.updated_at,
        };
    }

    /**
     * 저장 — `clientSecret` 이 undefined 면 기존 secret 유지, null 이면 제거.
     * 카탈로그 항목이 없으면 FK 위반으로 throw(라우트가 404 로 먼저 거른다).
     */
    async upsert(p: {
        catalogId: string;
        clientId: string;
        clientSecret?: string | null;
        tokenEndpointAuthMethod?: StaticTokenEndpointAuthMethod | null;
        scope?: string | null;
        authorizationParams?: Record<string, string>;
        updatedBy: string;
    }): Promise<void> {
        const keepSecret = p.clientSecret === undefined;
        await this.pool.query(
            `INSERT INTO mcp_catalog_oauth_clients
                (catalog_id, client_id, client_secret_enc, token_endpoint_auth_method, scope, authorization_params, updated_by)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
             ON CONFLICT (catalog_id) DO UPDATE SET
                client_id = EXCLUDED.client_id,
                client_secret_enc = CASE WHEN $8 THEN mcp_catalog_oauth_clients.client_secret_enc ELSE EXCLUDED.client_secret_enc END,
                token_endpoint_auth_method = EXCLUDED.token_endpoint_auth_method,
                scope = EXCLUDED.scope,
                authorization_params = EXCLUDED.authorization_params,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()`,
            [
                p.catalogId, p.clientId,
                p.clientSecret ? encryptToken(p.clientSecret) : null,
                p.tokenEndpointAuthMethod ?? null,
                p.scope ?? null,
                JSON.stringify(p.authorizationParams ?? {}),
                p.updatedBy,
                keepSecret,
            ],
        );
    }

    async delete(catalogId: string): Promise<boolean> {
        const r = await this.pool.query(`DELETE FROM mcp_catalog_oauth_clients WHERE catalog_id = $1`, [catalogId]);
        return (r.rowCount ?? 0) > 0;
    }

    private toClient(row: Row): StaticOAuthClient {
        let clientSecret: string | undefined;
        if (row.client_secret_enc) {
            const plain = decryptToken(row.client_secret_enc);
            if (isDecryptionFailure(plain)) logger.warn(`client_secret 복호화 실패 — secret 없이 진행 catalog=${row.catalog_id}`);
            else clientSecret = plain;
        }
        return {
            catalogId: row.catalog_id,
            clientId: row.client_id,
            ...(clientSecret ? { clientSecret } : {}),
            ...(row.token_endpoint_auth_method ? { tokenEndpointAuthMethod: row.token_endpoint_auth_method } : {}),
            ...(row.scope ? { scope: row.scope } : {}),
            authorizationParams: row.authorization_params ?? {},
        };
    }
}
