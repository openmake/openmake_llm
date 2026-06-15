/**
 * ============================================================
 * Admin Alerts / Monitoring Controller
 * ============================================================
 * admin.controller.ts 에서 분리 (파일 크기 가드 — 알림/모니터링 핸들러 책임 분리).
 * 모든 핸들러는 this 상태 비의존 + 의존성은 dynamic import() 로 self-contained → 순환 없음.
 * AdminController.setupRoutes() 가 이 함수들을 라우트에 직접 바인딩한다.
 *
 * @module controllers/admin-alerts.controller
 */
import { Request, Response } from 'express';
import { success, badRequest, internalError } from '../utils/api-response';
import { createLogger } from '../utils/logger';

const log = createLogger('AdminAlerts');

export async function listAlertHistory(req: Request, res: Response): Promise<void> {
    try {
        const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 500);
        const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
        const type = req.query.type ? String(req.query.type) : null;
        const severity = req.query.severity ? String(req.query.severity) : null;
        const startDate = req.query.startDate ? String(req.query.startDate) : null;
        const endDate = req.query.endDate ? String(req.query.endDate) : null;
        // acknowledged 필터: 'true'/'false' string, 미설정 시 전체
        const ackParam = req.query.acknowledged !== undefined ? String(req.query.acknowledged) : null;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        if (type) { conditions.push(`type = $${idx++}`); params.push(type); }
        if (severity) { conditions.push(`severity = $${idx++}`); params.push(severity); }
        if (startDate) { conditions.push(`created_at >= $${idx++}`); params.push(startDate); }
        if (endDate) { conditions.push(`created_at <= $${idx++}`); params.push(endDate); }
        if (ackParam === 'true') { conditions.push(`acknowledged = TRUE`); }
        else if (ackParam === 'false') { conditions.push(`acknowledged = FALSE`); }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();

        const totalRes = await pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM alert_history ${whereClause}`, params,
        );
        const total = parseInt(totalRes.rows[0]?.count ?? '0', 10);

        const dataRes = await pool.query(
            `SELECT id, type, severity, title, message, data, created_at,
                    acknowledged, acknowledged_by, acknowledged_at
             FROM alert_history ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${idx++} OFFSET $${idx++}`,
            [...params, limit, offset],
        );
        res.json(success({ history: dataRes.rows, total, limit, offset }));
    } catch (error) {
        log.error('[Admin AlertHistory] 오류:', error);
        res.status(500).json(internalError('알림 이력 조회 실패'));
    }
}

/**
 * GET /api/admin/llm-pool/stats — 단일 모델 context-fit 안전망 통계.
 *
 * (2026-06-15: 1M 노드 제거 — 1M routing 비율 대신 truncation 안전망 활동을 추적.)
 *
 * 응답:
 *   - byModel: { 'qwen3.6-35b-a3b': N, ... }
 *   - bySource: { auto: N, auto_trimmed: N, auto_trimmed_reduced: N, manual: N, pool_disabled: N }
 *   - trimmedRatioPct: truncation(auto_trimmed*) 발동 비율 (%) — 높으면 입력 과대/margin 검토
 *   - last7Days: [{ date, total, trimmed }] × 7
 *
 * 모두 지난 7일 데이터. 운영자가 LLM_POOL_DEFAULT_MARGIN_PCT 조정 의사결정용.
 */
export async function getLlmPoolStats(_req: Request, res: Response): Promise<void> {
    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();

        const [byModelRes, bySourceRes, trendRes] = await Promise.all([
            pool.query<{ model: string; count: string }>(
                `SELECT model, COUNT(*)::text AS count FROM model_pool_metrics
                 WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY model`,
            ),
            pool.query<{ source: string; count: string }>(
                `SELECT source, COUNT(*)::text AS count FROM model_pool_metrics
                 WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY source`,
            ),
            pool.query<{ date: string; total: string; trimmed_count: string }>(
                `SELECT to_char(date_trunc('day', d), 'YYYY-MM-DD') AS date,
                        COUNT(m.*)::text AS total,
                        COUNT(*) FILTER (WHERE m.source LIKE 'auto_trimmed%')::text AS trimmed_count
                 FROM generate_series(date_trunc('day', NOW()) - INTERVAL '6 days',
                                      date_trunc('day', NOW()), INTERVAL '1 day') AS d
                 LEFT JOIN model_pool_metrics m ON date_trunc('day', m.created_at) = d
                 GROUP BY d ORDER BY d ASC`,
            ),
        ]);

        const byModel: Record<string, number> = {};
        let totalCount = 0;
        for (const r of byModelRes.rows) {
            const n = parseInt(r.count, 10);
            byModel[r.model] = n;
            totalCount += n;
        }

        const bySource: Record<string, number> = {};
        let trimmedCount = 0;
        for (const r of bySourceRes.rows) {
            const n = parseInt(r.count, 10);
            bySource[r.source] = n;
            if (r.source.startsWith('auto_trimmed')) trimmedCount += n;
        }

        // Phase L (2026-05-26): LLM 자체 관측 강화 — usage-tracker 의 hourly/weekly
        // quota 통합. LiteLLM /global/spend 가 비활성이므로 클라이언트 측 tracking 으로 대체.
        const { getApiUsageTracker } = await import('../llm');
        const quota = getApiUsageTracker().getQuotaStatus();

        // model_pool_metrics 의 input_tokens 7일 합계 (대략적 prompt token 비용)
        const tokensRes = await pool.query<{ sum: string | null }>(
            `SELECT COALESCE(SUM(input_tokens), 0)::text AS sum FROM model_pool_metrics
             WHERE created_at >= NOW() - INTERVAL '7 days' AND input_tokens IS NOT NULL`,
        );
        const last7DaysInputTokens = parseInt(tokensRes.rows[0]?.sum ?? '0', 10);

        res.json(success({
            byModel,
            bySource,
            totalCount,
            trimmedRatioPct: totalCount > 0 ? Math.round((trimmedCount / totalCount) * 1000) / 10 : 0,
            last7Days: trendRes.rows.map(r => ({
                date: r.date,
                total: parseInt(r.total, 10),
                trimmed: parseInt(r.trimmed_count, 10),
            })),
            quota: {
                hourly: quota.hourly,
                weekly: quota.weekly,
            },
            last7DaysInputTokens,
        }));
    } catch (error) {
        log.error('[Admin LlmPoolStats] 오류:', error);
        res.status(500).json(internalError('LLM pool 통계 조회 실패'));
    }
}

/**
 * GET /api/admin/alerts/stats — alert_history 대시보드 요약 통계.
 *
 * 응답 schema:
 *   - todayCriticalCount: 오늘 0시 이후 critical 개수
 *   - pendingAckCount: 전체 acknowledged=false 개수 (모든 severity)
 *   - last7Days: [{ date: 'YYYY-MM-DD', total, info, warning, critical }] × 7
 *   - severityTotals: { info, warning, critical } — 지난 7일 합계
 *
 * 4 query 병렬 실행. 운영자 dashboard 진입 시 초당 호출 가능 — 가벼움 우선.
 */
export async function getAlertStats(_req: Request, res: Response): Promise<void> {
    try {
        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();

        const [todayCrit, pendingAck, trend, severityTotals] = await Promise.all([
            pool.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count FROM alert_history
                 WHERE severity = 'critical' AND created_at >= date_trunc('day', NOW())`,
            ),
            pool.query<{ count: string }>(
                `SELECT COUNT(*)::text AS count FROM alert_history WHERE acknowledged = FALSE`,
            ),
            pool.query<{ date: string; total: string; info: string; warning: string; critical: string }>(
                `SELECT to_char(date_trunc('day', d), 'YYYY-MM-DD') AS date,
                        COUNT(a.*)::text AS total,
                        COUNT(*) FILTER (WHERE a.severity = 'info')::text AS info,
                        COUNT(*) FILTER (WHERE a.severity = 'warning')::text AS warning,
                        COUNT(*) FILTER (WHERE a.severity = 'critical')::text AS critical
                 FROM generate_series(date_trunc('day', NOW()) - INTERVAL '6 days',
                                      date_trunc('day', NOW()), INTERVAL '1 day') AS d
                 LEFT JOIN alert_history a
                   ON date_trunc('day', a.created_at) = d
                 GROUP BY d
                 ORDER BY d ASC`,
            ),
            pool.query<{ severity: string; count: string }>(
                `SELECT severity, COUNT(*)::text AS count FROM alert_history
                 WHERE created_at >= NOW() - INTERVAL '7 days'
                 GROUP BY severity`,
            ),
        ]);

        const severityMap: Record<string, number> = { info: 0, warning: 0, critical: 0 };
        for (const r of severityTotals.rows) {
            severityMap[r.severity] = parseInt(r.count, 10);
        }

        res.json(success({
            todayCriticalCount: parseInt(todayCrit.rows[0]?.count ?? '0', 10),
            pendingAckCount: parseInt(pendingAck.rows[0]?.count ?? '0', 10),
            last7Days: trend.rows.map(r => ({
                date: r.date,
                total: parseInt(r.total, 10),
                info: parseInt(r.info, 10),
                warning: parseInt(r.warning, 10),
                critical: parseInt(r.critical, 10),
            })),
            severityTotals: severityMap,
        }));
    } catch (error) {
        log.error('[Admin AlertStats] 오류:', error);
        res.status(500).json(internalError('알림 통계 조회 실패'));
    }
}

