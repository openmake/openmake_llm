/**
 * 레지스트리 — 계정 비활성화·삭제 시 사용자 단위 끊기, 키 만료일 변경을 연결에 반영(2026-10-05).
 */
import type { WebSocket } from 'ws';
import type { ExtendedWebSocket } from '../../sockets/ws-types';

jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, MAX_DEVICES: 3 },
}));

const { getLocalBridgeRegistry } = require('./registry') as typeof import('./registry');
type DeviceSession = import('./registry').DeviceSession;

function fakeWs(expiresAtMs: number | null = null): WebSocket & { close: jest.Mock } {
    return { readyState: 1, OPEN: 1, send: jest.fn(), close: jest.fn(), _authTokenExpiresAtMs: expiresAtMs } as unknown as WebSocket & { close: jest.Mock };
}

function session(userId: string, deviceId: string, apiKeyId: string, ws = fakeWs()): DeviceSession {
    return { userId, deviceId, label: `dev-${deviceId}`, folderName: `folder-${deviceId}`, ws, connectedAt: Date.now(), apiKeyId };
}

describe('LocalBridgeRegistry 계정·키 만료', () => {
    const reg = getLocalBridgeRegistry();
    const sessions: DeviceSession[] = [];

    beforeEach(() => {
        sessions.splice(0).forEach((s) => reg.unregister(s.ws));
        sessions.push(session('ua', 'd1', 'key-a'), session('ua', 'd2', 'key-b'), session('ub', 'd1', 'key-a'));
        sessions.forEach((s) => expect(reg.register(s)).toBe(true));
    });
    afterAll(() => sessions.forEach((s) => reg.unregister(s.ws)));

    const closeOf = (s: DeviceSession) => (s.ws as unknown as { close: jest.Mock }).close;

    it('disconnectByUser 는 그 사용자의 연결만 모두 닫는다 — 관리자 강제 해제와 다른 사유', () => {
        expect(reg.disconnectByUser('ua', 'account_disabled')).toBe(2);
        expect(closeOf(sessions[0])).toHaveBeenCalledWith(1008, 'account_disabled');
        expect(closeOf(sessions[1])).toHaveBeenCalledWith(1008, 'account_disabled');
        expect(closeOf(sessions[2])).not.toHaveBeenCalled();
        expect(reg.getDevices('ua')).toEqual([]);
        expect(reg.getDevice('ub', 'd1')).not.toBeNull();
    });

    it('disconnectByUser 는 계정 삭제 사유도 쓸 수 있다', () => {
        reg.disconnectByUser('ub', 'account_deleted');
        expect(closeOf(sessions[2])).toHaveBeenCalledWith(1008, 'account_deleted');
    });

    it('disconnectByUser 는 연결이 없으면 0', () => {
        expect(reg.disconnectByUser('nobody', 'account_disabled')).toBe(0);
    });

    it('updateApiKeyExpiry 는 그 키로 인증한 연결의 만료 시각을 바꾼다 — 하트비트가 새 값으로 닫는다', () => {
        const at = Date.now() + 60_000;
        expect(reg.updateApiKeyExpiry('key-a', at)).toBe(2);
        expect((sessions[0].ws as unknown as ExtendedWebSocket)._authTokenExpiresAtMs).toBe(at);
        expect((sessions[2].ws as unknown as ExtendedWebSocket)._authTokenExpiresAtMs).toBe(at);
        expect((sessions[1].ws as unknown as ExtendedWebSocket)._authTokenExpiresAtMs).toBeNull();
        expect(closeOf(sessions[0])).not.toHaveBeenCalled();
    });

    it('updateApiKeyExpiry(null) 은 만료를 없앤다(무기한)', () => {
        reg.updateApiKeyExpiry('key-a', Date.now() + 1000);
        reg.updateApiKeyExpiry('key-a', null);
        expect((sessions[0].ws as unknown as ExtendedWebSocket)._authTokenExpiresAtMs).toBeNull();
    });
});
