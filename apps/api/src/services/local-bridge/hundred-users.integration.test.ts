/**
 * 100명 동시 연결 — 실제 TCP 소켓 (Companion P3 후속, 2026-10-05).
 * registry.scale.test 는 모의 소켓으로 레지스트리만 봤다. 여기서는 서버의 등록 처리(ws-bridge-handler)·레지스트리·원격 실행기와
 * 기기 코어를 **실제 WebSocket 100개**로 이어, 임직원 100명이 각자 PC 를 연결한 상태를 그대로 만든다.
 *   - 100명이 동시에 읽고 써도 각자의 폴더에서만 실행되고 결과가 섞이지 않는다
 *   - 한꺼번에 끊겼다 다시 붙어도(서버 재시작·네트워크 장애) 전원이 다시 동작한다
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { WebSocketServer, type WebSocket } from 'ws';
import { BridgeConnection, BridgeCore } from '@openmake/local-bridge-core';

jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, ENABLED: true, WORKTREE_ENABLED: false },
}));
jest.mock('../agent-task/device-wait', () => ({ resumeDeviceWaitingTasks: async () => 0 }));

import { handleBridgeMessage } from '../../sockets/ws-bridge-handler';
import { getLocalBridgeRegistry } from './registry';
import { RemoteExecutor } from './remote-executor';
import type { WSMessage, ExtendedWebSocket } from '../../sockets/ws-types';

const USERS = 100;
const user = (i: number): string => `load-u${i}`;

describe('100명 동시 연결 — 실제 WebSocket', () => {
    let wss: WebSocketServer;
    let url: string;
    let root: string;
    let conns: BridgeConnection[] = [];
    const reg = getLocalBridgeRegistry();
    const folder = (i: number): string => path.join(root, user(i));

    function connect(i: number): Promise<void> {
        const core = new BridgeCore({ folder: folder(i), confirm: async () => 'yes', sandboxProfileDir: os.tmpdir(), autoApproveAll: true });
        return new Promise<void>((resolve) => {
            const conn = new BridgeConnection({
                serverUrl: url, core, deviceId: `${user(i)}-dev`, hostId: `${user(i)}-pc`, label: `${user(i)}-pc · work`,
                headers: () => ({ Authorization: `Bearer key-${user(i)}` }),
                onStatus: (_s, code) => { if (code === 'connected') resolve(); },
                shouldReconnect: () => false,
            });
            conns.push(conn);
            void conn.connect();
        });
    }
    const connectAll = async (): Promise<void> => { await Promise.all(Array.from({ length: USERS }, (_v, i) => connect(i))); };

    beforeAll(async () => {
        wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => wss.once('listening', r));
        url = `http://127.0.0.1:${(wss.address() as AddressInfo).port}`;
        wss.on('connection', (ws: WebSocket, req) => {
            // 운영의 ws-auth 가 하는 일 — 인증 주체를 소켓에 붙인다(프레임의 값은 믿지 않는다)
            const ext = ws as ExtendedWebSocket;
            ext._authenticatedUserId = String(req.headers.authorization).replace('Bearer key-', '');
            ext._apiKeyScopes = ['bridge'];
            ws.on('message', (d) => { void handleBridgeMessage(ws, JSON.parse(d.toString()) as WSMessage); });
            ws.on('close', () => reg.unregister(ws));
        });
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-load-')));
        for (let i = 0; i < USERS; i++) {
            fs.mkdirSync(folder(i));
            fs.writeFileSync(path.join(folder(i), 'secret.txt'), `${user(i)} 의 자료`);
        }
        await connectAll();
    }, 60000);

    afterAll(async () => {
        for (const c of conns) c.disconnect();
        await new Promise<void>((r) => wss.close(() => r()));
        fs.rmSync(root, { recursive: true, force: true });
    }, 60000);

    it('100개의 실제 연결이 사용자마다 하나씩 등록된다', () => {
        expect(wss.clients.size).toBe(USERS);
        for (let i = 0; i < USERS; i++) expect(reg.getDevices(user(i)).map((d) => d.deviceId)).toEqual([`${user(i)}-dev`]);
    });

    it('100명이 동시에 읽어도 각자의 폴더 내용만 받는다', async () => {
        const out = await Promise.all(Array.from({ length: USERS }, (_v, i) => new RemoteExecutor(`task-load-r${i}`, user(i)).readFile('secret.txt')));
        out.forEach((content, i) => expect(content).toBe(`${user(i)} 의 자료`));
    }, 30000);

    it('100명이 동시에 써도 각자의 폴더에만 떨어진다', async () => {
        await Promise.all(Array.from({ length: USERS }, (_v, i) => new RemoteExecutor(`task-load-w${i}`, user(i)).writeFile('out.md', `결과 ${i}`)));
        for (let i = 0; i < USERS; i++) {
            expect(fs.readFileSync(path.join(folder(i), 'out.md'), 'utf8')).toBe(`결과 ${i}`);
            expect(fs.readdirSync(folder(i)).sort()).toEqual(['out.md', 'secret.txt']);
        }
    }, 30000);

    it('사용자마다 다섯 번씩, 500건이 한꺼번에 오가도 섞이지 않는다', async () => {
        const jobs = Array.from({ length: USERS * 5 }, (_v, n) => ({ i: n % USERS, n }));
        const out = await Promise.all(jobs.map(({ i, n }) => new RemoteExecutor(`task-load-m${n}`, user(i)).readFile('secret.txt')));
        out.forEach((content, k) => expect(content).toBe(`${user(jobs[k].i)} 의 자료`));
    }, 30000);

    it('전원이 한꺼번에 끊겼다 다시 붙어도 다시 동작한다', async () => {
        for (const c of conns) c.disconnect();
        conns = [];
        await new Promise((r) => setTimeout(r, 500));
        expect(wss.clients.size).toBe(0);
        for (let i = 0; i < USERS; i++) expect(reg.getDevice(user(i))).toBeNull();
        await connectAll();
        const out = await Promise.all(Array.from({ length: USERS }, (_v, i) => new RemoteExecutor(`task-load-b${i}`, user(i)).readFile('secret.txt')));
        out.forEach((content, i) => expect(content).toBe(`${user(i)} 의 자료`));
    }, 60000);
});
