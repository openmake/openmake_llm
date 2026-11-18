/**
 * 등록 전 소켓의 메시지 (설계 2026-11-19 device-id-conflict §3.2 r2) — 등록되지 않은 소켓(확인 대기 중·거절됨·대체돼 밀려남)의
 * bridge_result·bridge_event 는 아무것도 하지 않는다. 등록된 소켓은 종전과 같다. 실제 레지스트리를 쓴다.
 */
import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import type { WSMessage } from '../ws-types';

const mockResumeTakeover = jest.fn(async (..._a: unknown[]) => 0);
const mockResumeDeviceWait = jest.fn(async (..._a: unknown[]) => 0);
jest.mock('../../services/agent-task/browser-takeover', () => ({ resumeBrowserTakeoverTasks: (...a: unknown[]) => mockResumeTakeover(...a) }));
jest.mock('../../services/agent-task/device-wait', () => ({ resumeDeviceWaitingTasks: (...a: unknown[]) => mockResumeDeviceWait(...a) }));
jest.mock('../../config/local-bridge', () => {
    const actual = jest.requireActual('../../config/local-bridge');
    return { ...actual, LOCAL_BRIDGE: { ...actual.LOCAL_BRIDGE, ENABLED: true, REREGISTER_PROBE_MS: 5000 } };
});

import { handleBridgeMessage } from '../ws-bridge-handler';
import { getLocalBridgeRegistry } from '../../services/local-bridge/registry';

interface FakeWs extends EventEmitter {
    readyState: number; OPEN: number; pongs: boolean; sent: Array<Record<string, unknown>>; closedWith?: [number?, string?];
    _authenticatedUserId: string; _apiKeyScopes: string[];
    send(s: string): void; ping(d?: Buffer): void; close(code?: number, reason?: string): void;
}

function fakeWs(userId: string, pongs = true): FakeWs {
    const ws = new EventEmitter() as FakeWs;
    Object.assign(ws, { readyState: 1, OPEN: 1, pongs, sent: [], _authenticatedUserId: userId, _apiKeyScopes: ['bridge'] });
    ws.send = (s: string) => { ws.sent.push(JSON.parse(s) as Record<string, unknown>); };
    ws.ping = (d?: Buffer) => { if (ws.pongs) void Promise.resolve().then(() => ws.emit('pong', d ?? Buffer.alloc(0))); };
    ws.close = (code?: number, reason?: string) => {
        if (ws.readyState === 3) return;
        ws.closedWith = [code, reason];
        ws.readyState = 3;
        reg.unregister(ws as unknown as WebSocket); // handler.ts 의 close 처리와 같다
        ws.emit('close');
    };
    sockets.push(ws);
    return ws;
}

const reg = getLocalBridgeRegistry();
const sockets: FakeWs[] = [];
const W = (ws: FakeWs) => ws as unknown as WebSocket;
const hello = (deviceId: string, instanceId?: string) => ({ type: 'bridge_hello', deviceId, label: 'mac · w', folderName: 'w', ...(instanceId ? { instanceId } : {}) }) as unknown as WSMessage;
const result = (reqId: string) => ({ type: 'bridge_result', reqId, result: { ok: true, stdout: 'forged' } }) as unknown as WSMessage;
const control = { type: 'bridge_event', kind: 'browser_control', user: false } as unknown as WSMessage;

beforeEach(() => { mockResumeTakeover.mockClear(); mockResumeDeviceWait.mockClear(); });
afterEach(() => { for (const ws of sockets.splice(0)) reg.unregister(W(ws)); jest.useRealTimers(); });

/** dev-other 로 요청을 하나 걸어 둔다 — 그 reqId 를 위조 결과에 쓴다. */
async function routedRequest(userId: string) {
    const other = fakeWs(userId);
    await handleBridgeMessage(W(other), hello('dev-other', 'O'));
    let settled = false;
    const p = reg.request(userId, { kind: 'read', path: 'a' }, 60000, 'dev-other').then((r) => { settled = true; return r; });
    const reqId = (other.sent.find((f) => f.type === 'bridge_exec') as { reqId: string }).reqId;
    return { other, p, reqId, isSettled: () => settled };
}

