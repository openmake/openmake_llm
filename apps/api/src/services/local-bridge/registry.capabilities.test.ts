/**
 * 레지스트리 능력 목록·PC 단위 식별 (Companion P1, 2026-10-04).
 * - 상한은 PC(hostId) 단위로 센다 — 같은 PC 의 폴더 여러 개는 1대. 구버전(hostId 없음)은 deviceId 단위 그대로.
 * - 한 PC 의 폴더(루트) 수에도 상한이 있다.
 * - 기기가 지원하지 않는 요청 종류는 보내지 않고 unsupported 결과로 돌려준다. 능력 목록이 없는 구버전은 현행 12종.
 */
import type { WebSocket } from 'ws';

jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, MAX_DEVICES: 2, MAX_ROOTS_PER_HOST: 2 },
}));

const { getLocalBridgeRegistry, LEGACY_BRIDGE_KINDS, normalizeCapabilities } = require('./registry') as typeof import('./registry');
type DeviceSession = import('./registry').DeviceSession;

function fakeWs(): WebSocket {
    return { readyState: 1, OPEN: 1, send: jest.fn(), close: jest.fn() } as unknown as WebSocket;
}

describe('LocalBridgeRegistry 능력 목록·PC 단위 식별', () => {
    const reg = getLocalBridgeRegistry();
    const wsList: WebSocket[] = [];

    afterEach(() => {
        for (const ws of wsList.splice(0)) reg.unregister(ws);
    });

    function add(userId: string, deviceId: string, extra: Partial<DeviceSession> = {}): { ws: WebSocket; ok: boolean } {
        const ws = fakeWs();
        wsList.push(ws);
        const session: DeviceSession = { userId, deviceId, label: deviceId, folderName: deviceId, ws, connectedAt: Date.now(), ...extra };
        return { ws, ok: reg.register(session) };
    }

    test('같은 PC 의 폴더 여러 개는 상한에서 1대로 센다', () => {
        expect(add('u1', 'mac-a1', { hostId: 'mac' }).ok).toBe(true);
        expect(add('u1', 'mac-b2', { hostId: 'mac' }).ok).toBe(true);
        // PC 는 아직 1대 — 두 번째 PC 가 들어온다
        expect(add('u1', 'win-c3', { hostId: 'win' }).ok).toBe(true);
        // 세 번째 PC 는 상한(2) 초과
        expect(add('u1', 'linux-d4', { hostId: 'linux' }).ok).toBe(false);
    });

    test('한 PC 의 폴더 수가 상한을 넘으면 거절한다', () => {
        expect(add('u1', 'mac-a1', { hostId: 'mac' }).ok).toBe(true);
        expect(add('u1', 'mac-b2', { hostId: 'mac' }).ok).toBe(true);
        expect(add('u1', 'mac-c3', { hostId: 'mac' }).ok).toBe(false);
    });

    test('hostId 가 없는 구버전은 deviceId 단위로 센다(현행)', () => {
        expect(add('u1', 'old-1').ok).toBe(true);
        expect(add('u1', 'old-2').ok).toBe(true);
        expect(add('u1', 'old-3').ok).toBe(false);
        expect(reg.getDevice('u1', 'old-1')?.hostId).toBe('old-1');
    });

    test('같은 deviceId 재등록은 상한과 무관하게 대체된다', () => {
        add('u1', 'mac-a1', { hostId: 'mac' });
        add('u1', 'mac-b2', { hostId: 'mac' });
        expect(add('u1', 'mac-a1', { hostId: 'mac' }).ok).toBe(true);
        expect(reg.getDevices('u1')).toHaveLength(2);
    });

    test('능력 목록이 없으면 현행 12종을 지원하는 것으로 본다', () => {
        add('u1', 'old-1');
        expect(reg.supports('u1', 'old-1', 'exec')).toBe(true);
        expect(reg.supports('u1', 'old-1', 'test_runner')).toBe(true);
    });

    test('능력 목록에 없는 종류는 보내지 않고 unsupported 로 돌려준다', async () => {
        const { ws } = add('u1', 'new-1', { capabilities: new Set(['read', 'list']) });
        expect(reg.supports('u1', 'new-1', 'exec')).toBe(false);
        const r = await reg.request('u1', { kind: 'exec', command: 'ls' }, 1000, 'new-1');
        expect(r).toMatchObject({ ok: false, unsupported: true });
        expect(ws.send).not.toHaveBeenCalled();
    });

    test('요청 프레임에 만료 시각을 싣는다 — 응답 대기 상한과 같은 시점', async () => {
        const { ws } = add('u1', 'dev-1');
        const before = Date.now();
        const pending = reg.request('u1', { kind: 'read', path: 'a.txt' }, 5000, 'dev-1');
        const frame = JSON.parse((ws.send as jest.Mock).mock.calls[0][0] as string) as { type: string; reqId: string; expiresAt: number };
        expect(frame.type).toBe('bridge_exec');
        expect(frame.expiresAt).toBeGreaterThanOrEqual(before + 5000);
        expect(frame.expiresAt).toBeLessThanOrEqual(Date.now() + 5000);
        reg.handleResult('u1', frame.reqId, { ok: true, content: '' }, 'dev-1');
        await expect(pending).resolves.toMatchObject({ ok: true });
    });

    test('연결되지 않은 기기는 어떤 종류도 지원하지 않는다', () => {
        expect(reg.supports('u1', 'nope', 'read')).toBe(false);
    });
});

describe('normalizeCapabilities', () => {
    test('배열이 아니면 undefined(구버전)', () => {
        expect(normalizeCapabilities(undefined)).toBeUndefined();
        expect(normalizeCapabilities('exec')).toBeUndefined();
    });

    test('아는 종류만 남기고 모르는 값·문자열이 아닌 값은 버린다', () => {
        const caps = normalizeCapabilities(['read', 'exec', 'rm_rf_everything', 42, null]);
        expect(caps && [...caps].sort()).toEqual(['exec', 'read']);
    });

    test('빈 배열은 "아무것도 지원하지 않음"이다(구버전과 구분)', () => {
        expect(normalizeCapabilities([])?.size).toBe(0);
    });

    test('현행 12종 목록', () => {
        expect(LEGACY_BRIDGE_KINDS).toHaveLength(12);
    });
});
