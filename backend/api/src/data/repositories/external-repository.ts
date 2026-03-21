/**
 * @module data/repositories/external-repository
 * @description 외부 연동 테이블 데이터 접근 계층
 *
 * 외부 서비스 연결/파일 캐시 및 MCP 서버 설정 관련 엔티티의 CRUD를 담당합니다.
 * - 외부 서비스 연결/파일 관리 (external_connections, external_files)
 * - MCP 서버 설정 관리 (mcp_servers)
 */
import { BaseRepository, QueryParam } from './base-repository';
import type { ExternalConnection, ExternalFile, ExternalServiceType, MCPServerRow } from '../models/unified-database.types';
import { encryptToken, decryptToken } from '../../utils/token-crypto';

type DbRow = Record<string, unknown>;

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
            access_token: row.access_token != null ? decryptToken(row.access_token as string) : row.access_token,
            refresh_token: row.refresh_token != null ? decryptToken(row.refresh_token as string) : row.refresh_token,
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
            access_token: row.access_token != null ? decryptToken(row.access_token as unknown as string) : row.access_token,
            refresh_token: row.refresh_token != null ? decryptToken(row.refresh_token as unknown as string) : row.refresh_token,
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
            access_token: row.access_token != null ? decryptToken(row.access_token as unknown as string) : row.access_token,
            refresh_token: row.refresh_token != null ? decryptToken(row.refresh_token as unknown as string) : row.refresh_token,
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

    async getMcpServers(): Promise<MCPServerRow[]> {
        const result = await this.query('SELECT * FROM mcp_servers ORDER BY created_at DESC LIMIT 1000');
        return result.rows.map((row: DbRow) => ({
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        })) as MCPServerRow[];
    }

    async getMcpServerById(id: string): Promise<MCPServerRow | null> {
        const result = await this.query('SELECT * FROM mcp_servers WHERE id = $1', [id]);
        const row = result.rows[0] as DbRow | undefined;
        if (!row) return null;

        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        } as MCPServerRow;
    }

    async createMcpServer(server: Omit<MCPServerRow, 'created_at' | 'updated_at'>): Promise<MCPServerRow> {
        const result = await this.query(
            `INSERT INTO mcp_servers (id, name, transport_type, command, args, env, url, enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *`,
            [
                server.id,
                server.name,
                server.transport_type,
                server.command,
                server.args ? JSON.stringify(server.args) : null,
                server.env ? JSON.stringify(server.env) : null,
                server.url,
                server.enabled
            ]
        );
        const row = result.rows[0] as DbRow;
        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        } as MCPServerRow;
    }

    async updateMcpServer(id: string, updates: Partial<Pick<MCPServerRow, 'name' | 'transport_type' | 'command' | 'args' | 'env' | 'url' | 'enabled'>>): Promise<MCPServerRow | null> {
        const sets: string[] = ['updated_at = NOW()'];
        const params: QueryParam[] = [];
        let paramIdx = 1;

        if (updates.name !== undefined) {
            sets.push(`name = $${paramIdx++}`);
            params.push(updates.name);
        }
        if (updates.transport_type !== undefined) {
            sets.push(`transport_type = $${paramIdx++}`);
            params.push(updates.transport_type);
        }
        if (updates.command !== undefined) {
            sets.push(`command = $${paramIdx++}`);
            params.push(updates.command);
        }
        if (updates.args !== undefined) {
            sets.push(`args = $${paramIdx++}`);
            params.push(updates.args ? JSON.stringify(updates.args) : null);
        }
        if (updates.env !== undefined) {
            sets.push(`env = $${paramIdx++}`);
            params.push(updates.env ? JSON.stringify(updates.env) : null);
        }
        if (updates.url !== undefined) {
            sets.push(`url = $${paramIdx++}`);
            params.push(updates.url);
        }
        if (updates.enabled !== undefined) {
            sets.push(`enabled = $${paramIdx++}`);
            params.push(updates.enabled);
        }

        params.push(id);
        const result = await this.query(
            `UPDATE mcp_servers SET ${sets.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
            params
        );

        const row = result.rows[0] as DbRow | undefined;
        if (!row) return null;

        return {
            ...row,
            args: (row.args as string[] | null) || null,
            env: (row.env as Record<string, string> | null) || null,
            enabled: !!row.enabled
        } as MCPServerRow;
    }

    async deleteMcpServer(id: string): Promise<boolean> {
        const result = await this.query('DELETE FROM mcp_servers WHERE id = $1', [id]);
        return (result.rowCount || 0) > 0;
    }
}
