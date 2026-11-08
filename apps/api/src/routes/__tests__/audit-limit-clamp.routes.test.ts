/**
 * 감사 로그 조회 — limit/offset 검증.
 * limit 은 [1, PAGINATION.ADMIN_MAX_LIMIT], offset 은 0 이상, 숫자가 아니면 기본값.
 * 검증이 없으면 limit=10000000 은 전체 전송, 음수는 DB 오류(500)가 된다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { PAGINATION } from '../../config/http-data-limits';

jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => {
        (req as unknown as { user: object }).user = { id: 'admin-1', role: 'admin' };
        next();
    },
    requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
const mockGetAuditLogs = jest.fn(async (_filters: Record<string, unknown>) => ({ logs: [], total: 0 }));
jest.mock('../../services/AuditService', () => ({
    getAuditService: () => ({ getAuditLogs: mockGetAuditLogs }),
}));

import auditRouter from '../audit.routes';

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/audit', auditRouter);
    return a;
}

const lastFilters = () => mockGetAuditLogs.mock.calls.at(-1)![0];

beforeEach(() => mockGetAuditLogs.mockClear());
afterEach(() => { delete process.env.AUDIT_CSV_MAX_ROWS; });

describe('GET /api/audit — limit/offset 검증', () => {
    it.each([
        ['상한 초과', '10000000', PAGINATION.ADMIN_MAX_LIMIT],
        ['음수', '-5', 1],
        ['0', '0', PAGINATION.ADMIN_DEFAULT_LIMIT],
        ['숫자 아님', 'abc', PAGINATION.ADMIN_DEFAULT_LIMIT],
        ['정상 값(화면이 보내는 50)', '50', 50],
        ['상한 값', String(PAGINATION.ADMIN_MAX_LIMIT), PAGINATION.ADMIN_MAX_LIMIT],
    ])('limit %s(%s) → %d', async (_label, raw, expected) => {
        const res = await request(app()).get('/api/audit').query({ limit: raw });
        expect(res.status).toBe(200);
        expect(lastFilters().limit).toBe(expected);
    });

    it('limit 이 없으면 기본값', async () => {
        await request(app()).get('/api/audit');
        expect(lastFilters()).toMatchObject({ limit: PAGINATION.ADMIN_DEFAULT_LIMIT, offset: 0 });
    });

    it.each([
        ['음수', '-1', 0],
        ['숫자 아님', 'abc', 0],
        ['정상 값', '200', 200],
    ])('offset %s(%s) → %d', async (_label, raw, expected) => {
        const res = await request(app()).get('/api/audit').query({ offset: raw });
        expect(res.status).toBe(200);
        expect(lastFilters().offset).toBe(expected);
    });

    it('다른 필터와 응답 모양은 그대로', async () => {
        mockGetAuditLogs.mockResolvedValueOnce({ logs: [{ id: 1 }] as never[], total: 7 });
        const res = await request(app()).get('/api/audit')
            .query({ limit: '50', action: 'login', userId: 'u1', startDate: '2026-10-01', endDate: '2026-10-02' });
        expect(lastFilters()).toEqual({
            startDate: '2026-10-01', endDate: '2026-10-02', action: 'login', userId: 'u1', limit: 50, offset: 0,
        });
        expect(res.body.data).toEqual({ logs: [{ id: 1 }], total: 7 });
    });
});

describe('GET /api/audit/user/:userId — limit 검증', () => {
    it.each([
        ['상한 초과', '10000000', PAGINATION.ADMIN_MAX_LIMIT],
        ['음수', '-5', 1],
        ['숫자 아님', 'abc', PAGINATION.ADMIN_DEFAULT_LIMIT],
        ['정상 값', '30', 30],
    ])('limit %s(%s) → %d', async (_label, raw, expected) => {
        const res = await request(app()).get('/api/audit/user/u1').query({ limit: raw });
        expect(res.status).toBe(200);
        expect(lastFilters()).toEqual({ userId: 'u1', limit: expected });
    });
});

describe('GET /api/audit/export — 행 수 상한', () => {
    it('기본 상한 10000 행, 쿼리의 limit 은 무시한다', async () => {
        const res = await request(app()).get('/api/audit/export').query({ limit: '10000000' });
        expect(res.status).toBe(200);
        expect(lastFilters()).toMatchObject({ limit: 10000, offset: 0 });
    });

    it('AUDIT_CSV_MAX_ROWS 가 유효하면 그 값을 쓴다', async () => {
        process.env.AUDIT_CSV_MAX_ROWS = '2500';
        await request(app()).get('/api/audit/export');
        expect(lastFilters().limit).toBe(2500);
    });

    it.each(['abc', '-1', '0'])('AUDIT_CSV_MAX_ROWS 가 잘못된 값(%s)이면 기본 상한으로 돌아간다', async (bad) => {
        process.env.AUDIT_CSV_MAX_ROWS = bad;
        await request(app()).get('/api/audit/export');
        expect(lastFilters().limit).toBe(10000);
    });
});

// 셀 인코딩은 다른 내보내기와 같은 csvCell 을 쓴다(인증 보강, 2026-11-08 점검).
describe('GET /api/audit/export — 셀 인코딩', () => {
    const row = {
        id: 7,
        timestamp: new Date('2026-11-08T01:02:03.000Z'),
        action: 'login',
        user_id: 'u1',
        resource_type: null,
        resource_id: undefined,
        ip_address: '127.0.0.1',
        user_agent: '=SUM(1,2)',
        details: { note: 'a "q"' },
    };

    it('수식 선행 문자로 시작하는 문자열 셀은 작은따옴표를 앞에 붙인다', async () => {
        mockGetAuditLogs.mockResolvedValueOnce({ logs: [row] as never[], total: 1 });
        const res = await request(app()).get('/api/audit/export');
        const lines = res.text.replace(/^﻿/, '').split('\n');
        expect(lines[1]).toContain(`"'=SUM(1,2)"`);
        expect(lines[1]).not.toContain(`,"=SUM`);
    });

    it('헤더·BOM·응답 헤더와 나머지 셀 값은 그대로', async () => {
        mockGetAuditLogs.mockResolvedValueOnce({ logs: [{ ...row, user_agent: 'Mozilla/5.0' }] as never[], total: 1 });
        const res = await request(app()).get('/api/audit/export');
        expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
        expect(res.headers['content-disposition']).toMatch(/^attachment; filename="audit_logs_\d{4}-\d{2}-\d{2}\.csv"$/);
        expect(res.text.startsWith('﻿')).toBe(true);
        const [header, line] = res.text.slice(1).split('\n');
        expect(header).toBe('id,timestamp,action,user_id,resource_type,resource_id,ip_address,user_agent,details');
        expect(line).toBe('"7","2026-11-08T01:02:03.000Z","login","u1","","","127.0.0.1","Mozilla/5.0","{""note"":""a \\""q\\""""}"');
    });
});
