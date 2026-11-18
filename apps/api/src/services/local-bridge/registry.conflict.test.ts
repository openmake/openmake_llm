/**
 * 같은 deviceId 의 다른 프로세스 (설계 2026-11-19 device-id-conflict §3.2·§5.1) — 기존 연결이 확인 ping 에 응답하면
 * 새 연결을 거절하고, 응답하지 않으면 종전대로 대체한다.
 */
import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';

const mockWarn = jest.fn();
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: (...a: unknown[]) => mockWarn(...a), error: jest.fn(), debug: jest.fn() }),
}));

import { getLocalBridgeRegistry, type DeviceSession } from './registry';
import { LOCAL_BRIDGE } from '../../config/local-bridge';

const PROBE_MS = LOCAL_BRIDGE.REREGISTER_PROBE_MS;

interface FakeWs extends EventEmitter {
    readyState: number;
    OPEN: number;
    pongs: boolean;
    sent: string[];
    closed: boolean;
    send(s: string): void;
    ping(data?: Buffer): void;
    close(code?: number, reason?: string): void;
}

/** 가짜 소켓 — pongs 면 ping 내용을 그대로 돌려준다(ws·tungstenite 자동 응답). close 는 'close' 를 낸다. */
function fakeWs(opts: { pongs: boolean }): FakeWs {
    const ws = new EventEmitter() as FakeWs;
    ws.readyState = 1;
    ws.OPEN = 1;
    ws.pongs = opts.pongs;
    ws.sent = [];
    ws.closed = false;
    ws.send = (s: string) => { ws.sent.push(s); };
    ws.ping = (data?: Buffer) => { if (ws.pongs) void Promise.resolve().then(() => ws.emit('pong', data ?? Buffer.alloc(0))); };
    ws.close = () => {
        if (ws.closed) return;
        ws.closed = true;
        ws.readyState = 3;
        ws.emit('close');
    };
    return ws;
}

const reg = getLocalBridgeRegistry();
const sockets: FakeWs[] = [];

function session(userId: string, ws: FakeWs, instanceId?: string): DeviceSession {
    sockets.push(ws);
    return { userId, deviceId: 'dev-1', label: 'mac · work', folderName: 'work', ws: ws as unknown as WebSocket, connectedAt: Date.now(), ...(instanceId ? { instanceId } : {}) };
}

function lastReqId(ws: FakeWs): string {
    return (JSON.parse(ws.sent[ws.sent.length - 1]) as { reqId: string }).reqId;
}

/** 확인 시간을 넘긴다 — 가짜 타이머를 돌리고 미뤄진 Promise 를 흘려보낸다. */
async function passProbe(): Promise<void> {
    await jest.advanceTimersByTimeAsync(PROBE_MS + 1);
}

function silentWarns(): string[] {
    return mockWarn.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('무응답'));
}
function conflictWarns(): string[] {
    return mockWarn.mock.calls.map((c) => String(c[0])).filter((s) => s.includes('충돌'));
}

beforeEach(() => { jest.useFakeTimers(); mockWarn.mockClear(); });
afterEach(() => {
    for (const ws of sockets.splice(0)) reg.unregister(ws as unknown as WebSocket);
    jest.useRealTimers();
});

