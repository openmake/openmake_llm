/**
 * 재연결 간격 분산 — 서버가 재시작하면 모든 사용자의 디바이스가 같은 순간에 재접속하던 문제(고정 10초).
 * 간격을 구간 안에서 흩고(jitter), 계속 실패하면 늘린다(지수 백오프, 상한).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocketServer } from 'ws';
import { BridgeConnection, reconnectDelayMs } from '../connection';
import { BridgeCore } from '../core';
import { RECONNECT_MAX_MS, RECONNECT_MS } from '../constants';

describe('reconnectDelayMs', () => {
    it('첫 시도는 기준 간격의 절반~전체 구간에 흩어진다', () => {
        expect(reconnectDelayMs(0, 10000, 60000, () => 0)).toBe(5000);
        expect(reconnectDelayMs(0, 10000, 60000, () => 0.5)).toBe(7500);
        expect(reconnectDelayMs(0, 10000, 60000, () => 0.999999)).toBeLessThanOrEqual(10000);
    });

    it('실패가 이어지면 두 배씩 늘고 상한에서 멈춘다', () => {
        const top = (attempt: number): number => reconnectDelayMs(attempt, 10000, 60000, () => 1);
        expect([0, 1, 2, 3, 10].map(top)).toEqual([10000, 20000, 40000, 60000, 60000]);
        expect(reconnectDelayMs(50, 10000, 60000, () => 0)).toBe(30000); // 큰 attempt 도 넘치지 않는다
    });

    it('난수에 따라 값이 달라진다 — 디바이스마다 다른 시각에 재접속', () => {
        const seen = new Set([0.1, 0.3, 0.6, 0.9].map((r) => reconnectDelayMs(0, RECONNECT_MS, RECONNECT_MAX_MS, () => r)));
        expect(seen.size).toBe(4);
    });

    it('기준 간격이 상한보다 크면 기준 간격을 상한으로 쓴다', () => {
        expect(reconnectDelayMs(3, 90000, 60000, () => 1)).toBe(90000);
    });
});

describe('BridgeConnection 재연결 백오프', () => {
    let base: string;
    beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'omk-backoff-')); });

    function makeConn(port: number, delays: number[], statuses: string[]): BridgeConnection {
        const core = new BridgeCore({ folder: base, confirm: async () => 'all', sandboxProfileDir: os.tmpdir() });
        return new BridgeConnection({
            serverUrl: `http://127.0.0.1:${port}`,
            core, deviceId: 'd1', label: 'l',
            headers: () => ({}),
            onStatus: (s) => statuses.push(s),
            reconnectMs: 20, reconnectMaxMs: 200, random: () => 1,
            onReconnectScheduled: (ms) => delays.push(ms),
        });
    }

    it('서버가 계속 죽어 있으면 간격이 늘어난다', async () => {
        // 닫힌 포트 — 접속이 매번 실패한다
        const probe = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => probe.once('listening', r));
        const port = (probe.address() as { port: number }).port;
        await new Promise<void>((r) => probe.close(() => r()));

        const delays: number[] = [];
        const conn = makeConn(port, delays, []);
        await conn.connect();
        // 고정 시간만 기다리면 느린 CI 러너에서 접속 실패 처리가 늦어 4번째 예약 전에 끝난다 — 4번 예약될 때까지 기다린다
        const deadline = Date.now() + 5000;
        while (delays.length < 4 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
        conn.disconnect();
        expect(delays.slice(0, 4)).toEqual([20, 40, 80, 160]);
    });

    it('연결에 성공하면(bridge_ready) 다음 끊김은 다시 기준 간격부터 시작한다', async () => {
        const wss = new WebSocketServer({ port: 0 });
        await new Promise<void>((r) => wss.once('listening', r));
        const port = (wss.address() as { port: number }).port;
        let accept = false;
        wss.on('connection', (ws) => {
            if (!accept) { ws.terminate(); return; }
            ws.on('message', () => { ws.send(JSON.stringify({ type: 'bridge_ready' })); });
        });
        const delays: number[] = [];
        const statuses: string[] = [];
        const conn = makeConn(port, delays, statuses);
        await conn.connect();
        // 20 → 40 까지 실패 — 고정 시간만 기다리면 부하가 걸린 러너에서 두 번째 예약 전에 끝난다(위 테스트와 같은 이유)
        const until0 = Date.now() + 5000;
        while (delays.length < 2 && Date.now() < until0) await new Promise((r) => setTimeout(r, 10));
        expect(delays.length).toBeGreaterThanOrEqual(2);
        expect(delays[1]).toBe(40);
        accept = true;
        const until = Date.now() + 5000;
        while (!statuses.some((s) => s.startsWith('연결됨')) && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
        expect(statuses.some((s) => s.startsWith('연결됨'))).toBe(true);
        const before = delays.length;
        for (const c of wss.clients) c.terminate();
        const until2 = Date.now() + 2000;
        while (delays.length === before && Date.now() < until2) await new Promise((r) => setTimeout(r, 10));
        expect(delays[before]).toBe(20); // 리셋됨
        conn.disconnect();
        await new Promise<void>((r) => wss.close(() => r()));
    });
});
