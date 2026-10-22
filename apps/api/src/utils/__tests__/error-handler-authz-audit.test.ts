/**
 * 글로벌 errorHandler 의 403 AppError 감사(S10) — 인가 거부는 security.authz_denied 로 남기고,
 * 감사는 fire-and-forget 이라 응답 코드·본문을 바꾸거나 막지 않는다(감사 실패에도 403 그대로).
 */
jest.mock('../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
}));

import type { Request, Response, NextFunction } from 'express';
import { errorHandler, AuthorizationError, ValidationError } from '../error-handler';
import { auditSecurityEvent } from '../../security/security-audit';

const audit = auditSecurityEvent as jest.Mock;

function mockRes() {
    const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
    res.status = jest.fn((code: number) => { res.statusCode = code; return res as Response; }) as unknown as Response['status'];
    res.json = jest.fn((body: unknown) => { res.body = body; return res as Response; }) as unknown as Response['json'];
    res.set = jest.fn(() => res as Response) as unknown as Response['set'];
    return res as Response & { statusCode?: number; body?: { error?: { code?: string; message?: string } } };
}

function mockReq(): Request {
    return {
        path: '/x', method: 'GET', body: {}, query: {}, headers: { 'user-agent': 'jest-ua' },
        ip: '127.0.0.1', user: { id: 'u-1' },
    } as unknown as Request;
}
const next = jest.fn() as NextFunction;

describe('errorHandler × 인가 거부 감사', () => {
    beforeEach(() => { audit.mockReset(); audit.mockResolvedValue(undefined); });

    it('AuthorizationError → 403 응답 그대로 + security.authz_denied 1회', async () => {
        const res = mockRes();
        errorHandler(new AuthorizationError('관리자만'), mockReq(), res, next);
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.message).toBe('관리자만');
        await new Promise((r) => setImmediate(r));
        expect(audit).toHaveBeenCalledTimes(1);
        const input = audit.mock.calls[0][0];
        expect(input).toMatchObject({
            action: 'security.authz_denied', userId: 'u-1', resourceType: 'http', resourceId: 'GET /x',
            ipAddress: '127.0.0.1', userAgent: 'jest-ua',
        });
        expect(input.details).toEqual({ code: 'AUTHORIZATION_ERROR', message: '관리자만' });
    });

    it('400 AppError 는 감사하지 않는다', async () => {
        const res = mockRes();
        errorHandler(new ValidationError('bad'), mockReq(), res, next);
        expect(res.statusCode).toBe(400);
        await new Promise((r) => setImmediate(r));
        expect(audit).not.toHaveBeenCalled();
    });

    it('감사가 reject 해도 403 응답은 그대로 나간다', async () => {
        audit.mockRejectedValue(new Error('db down'));
        const res = mockRes();
        expect(() => errorHandler(new AuthorizationError(), mockReq(), res, next)).not.toThrow();
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.code).toBe('AUTHORIZATION_ERROR');
        await new Promise((r) => setImmediate(r));
        expect(audit).toHaveBeenCalledTimes(1);
    });
});
