/**
 * @module data/repositories/audit-repository
 * @description 감사/로깅 테이블 데이터 접근 계층
 *
 * 에이전트 사용 로그와 감사 로그 엔티티의 CRUD를 담당합니다.
 * - 에이전트 사용 로그 기록 (agent_usage_logs)
 * - 감사 로그 생성/조회 (audit_logs)
 */
import { BaseRepository } from './base-repository';

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

}
