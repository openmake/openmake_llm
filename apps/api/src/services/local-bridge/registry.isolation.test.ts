/**
 * 레지스트리 사용자·기기 격리 (Companion P1-6, 2026-10-04).
 * 요청은 그 사용자의 그 기기로만 나가고, 결과는 요청을 받은 사용자·기기가 보낸 것만 받는다.
 */
import type { WebSocket } from 'ws';
import { getLocalBridgeRegistry } from './registry';

function fakeWs(): WebSocket & { send: jest.Mock } {
    return { readyState: 1, OPEN: 1, send: jest.fn(), close: jest.fn() } as unknown as WebSocket & { send: jest.Mock };
}
const reqIdOf = (ws: { send: jest.Mock }): string => (JSON.parse(ws.send.mock.calls[0][0] as string) as { reqId: string }).reqId;

describe('LocalBridgeRegistry 사용자·기기 격리', () => {
    const reg = getLocalBridgeRegistry();
    const wsList: WebSocket[] = [];
    afterEach(() => { for (const ws of wsList.splice(0)) reg.unregister(ws); });

    function add(userId: string, deviceId: string): WebSocket & { send: jest.Mock } {
        const ws = fakeWs();
        wsList.push(ws);
        reg.register({ userId, deviceId, label: deviceId, folderName: deviceId, ws, connectedAt: Date.now() });
        return ws;
    }

    test('요청은 요청한 사용자의 기기로만 나간다', async () => {
        const a = add('iso-A', 'pc');
        const b = add('iso-B', 'pc'); // 같은 deviceId 라도 사용자가 다르면 다른 기기
        const p = reg.request('iso-A', { kind: 'read', path: 'secret.txt' }, 5000, 'pc');
        expect(a.send).toHaveBeenCalledTimes(1);
        expect(b.send).not.toHaveBeenCalled();
        reg.handleResult('iso-A', reqIdOf(a), { ok: true, content: 'A' }, 'pc');
        await expect(p).resolves.toMatchObject({ content: 'A' });
    });

    test('다른 사용자가 남의 reqId 로 보낸 결과는 무시한다', async () => {
        const a = add('iso-A', 'pc');
        add('iso-B', 'pc');
        let settled = false;
        const p = reg.request('iso-A', { kind: 'read', path: 'secret.txt' }, 5000, 'pc').then((r) => { settled = true; return r; });
        const reqId = reqIdOf(a);
        reg.handleResult('iso-B', reqId, { ok: true, content: '위조' }, 'pc');
        await Promise.resolve();
        expect(settled).toBe(false);
        reg.handleResult('iso-A', reqId, { ok: true, content: '진짜' }, 'pc');
        await expect(p).resolves.toMatchObject({ content: '진짜' });
    });

    test('같은 사용자의 다른 기기가 보낸 결과도 무시한다', async () => {
        const mac = add('iso-A', 'mac');
        add('iso-A', 'win');
        let settled = false;
        const p = reg.request('iso-A', { kind: 'exec', command: 'ls' }, 5000, 'mac').then((r) => { settled = true; return r; });
        const reqId = reqIdOf(mac);
        reg.handleResult('iso-A', reqId, { ok: true, stdout: '위조' }, 'win');
        await Promise.resolve();
        expect(settled).toBe(false);
        reg.handleResult('iso-A', reqId, { ok: true, stdout: '진짜' }, 'mac');
        await expect(p).resolves.toMatchObject({ stdout: '진짜' });
    });

    test('사용자 A 의 기기 목록·조회에 B 의 기기가 섞이지 않는다', () => {
        add('iso-A', 'mac');
        add('iso-B', 'win');
        expect(reg.getDevices('iso-A').map((d) => d.deviceId)).toEqual(['mac']);
        expect(reg.getDevice('iso-A', 'win')).toBeNull();
        expect(reg.supports('iso-A', 'win', 'read')).toBe(false);
    });

    test('B 의 기기가 끊겨도 A 의 대기 중 요청은 영향받지 않는다', async () => {
        const a = add('iso-A', 'pc');
        const b = add('iso-B', 'pc');
        let settled = false;
        const p = reg.request('iso-A', { kind: 'write', path: 'a' }, 5000, 'pc').then((r) => { settled = true; return r; });
        reg.unregister(b);
        await Promise.resolve();
        expect(settled).toBe(false);
        reg.handleResult('iso-A', reqIdOf(a), { ok: true }, 'pc');
        await expect(p).resolves.toMatchObject({ ok: true });
    });
});
