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

        // 전체 매칭 수를 별도 COUNT 쿼리로 가져옴 (페이지네이션 total)
        const countResult = await pool.query(
            `SELECT COUNT(*) AS cnt FROM audit_logs ${whereClause}`,
            params
        );
        const total = parseInt((countResult.rows[0] as { cnt: string }).cnt, 10);

        const result = await pool.query(
            `SELECT * FROM audit_logs ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            [...params, limit, offset]
        );

        const logs = result.rows as AuditLog[];
        return { logs, total };
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

        // GDPR Phase D follow-up — critical event 시 fire-and-forget AlertSystem.
        // whitelist 만 alert 발송 (chat 등 빈도 높은 event 는 skip).
        const severity = CRITICAL_ACTIONS[input.action];
        if (severity) {
            void sendAlertForAction(input, severity);
        }
    }
}

/**
 * Critical event whitelist — audit_logs INSERT 시 자동 AlertSystem 호출 대상.
 * severity 별로 channel 영향: info 는 console 만 (spam 방어), warning+ 는 webhook 도 발송.
 */
const CRITICAL_ACTIONS: Record<string, 'info' | 'warning' | 'critical'> = {
    // GDPR Article 17 (right to erasure) — admin 의 사용자 삭제
    'user.deleted': 'critical',
    // 권한 변화 — admin 승격/박탈
    'user.role_changed': 'critical',
    // 보안 변화
    'password.changed': 'warning',
    // GDPR Article 7(3) — 동의 철회
    'consent.withdrawn': 'warning',
    // GDPR Article 20 — 데이터 export 요청 (operator 인지용)
    'export.requested': 'warning',
    // 기존 ApiKeyService 패턴 정합
    'api_key.revoked': 'warning',
    // info 는 audit 만 (alert webhook 안 보냄)
    'api_key.created': 'info',
    'user.register': 'info',
    'consent.granted': 'info',
    'login.failed': 'info',
};

/**
 * AlertSystem 으로 critical event 알림. info 는 webhook 안 보내고 console 만.
 * warning+ 는 channel 전체 (console + webhook + email if configured).
 */
async function sendAlertForAction(
    input: CreateAuditLogInput,
    severity: 'info' | 'warning' | 'critical',
): Promise<void> {
    try {
        const { getAlertSystem } = await import('../monitoring/alerts');
        // alert type 은 AlertType enum 에 등록된 것만 valid — 동적이라 string cast.
        // AuditService 의 whitelist 가 SoT.
        await getAlertSystem().sendAlert(
            input.action.replace(/\./g, '_') as never,
            severity,
            `[audit] ${input.action} by ${input.userId || 'system'}`,
            `Resource: ${input.resourceType ?? '-'}/${input.resourceId ?? '-'}`,
            {
                userId: input.userId,
                resourceType: input.resourceType,
                resourceId: input.resourceId,
                ipAddress: input.ipAddress,
                userAgent: input.userAgent,
                ...(input.details ?? {}),
            },
        );
    } catch (err) {
        logger.error(`[AuditAlert] sendAlert 실패 (action=${input.action}):`, err);
    }
}

let auditServiceInstance: AuditService | null = null;

export function getAuditService(): AuditService {
    if (!auditServiceInstance) {
        auditServiceInstance = new AuditService();
    }
    return auditServiceInstance;
}
