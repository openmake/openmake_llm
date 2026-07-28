import { assertResourceOwnerOrAdmin } from '../auth/ownership';
import { AuthorizationError } from '../utils/error-handler';

describe('assertResourceOwnerOrAdmin', () => {
    test('admin role always passes with mismatched IDs', () => {
        expect(() => assertResourceOwnerOrAdmin('owner-1', 'requester-2', 'admin')).not.toThrow();
    });

    test('admin role passes with matching IDs', () => {
        expect(() => assertResourceOwnerOrAdmin('user-1', 'user-1', 'admin')).not.toThrow();
    });

    test('matching user IDs passes', () => {
        expect(() => assertResourceOwnerOrAdmin('user-1', 'user-1', 'user')).not.toThrow();
    });

    test('mismatched IDs with non-admin throws AuthorizationError', () => {
        expect(() => assertResourceOwnerOrAdmin('owner-1', 'requester-2', 'user')).toThrow(AuthorizationError);
    });

    test('works with string IDs', () => {
        expect(() => assertResourceOwnerOrAdmin('abc', 'abc', 'user')).not.toThrow();
    });

    test('works when both IDs are numeric strings', () => {
        expect(() => assertResourceOwnerOrAdmin('123', '123', 'user')).not.toThrow();
    });

    test('resourceOwnerId and requestUserId comparison is string-based', () => {
        expect(() => assertResourceOwnerOrAdmin('00123', '123', 'user')).toThrow(AuthorizationError);
    });

    test('different types but same string value passes', () => {
        expect(() => assertResourceOwnerOrAdmin(String(123), String(123), 'user')).not.toThrow();
    });

    test("'user' role with mismatched IDs throws", () => {
        expect(() => assertResourceOwnerOrAdmin('owner', 'requester', 'user')).toThrow(AuthorizationError);
    });

    test("'guest' role with mismatched IDs throws", () => {
        expect(() => assertResourceOwnerOrAdmin('owner', 'requester', 'guest')).toThrow(AuthorizationError);
    });

    test('empty string IDs match and pass for non-admin', () => {
        expect(() => assertResourceOwnerOrAdmin('', '', 'user')).not.toThrow();
    });

    test('empty owner ID with non-empty request ID throws for non-admin', () => {
        expect(() => assertResourceOwnerOrAdmin('', 'u1', 'user')).toThrow(AuthorizationError);
    });

    test('throws with expected message when access is denied', () => {
        expect(() => assertResourceOwnerOrAdmin('owner-1', 'requester-2', 'user')).toThrow('접근 권한이 없습니다');
    });
});
