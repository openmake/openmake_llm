/**
 * @module data/repositories/external-repository
 * @description 외부 연동 테이블 데이터 접근 계층
 *
 * 외부 서비스 연결/파일 캐시 및 MCP 서버 설정 관련 엔티티의 CRUD를 담당합니다.
 * - 외부 서비스 연결/파일 관리 (external_connections, external_files)
 * (MCP 서버 설정(mcp_servers) CRUD 는 2026-10-18 MCP 런타임 add-on 으로 옮겼다 — addons/mcp-runtime/data/mcp-server-repository.ts)
 */
import { BaseRepository } from './base-repository';
import type { ExternalConnection, ExternalFile, ExternalServiceType } from '../models/unified-database.types';
import { encryptToken, tryDecryptToken } from '../../utils/token-crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ExternalRepository');

/**
 * OAuth 토큰 1개 복호화 — 실패 시 null.
 *
 * 복호화 실패(암호문 잔존·비-dev throw)는 tryDecryptToken 이 null 로 내린다.
 * 암호문을 그대로 반환하면 암호문이 그대로 Bearer 토큰으로 쓰여
 * 외부 API 가 401 을 내는 조용한 실패가 된다. null 로 내리면 소비자들이 이미 갖춘
 * "토큰 없음" 폴백(clone/push/PR skip)으로 자연스럽게 degrade 된다.
 *
 * 커넥션 단위로만 무효화하므로 목록 조회에서 한 건이 손상돼도 나머지는 정상 반환된다.
 */
function decryptTokenField(value: unknown, field: string, connectionId?: unknown): string | undefined {
    if (value == null) return undefined;
    const plain = tryDecryptToken(value as string);
    if (plain === null) {
        logger.error(`OAuth ${field} 복호화 실패 (connection=${String(connectionId ?? 'unknown')}): 암호문이 그대로 남았습니다 — TOKEN_ENCRYPTION_KEY 확인 필요`);
        return undefined;
    }
    return plain;
}

export class ExternalRepository extends BaseRepository {
    async createExternalConnection(params: {
        id: string;
        userId: string;
        serviceType: ExternalServiceType;
        accessToken?: string;
        refreshToken?: string;
        tokenExpiresAt?: string;
        accountEmail?: string;
        accountName?: string;
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        await this.query(
            `INSERT INTO external_connections 
            (id, user_id, service_type, access_token, refresh_token, token_expires_at, account_email, account_name, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT(user_id, service_type) DO UPDATE SET
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                account_email = EXCLUDED.account_email,
                account_name = EXCLUDED.account_name,
                metadata = EXCLUDED.metadata,
                is_active = TRUE,
                updated_at = NOW()`,
            [
                params.id,
                params.userId,
                params.serviceType,
                params.accessToken != null ? encryptToken(params.accessToken) : params.accessToken,
                params.refreshToken != null ? encryptToken(params.refreshToken) : params.refreshToken,
                params.tokenExpiresAt,
                params.accountEmail,
                params.accountName,
                params.metadata ? JSON.stringify(params.metadata) : null
            ]
        );
    }

    async getUserConnections(userId: string): Promise<ExternalConnection[]> {
        const result = await this.query<ExternalConnection>(
            'SELECT * FROM external_connections WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at DESC',
            [userId]
        );
        return result.rows.map((row) => ({
            ...row,
            access_token: decryptTokenField(row.access_token, 'access_token', row.id),
            refresh_token: decryptTokenField(row.refresh_token, 'refresh_token', row.id),
            is_active: !!row.is_active,
            metadata: row.metadata || {}
        }));
    }

    async getExternalConnection(connectionId: string): Promise<ExternalConnection | undefined> {
        const result = await this.query<ExternalConnection>('SELECT * FROM external_connections WHERE id = $1', [connectionId]);
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            access_token: decryptTokenField(row.access_token, 'access_token', row.id),
            refresh_token: decryptTokenField(row.refresh_token, 'refresh_token', row.id),
            is_active: !!row.is_active,
            metadata: row.metadata || {}
        };
    }

    async getUserConnectionByService(userId: string, serviceType: ExternalServiceType): Promise<ExternalConnection | undefined> {
        const result = await this.query<ExternalConnection>(
            'SELECT * FROM external_connections WHERE user_id = $1 AND service_type = $2 AND is_active = TRUE',
            [userId, serviceType]
        );
        const row = result.rows[0];
        if (!row) return undefined;

        return {
            ...row,
            access_token: decryptTokenField(row.access_token, 'access_token', row.id),
            refresh_token: decryptTokenField(row.refresh_token, 'refresh_token', row.id),
            is_active: !!row.is_active,
            metadata: row.metadata || {}
        };
    }

    async updateConnectionTokens(connectionId: string, tokens: {
        accessToken: string;
        refreshToken?: string;
        expiresAt?: string;
    }): Promise<void> {
        await this.query(
            `UPDATE external_connections 
            SET access_token = $1, refresh_token = COALESCE($2, refresh_token), token_expires_at = $3, updated_at = NOW()
            WHERE id = $4`,
            [
                encryptToken(tokens.accessToken),
                tokens.refreshToken != null ? encryptToken(tokens.refreshToken) : tokens.refreshToken,
                tokens.expiresAt,
                connectionId
            ]
        );
    }

    async disconnectService(userId: string, serviceType: ExternalServiceType): Promise<void> {
        await this.query(
            `UPDATE external_connections 
            SET is_active = FALSE, access_token = NULL, refresh_token = NULL, updated_at = NOW()
            WHERE user_id = $1 AND service_type = $2`,
            [userId, serviceType]
        );
    }

    async cacheExternalFile(params: {
        id: string;
        connectionId: string;
        externalId: string;
        fileName: string;
        fileType?: string;
        fileSize?: number;
        webUrl?: string;
        cachedContent?: string;
    }): Promise<void> {
        await this.query(
            `INSERT INTO external_files 
            (id, connection_id, external_id, file_name, file_type, file_size, web_url, cached_content, last_synced)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            ON CONFLICT(connection_id, external_id) DO UPDATE SET
                file_name = EXCLUDED.file_name,
                file_type = EXCLUDED.file_type,
                file_size = EXCLUDED.file_size,
                web_url = EXCLUDED.web_url,
                cached_content = EXCLUDED.cached_content,
                last_synced = NOW()`,
            [
                params.id,
                params.connectionId,
                params.externalId,
                params.fileName,
                params.fileType,
                params.fileSize,
                params.webUrl,
                params.cachedContent
            ]
        );
    }

    async getConnectionFiles(connectionId: string, limit: number = 100): Promise<ExternalFile[]> {
        const result = await this.query<ExternalFile>(
            'SELECT * FROM external_files WHERE connection_id = $1 ORDER BY last_synced DESC LIMIT $2',
            [connectionId, limit]
        );
        return result.rows as ExternalFile[];
    }

    async getCachedFile(connectionId: string, externalId: string): Promise<ExternalFile | undefined> {
        const result = await this.query<ExternalFile>(
            'SELECT * FROM external_files WHERE connection_id = $1 AND external_id = $2',
            [connectionId, externalId]
        );
        return result.rows[0] as ExternalFile | undefined;
    }
}
