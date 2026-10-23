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
import { SECURITY_AUDIT_DETAIL_LIMITS } from '../../config/security-audit';

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

    it("userId 'guest' 는 user_id 없이, details.actorId 는 'anonymous'(#1476 — 미인증 actor 통일)", async () => {
        await auditSecurityEvent({ action: 'security.authz_denied', userId: 'guest', details: { route: '/x' } });
        expect(entry().userId).toBeUndefined();
        expect((entry().details as Record<string, unknown>).actorId).toBe('anonymous');
    });

    it("실제 사용자 id 는 그대로 — 'guest' 를 포함하거나 비슷한 id 도 사용자로 남긴다(과한 추정 없음)", async () => {
        for (const id of ['guest-1', 'Guest', 'anon_1', '0']) {
            logAudit.mockClear();
            await auditSecurityEvent({ action: 'security.authz_denied', userId: id });
            expect(entry().userId).toBe(id);
            expect((entry().details as Record<string, unknown>).actorId).toBe(id);
        }
    });

    it("빈·null userId 도 user_id 없이, details.actorId 는 'anonymous'", async () => {
        await auditSecurityEvent({ action: 'security.authz_denied', userId: '' });
        await auditSecurityEvent({ action: 'security.authz_denied', userId: null });
        for (const call of logAudit.mock.calls) {
            const e = call[0] as Record<string, unknown>;
            expect(e.userId).toBeUndefined();
            expect((e.details as Record<string, unknown>).actorId).toBe('anonymous');
        }
    });

    it("userId 가 없으면 details.actorId 는 'anonymous' — 손님('guest')과 같은 표기", async () => {
        await auditSecurityEvent({ action: 'security.ssrf_blocked' });
        expect(entry().userId).toBeUndefined();
        expect((entry().details as Record<string, unknown>).actorId).toBe('anonymous');
    });

    it('resourceId 는 capText(200) 으로 자른다', async () => {
        await auditSecurityEvent({ action: 'security.authz_denied', userId: 'u1', resourceId: `GET /${'p'.repeat(300)}` });
        const rid = entry().resourceId as string;
        expect(rid.startsWith(`GET /${'p'.repeat(195)}`)).toBe(true);
        expect(rid.length).toBeLessThan(300);
    });

    it('details 키가 많아도 actorId 는 남고 호출부가 덮어쓰지 못한다', async () => {
        const big = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
        await auditSecurityEvent({ action: 'security.authz_denied', userId: 'u9', details: { ...big, actorId: 'spoof' } });
        expect((entry().details as Record<string, unknown>).actorId).toBe('u9');
    });

    it('중첩·순환 details 도 제한된 값만 넘기고 원본 객체는 건드리지 않는다', async () => {
        const nested: Record<string, unknown> = { inner: { token: 's'.repeat(300) } };
        nested.self = nested;
        await auditSecurityEvent({ action: 'security.authz_denied', userId: 'u1', details: { nested } });
        const d = entry().details as Record<string, any>;
        expect(() => JSON.stringify(d)).not.toThrow();
        expect(d.nested.self).toBe(SECURITY_AUDIT_DETAIL_LIMITS.CIRCULAR_MARKER);
        expect((d.nested.inner.token as string).length).toBeLessThan(300);
        expect(d.nested).not.toBe(nested);
        expect(nested.self).toBe(nested);
    });

    it('기록 실패 warn 에 details 원문(중첩 비밀값)을 싣지 않는다', async () => {
        logAudit.mockImplementation(async () => { throw new Error('db down'); });
        await auditSecurityEvent({ action: 'security.authz_denied', userId: 'u1', details: { a: { b: { secret: 'SECRET-VALUE-123' } } } });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).not.toContain('SECRET-VALUE-123');
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

    it('중첩 객체의 문자열도 capText(200), 키도 20개, undefined 는 뺀다', () => {
        const big = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
        const d = securityAuditDetails({ o: { s: 'y'.repeat(500), u: undefined, big } }) as Record<string, any>;
        expect((d.o.s as string).startsWith('y'.repeat(200))).toBe(true);
        expect((d.o.s as string).length).toBeLessThan(500);
        expect('u' in d.o).toBe(false);
        expect(Object.keys(d.o.big)).toEqual(Array.from({ length: 20 }, (_, i) => `k${i}`));
    });

    it('배열은 앞 20개만, 배열 안 문자열·객체도 제한한다', () => {
        const d = securityAuditDetails({
            list: Array.from({ length: 25 }, (_, i) => i),
            rows: [{ s: 'z'.repeat(500) }, 'w'.repeat(500)],
        }) as Record<string, any>;
        expect(d.list).toEqual(Array.from({ length: 20 }, (_, i) => i));
        expect((d.rows[0].s as string).length).toBeLessThan(500);
        expect((d.rows[1] as string).length).toBeLessThan(500);
    });

    it('깊이 3 을 넘는 객체·배열은 고정 표식으로 끊는다(깊은 값 원문은 남지 않는다)', () => {
        const d = securityAuditDetails({ a: { b: { c: { secret: 'deep-secret' }, arr: [[1]], n: 1 } } }) as Record<string, any>;
        expect(d.a.b.n).toBe(1);
        expect(d.a.b.c).toBe(SECURITY_AUDIT_DETAIL_LIMITS.DEPTH_MARKER);
        expect(d.a.b.arr).toBe(SECURITY_AUDIT_DETAIL_LIMITS.DEPTH_MARKER);
        expect(JSON.stringify(d)).not.toContain('deep-secret');
    });

    it('순환 참조는 고정 표식으로 끝나고, 순환이 아닌 같은 객체 재사용은 그대로 둔다', () => {
        const shared = { v: 1 };
        const arr: unknown[] = [1];
        arr.push(arr);
        const loop: Record<string, unknown> = { name: 'x' };
        loop.me = loop;
        const d = securityAuditDetails({ loop, arr, p: shared, q: shared }) as Record<string, any>;
        expect(d.loop).toEqual({ name: 'x', me: SECURITY_AUDIT_DETAIL_LIMITS.CIRCULAR_MARKER });
        expect(d.arr).toEqual([1, SECURITY_AUDIT_DETAIL_LIMITS.CIRCULAR_MARKER]);
        expect(d.p).toEqual({ v: 1 });
        expect(d.q).toEqual({ v: 1 });
        expect(() => JSON.stringify(d)).not.toThrow();
    });

    it('최상위 details 자기참조도 표식으로 끝난다', () => {
        const top: Record<string, unknown> = { a: 1 };
        top.self = top;
        expect(securityAuditDetails(top)).toEqual({ a: 1, self: SECURITY_AUDIT_DETAIL_LIMITS.CIRCULAR_MARKER });
    });

    it('기존 상한 값(문자열 200·키 20)과 새 상한(배열 20·깊이 3)은 L2 설정 값이다', () => {
        expect(SECURITY_AUDIT_DETAIL_LIMITS).toMatchObject({ TEXT_MAX_CHARS: 200, MAX_KEYS: 20, MAX_ARRAY_ITEMS: 20, MAX_DEPTH: 3 });
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