describe('등록되지 않은 소켓', () => {
    test('① 다른 기기로 나간 요청의 reqId 로 bridge_result 를 보내도 요청이 끝나지 않는다', async () => {
        const { reqId, isSettled } = await routedRequest('h-u1');
        const stranger = fakeWs('h-u1');
        await handleBridgeMessage(W(stranger), result(reqId));
        await Promise.resolve();
        expect(isSettled()).toBe(false);
    });

    test('② bridge_event(browser_control, user=false) 는 재개를 부르지 않는다', async () => {
        const stranger = fakeWs('h-u2');
        await handleBridgeMessage(W(stranger), control);
        await new Promise((r) => setImmediate(r));
        expect(mockResumeTakeover).not.toHaveBeenCalled();
    });

    test('③ 확인 대기 중인 소켓도 같다', async () => {
        jest.useFakeTimers();
        const { reqId, isSettled } = await routedRequest('h-u3');
        const a = fakeWs('h-u3', false);
        await handleBridgeMessage(W(a), hello('dev-1', 'A'));
        const b = fakeWs('h-u3');
        const pending = handleBridgeMessage(W(b), hello('dev-1', 'B')); // a 는 응답하지 않는다 — 확인 대기
        await Promise.resolve();
        await handleBridgeMessage(W(b), result(reqId));
        await handleBridgeMessage(W(b), control);
        await jest.advanceTimersByTimeAsync(0);
        expect(isSettled()).toBe(false);
        expect(mockResumeTakeover).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(5001);
        await pending;
    });

    test("③ 'conflict' 로 거절된 소켓도 같다", async () => {
        const { reqId, isSettled } = await routedRequest('h-u4');
        const a = fakeWs('h-u4');
        await handleBridgeMessage(W(a), hello('dev-1', 'A'));
        const b = fakeWs('h-u4');
        b.close = function (code?: number, reason?: string) { b.closedWith = [code, reason]; }; // 닫는 중 — 아직 프레임이 올 수 있다
        await handleBridgeMessage(W(b), hello('dev-1', 'B'));
        expect(b.closedWith).toEqual([1008, 'device_conflict']);
        await handleBridgeMessage(W(b), result(reqId));
        await handleBridgeMessage(W(b), control);
        await new Promise((r) => setImmediate(r));
        expect(isSettled()).toBe(false);
        expect(mockResumeTakeover).not.toHaveBeenCalled();
    });

    test('③ 대체되어 밀려난 소켓도 같다', async () => {
        const { reqId, isSettled } = await routedRequest('h-u5');
        const a = fakeWs('h-u5');
        a.close = function (code?: number, reason?: string) { a.closedWith = [code, reason]; }; // 닫는 중
        await handleBridgeMessage(W(a), hello('dev-1', 'same'));
        const b = fakeWs('h-u5');
        await handleBridgeMessage(W(b), hello('dev-1', 'same')); // 같은 프로세스 재연결 — 즉시 대체
        expect(a.closedWith).toEqual([1000, 'device_reregistered']);
        await handleBridgeMessage(W(a), result(reqId));
        await handleBridgeMessage(W(a), control);
        await new Promise((r) => setImmediate(r));
        expect(isSettled()).toBe(false);
        expect(mockResumeTakeover).not.toHaveBeenCalled();
    });

    test('④ 등록된 소켓은 종전대로 결과가 풀리고 재개가 불린다', async () => {
        const { other, p, reqId } = await routedRequest('h-u6');
        await handleBridgeMessage(W(other), result(reqId));
        await expect(p).resolves.toMatchObject({ ok: true });
        await handleBridgeMessage(W(other), control);
        await new Promise((r) => setImmediate(r));
        expect(mockResumeTakeover).toHaveBeenCalledWith('h-u6');
    });

    test('⑤ 확인 대기 중 같은 소켓의 두 번째 hello 는 무시된다', async () => {
        jest.useFakeTimers();
        const a = fakeWs('h-u7', false);
        await handleBridgeMessage(W(a), hello('dev-1', 'A'));
        const b = fakeWs('h-u7');
        const p1 = handleBridgeMessage(W(b), hello('dev-1', 'B'));
        await Promise.resolve();
        const p2 = handleBridgeMessage(W(b), hello('dev-1', 'B'));
        await jest.advanceTimersByTimeAsync(5001);
        await Promise.all([p1, p2]);
        expect(b.sent.filter((f) => f.type === 'bridge_ready')).toHaveLength(1);
    });
});
