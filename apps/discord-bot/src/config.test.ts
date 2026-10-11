/**
 * loadRemoteSettings 기동 재시도 검증 — 실제 HTTP 서버(임의 포트)를 띄워 확인한다.
 * 실행: npm test (Node 내장 테스트 러너 + ts-node)
 */
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, test } from 'node:test';
import { config, loadRemoteSettings } from './config';

/** 테스트가 수십 초 걸리지 않게 짧은 간격·한도를 주입한다. */
const FAST_RETRY = { retryMaxMs: 5_000, retryIntervalMs: 50 };

const SETTINGS_BODY = JSON.stringify({ data: { settings: { DISCORD_BOT_MODEL: 'remote-model' } } });

let server: http.Server | undefined;

function listen(handler: http.RequestListener, port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = http.createServer(handler);
        s.once('error', reject);
        s.listen(port, '127.0.0.1', () => {
            server = s;
            resolve((s.address() as AddressInfo).port);
        });
    });
}

function closeServer(): Promise<void> {
    return new Promise((resolve) => {
        if (!server) return resolve();
        const s = server;
        server = undefined;
        s.closeAllConnections();
        s.close(() => resolve());
    });
}

/** 지금은 닫혀 있는(방금 열었다 닫은) 포트 번호 */
async function closedPort(): Promise<number> {
    const port = await listen(() => undefined);
    await closeServer();
    return port;
}

beforeEach(() => {
    config.apiKey = 'test-key';
    config.model = '';
});

afterEach(async () => {
    await closeServer();
});

test('포트가 닫혀 있다가 서버가 뜨면 재시도 끝에 설정이 적용된다', async (t) => {
    const log = t.mock.method(console, 'log', () => undefined);
    const port = await closedPort();
    config.apiBaseUrl = `http://127.0.0.1:${port}`;
    const timer = setTimeout(() => {
        void listen((_req, res) => res.end(SETTINGS_BODY), port);
    }, 300);
    t.after(() => clearTimeout(timer));

    const applied = await loadRemoteSettings(FAST_RETRY);

    assert.deepEqual(applied, ['DISCORD_BOT_MODEL']);
    assert.equal(config.model, 'remote-model');
    // 재시도 진입 1줄 + 성공 1줄 — 시도마다 로그를 쏟지 않는다
    assert.equal(log.mock.callCount(), 2);
});

test('계속 닫혀 있으면 한도 뒤 빈 배열을 돌려주고 예외를 던지지 않는다', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    const warn = t.mock.method(console, 'warn', () => undefined);
    config.apiBaseUrl = `http://127.0.0.1:${await closedPort()}`;

    const startedAt = Date.now();
    const applied = await loadRemoteSettings({ retryMaxMs: 300, retryIntervalMs: 50 });
    const elapsedMs = Date.now() - startedAt;

    assert.deepEqual(applied, []);
    assert.ok(elapsedMs >= 200, `한도까지 기다려야 한다 (실제 ${elapsedMs}ms)`);
    assert.ok(elapsedMs < 3_000, `한도를 크게 넘기면 안 된다 (실제 ${elapsedMs}ms)`);
    assert.equal(warn.mock.callCount(), 1);
});

test('총 대기 0 이면 재시도하지 않는다', async (t) => {
    t.mock.method(console, 'warn', () => undefined);
    let requests = 0;
    const port = await listen((_req, res) => {
        requests += 1;
        res.statusCode = 503;
        res.end();
    });
    config.apiBaseUrl = `http://127.0.0.1:${port}`;

    const applied = await loadRemoteSettings({ retryMaxMs: 0, retryIntervalMs: 50 });

    assert.deepEqual(applied, []);
    assert.equal(requests, 1);
});

test('401 이면 재시도 없이 바로 빈 배열을 돌려준다', async (t) => {
    t.mock.method(console, 'warn', () => undefined);
    let requests = 0;
    const port = await listen((_req, res) => {
        requests += 1;
        res.statusCode = 401;
        res.end();
    });
    config.apiBaseUrl = `http://127.0.0.1:${port}`;

    const applied = await loadRemoteSettings(FAST_RETRY);

    assert.deepEqual(applied, []);
    assert.equal(requests, 1);
});

test('503 뒤 200 이면 설정이 적용된다', async (t) => {
    t.mock.method(console, 'log', () => undefined);
    let requests = 0;
    const port = await listen((_req, res) => {
        requests += 1;
        if (requests === 1) {
            res.statusCode = 503;
            res.end();
            return;
        }
        res.end(SETTINGS_BODY);
    });
    config.apiBaseUrl = `http://127.0.0.1:${port}`;

    const applied = await loadRemoteSettings(FAST_RETRY);

    assert.deepEqual(applied, ['DISCORD_BOT_MODEL']);
    assert.equal(config.model, 'remote-model');
    assert.equal(requests, 2);
});

test('apiKey 가 없으면 요청 없이 빈 배열을 돌려준다', async () => {
    let requests = 0;
    const port = await listen((_req, res) => {
        requests += 1;
        res.end(SETTINGS_BODY);
    });
    config.apiBaseUrl = `http://127.0.0.1:${port}`;
    config.apiKey = '';

    assert.deepEqual(await loadRemoteSettings(FAST_RETRY), []);
    assert.equal(requests, 0);
});
