/**
 * @module data/repositories/audit-repository
 * @description 감사/로깅 및 외부 연동 테이블 데이터 접근 계층
 *
 * 에이전트 사용 로그, 시스템 알림, 외부 서비스 연결, MCP 서버 설정 등
 * 운영/감사 관련 엔티티의 CRUD를 담당합니다.
 * - 에이전트 사용 로그 기록 (agent_usage_logs)
 * - 시스템 알림 생성/조회/확인 (system_alerts)
 * - 외부 서비스 연결/파일 관리 (external_connections, external_files)
 * - MCP 서버 설정 관리 (mcp_servers)
 */
import { BaseRepository, QueryParam } from './base-repository';
import type { ExternalConnection, ExternalFile, ExternalServiceType, MCPServerRow } from '../models/unified-database';

type DbRow = Record<string, unknown>;

export class AuditRepository extends BaseRepository {
    async logAgentUsage(params: {
        userId?: string;
        sessionId?: string;
        agentId: string;
        query: string;
        responsePreview?: string;
        responseTimeMs?: number;
        tokensUsed?: number;
        success?: boolean;
        errorMessage?: string;
    }) {
        return this.query(
            `INSERT INTO agent_usage_logs 
            (user_id, session_id, agent_id, query, response_preview, response_time_ms, tokens_used, success, error_message)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
                params.userId,
                params.sessionId,
                params.agentId,
                params.query,
                params.responsePreview,
                params.responseTimeMs,
                params.tokensUsed,
                params.success !== false,
                params.errorMessage
            ]
        );
    }

    async getAgentStats(agentId: string) {
        const result = await this.query(
            `SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as successful_requests,
                AVG(response_time_ms) as avg_response_time,
                AVG(tokens_used) as avg_tokens
            FROM agent_usage_logs
            WHERE agent_id = $1`,
            [agentId]
        );
        return result.rows[0];
    }

    async logAudit(params: {
        action: string;
        userId?: string;
        resourceType?: string;
        resourceId?: string;
        details?: Record<string, unknown>;
        ipAddress?: string;
        userAgent?: string;
    }) {
        return this.query(
            `INSERT INTO audit_logs 
            (action, user_id, resource_type, resource_id, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                params.action,
                params.userId,
                params.resourceType,
                params.resourceId,
                JSON.stringify(params.details || {}),
                params.ipAddress,
                params.userAgent
            ]
        );
    }

    async getAuditLogs(limit: number = 100) {
        const result = await this.query('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT $1', [limit]);
        return result.rows;
    }

    async getStats() {
        const stats: Record<string, number> = {};

        const result = await this.query(
            `SELECT 'users' as table_name, COUNT(*) as count FROM users
            UNION ALL SELECT 'conversation_sessions', COUNT(*) FROM conversation_sessions
            UNION ALL SELECT 'conversation_messages', COUNT(*) FROM conversation_messages
            UNION ALL SELECT 'api_usage', COUNT(*) FROM api_usage
            UNION ALL SELECT 'agent_usage_logs', COUNT(*) FROM agent_usage_logs
            UNION ALL SELECT 'agent_feedback', COUNT(*) FROM agent_feedback
            UNION ALL SELECT 'custom_agents', COUNT(*) FROM custom_agents
            UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs
            UNION ALL SELECT 'alert_history', COUNT(*) FROM alert_history`
        );

        for (const row of result.rows as { table_name: string; count: string }[]) {
            stats[row.table_name] = parseInt(row.count, 10);
        }

        return stats;
    }

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
                params.accessToken,
                params.refreshToken,
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
            [tokens.accessToken, tokens.refreshToken, tokens.expiresAt, connectionId]
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
        const result = await this.query('SELECT * FROM mcp_servers ORDER BY created_at DESC');
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
