/**
 * 글로벌 errorHandler 의 ProviderError 매핑 — REST /api/chat 이 asyncHandler 로 던진
 * 정책 차단(MODEL_ACCESS_RESTRICTED)이 500 INTERNAL_ERROR 가 아니라 403 + 원래 code 로 나가야 한다.
 */
import type { Request, Response, NextFunction } from 'express';
import { errorHandler } from '../error-handler';
import { ProviderError, PROVIDER_ERROR_HTTP_STATUS } from '../../providers/provider-errors';

function mockRes() {
    const res: Partial<Response> & { statusCode?: number; body?: unknown } = {};
    res.status = jest.fn((code: number) => { res.statusCode = code; return res as Response; }) as unknown as Response['status'];
    res.json = jest.fn((body: unknown) => { res.body = body; return res as Response; }) as unknown as Response['json'];
    res.set = jest.fn(() => res as Response) as unknown as Response['set'];
    return res as Response & { statusCode?: number; body?: { error?: { code?: string; message?: string } } };
}

const req = { path: '/api/chat', method: 'POST', body: {}, query: {}, headers: {} } as unknown as Request;
const next = jest.fn() as NextFunction;

describe('errorHandler × ProviderError', () => {
    it('MODEL_ACCESS_RESTRICTED → 403 + code 유지', () => {
        const res = mockRes();
        errorHandler(new ProviderError('MODEL_ACCESS_RESTRICTED', '관리자 정책으로 사용할 수 없는 모델입니다: nvidia:x'), req, res, next);
        expect(res.statusCode).toBe(403);
        expect(res.body?.error?.code).toBe('MODEL_ACCESS_RESTRICTED');
        expect(res.body?.error?.message).toContain('관리자 정책');
    });

    it.each(Object.entries(PROVIDER_ERROR_HTTP_STATUS))('%s → %s', (code, status) => {
        const res = mockRes();
        errorHandler(new ProviderError(code as ProviderError['code'], 'x'), req, res, next);
        expect(res.statusCode).toBe(status);
        expect(res.body?.error?.code).toBe(code);
    });
});
