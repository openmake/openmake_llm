import { evaluateSessionAccess, resolveSessionListScope } from '../session.controller';

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

describe('resolveSessionListScope — 관리자 전체 조회 옵트인', () => {
    // 🔴 회귀 방어: 과거엔 관리자 기본이 전체 조회라 개인 히스토리·사이드바에
    // 모든 사용자의 대화가 섞여 노출됐다. 전체 조회는 viewAll=true 옵트인만 허용.
    test('관리자도 viewAll 없이는 자신의 세션만', () => {
        expect(resolveSessionListScope({ isAdmin: true, viewAll: false, userId: 'u-admin' })).toBe('user');
    });

    test('관리자 + viewAll=true 는 전체 조회', () => {
        expect(resolveSessionListScope({ isAdmin: true, viewAll: true, userId: 'u-admin' })).toBe('all');
    });

    test('비관리자의 viewAll 은 무시 — 자신의 세션만', () => {
        expect(resolveSessionListScope({ isAdmin: false, viewAll: true, userId: 'u-user' })).toBe('user');
    });

    test('비로그인 + anonSessionId 는 익명 스코프', () => {
        expect(resolveSessionListScope({ isAdmin: false, viewAll: false, anonSessionId: 'anon-abc' })).toBe('anon');
    });

    test('비로그인 + viewAll 도 무시 — 인증 정보 없으면 none', () => {
        expect(resolveSessionListScope({ isAdmin: false, viewAll: true })).toBe('none');
    });
});
