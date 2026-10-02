/**
 * 브라우저 넘겨받기 라우트 — 소유자만, 샌드박스 실행 작업만, 입력은 검증된 것만 세션으로 간다.
 * asyncHandler 는 promise 를 기다리지 않으므로 응답(res.json)이 쓰일 때까지 기다린다.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const getAgentTask = jest.fn();
const getAgentTaskSteps = jest.fn(async (): Promise<unknown[]> => []);
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getAgentTask, getAgentTaskSteps }) }));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));
jest.mock('../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));
const startBrowserSession = jest.fn(async () => undefined);
const stopBrowserSession = jest.fn(async () => undefined);
const isBrowserSessionActive = jest.fn(async () => true);
const sendBrowserSessionCommand = jest.fn();
jest.mock('../../services/task-sandbox/browser-session', () => ({
    ...jest.requireActual('../../services/task-sandbox/browser-session'),
    startBrowserSession, stopBrowserSession, isBrowserSessionActive, sendBrowserSessionCommand,
}));
jest.mock('../../config/task-sandbox', () => {
    const actual = jest.requireActual('../../config/task-sandbox');
    return { ...actual, getTaskSandboxConfig: () => ({ ...actual.getTaskSandboxConfig(), enabled: true, browserEnabled: true }) };
});

import { browserSessionRouter } from '../agent-task-browser-session.routes';

type Method = 'get' | 'post' | 'delete';
function handler(method: Method, path: string) {
    const layer = (browserSessionRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
    const h = layer.route.stack[0].handle as (req: any, res: any, next: any) => void;
    // 핸들러는 실제 파일 조회(stat)를 거친다 — 틱 수를 세지 않고 응답이 쓰일 때까지 기다린다(CI 에서 틱 수 대기는 모자랐다).
    return async (req: any, res: any) => { h(req, res, jest.fn()); await res.done; };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.done = new Promise<void>((resolve) => { res.finish = resolve; });
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.json = (b: unknown) => { res.body = b; res.finish(); return res; };
    return res;
}
const BASE = '/:taskId/browser-session';
let workdir: string;
const task = (extra: Record<string, unknown> = {}) => ({ id: 't1', user_id: 'u1', status: 'running', executor: 'sandbox', workspace_path: workdir, ...extra });
const req = (body: unknown = {}, user = { id: 'u1', role: 'user' }) => ({ params: { taskId: 't1' }, body, user });

beforeAll(() => { workdir = mkdtempSync(join(tmpdir(), 'omk-bsr-')); });
afterAll(() => { rmSync(workdir, { recursive: true, force: true }); });
beforeEach(() => { jest.clearAllMocks(); getAgentTask.mockResolvedValue(task()); isBrowserSessionActive.mockResolvedValue(true); });

describe('대상 검증', () => {
    it('소유자가 아니면 관리자여도 403', async () => {
        const res = mockRes();
        await handler('post', BASE)(req({}, { id: 'admin1', role: 'admin' }), res);
        expect(res.statusCode).toBe(403);
        expect(startBrowserSession).not.toHaveBeenCalled();
    });
    it('로컬 실행 작업은 400', async () => {
        getAgentTask.mockResolvedValue(task({ executor: 'local' }));
        const res = mockRes();
        await handler('post', BASE)(req(), res);
        expect(res.statusCode).toBe(400);
        expect(startBrowserSession).not.toHaveBeenCalled();
    });
    it('작업 공간이 없으면 400', async () => {
        getAgentTask.mockResolvedValue(task({ workspace_path: join(workdir, 'gone') }));
        const res = mockRes();
        await handler('get', BASE)(req(), res);
        expect(res.statusCode).toBe(400);
    });
});

describe('POST 넘겨받기', () => {
    it('세션을 시작하고 201', async () => {
        const res = mockRes();
        await handler('post', BASE)(req({ url: 'https://example.com/login' }), res);
        expect(res.statusCode).toBe(201);
        expect(startBrowserSession).toHaveBeenCalledWith('t1', workdir, { startUrl: 'https://example.com/login' });
    });
    it('주소를 주지 않으면 에이전트가 마지막으로 연 주소에서 시작한다', async () => {
        getAgentTaskSteps.mockResolvedValueOnce([
            { tool_name: 'browser', tool_args: { actions: [{ type: 'goto', url: 'https://a.example/1' }] } },
            { tool_name: 'bash', tool_args: { command: 'ls' } },
            { tool_name: 'browser', tool_args: { actions: [{ type: 'goto', url: 'https://b.example/login' }, { type: 'extractText' }] } },
        ]);
        const res = mockRes();
        await handler('post', BASE)(req({}), res);
        expect(startBrowserSession).toHaveBeenCalledWith('t1', workdir, { startUrl: 'https://b.example/login' });
    });
    it('http(s) 가 아닌 시작 주소는 400', async () => {
        const res = mockRes();
        await handler('post', BASE)(req({ url: 'file:///etc/passwd' }), res);
        expect(res.statusCode).toBe(400);
        expect(startBrowserSession).not.toHaveBeenCalled();
    });
    it('시작 실패는 409', async () => {
        startBrowserSession.mockRejectedValueOnce(new Error('docker 없음'));
        const res = mockRes();
        await handler('post', BASE)(req(), res);
        expect(res.statusCode).toBe(409);
    });
});

describe('POST 입력', () => {
    it('검증된 입력만 세션으로 보낸다', async () => {
        sendBrowserSessionCommand.mockResolvedValue({ ok: true });
        const res = mockRes();
        await handler('post', `${BASE}/input`)(req({ op: 'click', x: 10, y: 20 }), res);
        expect(res.body.data).toEqual({ ok: true });
        expect(sendBrowserSessionCommand).toHaveBeenCalledWith('t1', { op: 'click', x: 10, y: 20 });
    });
    it('허용되지 않은 명령은 400 — 세션에 닿지 않는다', async () => {
        const res = mockRes();
        await handler('post', `${BASE}/input`)(req({ op: 'close' }), res);
        expect(res.statusCode).toBe(400);
        expect(sendBrowserSessionCommand).not.toHaveBeenCalled();
    });
    it('세션이 끝났으면 409', async () => {
        sendBrowserSessionCommand.mockResolvedValue({ ok: false, error: 'session_unavailable' });
        isBrowserSessionActive.mockResolvedValue(false);
        const res = mockRes();
        await handler('post', `${BASE}/input`)(req({ op: 'back' }), res);
        expect(res.statusCode).toBe(409);
    });
    it('세션은 살아 있는데 조작이 실패하면 사유를 돌려준다', async () => {
        sendBrowserSessionCommand.mockResolvedValue({ ok: false, error: 'Timeout 20000ms exceeded' });
        const res = mockRes();
        await handler('post', `${BASE}/input`)(req({ op: 'goto', url: 'https://example.com' }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual({ ok: false, error: 'Timeout 20000ms exceeded' });
    });
});

describe('GET 화면', () => {
    it('스크린샷·주소·제목을 돌려준다', async () => {
        sendBrowserSessionCommand.mockResolvedValue({ ok: true, image: 'QUJD', url: 'https://example.com/', title: 'Example' });
        const res = mockRes();
        await handler('get', `${BASE}/screenshot`)(req(), res);
        expect(res.body.data).toEqual({ active: true, image: 'QUJD', url: 'https://example.com/', title: 'Example' });
    });
    it('세션이 끝났으면 409', async () => {
        sendBrowserSessionCommand.mockResolvedValue({ ok: false, error: 'session_unavailable' });
        isBrowserSessionActive.mockResolvedValue(false);
        const res = mockRes();
        await handler('get', `${BASE}/screenshot`)(req(), res);
        expect(res.statusCode).toBe(409);
    });
});

it('DELETE 돌려주기 — 세션을 내린다', async () => {
    const res = mockRes();
    await handler('delete', BASE)(req(), res);
    expect(stopBrowserSession).toHaveBeenCalledWith('t1');
    expect(res.body.data).toEqual({ active: false });
});
