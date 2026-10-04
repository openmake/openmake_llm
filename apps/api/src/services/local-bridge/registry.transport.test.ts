/**
 * 레지스트리 전송 실패 구분 (Companion P1, 2026-10-04) — 요청이 기기에 닿았는지에 따라 결과 불명 여부가 갈린다.
 *   no_device·send_failed : 기기에 닿지 않았다(실행되지 않았다)
 *   timeout·disconnected  : 보낸 뒤 응답을 못 받았다(실행됐을 수 있다)
 */
import type { WebSocket } from 'ws';
import { getLocalBridgeRegistry } from './registry';

function fakeWs(send: jest.Mock = jest.fn()): WebSocket {
    return { readyState: 1, OPEN: 1, send, close: jest.fn() } as unknown as WebSocket;
}

describe('LocalBridgeRegistry 전송 실패 구분', () => {
    const reg = getLocalBridgeRegistry();
    const wsList: WebSocket[] = [];
    afterEach(() => { for (const ws of wsList.splice(0)) reg.unregister(ws); jest.useRealTimers(); });

    function add(userId: string, deviceId: string, ws = fakeWs()): WebSocket {
        wsList.push(ws);
        reg.register({ userId, deviceId, label: deviceId, folderName: deviceId, ws, connectedAt: Date.now() });
        return ws;
    }

    test('기기가 없으면 no_device', async () => {
        await expect(reg.request('tx-u1', { kind: 'write', path: 'a' })).resolves.toMatchObject({ ok: false, transport: 'no_device' });
    });

    test('전송 자체가 실패하면 send_failed', async () => {
        add('tx-u2', 'd', fakeWs(jest.fn(() => { throw new Error('socket closed'); })));
        await expect(reg.request('tx-u2', { kind: 'write', path: 'a' }, 1000, 'd')).resolves.toMatchObject({ ok: false, transport: 'send_failed' });
    });

    test('보낸 뒤 응답이 없으면 timeout', async () => {
        jest.useFakeTimers();
        add('tx-u3', 'd');
        const p = reg.request('tx-u3', { kind: 'write', path: 'a' }, 1000, 'd');
        jest.advanceTimersByTime(1001);
        await expect(p).resolves.toMatchObject({ ok: false, transport: 'timeout' });
    });

    test('보낸 뒤 연결이 끊기면 disconnected', async () => {
        const ws = add('tx-u4', 'd');
        const p = reg.request('tx-u4', { kind: 'write', path: 'a' }, 5000, 'd');
        reg.unregister(ws);
        await expect(p).resolves.toMatchObject({ ok: false, transport: 'disconnected' });
    });

    test('같은 기기가 다시 등록돼 세션이 대체돼도 disconnected', async () => {
        add('tx-u5', 'd');
        const p = reg.request('tx-u5', { kind: 'exec', command: 'ls' }, 5000, 'd');
        add('tx-u5', 'd');
        await expect(p).resolves.toMatchObject({ ok: false, transport: 'disconnected' });
    });

    test('기기가 돌려준 결과에는 transport 가 없다', async () => {
        const send = jest.fn();
        add('tx-u6', 'd', fakeWs(send));
        const p = reg.request('tx-u6', { kind: 'read', path: 'a' }, 5000, 'd');
        const { reqId } = JSON.parse(send.mock.calls[0][0] as string) as { reqId: string };
        reg.handleResult('tx-u6', reqId, { ok: false, error: '파일 없음' }, 'd');
        const r = await p;
        expect(r.transport).toBeUndefined();
    });
});
