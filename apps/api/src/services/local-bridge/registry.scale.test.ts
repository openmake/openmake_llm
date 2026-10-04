/**
 * 레지스트리 규모 검증 (Companion P3-3) — 임직원 100명이 각자 기기를 연결한 상태.
 * 연결 목록은 API 프로세스 메모리에 있다(프로세스 1개 전제). 100대에서 요청이 섞이지 않고, 한꺼번에 끊겼다 다시 붙어도 상태가 맞는지 본다.
 */
import type { WebSocket } from 'ws';
import { getLocalBridgeRegistry } from './registry';

const USERS = 100;
type FakeWs = WebSocket & { send: jest.Mock };
const fakeWs = (): FakeWs => ({ readyState: 1, OPEN: 1, send: jest.fn(), close: jest.fn() } as unknown as FakeWs);
const frameOf = (ws: FakeWs, n = 0) => JSON.parse(ws.send.mock.calls[n][0] as string) as { reqId: string; path: string };

describe('LocalBridgeRegistry — 100명 연결', () => {
    const reg = getLocalBridgeRegistry();
    let sockets: FakeWs[] = [];

    function connectAll(): void {
        sockets = Array.from({ length: USERS }, (_v, i) => {
            const ws = fakeWs();
            expect(reg.register({ userId: `scale-u${i}`, deviceId: `pc-${i}`, hostId: `pc-${i}`, label: `pc-${i}`, folderName: 'work', ws, connectedAt: Date.now() })).toBe(true);
            return ws;
        });
    }
    afterEach(() => { for (const ws of sockets) reg.unregister(ws); sockets = []; });

    test('100명이 동시에 요청해도 각자의 기기로만 가고 결과가 섞이지 않는다', async () => {
        connectAll();
        const pending = sockets.map((_ws, i) => reg.request(`scale-u${i}`, { kind: 'read', path: `file-${i}.txt` }, 5000, `pc-${i}`));
        sockets.forEach((ws, i) => {
            expect(ws.send).toHaveBeenCalledTimes(1);
            expect(frameOf(ws).path).toBe(`file-${i}.txt`);
        });
        // 역순으로 응답해도 요청한 사용자에게 돌아간다
        for (let i = USERS - 1; i >= 0; i--) reg.handleResult(`scale-u${i}`, frameOf(sockets[i]).reqId, { ok: true, content: `내용-${i}` }, `pc-${i}`);
        const results = await Promise.all(pending);
        results.forEach((r, i) => expect(r.content).toBe(`내용-${i}`));
    });

    test('다른 사용자의 요청 ID 로 보낸 결과는 100명 규모에서도 받지 않는다', async () => {
        connectAll();
        let settled = false;
        const p = reg.request('scale-u0', { kind: 'read', path: 'a' }, 5000, 'pc-0').then((r) => { settled = true; return r; });
        const reqId = frameOf(sockets[0]).reqId;
        for (let i = 1; i < USERS; i++) reg.handleResult(`scale-u${i}`, reqId, { ok: true, content: '위조' }, `pc-${i}`);
        await Promise.resolve();
        expect(settled).toBe(false);
        reg.handleResult('scale-u0', reqId, { ok: true, content: '진짜' }, 'pc-0');
        await expect(p).resolves.toMatchObject({ content: '진짜' });
    });

    test('서버 재시작처럼 전부 끊겼다 다시 붙어도 대기 중 요청은 끊김으로 끝나고 새 연결이 동작한다', async () => {
        connectAll();
        const pending = sockets.map((_ws, i) => reg.request(`scale-u${i}`, { kind: 'write', path: 'a', contentB64: '' }, 5000, `pc-${i}`));
        for (const ws of sockets) reg.unregister(ws);
        for (const r of await Promise.all(pending)) expect(r).toMatchObject({ ok: false, transport: 'disconnected' });
        for (let i = 0; i < USERS; i++) expect(reg.getDevice(`scale-u${i}`)).toBeNull();
        connectAll();
        const again = reg.request('scale-u42', { kind: 'read', path: 'b' }, 5000, 'pc-42');
        reg.handleResult('scale-u42', frameOf(sockets[42]).reqId, { ok: true, content: 'ok' }, 'pc-42');
        await expect(again).resolves.toMatchObject({ ok: true });
    });

    test('연결 100대의 등록·조회·해제가 짧은 시간 안에 끝난다', () => {
        const t0 = Date.now();
        connectAll();
        for (let i = 0; i < USERS; i++) expect(reg.getDevices(`scale-u${i}`)).toHaveLength(1);
        for (const ws of sockets) reg.unregister(ws);
        sockets = [];
        expect(Date.now() - t0).toBeLessThan(1000);
    });
});
