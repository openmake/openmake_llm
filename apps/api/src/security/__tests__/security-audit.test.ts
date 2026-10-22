/**
 * 보안 감사 헬퍼(security/security-audit) — 기록 실패를 삼키고(절대 throw 안 함), 게스트는 user_id 없이 남긴다.
 */
const logAudit = jest.fn(async (_entry: unknown) => undefined);
const getAuditService = jest.fn(() => ({ logAudit }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => getAuditService() }));
const warn = jest.fn();
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: (m: string) => warn(m), error: jest.fn() }),
}));

import { auditSecurityEvent, isSsrfBlockedError, securityAuditDetails } from '../security-audit';

beforeEach(() => {
    jest.clearAllMocks();
    logAudit.mockImplementation(async () => undefined);
    getAuditService.mockImplementation(() => ({ logAudit }));
});

const entry = (): Record<string, unknown> => logAudit.mock.calls[0][0] as Record<string, unknown>;

describe('auditSecurityEvent', () => {
    it('정상 입력이면 logAudit 을 한 번, 입력대로 부른다', async () => {
        await auditSecurityEvent({
            action: 'security.ssrf_blocked', userId: 'u1', resourceType: 'url', resourceId: 'example.com',
            details: { reason: 'scheme' }, ipAddress: '1.2.3.4', userAgent: 'ua',
        });
        expect(logAudit).toHaveBeenCalledTimes(1);
        expect(entry()).toEqual({
            action: 'security.ssrf_blocked', userId: 'u1', resourceType: 'url', resourceId: 'example.com',
            details: { reason: 'scheme', actorId: 'u1' }, ipAddress: '1.2.3.4', userAgent: 'ua',
        });
    });

    it('숫자 userId 는 문자열로 넘긴다', async () => {
        await auditSecurityEvent({ action: 'external_key.set', userId: 42 });
        expect(entry().userId).toBe('42');
    });

    it("userId 'guest' 는 user_id 없이, details.actorId 에 원값을 남긴다", async () => {
        await auditSecurityEvent({ action: 'security.authz_denied', userId: 'guest', details: { route: '/x' } });
        expect(entry().userId).toBeUndefined();
        expect((entry().details as Record<string, unknown>).actorId).toBe('guest');
    });

    it('빈·null userId 도 user_id 없이 남긴다', async () => {
        await auditSecurityEvent({ action: 'security.authz_denied', userId: '' });
        await auditSecurityEvent({ action: 'security.authz_denied', userId: null });
        expect((logAudit.mock.calls[0][0] as Record<string, unknown>).userId).toBeUndefined();
        expect((logAudit.mock.calls[1][0] as Record<string, unknown>).userId).toBeUndefined();
    });

    it('details 키가 많아도 actorId 는 남고 호출부가 덮어쓰지 못한다', async () => {
        const big = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
        await auditSecurityEvent({ action: 'security.authz_denied', userId: 'u9', details: { ...big, actorId: 'spoof' } });
        expect((entry().details as Record<string, unknown>).actorId).toBe('u9');
    });

    it('logAudit 이 reject 해도 resolve 하고 warn 을 한 번 남긴다', async () => {
        logAudit.mockImplementation(async () => { throw new Error('db down'); });
        await expect(auditSecurityEvent({ action: 'mcp_server.delete', userId: 'u1' })).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('getAuditService 가 throw 해도 resolve 한다', async () => {
        getAuditService.mockImplementation(() => { throw new Error('init'); });
        await expect(auditSecurityEvent({ action: 'mcp_server.create', userId: 'u1' })).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(1);
    });
});

describe('securityAuditDetails', () => {
    it('undefined 값은 빼고 긴 문자열은 capText(200) 으로 자른다', () => {
        const d = securityAuditDetails({ a: 'x'.repeat(500), b: undefined, n: 3 });
        expect('b' in d).toBe(false);
        expect(d.n).toBe(3);
        expect((d.a as string).startsWith('x'.repeat(200))).toBe(true);
        expect((d.a as string).slice(200).includes('x')).toBe(false);
        expect((d.a as string).length).toBeLessThan(500);
    });

    it('키 20개를 넘으면 앞 20개만 남긴다', () => {
        const big = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
        const d = securityAuditDetails(big);
        expect(Object.keys(d)).toEqual(Array.from({ length: 20 }, (_, i) => `k${i}`));
    });
});

describe('isSsrfBlockedError', () => {
    it('SSRF 가드 오류만 참이다', () => {
        expect(isSsrfBlockedError(new Error('SSRF blocked: scheme not allowed: ftp:'))).toBe(true);
        expect(isSsrfBlockedError(new Error('ECONNREFUSED'))).toBe(false);
        expect(isSsrfBlockedError('SSRF blocked: x')).toBe(false);
        expect(isSsrfBlockedError(undefined)).toBe(false);
    });
});
