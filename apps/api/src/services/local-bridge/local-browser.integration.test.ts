/**
 * 로컬 브라우저 전 구간 (Companion P2·P3) — 서버의 RemoteExecutor → 실제 WebSocket → 기기 코어 → **실제 Chrome**.
 * 사이트 정책의 서버 계획(planBrowserSitePolicy)과 기기 재판정이 한 흐름에서 맞물리는지 본다.
 * Chrome 이 없는 환경과 CI 에서는 건너뛴다(개발 장비에서 돈다).
 */
process.env.OMK_BRIDGE_BROWSER_HEADLESS = '1';

import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { WebSocketServer, type WebSocket } from 'ws';
import { BridgeConnection, BridgeCore, LocalBrowser, findChrome } from '@openmake/local-bridge-core';

jest.mock('../../config/local-bridge', () => ({
    LOCAL_BRIDGE: { ...jest.requireActual('../../config/local-bridge').LOCAL_BRIDGE, ENABLED: true, BROWSER_ENABLED: true, WORKTREE_ENABLED: false },
}));
jest.mock('../agent-task/device-wait', () => ({ resumeDeviceWaitingTasks: async () => 0 }));
let sitePolicy = { allow: [] as string[], deny: [] as string[] };
jest.mock('../org/effective-policy', () => ({ resolveEffectivePolicy: async () => ({ browserSite: sitePolicy }) }));

import { handleBridgeMessage } from '../../sockets/ws-bridge-handler';
import { getLocalBridgeRegistry } from './registry';
import { RemoteExecutor } from './remote-executor';
import type { WSMessage, ExtendedWebSocket } from '../../sockets/ws-types';

const describeIfChrome = findChrome() && process.env.CI !== 'true' ? describe : describe.skip;
const FORM = '<html><body><h1 id="t">양식</h1><form action="/done"><input id="name" name="name"><button id="send">보내기</button></form></body></html>';

describeIfChrome('로컬 브라우저 전 구간 — RemoteExecutor ↔ 코어 ↔ 실제 Chrome', () => {
    let site: http.Server;
    let wss: WebSocketServer;
    let origin: string;
    let folder: string;
    let profile: string;
    let conn: BridgeConnection;
    const hits: string[] = [];
    const reg = getLocalBridgeRegistry();
    const parse = (stdout: string) => JSON.parse(stdout) as { ok: boolean; finalUrl: string; results: Array<{ ok: boolean; text?: string; error?: string }> };

    beforeAll(async () => {
        site = http.createServer((req, res) => {
            hits.push(req.url ?? '');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end((req.url ?? '').startsWith('/done') ? `<html><body><p id="got">${req.url}</p></body></html>` : FORM);
        });
        await new Promise<void>((r) => site.listen(0, '127.0.0.1', r));
        origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
        wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => wss.once('listening', r));
        wss.on('connection', (ws: WebSocket) => {
            const ext = ws as ExtendedWebSocket;
            ext._authenticatedUserId = 'carol';
            ext._apiKeyScopes = ['bridge'];
            ws.on('message', (d) => { void handleBridgeMessage(ws, JSON.parse(d.toString()) as WSMessage); });
            ws.on('close', () => reg.unregister(ws));
        });
        folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'omk-e2e-folder-')));
        profile = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-e2e-profile-'));
        const core = new BridgeCore({ folder, confirm: async () => 'yes', sandboxProfileDir: os.tmpdir(), browserProfileDir: profile });
        await new Promise<void>((resolve) => {
            conn = new BridgeConnection({
                serverUrl: `http://127.0.0.1:${(wss.address() as AddressInfo).port}`, core, deviceId: 'carol-dev', hostId: 'carol-pc', label: 'carol-pc · work',
                headers: () => ({ Authorization: 'Bearer k' }), onStatus: (_s, code) => { if (code === 'connected') resolve(); }, shouldReconnect: () => false,
            });
            void conn.connect();
        });
    }, 30000);

    afterAll(async () => {
        await reg.request('carol', { kind: 'task_end', taskId: 'e2e-task-0001' }, 5000).catch(() => undefined);
        conn.disconnect();
        await LocalBrowser.forProfile(profile).dispose();
        await new Promise<void>((r) => wss.close(() => r()));
        await new Promise<void>((r) => site.close(() => r()));
        fs.rmSync(folder, { recursive: true, force: true });
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }, 30000);

    it('기기가 browser 능력을 알렸고 게이트가 켜져 있어 서버가 브라우저를 쓴다', () => {
        expect(reg.supports('carol', 'carol-dev', 'browser')).toBe(true);
        expect(new RemoteExecutor('e2e-task-0001', 'carol').isBrowserEnabled).toBe(true);
    });

    it('읽기는 허용 목록이 비어 있어도 실행되고, 서버가 마지막 주소를 기억한다', async () => {
        const ex = new RemoteExecutor('e2e-task-0001', 'carol');
        const actions = [{ type: 'goto', url: `${origin}/form` }, { type: 'extractText', selector: '#t' }];
        expect((await ex.planBrowserSitePolicy(actions)).offListWrites).toEqual([]);
        const out = parse((await ex.runBrowserSpec({ actions, approvedHosts: [] })).stdout);
        expect(out.ok).toBe(true);
        expect(out.results[1].text).toBe('양식');
        // 다음 호출 — goto 없이 입력만 와도 서버가 "목록 밖 쓰기"로 본다
        const plan = await ex.planBrowserSitePolicy([{ type: 'fill', selector: '#name', text: '자료' }]);
        expect(plan.offListWrites).toEqual([expect.objectContaining({ host: '127.0.0.1', type: 'fill' })]);
    }, 60000);

    it('승인 없이 보낸 입력은 기기가 실행하지 않는다 — 서버를 건너뛰어도 막힌다', async () => {
        hits.length = 0;
        const ex = new RemoteExecutor('e2e-task-0001', 'carol');
        const r = await ex.runBrowserSpec({ actions: [{ type: 'fill', selector: '#name', text: '새면 안 됨' }, { type: 'click', selector: '#send' }], approvedHosts: [] });
        const out = parse(r.stdout);
        expect(r.exitCode).toBe(1);
        expect(out.results[0]).toMatchObject({ ok: false });
        expect(out.results[0].error).toContain('사용자 승인이 필요');
        expect(hits.some((h) => h.startsWith('/done'))).toBe(false);
    }, 60000);

    it('승인된 호스트를 실어 보내면 입력·제출이 실행된다', async () => {
        const ex = new RemoteExecutor('e2e-task-0001', 'carol');
        const out = parse((await ex.runBrowserSpec({
            actions: [{ type: 'fill', selector: '#name', text: 'approved' }, { type: 'click', selector: '#send' }, { type: 'extractText', selector: '#got' }],
            approvedHosts: ['127.0.0.1'],
        })).stdout);
        expect(out.ok).toBe(true);
        expect(out.results[2].text).toContain('name=approved');
    }, 60000);

    it('관리자가 허용 목록에 넣은 사이트는 승인 없이 입력된다 — 정책은 호출마다 읽는다', async () => {
        sitePolicy = { allow: ['127.0.0.1'], deny: [] };
        const ex = new RemoteExecutor('e2e-task-0001', 'carol');
        const actions = [{ type: 'goto', url: `${origin}/form` }, { type: 'fill', selector: '#name', text: 'listed' }];
        expect((await ex.planBrowserSitePolicy(actions)).offListWrites).toEqual([]);
        expect(parse((await ex.runBrowserSpec({ actions, approvedHosts: [] })).stdout).ok).toBe(true);
        sitePolicy = { allow: [], deny: [] };
    }, 60000);
});
