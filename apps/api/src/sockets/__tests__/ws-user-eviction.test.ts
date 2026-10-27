/**
 * 인증 철회(강등·비활성화·삭제·비밀번호 변경) → 그 사용자의 열린 채팅 WS 즉시 종료 (보안 점검 A3 보조 방어).
 */
const mockDetach = jest.fn().mockReturnValue(false);
jest.mock('../ws-stream-registry', () => ({
    getInFlightStreamRegistry: () => ({ detach: (...a: unknown[]) => mockDetach(...a) }),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { WebSocket } from 'ws';
import { emitUserAuthRevoked } from '../../utils/event-bus';
import { subscribeUserAuthRevoked } from '../ws-user-eviction';
import { WsConnectionGuard } from '../ws-connection-guard';
import type { ExtendedWebSocket } from '../ws-types';

interface FakeWs {
    readyState: number;
    close: jest.Mock;
    _authenticatedUserId: string;
    _abortController: AbortController | null;
}

function fakeWs(userId: string, readyState: number = WebSocket.OPEN): FakeWs {
    return { readyState, close: jest.fn(), _authenticatedUserId: userId, _abortController: null };
}

function fakeGuard(byUser: Map<string, Set<FakeWs>>) {
    return { getUserConnections: (userId: string) => (byUser.get(userId) ?? new Set()) as unknown as Set<WebSocket> };
}

describe('subscribeUserAuthRevoked', () => {
    let unsubscribe: (() => void) | null = null;
    afterEach(() => {
        unsubscribe?.();
        unsubscribe = null;
        mockDetach.mockReset().mockReturnValue(false);
    });

    test('철회된 사용자의 소켓만 정리하고 1008 auth_revoked 로 닫는다', () => {
        const a1 = fakeWs('A');
        const a2 = fakeWs('A');
        const b1 = fakeWs('B');
        const byUser = new Map([['A', new Set([a1, a2])], ['B', new Set([b1])]]);
        // 실제 handler 처럼 정리 콜백이 레지스트리에서 지운다 — 순회 중 삭제에도 두 소켓 모두 닫혀야 한다.
        const unregister = jest.fn((ws: WebSocket) => { byUser.get('A')?.delete(ws as unknown as FakeWs); });
        unsubscribe = subscribeUserAuthRevoked(fakeGuard(byUser), unregister);

        emitUserAuthRevoked({ userId: 'A', reason: 'role_changed' });

        expect(unregister).toHaveBeenCalledTimes(2);
        expect(unregister).toHaveBeenCalledWith(a1);
        expect(unregister).toHaveBeenCalledWith(a2);
        expect(a1.close).toHaveBeenCalledWith(1008, 'auth_revoked');
        expect(a2.close).toHaveBeenCalledWith(1008, 'auth_revoked');
        expect(b1.close).not.toHaveBeenCalled();
        expect(byUser.get('B')?.size).toBe(1);
    });

    test('이미 CLOSING·CLOSED 인 소켓은 close 를 다시 부르지 않는다', () => {
        const closed = fakeWs('A', WebSocket.CLOSED);
        const closing = fakeWs('A', WebSocket.CLOSING);
        const unregister = jest.fn();
        unsubscribe = subscribeUserAuthRevoked(fakeGuard(new Map([['A', new Set([closed, closing])]])), unregister);

        emitUserAuthRevoked({ userId: 'A', reason: 'account_disabled' });

        expect(closed.close).not.toHaveBeenCalled();
        expect(closing.close).not.toHaveBeenCalled();
    });

    test('진행 중 생성은 하트비트 종료와 같이 detach, 이어받기 대상이 아니면 abort', () => {
        const streaming = fakeWs('A');
        const plain = fakeWs('A');
        const ctrl = new AbortController();
        plain._abortController = ctrl;
        mockDetach.mockImplementation((ws: unknown) => ws === streaming);
        unsubscribe = subscribeUserAuthRevoked(fakeGuard(new Map([['A', new Set([streaming, plain])]])), jest.fn());

        emitUserAuthRevoked({ userId: 'A', reason: 'password_changed' });

        expect(mockDetach).toHaveBeenCalledWith(streaming);
        expect(mockDetach).toHaveBeenCalledWith(plain);
        expect(ctrl.signal.aborted).toBe(true);
        expect(plain._abortController).toBeNull();
    });

    test('한 소켓 정리가 실패해도 emit 은 던지지 않고 나머지 소켓을 닫는다', () => {
        const bad = fakeWs('A');
        bad.close.mockImplementation(() => { throw new Error('boom'); });
        const good = fakeWs('A');
        unsubscribe = subscribeUserAuthRevoked(fakeGuard(new Map([['A', new Set([bad, good])]])), jest.fn());

        expect(() => emitUserAuthRevoked({ userId: 'A', reason: 'account_deleted' })).not.toThrow();
        expect(good.close).toHaveBeenCalledWith(1008, 'auth_revoked');
    });

    test('실제 WsConnectionGuard — 철회된 사용자의 레지스트리만 비고 다른 사용자는 남는다', () => {
        const guard = new WsConnectionGuard();
        const [a1, a2, b1] = [fakeWs('A'), fakeWs('A'), fakeWs('B')];
        for (const ws of [a1, a2, b1]) guard.registerUser(ws as unknown as ExtendedWebSocket);
        unsubscribe = subscribeUserAuthRevoked(guard, (ws) => guard.unregisterUser(ws));

        emitUserAuthRevoked({ userId: 'A', reason: 'account_disabled' });

        expect(guard.getActiveConnectionsForUser('A')).toBe(0);
        expect(guard.getActiveConnectionsForUser('B')).toBe(1);
        expect(a1.close).toHaveBeenCalledWith(1008, 'auth_revoked');
        expect(a2.close).toHaveBeenCalledWith(1008, 'auth_revoked');
        expect(b1.close).not.toHaveBeenCalled();
    });

    test('구독 해제 뒤 emit 은 무반응', () => {
        const a1 = fakeWs('A');
        const unregister = jest.fn();
        const off = subscribeUserAuthRevoked(fakeGuard(new Map([['A', new Set([a1])]])), unregister);
        off();

        emitUserAuthRevoked({ userId: 'A', reason: 'role_changed' });

        expect(unregister).not.toHaveBeenCalled();
        expect(a1.close).not.toHaveBeenCalled();
    });
});
