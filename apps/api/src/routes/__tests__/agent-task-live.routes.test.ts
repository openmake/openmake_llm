/**
 * 실시간 작업 화면 조회 라우트 — 소유자만(관리자도 남의 작업은 불가), 샌드박스 실행 작업만, 대상이 아니어도 200.
 * asyncHandler 는 promise 를 기다리지 않으므로 응답(res.json)이 쓰일 때까지 기다린다.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const getAgentTask = jest.fn();
jest.mock('../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getAgentTask }) }));
jest.mock('../../auth/ownership', () => ({ assertResourceOwnerOrAdmin: jest.fn() }));
const LIVE = { browser: { image: 'AAA', url: 'https://example.com/', title: '예시', at: 1 }, terminal: null };
const readLiveView = jest.fn(async () => LIVE);
jest.mock('../../services/task-sandbox/live-view', () => ({ readLiveView }));
let liveEnabled = true;
jest.mock('../../config/agent-task-live-view', () => {
    const actual = jest.requireActual('../../config/agent-task-live-view');
    return { ...actual, LIVE_VIEW: new Proxy(actual.LIVE_VIEW, { get: (t, k) => (k === 'ENABLED' ? liveEnabled : t[k]) }) };
});
jest.mock('../../config/task-sandbox', () => {
    const actual = jest.requireActual('../../config/task-sandbox');
    // 브라우저가 꺼져 있어도(터미널은 보인다) 대상이어야 한다
    return { ...actual, getTaskSandboxConfig: () => ({ ...actual.getTaskSandboxConfig(), enabled: true, browserEnabled: false }) };
});

import { liveViewRouter } from '../agent-task-live.routes';

function handler(path: string) {
    const layer = (liveViewRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods.get);
    const h = layer.route.stack[0].handle as (req: any, res: any, next: any) => void;
    return async (req: any, res: any) => { h(req, res, jest.fn()); await res.done; };
}
function mockRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.done = new Promise<void>((resolve) => { res.finish = resolve; });
    res.status = (c: number) => { res.statusCode = c; return res; };
    res.setHeader = (k: string, v: string) => { res.headers[k.toLowerCase()] = v; return res; };
    res.json = (b: unknown) => { res.body = b; res.finish(); return res; };
    return res;
}
const PATH = '/:taskId/live';
let workdir: string;
const task = (extra: Record<string, unknown> = {}) => ({ id: 't1', user_id: 'u1', status: 'running', executor: 'sandbox', workspace_path: workdir, ...extra });
const req = (user = { id: 'u1', role: 'user' }, query: Record<string, unknown> = {}) => ({ params: { taskId: 't1' }, body: {}, query, user });

beforeAll(() => { workdir = mkdtempSync(join(tmpdir(), 'omk-live-r-')); });
afterAll(() => { rmSync(workdir, { recursive: true, force: true }); });
beforeEach(() => { jest.clearAllMocks(); liveEnabled = true; getAgentTask.mockResolvedValue(task()); });

it('소유자는 eligible true 와 읽은 내용을 받는다', async () => {
    const res = mockRes();
    await handler(PATH)(req(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ eligible: true, status: 'running', ...LIVE });
    expect(readLiveView).toHaveBeenCalledWith(workdir, { frameAt: undefined });
});

it('관리자가 남의 작업을 보면 eligible false · not_owner', async () => {
    const res = mockRes();
    await handler(PATH)(req({ id: 'admin1', role: 'admin' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ eligible: false, reason: 'not_owner' });
    expect(readLiveView).not.toHaveBeenCalled();
});

it('LIVE_VIEW 가 꺼져 있으면 disabled', async () => {
    liveEnabled = false;
    const res = mockRes();
    await handler(PATH)(req(), res);
    expect(res.body.data).toEqual({ eligible: false, reason: 'disabled' });
    expect(readLiveView).not.toHaveBeenCalled();
});

it('로컬 실행 작업은 not_sandbox', async () => {
    getAgentTask.mockResolvedValue(task({ executor: 'local' }));
    const res = mockRes();
    await handler(PATH)(req(), res);
    expect(res.body.data).toEqual({ eligible: false, reason: 'not_sandbox' });
});

it('작업 폴더가 없으면 workspace_gone', async () => {
    getAgentTask.mockResolvedValue(task({ workspace_path: join(workdir, 'gone') }));
    const res = mockRes();
    await handler(PATH)(req(), res);
    expect(res.body.data).toEqual({ eligible: false, reason: 'workspace_gone' });
    expect(readLiveView).not.toHaveBeenCalled();
});

it('작업이 없으면 404', async () => {
    getAgentTask.mockResolvedValue(undefined);
    const res = mockRes();
    await handler(PATH)(req(), res);
    expect(res.statusCode).toBe(404);
});

it('응답에 Cache-Control no-store', async () => {
    const res = mockRes();
    await handler(PATH)(req(), res);
    expect(res.headers['cache-control']).toBe('no-store');
});

it.each([
    ['1761030000123', 1761030000123],
    ['abc', undefined],
    ['', undefined],
    [['1', '2'], undefined],
])('frameAt 쿼리 %p 는 %p 로 넘긴다', async (q, expected) => {
    const res = mockRes();
    await handler(PATH)(req(undefined, { frameAt: q }), res);
    expect(readLiveView).toHaveBeenCalledWith(workdir, { frameAt: expected });
});
