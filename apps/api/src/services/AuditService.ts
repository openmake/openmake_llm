import { getPool, getUnifiedDatabase } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';
import { AUDIT_ACTIONS, CRITICAL_ACTIONS, type AuditAction, type AuditSeverity } from '../config/audit-actions';

const logger = createLogger('AuditService');

type AuditLog = Record<string, unknown>;

interface AuditStat {
    action: string;
    count: number;
}

interface GetAuditLogsFilters {
    startDate?: string;
    endDate?: string;
    action?: string;
    userId?: string;
    limit?: number;
    offset?: number;
}

interface CreateAuditLogInput {
    /** config/audit-actions 레지스트리에 등록된 action 만 받는다 (미등록·오타는 컴파일 오류). */
    action: AuditAction;
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    /**
     * Alert sender tracking (PR follow-up) — actor 의 풍부한 정보. sendAlertForAction 에서
     * webhook payload 의 title/message 가독성 향상에 사용. DB INSERT 시 details 에 자동 병합.
     */
    actor?: {
        email?: string;
        username?: string;
        role?: string;
    };
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
        // 레지스트리(서버가 기록할 수 있는 action 전부) + DB 에만 남은 과거 action.
        // 아직 한 번도 기록되지 않은 action 도 필터 목록에 나오고, 과거 기록도 계속 걸러 볼 수 있다.
        return [...new Set<string>([...AUDIT_ACTIONS, ...rows.map((row) => row.action)])].sort();
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
            // actor 정보를 details 에 병합 (DB 영속화 — webhook 외 audit 조회 시도 표시)
            const mergedDetails = input.actor
                ? { ...(input.details ?? {}), actor: input.actor }
                : input.details;
            await db.logAudit({
                action: input.action,
                userId: input.userId,
                resourceType: input.resourceType,
                resourceId: input.resourceId,
                details: mergedDetails,
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
 * AlertSystem 으로 critical event 알림. info 는 webhook 안 보내고 console 만.
 * warning+ 는 channel 전체 (console + webhook + email if configured).
 */
async function sendAlertForAction(
    input: CreateAuditLogInput,
    severity: AuditSeverity,
): Promise<void> {
    try {
        const { getAlertSystem } = await import('../monitoring/alerts');
        // alert type 은 AlertType enum 에 등록된 것만 valid — 동적이라 string cast.
        // AuditService 의 whitelist 가 SoT.
        // Actor 정보 풍부화 — email > username > userId 우선순위로 표시명 + role 명시.
        const actorDisplay = input.actor?.email
            || input.actor?.username
            || input.userId
            || 'system';
        const roleSuffix = input.actor?.role ? ` (${input.actor.role})` : '';
        await getAlertSystem().sendAlert(
            input.action.replace(/\./g, '_') as never,
            severity,
            `[audit] ${input.action} by ${actorDisplay}${roleSuffix}`,
            `Resource: ${input.resourceType ?? '-'}/${input.resourceId ?? '-'} | IP: ${input.ipAddress ?? '-'}`,
            {
                actor: input.actor,
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
