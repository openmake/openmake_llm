/**
 * 작업 API 클라이언트 — 실제 HTTP 서버(임의 포트)에 요청을 보내 경로·본문·응답 해석을 고정한다.
 * 실행: npm test
 */
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';
import { createTaskClient, TaskApiError } from './task-client';

interface Seen { method: string; url: string; auth: string | undefined; body: unknown }

let server: http.Server | undefined;

/** 요청을 기록하고, 경로별로 정해 둔 응답을 돌려주는 서버 */
function serve(routes: Record<string, { status?: number; body: unknown }>): Promise<{ baseUrl: string; seen: Seen[] }> {
    const seen: Seen[] = [];
    return new Promise((resolve) => {
        const s = http.createServer((req, res) => {
            let raw = '';
            req.on('data', (c) => { raw += c; });
            req.on('end', () => {
                seen.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body: raw ? JSON.parse(raw) : undefined });
                const route = routes[`${req.method} ${req.url}`];
                res.statusCode = route?.status ?? (route ? 200 : 404);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(route?.body ?? { success: false, error: { message: 'no route' } }));
            });
        });
        s.listen(0, '127.0.0.1', () => {
            server = s;
            resolve({ baseUrl: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, seen });
        });
    });
}

afterEach(async () => {
    await new Promise<void>((resolve) => {
        if (!server) return resolve();
        const s = server;
        server = undefined;
        s.closeAllConnections();
        s.close(() => resolve());
    });
});

const ok = (data: unknown) => ({ body: { success: true, data } });

test('작업 생성: sandbox 는 goal 만, local 은 executor 를 함께 보내고 작업 id 를 돌려준다', async () => {
    const { baseUrl, seen } = await serve({ 'POST /api/agent-tasks': { status: 201, body: { success: true, data: { task: { id: 't1' } } } } });
    const client = createTaskClient({ baseUrl: `${baseUrl}/`, apiKey: 'k1' });
    assert.equal(await client.createTask('보고서 만들어줘', 'sandbox'), 't1');
    assert.equal(await client.createTask('보고서 만들어줘', 'local'), 't1');
    assert.deepEqual(seen[0].body, { goal: '보고서 만들어줘' });
    assert.deepEqual(seen[1].body, { goal: '보고서 만들어줘', executor: 'local' });
    assert.equal(seen[0].auth, 'Bearer k1');
});

test('작업 실행: 승인 방식을 본문에 싣는다', async () => {
    const { baseUrl, seen } = await serve({ 'POST /api/agent-tasks/t1/execute': { status: 202, body: { success: true, data: { taskId: 't1' } } } });
    await createTaskClient({ baseUrl, apiKey: 'k' }).executeTask('t1', 'all');
    assert.deepEqual(seen[0].body, { approvalPolicy: 'all' });
});

test('작업 조회: 서버 필드를 봇이 쓰는 모양으로 옮긴다 — 없는 값은 0·null', async () => {
    const { baseUrl } = await serve({
        'GET /api/agent-tasks/t1': ok({ task: { id: 't1', status: 'running', progress: 22, current_turn: 7, max_turns: 32, result: null, error: null }, steps: [] }),
        'GET /api/agent-tasks/t2': ok({ task: { id: 't2', status: 'completed', result: '끝' }, steps: [] }),
    });
    const client = createTaskClient({ baseUrl, apiKey: 'k' });
    assert.deepEqual(await client.getTask('t1'), { id: 't1', status: 'running', progress: 22, currentTurn: 7, maxTurns: 32, result: null, error: null });
    assert.deepEqual(await client.getTask('t2'), { id: 't2', status: 'completed', progress: 0, currentTurn: 0, maxTurns: 0, result: '끝', error: null });
});

test('승인 대기 조회: 그 작업의 요청만 돌려준다', async () => {
    const { baseUrl } = await serve({
        'GET /api/agent-tasks/approvals/pending': ok({ pending: [
            { approvalId: 'a1', taskId: 't1', userId: 'u', toolName: 'bash', args: { command: 'ls' } },
            { approvalId: 'a2', taskId: 'other', userId: 'u', toolName: 'bash', args: {} },
        ] }),
    });
    assert.deepEqual(await createTaskClient({ baseUrl, apiKey: 'k' }).listPendingApprovals('t1'), [
        { approvalId: 'a1', taskId: 't1', toolName: 'bash', args: { command: 'ls' } },
    ]);
});

test('승인 결정: 성공은 ok, 이미 처리된 요청(404)은 gone', async () => {
    const { baseUrl, seen } = await serve({
        'POST /api/agent-tasks/approvals/a1/approve': ok({ approvalId: 'a1', decision: 'approve' }),
        'POST /api/agent-tasks/approvals/a2/reject': { status: 404, body: { success: false, error: { message: '대기 중인 승인 요청을 찾을 수 없습니다' } } },
    });
    const client = createTaskClient({ baseUrl, apiKey: 'k' });
    assert.equal(await client.decideApproval('a1', 'approve'), 'ok');
    assert.equal(await client.decideApproval('a2', 'reject'), 'gone');
    assert.equal(seen[0].method, 'POST');
});

test('취소와 기기 연결 조회', async () => {
    const { baseUrl, seen } = await serve({
        'POST /api/agent-tasks/t1/cancel': ok({ taskId: 't1' }),
        'GET /api/local-bridge/status': ok({ enabled: true, connected: false, devices: [] }),
    });
    const client = createTaskClient({ baseUrl, apiKey: 'k' });
    await client.cancelTask('t1');
    assert.equal(await client.isDeviceConnected(), false);
    assert.equal(seen[0].url, '/api/agent-tasks/t1/cancel');
});

test('2xx 가 아니면 서버 메시지와 상태 코드를 담은 TaskApiError 를 던진다', async () => {
    const { baseUrl } = await serve({ 'POST /api/agent-tasks': { status: 400, body: { success: false, error: { message: '로컬 실행 기능이 비활성화되어 있습니다' } } } });
    await assert.rejects(
        () => createTaskClient({ baseUrl, apiKey: 'k' }).createTask('x', 'local'),
        (e: unknown) => e instanceof TaskApiError && e.status === 400 && e.message === '로컬 실행 기능이 비활성화되어 있습니다',
    );
});

test('오류 본문이 JSON 이 아니어도 상태 코드로 오류를 만든다', async () => {
    const { baseUrl } = await serve({});
    await assert.rejects(
        () => createTaskClient({ baseUrl, apiKey: 'k' }).getTask('none'),
        (e: unknown) => e instanceof TaskApiError && e.status === 404,
    );
});