describe('registerChecked — 살아 있는 기존 연결 보호', () => {
    test('살아 있는 기존 연결이 있으면 같은 deviceId 의 다른 프로세스를 거절한다', async () => {
        const a = fakeWs({ pongs: true }), b = fakeWs({ pongs: true });
        expect(await reg.registerChecked(session('c-u1', a, 'A'))).toBe('ok');
        const pending = reg.request('c-u1', { kind: 'exec', command: 'sleep 1' }, 5000, 'dev-1');
        expect(await reg.registerChecked(session('c-u1', b, 'B'))).toBe('conflict');
        expect(a.closed).toBe(false);
        expect(reg.getDevice('c-u1', 'dev-1')!.ws).toBe(a);
        reg.handleResult('c-u1', lastReqId(a), { ok: true }, 'dev-1');
        expect((await pending).ok).toBe(true);
    });

    test('기존 소켓이 pong 하지 않으면 확인 시간 뒤 대체한다 — 걸려 있던 요청은 disconnected', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true });
        await reg.registerChecked(session('c-u2', a, 'A'));
        const pending = reg.request('c-u2', { kind: 'exec', command: 'ls' }, 60000, 'dev-1');
        const p = reg.registerChecked(session('c-u2', b, 'B'));
        await passProbe();
        expect(await p).toBe('ok');
        expect(a.closed).toBe(true);
        expect(reg.getDevice('c-u2', 'dev-1')!.ws).toBe(b);
        expect(await pending).toMatchObject({ ok: false, transport: 'disconnected' });
        expect(silentWarns()).toHaveLength(1);
    });

    test('기존 소켓이 OPEN 이 아니면 확인 없이 즉시 대체한다', async () => {
        const a = fakeWs({ pongs: true }), b = fakeWs({ pongs: true });
        await reg.registerChecked(session('c-u3', a, 'A'));
        a.readyState = 2;
        const ping = jest.spyOn(a, 'ping');
        expect(await reg.registerChecked(session('c-u3', b, 'B'))).toBe('ok');
        expect(ping).not.toHaveBeenCalled();
        expect(reg.getDevice('c-u3', 'dev-1')!.ws).toBe(b);
    });

    test('instanceId 가 같으면 확인 없이 즉시 대체한다(같은 프로세스의 재연결)', async () => {
        const a = fakeWs({ pongs: true }), b = fakeWs({ pongs: true });
        await reg.registerChecked(session('c-u4', a, 'same'));
        const ping = jest.spyOn(a, 'ping');
        expect(await reg.registerChecked(session('c-u4', b, 'same'))).toBe('ok');
        expect(ping).not.toHaveBeenCalled();
        expect(a.closed).toBe(true);
    });

    test('instanceId 가 없는 옛 기기도 pong 으로 판정한다', async () => {
        const a = fakeWs({ pongs: true }), b = fakeWs({ pongs: true });
        await reg.registerChecked(session('c-u5', a));
        expect(await reg.registerChecked(session('c-u5', b))).toBe('conflict');
        const c = fakeWs({ pongs: true });
        expect(await reg.registerChecked(session('c-u5', c, 'C'))).toBe('conflict');
        expect(reg.getDevice('c-u5', 'dev-1')!.ws).toBe(a);
    });

    test('반복 시도 — B 가 10번 시도해도 대체 0회, A 그대로, 충돌 경고는 1줄', async () => {
        const a = fakeWs({ pongs: true });
        await reg.registerChecked(session('c-u6', a, 'A'));
        for (let i = 0; i < 10; i++) {
            expect(await reg.registerChecked(session('c-u6', fakeWs({ pongs: true }), 'B'))).toBe('conflict');
        }
        expect(a.closed).toBe(false);
        expect(reg.getDevice('c-u6', 'dev-1')!.ws).toBe(a);
        expect(conflictWarns()).toHaveLength(1);
        expect(silentWarns()).toHaveLength(0);
    });

    test('확인 중 같은 기기로 세 번째 hello 가 와도 등록은 하나만 남는다', async () => {
        const a = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-u7', a, 'A'));
        const b = fakeWs({ pongs: true }), c = fakeWs({ pongs: true });
        const pb = reg.registerChecked(session('c-u7', b, 'B'));
        const pc = reg.registerChecked(session('c-u7', c, 'C'));
        await passProbe();
        // B 가 A 를 대체하고, C 는 그 결과를 기다린 뒤 B 를 확인한다 — B 는 응답하므로 C 가 거절된다.
        expect(await pb).toBe('ok');
        expect(await pc).toBe('conflict');
        expect(reg.getDevices('c-u7')).toHaveLength(1);
        expect(reg.getDevice('c-u7', 'dev-1')!.ws).toBe(b);
    });

    test('확인 중 새 소켓이 닫히면 등록하지 않는다', async () => {
        const a = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-u8', a, 'A'));
        const b = fakeWs({ pongs: true });
        const pb = reg.registerChecked(session('c-u8', b, 'B'));
        b.close();
        await passProbe();
        expect(await pb).toBe('closed');
        expect(reg.getDevice('c-u8', 'dev-1')!.ws).toBe(a);
        expect(a.closed).toBe(false);
    });

    test('상한 초과는 종전대로 limit', async () => {
        for (let i = 0; i < LOCAL_BRIDGE.MAX_DEVICES; i++) {
            const ws = fakeWs({ pongs: true });
            sockets.push(ws);
            reg.register({ userId: 'c-u9', deviceId: `d${i}`, label: 'x', folderName: 'x', ws: ws as unknown as WebSocket, connectedAt: Date.now() });
        }
        expect(await reg.registerChecked(session('c-u9', fakeWs({ pongs: true }), 'X'))).toBe('limit');
    });
});

