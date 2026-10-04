/**
 * 두 사용자·두 기기 동시 실행 (Companion P3-1·3-2) — 서버의 등록 처리(ws-bridge-handler)·레지스트리·원격 실행기와
 * 기기 코어(@openmake/local-bridge-core)를 **실제 WebSocket** 으로 이어 검증한다. 모의 소켓이 아니라 실제 프레임이 오간다.
 *   - 각 사용자의 요청은 자기 기기의 폴더에서만 실행된다(다른 계정 자료 접근 불가)
 *   - 연결이 끊기면 쓰기는 결과 불명, 재연결 후에는 다시 동작한다
 *   - 구버전 기기처럼 능력 목록에 없는 요청은 보내지 않는다
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { WebSocketServer, type WebSocket } from 'ws';
import { BridgeConnection, BridgeCore } from '@openmake/local-bridge-core';

jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, ENABLED: true, MAX_DEVICES: 3, WORKTREE_ENABLED: false },
}));
jest.mock('../agent-task/device-wait', () => ({ resumeDeviceWaitingTasks: async () => 0 }));

import { handleBridgeMessage } from '../../sockets/ws-bridge-handler';
import { getLocalBridgeRegistry } from './registry';
import { RemoteExecutor } from './remote-executor';
import type { WSMessage, ExtendedWebSocket } from '../../sockets/ws-types';

const KEYS: Record<string, string> = { 'Bearer key-alice': 'alice', 'Bearer key-bob': 'bob' };

describe('두 사용자·두 기기 — 실제 WebSocket', () => {
    let wss: WebSocketServer;
    let url: string;
    const folders: Record<string, string> = {};
    const conns: BridgeConnection[] = [];
    const reg = getLocalBridgeRegistry();

    async function connect(user: string, deviceId: string): Promise<BridgeConnection> {
        const core = new BridgeCore({ folder: folders[user], confirm: async () => 'yes', sandboxProfileDir: os.tmpdir(), autoApproveAll: true });
        const ready = new Promise<void>((resolve) => {
            const conn = new BridgeConnection({
                serverUrl: url, core, deviceId, hostId: `${user}-pc`, label: `${user}-pc · work`,
                headers: () => ({ Authorization: `Bearer key-${user}` }),
                onStatus: (_s, code) => { if (code === 'connected') resolve(); },
                shouldReconnect: () => false,
            });
            conns.push(conn);
            void conn.connect();
        });
        await ready;
        return conns[conns.length - 1];
    }

    beforeAll(async () => {
        wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => wss.once('listening', r));
        url = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
        wss.on('connection', (ws: WebSocket, req) => {
            // 운영의 ws-auth 가 하는 일 — 인증 주체를 소켓에 붙인다(프레임의 값은 믿지 않는다)
            const ext = ws as ExtendedWebSocket;
            ext._authenticatedUserId = KEYS[String(req.headers.authorization)];
            ext._apiKeyScopes = ['bridge'];
            ws.on('message', (d) => { void handleBridgeMessage(ws, JSON.parse(d.toString()) as WSMessage); });
            ws.on('close', () => reg.unregister(ws));
        });
        for (const user of ['alice', 'bob']) {
            folders[user] = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `omk-two-${user}-`)));
            fs.writeFileSync(path.join(folders[user], 'secret.txt'), `${user} 의 자료`);
        }
        await connect('alice', 'alice-dev');
        await connect('bob', 'bob-dev');
    }, 30000);

    afterAll(async () => {
        for (const c of conns) c.disconnect();
        await new Promise<void>((r) => wss.close(() => r()));
        for (const f of Object.values(folders)) fs.rmSync(f, { recursive: true, force: true });
    }, 30000);

    it('각 사용자의 작업은 자기 PC 의 폴더만 본다 — 동시에 실행해도 섞이지 않는다', async () => {
        const [a, b] = await Promise.all([
            new RemoteExecutor('task-a-0000001', 'alice').readFile('secret.txt'),
            new RemoteExecutor('task-b-0000001', 'bob').readFile('secret.txt'),
        ]);
        expect(a).toBe('alice 의 자료');
        expect(b).toBe('bob 의 자료');
    });

    it('다른 사용자의 기기 ID 를 지정해도 그 기기로 가지 않는다', async () => {
        await expect(new RemoteExecutor('task-a-0000002', 'alice', 'bob-dev').readFile('secret.txt')).rejects.toThrow('연결된 로컬 디바이스가 없습니다');
        expect(reg.getDevices('alice').map((d) => d.deviceId)).toEqual(['alice-dev']);
    });

    it('쓰기는 자기 폴더에만 떨어지고, 폴더 밖 경로는 기기가 거부한다', async () => {
        const ex = new RemoteExecutor('task-a-0000003', 'alice');
        await ex.writeFile('out/report.md', '# 보고서');
        expect(fs.readFileSync(path.join(folders.alice, 'out/report.md'), 'utf8')).toBe('# 보고서');
        expect(fs.existsSync(path.join(folders.bob, 'out/report.md'))).toBe(false);
        await expect(ex.readFile(path.join(folders.bob, 'secret.txt'))).rejects.toThrow();
        await expect(ex.readFile('../../etc/hosts')).rejects.toThrow();
    });

    it('등록 때 알린 PC 식별자와 능력 목록이 서버에 남는다', () => {
        const dev = reg.getDevice('alice', 'alice-dev');
        expect(dev?.hostId).toBe('alice-pc');
        expect(reg.supports('alice', 'alice-dev', 'exec')).toBe(true);
        expect(reg.supports('alice', 'alice-dev', 'browser')).toBe(false); // 전용 프로필을 주지 않은 기기
    });

    it('한 사용자의 연결이 끊겨도 다른 사용자는 계속 동작하고, 끊긴 쪽은 재연결 후 다시 동작한다', async () => {
        conns[1].disconnect(); // bob
        await new Promise((r) => setTimeout(r, 200));
        expect(reg.getDevice('bob')).toBeNull();
        await expect(new RemoteExecutor('task-a-0000004', 'alice').readFile('secret.txt')).resolves.toBe('alice 의 자료');
        const lost = new RemoteExecutor('task-b-0000002', 'bob');
        expect((await lost.exec('echo hi')).stderr).toContain('연결된 로컬 디바이스가 없습니다');
        expect(lost.consumeDeviceLoss()).toBe('rerunnable');
        await connect('bob', 'bob-dev');
        await expect(new RemoteExecutor('task-b-0000003', 'bob').readFile('secret.txt')).resolves.toBe('bob 의 자료');
    }, 30000);

    it('만료 시각이 지난 요청은 기기가 실행하지 않는다', async () => {
        const ws = reg.getDevice('alice', 'alice-dev')!.ws;
        const result = new Promise<Record<string, unknown>>((resolve) => {
            const orig = reg.handleResult.bind(reg);
            jest.spyOn(reg, 'handleResult').mockImplementation((userId, reqId, r, sender) => {
                if (reqId === 'late-req') resolve(r as unknown as Record<string, unknown>); else orig(userId, reqId, r, sender);
            });
        });
        ws.send(JSON.stringify({ type: 'bridge_exec', reqId: 'late-req', kind: 'write', path: 'late.txt', contentB64: 'eA==', expiresAt: Date.now() - 10 * 60 * 1000 }));
        await expect(result).resolves.toMatchObject({ ok: false, rejected: 'expired' });
        expect(fs.existsSync(path.join(folders.alice, 'late.txt'))).toBe(false);
        jest.restoreAllMocks();
    });
});
