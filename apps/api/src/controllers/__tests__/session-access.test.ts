import { evaluateSessionAccess } from '../session.controller';

type SessionLike = { userId?: string; anonSessionId?: string };

const userSession: SessionLike = { userId: 'u-owner', anonSessionId: undefined };
const anonSession: SessionLike = { userId: undefined, anonSessionId: 'anon-abc' };

describe('evaluateSessionAccess — IDOR 회귀', () => {
    // 🔴 회귀 방어: 미인증 + anonSessionId 파라미터 없음 → 요청측 두 값이 모두 undefined.
    // 과거엔 session.anonSessionId(undefined) === requestAnonSessionId(undefined) 로 통과했다.
    test('미인증·무파라미터 요청은 로그인 사용자 세션에 접근 불가', () => {
        expect(evaluateSessionAccess(userSession, { isAdmin: false })).toBe(false);
    });

    test('미인증·무파라미터 요청은 익명 세션에도 접근 불가', () => {
        expect(evaluateSessionAccess(anonSession, { isAdmin: false })).toBe(false);
    });

    test('다른 로그인 사용자는 남의 세션에 접근 불가', () => {
        expect(evaluateSessionAccess(userSession, { userId: 'u-other', isAdmin: false })).toBe(false);
    });

    test('다른 anonSessionId 로는 남의 익명 세션에 접근 불가', () => {
        expect(evaluateSessionAccess(anonSession, { anonSessionId: 'anon-other', isAdmin: false })).toBe(false);
    });

    // 정상 접근 경로는 유지
    test('소유자 본인은 자신의 세션에 접근 가능', () => {
        expect(evaluateSessionAccess(userSession, { userId: 'u-owner', isAdmin: false })).toBe(true);
    });

    test('일치하는 anonSessionId 로 익명 세션 접근 가능', () => {
        expect(evaluateSessionAccess(anonSession, { anonSessionId: 'anon-abc', isAdmin: false })).toBe(true);
    });

    test('admin 은 모든 세션 접근 가능', () => {
        expect(evaluateSessionAccess(userSession, { isAdmin: true })).toBe(true);
        expect(evaluateSessionAccess(anonSession, { isAdmin: true })).toBe(true);
    });

    test('세션이 없으면 (비-admin) 접근 불가', () => {
        expect(evaluateSessionAccess(undefined, { userId: 'u-owner', isAdmin: false })).toBe(false);
    });
});
