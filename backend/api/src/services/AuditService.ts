import { getPool, getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('AuditService');

export type AuditLog = Record<string, unknown>;

export interface AuditStat {
    action: string;
    count: number;
}

export interface GetAuditLogsFilters {
    startDate?: string;
    endDate?: string;
    action?: string;
    userId?: string;
    limit?: number;
    offset?: number;
}

export interface CreateAuditLogInput {
    action: string;
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
}

export class AuditService {
    async getAuditLogs(filters: GetAuditLogsFilters): Promise<{ logs: AuditLog[]; total: number }> {
        const pool = getPool();
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (filters.startDate) {
            conditions.push(`timestamp >= $${paramIndex++}`);
            params.push(filters.startDate);
        }

        if (filters.endDate) {
            conditions.push(`timestamp <= $${paramIndex++}`);
            params.push(filters.endDate);
        }

        if (filters.action) {
            conditions.push(`action = $${paramIndex++}`);
            params.push(filters.action);
        }

        if (filters.userId) {
            conditions.push(`user_id = $${paramIndex++}`);
            params.push(filters.userId);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = filters.limit ?? 100;
        const offset = filters.offset ?? 0;

        const result = await pool.query(
            `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            [...params, limit, offset]
        );

        const logs = result.rows as AuditLog[];
        return { logs, total: logs.length };
    }

    async getDistinctActions(): Promise<string[]> {
        const pool = getPool();
        const result = await pool.query('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC');
        const rows = result.rows as Array<{ action: string }>;
        return rows.map((row) => row.action);
    }

    async getAuditStats(startDate?: string, endDate?: string): Promise<AuditStat[]> {
        const pool = getPool();
        const conditions: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        if (startDate) {
            conditions.push(`timestamp >= $${paramIndex++}`);
            params.push(startDate);
        }

        if (endDate) {
            conditions.push(`timestamp <= $${paramIndex++}`);
            params.push(endDate);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
            `SELECT action, COUNT(*)::int AS count FROM audit_logs ${whereClause} GROUP BY action ORDER BY action ASC`,
            params
        );

        return (result.rows as Array<{ action: string; count: number }>).map((row) => ({
            action: row.action,
            count: Number(row.count),
        }));
    }

    async logAudit(input: CreateAuditLogInput): Promise<void> {
        const db = getUnifiedDatabase();
        try {
            await db.logAudit({
                action: input.action,
                userId: input.userId,
                resourceType: input.resourceType,
                resourceId: input.resourceId,
                details: input.details,
                ipAddress: input.ipAddress,
                userAgent: input.userAgent,
            });
        } catch (error) {
            logger.error('Failed to create audit log:', error);
            throw error;
        }
    }
}

let auditServiceInstance: AuditService | null = null;

export function getAuditService(): AuditService {
    if (!auditServiceInstance) {
        auditServiceInstance = new AuditService();
    }
    return auditServiceInstance;
}
