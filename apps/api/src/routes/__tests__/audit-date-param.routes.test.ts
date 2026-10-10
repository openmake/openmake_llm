/**
 * 감사 로그 조회·내보내기 — startDate/endDate 검증.
 * 날짜가 아닌 값이 그대로 SQL 파라미터로 가면 Postgres 캐스트 오류(500)가 된다 → 400 으로 거절.
 * 화면은 Date.prototype.toISOString() 형식(예: 2026-10-03T15:00:00.000Z)을 보낸다.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

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

describe.each([
    ['조회', '/api/audit'],
    ['내보내기', '/api/audit/export'],
])('GET %s(%s) — startDate/endDate 검증', (_label, path) => {
    it.each([
        ['날짜 아님', 'abc'],
        ['숫자만', '12345'],
        ['없는 날짜', '2026-02-30'],
        ['없는 달', '2026-13-01'],
        ['없는 시각', '2026-10-01T25:00:00.000Z'],
        ['뒤에 붙은 문자', '2026-10-01T00:00:00.000Zx'],
        ['SQL 조각', "2026-10-01'; --"],
    ])('잘못된 startDate(%s: %s) → 400, 서비스 호출 없음', async (_l, bad) => {
        const res = await request(app()).get(path).query({ startDate: bad });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(mockGetAuditLogs).not.toHaveBeenCalled();
    });

    it.each(['abc', '2026-02-30'])('잘못된 endDate(%s) → 400, 서비스 호출 없음', async (bad) => {
        const res = await request(app()).get(path).query({ startDate: '2026-10-01', endDate: bad });
        expect(res.status).toBe(400);
        expect(mockGetAuditLogs).not.toHaveBeenCalled();
    });

    it('같은 이름이 여러 번 온 값(배열) → 400', async () => {
        const res = await request(app()).get(`${path}?startDate=2026-10-01&startDate=2026-10-02`);
        expect(res.status).toBe(400);
        expect(mockGetAuditLogs).not.toHaveBeenCalled();
    });

    it('화면이 보내는 형식(toISOString) → 통과, 값 그대로 전달', async () => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - 6);
        const startDate = start.toISOString();
        const endDate = new Date().toISOString();
        const res = await request(app()).get(path).query({ startDate, endDate });
        expect(res.status).toBe(200);
        expect(lastFilters()).toMatchObject({ startDate, endDate });
    });

    it.each([
        ['날짜만', '2026-10-01'],
        ['윤일', '2028-02-29'],
        ['초 단위 UTC', '2026-10-01T15:00:00Z'],
        ['시간대 오프셋', '2026-10-01T00:00:00+09:00'],
    ])('ISO 형식(%s: %s) → 통과', async (_l, ok) => {
        const res = await request(app()).get(path).query({ startDate: ok, endDate: ok });
        expect(res.status).toBe(200);
        expect(lastFilters()).toMatchObject({ startDate: ok, endDate: ok });
    });

    it('미지정 → 통과, 날짜 필터 없음', async () => {
        const res = await request(app()).get(path);
        expect(res.status).toBe(200);
        expect(lastFilters().startDate).toBeUndefined();
        expect(lastFilters().endDate).toBeUndefined();
    });

    it('빈 값 → 미지정과 같게 통과', async () => {
        const res = await request(app()).get(`${path}?startDate=&endDate=`);
        expect(res.status).toBe(200);
        expect(lastFilters().startDate).toBeUndefined();
        expect(lastFilters().endDate).toBeUndefined();
    });
});
