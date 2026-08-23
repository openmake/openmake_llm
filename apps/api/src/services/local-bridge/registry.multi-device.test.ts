/**
 * 레지스트리 다중 디바이스(101, 2026-08-21) — 데스크톱+CLI 병존.
 * 유저당 여러 디바이스 등록, 같은 deviceId 재등록 대체, deviceId 지정/미지정 라우팅,
 * 상한 초과 거부, 해제 시 해당 디바이스 pending 만 reject 를 검증한다.
 */
import type { WebSocket } from 'ws';

// 상한 검증은 값 자체를 고정해야 한다 — 운영 .env 의 LOCAL_BRIDGE_MAX_DEVICES 가 주입되면
// (로컬은 6) 기본 3 을 가정한 케이스가 환경에 따라 깨진다. requireActual + override 관행.
const MAX_DEVICES = 3;
jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, MAX_DEVICES: 3 },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getLocalBridgeRegistry } = require('./registry') as typeof import('./registry');
type DeviceSession = import('./registry').DeviceSession;

function fakeWs(): WebSocket {
    return { readyState: 1, OPEN: 1, send: jest.fn(), close: jest.fn() } as unknown as WebSocket;
}

function session(userId: string, deviceId: string, connectedAt: number, ws = fakeWs()): DeviceSession {
    return { userId, deviceId, label: `dev-${deviceId}`, folderName: `folder-${deviceId}`, ws, connectedAt };
}

describe('LocalBridgeRegistry 다중 디바이스', () => {
    const reg = getLocalBridgeRegistry();
    const wsList: WebSocket[] = [];

    afterEach(() => {
        for (const ws of wsList.splice(0)) reg.unregister(ws);
    });

    function add(userId: string, deviceId: string, connectedAt: number): { ws: WebSocket; ok: boolean } {
        const ws = fakeWs();
        wsList.push(ws);
        return { ws, ok: reg.register(session(userId, deviceId, connectedAt, ws)) };
    }

    test('유저당 여러 디바이스가 병존한다', () => {
        expect(add('u1', 'desktop', 100).ok).toBe(true);
        expect(add('u1', 'cli', 200).ok).toBe(true);
        expect(reg.getDevices('u1').map((d) => d.deviceId)).toEqual(['desktop', 'cli']);
    });

    test('deviceId 지정 조회는 정확 일치, 미지정은 최근 접속 디바이스', () => {
        add('u1', 'desktop', 100);
        add('u1', 'cli', 200);
        expect(reg.getDevice('u1', 'desktop')?.deviceId).toBe('desktop');
        expect(reg.getDevice('u1')?.deviceId).toBe('cli'); // 최근 접속
        expect(reg.getDevice('u1', 'unknown')).toBeNull();
    });

    test('같은 deviceId 재등록은 기존 세션을 대체한다 (디바이스 수 불변)', () => {
        add('u1', 'cli', 100);
        add('u1', 'cli', 200);
        expect(reg.getDevices('u1')).toHaveLength(1);
        expect(reg.getDevice('u1', 'cli')?.connectedAt).toBe(200);
    });

    test('상한(MAX_DEVICES) 초과 신규 등록은 거부된다', () => {
        for (let i = 1; i <= MAX_DEVICES; i++) expect(add('u1', `d${i}`, i).ok).toBe(true);
        expect(add('u1', `d${MAX_DEVICES + 1}`, MAX_DEVICES + 1).ok).toBe(false);
        expect(reg.getDevices('u1')).toHaveLength(MAX_DEVICES);
        // 기존 디바이스 재등록은 상한과 무관하게 허용
        expect(add('u1', `d${MAX_DEVICES}`, 99).ok).toBe(true);
    });

    test('같은 deviceId 재등록 시 구 소켓을 close 한다 (M2)', () => {
        const a = add('u1', 'cli', 100);
        add('u1', 'cli', 200); // 같은 deviceId, 새 ws
        expect((a.ws.close as jest.Mock)).toHaveBeenCalled();
    });

    test('getDeviceIdByWs 는 소켓의 deviceId 를 돌려준다 (L1 발신자 검증)', () => {
        const a = add('u1', 'desktop', 100);
        expect(reg.getDeviceIdByWs('u1', a.ws)).toBe('desktop');
        expect(reg.getDeviceIdByWs('u1', fakeWs())).toBeNull();
    });

    test('handleResult 는 발신 디바이스 불일치를 무시한다 (L1)', async () => {
        const a = add('u1', 'desktop', 100);
        add('u1', 'cli', 200);
        const p = reg.request('u1', { kind: 'read', path: 'x' }, 60000, 'desktop');
        const sent = JSON.parse((a.ws.send as jest.Mock).mock.calls[0][0] as string);
        // 다른 디바이스(cli)가 desktop 으로 라우팅된 reqId 결과를 위조 → 무시되어야 함
        reg.handleResult('u1', sent.reqId, { ok: true, content: 'forged' }, 'cli');
        // 올바른 디바이스(desktop)가 응답하면 정상 해소
        reg.handleResult('u1', sent.reqId, { ok: true, content: 'real' }, 'desktop');
        expect((await p).content).toBe('real');
    });

    test('한 디바이스 해제는 다른 디바이스에 영향을 주지 않는다', () => {
        const a = add('u1', 'desktop', 100);
        add('u1', 'cli', 200);
        reg.unregister(a.ws);
        expect(reg.getDevice('u1', 'desktop')).toBeNull();
        expect(reg.getDevice('u1', 'cli')?.deviceId).toBe('cli');
    });

    test('request 는 deviceId 로 해당 디바이스에만 전송된다', async () => {
        const a = add('u1', 'desktop', 100);
        const b = add('u1', 'cli', 200);
        void reg.request('u1', { kind: 'read', path: 'x' }, 1000, 'desktop');
        expect((a.ws.send as jest.Mock)).toHaveBeenCalledTimes(1);
        expect((b.ws.send as jest.Mock)).not.toHaveBeenCalled();
        // pending 정리 (타이머 leak 방지) — desktop 해제로 reject
        reg.unregister(a.ws);
    });

    test('디바이스 해제 시 그 디바이스의 pending 만 reject 된다', async () => {
        const a = add('u1', 'desktop', 100);
        const b = add('u1', 'cli', 200);
        const pA = reg.request('u1', { kind: 'read', path: 'x' }, 60000, 'desktop');
        const pB = reg.request('u1', { kind: 'read', path: 'y' }, 60000, 'cli');
        reg.unregister(a.ws);
        const rA = await pA;
        expect(rA.ok).toBe(false);
        expect(rA.error).toContain('끊어');
        // cli pending 은 살아 있다 — 결과 주입으로 정상 해소
        const sent = JSON.parse((b.ws.send as jest.Mock).mock.calls[0][0] as string);
        reg.handleResult('u1', sent.reqId, { ok: true, content: 'data' });
        const rB = await pB;
        expect(rB.ok).toBe(true);
        expect(rB.content).toBe('data');
    });
});
