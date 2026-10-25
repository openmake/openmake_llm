/**
 * 글로벌 errorHandler 의 알 수 없는 오류(W3·W7) — development 밖에서는 내부 오류 문구(테이블 이름·경로 등)를
 * 응답에 내보내지 않고 고정 문구로 바꾼다. AppError 의 명시 문구는 모든 환경에서 유지한다.
 * 500 로그에는 요청 본문·쿼리 값 대신 키 이름만 남긴다.
 */
const mockLogError = jest.fn();
jest.mock('../logger', () => ({
    createLogger: () => ({ error: mockLogError, warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import type { Request, Response, NextFunction } from 'express';
import { errorHandler, AppError } from '../error-handler';

const GENERIC = '서버 내부 오류가 발생했습니다';

function mockRes() {
    const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
    res.status = jest.fn((code: number) => { res.statusCode = code; return res as Response; }) as unknown as Response['status'];
    res.json = jest.fn((body: unknown) => { res.body = body; return res as Response; }) as unknown as Response['json'];
    res.set = jest.fn(() => res as Response) as unknown as Response['set'];
    return res as Response & { statusCode?: number; body?: { error?: { code?: string; message?: string }; stack?: string } };
}

function mockReq(): Request {
    return {
        path: '/api/x', method: 'POST',
        body: { message: '비밀 문장', note: 'secret-value-123' },
        query: { q: 'query-value-456' },
        headers: {},
    } as unknown as Request;
}
const next = jest.fn() as NextFunction;

describe('errorHandler × 알 수 없는 오류 문구', () => {
    const originalEnv = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = originalEnv; mockLogError.mockReset(); });

    it('production: 알 수 없는 오류 → 500 + 고정 문구, 원문·stack 없음', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(new Error('relation "users" does not exist'), mockReq(), res, next);
        expect(res.statusCode).toBe(500);
        expect(res.body?.error?.code).toBe('INTERNAL_ERROR');
        expect(res.body?.error?.message).toBe(GENERIC);
        expect(JSON.stringify(res.body)).not.toContain('users');
        expect(res.body?.stack).toBeUndefined();
    });

    it('test 환경도 development 가 아니면 고정 문구', () => {
        process.env.NODE_ENV = 'test';
        const res = mockRes();
        errorHandler(new Error("ENOENT: no such file or directory, open '/srv/data/x'"), mockReq(), res, next);
        expect(res.body?.error?.message).toBe(GENERIC);
    });

    it('development: 원래 문구 유지', () => {
        process.env.NODE_ENV = 'development';
        const res = mockRes();
        errorHandler(new Error('relation "users" does not exist'), mockReq(), res, next);
        expect(res.body?.error?.message).toBe('relation "users" does not exist');
    });

    it('production: AppError(400) 명시 문구는 유지', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(new AppError('x', 400), mockReq(), res, next);
        expect(res.statusCode).toBe(400);
        expect(res.body?.error?.message).toBe('x');
    });

    it('production: status 400 클라이언트 오류(잘못된 JSON) → 문구 유지', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(Object.assign(new Error('Unexpected token'), { status: 400 }), mockReq(), res, next);
        expect(res.statusCode).toBe(400);
        expect(res.body?.error?.message).toBe('Unexpected token');
    });

    it('production: status 413 본문 초과 → 문구 유지', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(Object.assign(new Error('request entity too large'), { status: 413 }), mockReq(), res, next);
        expect(res.statusCode).toBe(413);
        expect(res.body?.error?.message).toBe('request entity too large');
    });

    it('production: statusCode 필드만 있는 4xx 도 그 상태·문구 유지', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(Object.assign(new Error('bad input'), { statusCode: 422 }), mockReq(), res, next);
        expect(res.statusCode).toBe(422);
        expect(res.body?.error?.message).toBe('bad input');
    });

    it('production: plain Error → 500 + 고정 문구', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(new Error('ECONNREFUSED 10.0.0.1:5432'), mockReq(), res, next);
        expect(res.statusCode).toBe(500);
        expect(res.body?.error?.message).toBe(GENERIC);
    });

    it('production: status 502 서버 오류도 고정 문구', () => {
        process.env.NODE_ENV = 'production';
        const res = mockRes();
        errorHandler(Object.assign(new Error('upstream /internal/path failed'), { status: 502 }), mockReq(), res, next);
        expect(res.statusCode).toBe(502);
        expect(res.body?.error?.message).toBe(GENERIC);
    });

    it('500 로그에는 body·query 의 키만 남고 값은 없다', () => {
        process.env.NODE_ENV = 'production';
        errorHandler(new Error('boom'), mockReq(), mockRes(), next);
        expect(mockLogError).toHaveBeenCalledTimes(1);
        const meta = mockLogError.mock.calls[0][1] as Record<string, unknown>;
        expect(meta.bodyKeys).toEqual(['message', 'note']);
        expect(meta.queryKeys).toEqual(['q']);
        expect(meta).not.toHaveProperty('body');
        expect(meta).not.toHaveProperty('query');
        const logged = JSON.stringify(mockLogError.mock.calls[0]);
        expect(logged).not.toContain('비밀 문장');
        expect(logged).not.toContain('secret-value-123');
        expect(logged).not.toContain('query-value-456');
    });
});
