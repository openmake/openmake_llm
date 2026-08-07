import { resolveSessionListScope } from '../../controllers/session.controller';

/**
 * GET /api/agent-tasks 와 GET /api/research/sessions 의 관리자 전체 조회(viewAll) 옵트인 계약.
 * 두 라우트는 session.controller 의 resolveSessionListScope 를 재사용한다 —
 * requireAuth 라 userId 가 항상 존재하므로 스코프는 'all'(관리자 옵트인) 또는 'user' 뿐이다.
 * 회귀 방어: 비관리자의 viewAll 은 무시되고 반드시 본인 것만 반환되어야 한다(정보 유출 차단).
 */
describe('관리자 목록 전체 조회 옵트인 (agent-tasks · research)', () => {
    test('관리자 + viewAll=true → 전체 조회', () => {
        expect(resolveSessionListScope({ isAdmin: true, viewAll: true, userId: 'u-admin' })).toBe('all');
    });

    test('관리자 + viewAll 없음 → 본인 것만', () => {
        expect(resolveSessionListScope({ isAdmin: true, viewAll: false, userId: 'u-admin' })).toBe('user');
    });

    test('비관리자 + viewAll=true → 무시하고 본인 것만', () => {
        expect(resolveSessionListScope({ isAdmin: false, viewAll: true, userId: 'u-user' })).toBe('user');
    });

    test('비관리자 + viewAll 없음 → 본인 것만', () => {
        expect(resolveSessionListScope({ isAdmin: false, viewAll: false, userId: 'u-user' })).toBe('user');
    });
});