/**
 * GET /api/admin/alerts/export — alert_history CSV download.
 *
 * 동일 filter (type/severity/acknowledged/startDate/endDate) 지원.
 * 무거운 query 방어: ALERT_CSV_MAX_ROWS env (default 10000) 강제 limit.
 * 출력: UTF-8 BOM + RFC 4180 escape — PR #91 의 audit export 와 동일 패턴.
 */
export async function exportAlertHistoryCsv(req: Request, res: Response): Promise<void> {
    try {
        const maxRows = parseInt(process.env.ALERT_CSV_MAX_ROWS ?? '10000', 10);
        const type = req.query.type ? String(req.query.type) : null;
        const severity = req.query.severity ? String(req.query.severity) : null;
        const startDate = req.query.startDate ? String(req.query.startDate) : null;
        const endDate = req.query.endDate ? String(req.query.endDate) : null;
        const ackParam = req.query.acknowledged !== undefined ? String(req.query.acknowledged) : null;

        const conditions: string[] = [];
        const params: unknown[] = [];
        let idx = 1;
        if (type) { conditions.push(`type = $${idx++}`); params.push(type); }
        if (severity) { conditions.push(`severity = $${idx++}`); params.push(severity); }
        if (startDate) { conditions.push(`created_at >= $${idx++}`); params.push(startDate); }
        if (endDate) { conditions.push(`created_at <= $${idx++}`); params.push(endDate); }
        if (ackParam === 'true') { conditions.push(`acknowledged = TRUE`); }
        else if (ackParam === 'false') { conditions.push(`acknowledged = FALSE`); }
        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        const r = await pool.query(
            `SELECT id, created_at, type, severity, title, message,
                    acknowledged, acknowledged_by, acknowledged_at, data
             FROM alert_history ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${idx}`,
            [...params, maxRows],
        );

        // RFC 4180: 모든 필드를 "" 로 감싸고 내부 " 를 "" 로 escape
        const esc = (v: unknown): string => {
            if (v === null || v === undefined) return '""';
            const s = typeof v === 'string' ? v : (v instanceof Date ? v.toISOString() : JSON.stringify(v));
            return `"${s.replace(/"/g, '""')}"`;
        };

        const header = ['id', 'created_at', 'type', 'severity', 'title', 'message', 'acknowledged', 'acknowledged_by', 'acknowledged_at', 'data'].join(',');
        const rows = (r.rows as Array<Record<string, unknown>>).map(row => [
            esc(row.id),
            esc(row.created_at),
            esc(row.type),
            esc(row.severity),
            esc(row.title),
            esc(row.message),
            esc(row.acknowledged ? 'true' : 'false'),
            esc(row.acknowledged_by),
            esc(row.acknowledged_at),
            esc(row.data),
        ].join(','));
        const csv = '﻿' + [header, ...rows].join('\n');

        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="alert_history_${date}.csv"`);
        res.send(csv);
    } catch (error) {
        log.error('[Admin AlertExport] 오류:', error);
        res.status(500).json(internalError('알림 이력 CSV export 실패'));
    }
}

/**
 * POST /api/admin/alerts/:id/acknowledge — alert_history 행 ack 처리.
 * 이미 ack 된 row 는 idempotent (no-op, 기존 ack 정보 그대로 반환).
 * 운영자 ID + 시간 기록으로 알림 처리 추적.
 */
export async function acknowledgeAlert(req: Request, res: Response): Promise<void> {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id) || id <= 0) {
            res.status(400).json(badRequest('잘못된 alert id'));
            return;
        }
        const userId = req.user && 'id' in req.user ? String((req.user as { id?: string | number }).id) : null;
        if (!userId) {
            res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: '인증 필요' } });
            return;
        }

        const { getPool } = await import('../data/models/unified-database');
        const pool = getPool();
        // acknowledged=FALSE 인 row 만 UPDATE — 중복 ack 시 정보 덮어쓰기 방지
        const r = await pool.query(
            `UPDATE alert_history
             SET acknowledged = TRUE, acknowledged_by = $1, acknowledged_at = NOW()
             WHERE id = $2 AND acknowledged = FALSE
             RETURNING id, type, severity, title, acknowledged, acknowledged_by, acknowledged_at`,
            [userId, id],
        );
        if (r.rowCount === 0) {
            // 이미 ack 됐거나 id 없음 — 현재 상태 조회 후 반환 (idempotent)
            const cur = await pool.query(
                `SELECT id, type, severity, title, acknowledged, acknowledged_by, acknowledged_at
                 FROM alert_history WHERE id = $1`,
                [id],
            );
            if (cur.rowCount === 0) {
                res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'alert 없음' } });
                return;
            }
            res.json(success({ alert: cur.rows[0], alreadyAcknowledged: true }));
            return;
        }

        // ack 성공 시 해당 alert key 의 cooldown clear → 재발생 시 즉시 통보
        // (incident 처리 후 같은 critical 재발 시 1분 cooldown 도 우회)
        try {
            const { getAlertSystem } = await import('../monitoring/alerts');
            getAlertSystem().clearCooldown(r.rows[0].type as string, r.rows[0].severity as 'info' | 'warning' | 'critical');
        } catch (e) { log.warn('[ack] cooldown clear 실패:', e); }

        // audit_logs INSERT — fire-and-forget (CRITICAL_ACTIONS whitelist 외라 alert 자체는 안 보냄)
        void (async () => {
            try {
                const { getAuditService } = await import('../services/AuditService');
                await getAuditService().logAudit({
                    action: 'alert.acknowledged',
                    userId,
                    resourceType: 'alert',
                    resourceId: String(id),
                    details: { type: r.rows[0].type, severity: r.rows[0].severity },
                    ipAddress: req.ip,
                    userAgent: req.headers['user-agent'],
                    actor: {
                        email: req.user && 'email' in req.user ? (req.user as { email?: string }).email : undefined,
                        role: req.user && 'role' in req.user ? (req.user as { role?: string }).role : undefined,
                    },
                });
            } catch (e) { log.warn('[audit] alert.acknowledged 기록 실패:', e); }
        })();

        res.json(success({ alert: r.rows[0], alreadyAcknowledged: false }));
    } catch (error) {
        log.error('[Admin AlertAck] 오류:', error);
        res.status(500).json(internalError('알림 확인 처리 실패'));
    }
}
