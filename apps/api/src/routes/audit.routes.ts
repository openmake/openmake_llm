/**
 * ============================================================
 * Audit Routes - 감사 로그 시스템 API 라우트
 * ============================================================
 *
 * 시스템 활동 감사 로그의 조회 및 생성을 담당합니다.
 * 모든 엔드포인트는 관리자(admin) 전용이며,
 * 액션 타입별/사용자별 필터링을 지원합니다.
 *
 * @module routes/audit.routes
 * @description
 * - GET  /api/audit               - 감사 로그 목록 조회 (필터: action, userId, limit)
 * - GET  /api/audit/export        - 감사 로그 CSV download (동일 filter)
 * - GET  /api/audit/actions       - 감사 로그 액션 타입 목록
 * - GET  /api/audit/user/:userId  - 특정 사용자 감사 로그 조회
 * - POST /api/audit               - 감사 로그 엔트리 생성
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires requireAdmin - 관리자 권한 미들웨어
 * @requires UnifiedDatabase - 감사 로그 DB 접근
 */

import { Router, Request, Response } from 'express';
import { success, badRequest } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { validate } from '../middlewares/validation';
import { createAuditSchema } from '../schemas/audit.schema';
import { requireAuth, requireAdmin } from '../auth';
import { getAuditService } from '../services/AuditService';
import { PAGINATION } from '../config/http-data-limits';

const router = Router();
const auditService = getAuditService();

// All audit endpoints require admin access
router.use(requireAuth, requireAdmin);

// ISO 8601 날짜(YYYY-MM-DD) 또는 날짜+시각(화면이 보내는 Date.toISOString() 형식 포함)
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * startDate/endDate 쿼리 값 검증 — 그대로 SQL 파라미터가 되므로 날짜가 아니면 DB 캐스트 오류(500)
 * @returns 미지정·빈 값은 undefined, 잘못된 값은 null
 */
function parseDateParam(raw: unknown): string | undefined | null {
    if (raw === undefined || raw === '') return undefined;
    if (typeof raw !== 'string') return null;
    const m = ISO_DATE_PATTERN.exec(raw);
    if (!m || Number.isNaN(Date.parse(raw))) return null;
    // Date.parse 는 2026-02-30 같은 없는 날짜를 다음 달로 넘겨 받아들인다 — 달력에 있는 날인지 따로 확인
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
    return raw;
}

const INVALID_DATE_MESSAGE = 'startDate/endDate 는 ISO 8601 날짜 형식이어야 합니다';

// ================================================
// 감사 로그 조회
// ================================================

/**
 * GET /api/audit
 * 감사 로그 목록 조회 (관리자 전용)
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
     // limit 은 [1, ADMIN_MAX_LIMIT], offset 은 0 이상 — 검증이 없으면 큰 limit 은 전체 전송, 음수는 DB 오류(500)
     const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || PAGINATION.ADMIN_DEFAULT_LIMIT, 1), PAGINATION.ADMIN_MAX_LIMIT);
     const offset = Math.max(parseInt(req.query.offset as string, 10) || PAGINATION.DEFAULT_OFFSET, 0);
     const startDate = parseDateParam(req.query.startDate);
     const endDate = parseDateParam(req.query.endDate);
     if (startDate === null || endDate === null) {
         res.status(400).json(badRequest(INVALID_DATE_MESSAGE));
         return;
     }
     const action = req.query.action as string | undefined;
     const userId = req.query.userId as string | undefined;

     const { logs, total } = await auditService.getAuditLogs({
         startDate,
         endDate,
         action,
         userId,
         limit,
         offset,
     });
     res.json(success({ logs, total }));
}));

/**
 * GET /api/audit/export
 * 감사 로그 CSV download (관리자 전용)
 *
 * 현재 GET / 와 동일 filter (startDate/endDate/action/userId) 지원.
 * 무거운 query 방어: limit 강제 max AUDIT_CSV_MAX_ROWS (default 10000).
 * 출력 형식: UTF-8 BOM + CSV (Excel 한글 호환, RFC 4180 escape).
 */
router.get('/export', asyncHandler(async (req: Request, res: Response) => {
    // 잘못된 설정값(숫자 아님·0 이하)은 기본 상한으로 — 그대로 LIMIT 에 넘기면 DB 오류(500)
    const configuredMaxRows = parseInt(process.env.AUDIT_CSV_MAX_ROWS ?? '10000', 10);
    const maxRows = configuredMaxRows > 0 ? configuredMaxRows : 10000;
    const startDate = parseDateParam(req.query.startDate);
    const endDate = parseDateParam(req.query.endDate);
    if (startDate === null || endDate === null) {
        res.status(400).json(badRequest(INVALID_DATE_MESSAGE));
        return;
    }
    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;

    const { logs } = await auditService.getAuditLogs({
        startDate,
        endDate,
        action,
        userId,
        limit: maxRows,
        offset: 0,
    });

    // RFC 4180: 큰따옴표는 "" 로 escape, 모든 필드를 "" 로 감쌈
    const esc = (v: unknown): string => {
        if (v === null || v === undefined) return '""';
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        return `"${s.replace(/"/g, '""')}"`;
    };

    const header = ['id', 'timestamp', 'action', 'user_id', 'resource_type', 'resource_id', 'ip_address', 'user_agent', 'details'].join(',');
    const rows = (logs as Array<Record<string, unknown>>).map(row => [
        esc(row.id),
        esc(row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp),
        esc(row.action),
        esc(row.user_id),
        esc(row.resource_type),
        esc(row.resource_id),
        esc(row.ip_address),
        esc(row.user_agent),
        esc(row.details),
    ].join(','));
    const csv = '﻿' + [header, ...rows].join('\n');  // UTF-8 BOM

    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${date}.csv"`);
    res.send(csv);
}));

/**
 * GET /api/audit/actions
 * 감사 로그 액션 타입 목록 (관리자 전용)
 */
router.get('/actions', asyncHandler(async (req: Request, res: Response) => {
     const actions = await auditService.getDistinctActions();

     res.json(success({ actions }));
}));

/**
 * GET /api/audit/user/:userId
 * 특정 사용자 감사 로그 조회 (관리자 전용)
 */
router.get('/user/:userId', asyncHandler(async (req: Request, res: Response) => {
     const { userId } = req.params;
     const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || PAGINATION.ADMIN_DEFAULT_LIMIT, 1), PAGINATION.ADMIN_MAX_LIMIT);
     const { logs, total } = await auditService.getAuditLogs({ userId, limit });
     res.json(success({ logs, total, userId }));
}));

// ================================================
// 감사 로그 생성
// ================================================

/**
 * POST /api/audit
 * 감사 로그 엔트리 생성 (관리자 전용)
 */
router.post('/', validate(createAuditSchema), asyncHandler(async (req: Request, res: Response) => {
     const { action, resourceType, resourceId, details } = req.body;

     await auditService.logAudit({
          action,
          userId: String(req.user!.id),
          resourceType,
         resourceId,
         details,
         ipAddress: req.ip,
         userAgent: req.headers['user-agent']
     });

     res.status(201).json(success({ message: '감사 로그가 생성되었습니다.' }));
}));

export default router;
