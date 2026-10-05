/**
 * 레지스트리 관리자 기능(2026-10-05) — 전체 기기 조회, 기기 강제 해제, 키 폐기 시 그 키의 연결 끊기.
 */
import type { WebSocket } from 'ws';

jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, MAX_DEVICES: 3 },
}));

const { getLocalBridgeRegistry } = require('./registry') as typeof import('./registry');
type DeviceSession = import('./registry').DeviceSession;

function fakeWs(): WebSocket & { close: jest.Mock } {
    return { readyState: 1, OPEN: 1, send: jest.fn(), close: jest.fn() } as unknown as WebSocket & { close: jest.Mock };
}

function session(userId: string, deviceId: string, apiKeyId: string | undefined, ws = fakeWs()): DeviceSession {
    return { userId, deviceId, label: `dev-${deviceId}`, folderName: `folder-${deviceId}`, ws, connectedAt: Date.now(), apiKeyId };
}

describe('LocalBridgeRegistry 관리자 기능', () => {
    const reg = getLocalBridgeRegistry();
    const sessions: DeviceSession[] = [];

    beforeEach(() => {
        sessions.splice(0).forEach((s) => reg.unregister(s.ws));
        sessions.push(session('ua', 'd1', 'key-a'), session('ua', 'd2', 'key-b'), session('ub', 'd1', 'key-a2'));
        sessions.forEach((s) => expect(reg.register(s)).toBe(true));
    });
    afterAll(() => sessions.forEach((s) => reg.unregister(s.ws)));

    it('listAllDevices 는 모든 사용자의 기기를 돌려준다', () => {
        const all = reg.listAllDevices();
        expect(all.map((d) => `${d.userId}/${d.deviceId}`).sort()).toEqual(['ua/d1', 'ua/d2', 'ub/d1']);
    });

    it('disconnectDevice 는 그 기기의 소켓을 닫고 목록에서 뺀다', () => {
        const target = sessions[0];
        expect(reg.disconnectDevice('ua', 'd1', 'admin_disconnect')).toBe(true);
        expect((target.ws as unknown as { close: jest.Mock }).close).toHaveBeenCalledWith(1008, 'admin_disconnect');
        expect(reg.getDevice('ua', 'd1')).toBeNull();
        // 다른 사용자의 같은 deviceId 는 그대로
        expect(reg.getDevice('ub', 'd1')).not.toBeNull();
    });

    it('disconnectDevice 는 없는 기기면 false', () => {
        expect(reg.disconnectDevice('ua', 'nope', 'admin_disconnect')).toBe(false);
    });

    it('disconnectByApiKey 는 그 키로 인증한 연결만 닫는다', () => {
        expect(reg.disconnectByApiKey('key-a')).toBe(1);
        expect((sessions[0].ws as unknown as { close: jest.Mock }).close).toHaveBeenCalledWith(1008, 'api_key_revoked');
        expect((sessions[1].ws as unknown as { close: jest.Mock }).close).not.toHaveBeenCalled();
        expect((sessions[2].ws as unknown as { close: jest.Mock }).close).not.toHaveBeenCalled();
        expect(reg.getDevice('ua', 'd1')).toBeNull();
        expect(reg.getDevice('ua', 'd2')).not.toBeNull();
    });

    it('disconnectByApiKey 는 해당 연결이 없으면 0', () => {
        expect(reg.disconnectByApiKey('unknown-key')).toBe(0);
    });
});