describe('registerChecked — 확인의 의미(r2·r3)', () => {
    test('무관한 pong(하트비트 응답)은 세지 않는다 — 시간 뒤 대체', async () => {
        const a = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-v1', a, 'A'));
        const p = reg.registerChecked(session('c-v1', fakeWs({ pongs: true }), 'B'));
        await Promise.resolve();
        a.emit('pong', Buffer.alloc(0));
        a.emit('pong', Buffer.from('other'));
        await passProbe();
        expect(await p).toBe('ok');
        expect(a.closed).toBe(true);
    });

    test('같은 내용의 pong 이면 거절한다', async () => {
        const a = fakeWs({ pongs: false });
        let token: Buffer | undefined;
        a.ping = (data?: Buffer) => { token = data; };
        await reg.registerChecked(session('c-v2', a, 'A'));
        const p = reg.registerChecked(session('c-v2', fakeWs({ pongs: true }), 'B'));
        await Promise.resolve();
        expect(token && token.length).toBeGreaterThan(0);
        a.emit('pong', Buffer.from(token!));
        expect(await p).toBe('conflict');
    });

    test('늦은 pong 은 결과를 바꾸지 않는다 — 리스너가 남지 않는다', async () => {
        const a = fakeWs({ pongs: false });
        let token: Buffer | undefined;
        a.ping = (data?: Buffer) => { token = data; };
        await reg.registerChecked(session('c-v3', a, 'A'));
        const b = fakeWs({ pongs: true });
        const p = reg.registerChecked(session('c-v3', b, 'B'));
        await passProbe();
        expect(await p).toBe('ok');
        expect(a.listenerCount('pong')).toBe(0);
        expect(a.listenerCount('close')).toBe(0);
        a.emit('pong', Buffer.from(token!));
        expect(reg.getDevice('c-v3', 'dev-1')!.ws).toBe(b);
    });

    test('응답 못 한 A 가 대체된 뒤 다시 붙을 때 B 가 응답하면 A 가 거절된다 — 대체 1회', async () => {
        const a = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-v4', a, 'A'));
        const b = fakeWs({ pongs: true });
        const pb = reg.registerChecked(session('c-v4', b, 'B'));
        await passProbe();
        expect(await pb).toBe('ok');
        expect(await reg.registerChecked(session('c-v4', fakeWs({ pongs: true }), 'A'))).toBe('conflict');
        expect(reg.getDevice('c-v4', 'dev-1')!.ws).toBe(b);
        expect(silentWarns()).toHaveLength(1);
    });

    test('연속 무응답 — 대체 2회 뒤 응답하면 멈춘다, 경고는 횟수 1·2', async () => {
        const a1 = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-v5', a1, 'A'));
        const r1 = reg.request('c-v5', { kind: 'exec', command: 'x' }, 600000, 'dev-1');
        const b1 = fakeWs({ pongs: false });
        const p1 = reg.registerChecked(session('c-v5', b1, 'B'));
        await passProbe();
        expect(await p1).toBe('ok');
        expect(await r1).toMatchObject({ transport: 'disconnected' });

        const r2 = reg.request('c-v5', { kind: 'exec', command: 'y' }, 600000, 'dev-1');
        const a2 = fakeWs({ pongs: true });
        const p2 = reg.registerChecked(session('c-v5', a2, 'A'));
        await passProbe();
        expect(await p2).toBe('ok');
        expect(await r2).toMatchObject({ transport: 'disconnected' });

        expect(await reg.registerChecked(session('c-v5', fakeWs({ pongs: true }), 'B'))).toBe('conflict');
        expect(reg.getDevice('c-v5', 'dev-1')!.ws).toBe(a2);
        expect(reg.getDevices('c-v5')).toHaveLength(1);
        const warns = silentWarns();
        expect(warns).toHaveLength(2);
        expect(warns[0]).toMatch(/recent=1\b/);
        expect(warns[1]).toMatch(/recent=2\b/);
    });

    test('무응답 대체 횟수는 창이 지나면 다시 1부터 센다', async () => {
        const a = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-v6', a, 'A'));
        const p1 = reg.registerChecked(session('c-v6', fakeWs({ pongs: false }), 'B'));
        await passProbe();
        await p1;
        await jest.advanceTimersByTimeAsync(11 * 60 * 1000);
        const p2 = reg.registerChecked(session('c-v6', fakeWs({ pongs: false }), 'A'));
        await passProbe();
        await p2;
        const warns = silentWarns();
        expect(warns).toHaveLength(2);
        expect(warns[1]).toMatch(/recent=1\b/);
    });

    test('확인 중 기존 소켓이 닫혀 해제되면 남은 시간을 기다리지 않고 등록된다', async () => {
        const a = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-v7', a, 'A'));
        const pending = reg.request('c-v7', { kind: 'exec', command: 'x' }, 600000, 'dev-1');
        const b = fakeWs({ pongs: true });
        const pb = reg.registerChecked(session('c-v7', b, 'B'));
        await Promise.resolve();
        a.close();
        reg.unregister(a as unknown as WebSocket);
        expect(await pb).toBe('ok');
        expect(reg.getDevice('c-v7', 'dev-1')!.ws).toBe(b);
        expect(await pending).toMatchObject({ transport: 'disconnected' });
    });

    test('확인 중 기존 기기가 강제 해제되면 지금 세션 기준으로 다시 판정한다', async () => {
        const a = fakeWs({ pongs: false });
        a.close = () => { a.readyState = 3; };  // 닫는 중 — close 이벤트가 늦게 온다
        await reg.registerChecked(session('c-v8', a, 'A'));
        const b = fakeWs({ pongs: true });
        const pb = reg.registerChecked(session('c-v8', b, 'B'));
        await Promise.resolve();
        reg.disconnectDevice('c-v8', 'dev-1', 'admin_disconnect');
        expect(await pb).toBe('ok');
        expect(reg.getDevice('c-v8', 'dev-1')!.ws).toBe(b);
        expect(a.listenerCount('pong')).toBe(0);
    });

    test('확인 중 그 자리에 다른 세션이 들어오면 지금 세션을 잘못 닫지 않는다', async () => {
        const a = fakeWs({ pongs: false });
        await reg.registerChecked(session('c-v9', a, 'A'));
        const b = fakeWs({ pongs: true });
        const pb = reg.registerChecked(session('c-v9', b, 'B'));
        await Promise.resolve();
        // 동기 register(옛 경로)로 다른 세션이 들어온다 — 그 세션은 응답한다.
        const c = fakeWs({ pongs: true });
        reg.register(session('c-v9', c, 'C'));
        expect(await pb).toBe('conflict');
        expect(c.closed).toBe(false);
        expect(reg.getDevice('c-v9', 'dev-1')!.ws).toBe(c);
    });

    test('확인이 어떻게 끝나든 리스너·타이머가 남지 않는다', async () => {
        const a = fakeWs({ pongs: true });
        await reg.registerChecked(session('c-v10', a, 'A'));
        await reg.registerChecked(session('c-v10', fakeWs({ pongs: true }), 'B'));
        expect(a.listenerCount('pong')).toBe(0);
        expect(a.listenerCount('close')).toBe(0);
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe('registerChecked — 확인 대기 중 키 폐기·계정 해제 (리뷰 r3)', () => {
    function keyed(userId: string, ws: FakeWs, instanceId: string, apiKeyId: string): DeviceSession {
        return { ...session(userId, ws, instanceId), apiKeyId };
    }

    test('확인 대기 중 그 키를 폐기하면 대기 소켓도 닫히고 등록되지 않는다', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true });
        await reg.registerChecked(keyed('c-k1', a, 'A', 'key-1'));
        const pb = reg.registerChecked(keyed('c-k1', b, 'B', 'key-1'));
        await Promise.resolve();
        expect(reg.disconnectByApiKey('key-1')).toBe(2);
        expect(await pb).toBe('closed');
        expect(b.closed).toBe(true);
        expect(reg.getDevice('c-k1', 'dev-1')).toBeNull();
    });

    test('닫기가 곧바로 상태를 바꾸지 않아도 폐기된 대기 소켓은 등록 직전 재검증에서 걸러진다', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true });
        b.close = () => { b.closed = true; }; // readyState 는 OPEN 그대로
        await reg.registerChecked(keyed('c-k2', a, 'A', 'key-2'));
        const pb = reg.registerChecked(keyed('c-k2', b, 'B', 'key-2'));
        await Promise.resolve();
        reg.disconnectByApiKey('key-2');
        expect(await pb).toBe('closed');
        expect(reg.getDevice('c-k2', 'dev-1')).toBeNull();
    });

    test('확인 시간이 끝난 뒤 등록 직전에도 폐기를 확인한다(기존 연결 무응답 → 대체 경로)', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true });
        b.close = () => { b.closed = true; };
        await reg.registerChecked(keyed('c-k3', a, 'A', 'key-a'));
        const pb = reg.registerChecked(keyed('c-k3', b, 'B', 'key-b'));
        await Promise.resolve();
        reg.disconnectByApiKey('key-b'); // A 는 다른 키라 그대로 — 확인은 계속된다
        expect(a.closed).toBe(false);
        await passProbe();
        expect(await pb).toBe('closed');
        expect(reg.getDevice('c-k3', 'dev-1')!.ws).toBe(a);
    });

    test('다른 키의 대기 소켓은 건드리지 않는다', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true });
        await reg.registerChecked(keyed('c-k4', a, 'A', 'key-old'));
        const pb = reg.registerChecked(keyed('c-k4', b, 'B', 'key-new'));
        await Promise.resolve();
        expect(reg.disconnectByApiKey('key-old')).toBe(1);
        expect(await pb).toBe('ok');
        expect(b.closed).toBe(false);
        expect(reg.getDevice('c-k4', 'dev-1')!.ws).toBe(b);
    });

    test('확인 대기 중 계정을 비활성화하면 대기 소켓도 닫히고 등록되지 않는다', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true });
        await reg.registerChecked(keyed('c-k5', a, 'A', 'key-5'));
        const pb = reg.registerChecked(keyed('c-k5', b, 'B', 'key-5'));
        await Promise.resolve();
        expect(reg.disconnectByUser('c-k5', 'account_disabled')).toBe(2);
        expect(await pb).toBe('closed');
        expect(b.closed).toBe(true);
        expect(reg.getDevice('c-k5', 'dev-1')).toBeNull();
    });

    test('확인 대기 중 키 만료일을 바꾸면 대기 소켓의 만료 시각도 바뀐다', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true });
        await reg.registerChecked(keyed('c-k7', a, 'A', 'key-7'));
        const pb = reg.registerChecked(keyed('c-k7', b, 'B', 'key-7'));
        await Promise.resolve();
        expect(reg.updateApiKeyExpiry('key-7', 12345)).toBe(2);
        expect((b as unknown as { _authTokenExpiresAtMs?: number | null })._authTokenExpiresAtMs).toBe(12345);
        await passProbe();
        expect(await pb).toBe('ok');
    });

    test('다른 확인의 결과를 기다리던 세 번째 소켓도 폐기 대상이다', async () => {
        const a = fakeWs({ pongs: false }), b = fakeWs({ pongs: true }), c = fakeWs({ pongs: true });
        await reg.registerChecked(keyed('c-k6', a, 'A', 'key-6'));
        const pb = reg.registerChecked(keyed('c-k6', b, 'B', 'key-6'));
        const pc = reg.registerChecked(keyed('c-k6', c, 'C', 'key-6'));
        await Promise.resolve();
        expect(reg.disconnectByApiKey('key-6')).toBe(3);
        expect(await pb).toBe('closed');
        expect(await pc).toBe('closed');
        expect(reg.getDevice('c-k6', 'dev-1')).toBeNull();
    });
});
