/**
 * ============================================================
 * WS Broadcast / Heartbeat Sweep — 연결 집합 대상 송신 유틸
 * ============================================================
 *
 * handler.ts 에서 분리(파일 크기 가드 선제 대응): 클래스 상태에 의존하지 않는
 * "연결 집합 → 송신/정리" 로직만 순수 함수로 추출한다. 동작 동일.
 *
 * @module sockets/ws-broadcast
 */
import { WebSocket } from 'ws';
import { WS_LIMITS } from '../config/timeouts';
import type { ExtendedWebSocket } from './ws-types';
import { createLogger } from '../utils/logger';

const log = createLogger('WebSocketHandler');

/**
 * 모든 연결에 backpressure 정책으로 브로드캐스트한다.
 *
 * 정책:
 *  - bufferedAmount > THRESHOLD_BYTES: 송신 skip + slowClient 카운터 증가
 *  - 카운터가 TERMINATE_AFTER 초과: ws.terminate() 로 강제 종료
 *    (heartbeat 가 없는 dead connection 정리)
 *  - 정상 송신 시 카운터 리셋
 *
 * 이전 동작(await/콜백 없는 단순 send)은 슬로우 클라이언트가 이벤트 루프와
 * Node 메모리를 점유해 fast 클라이언트의 latency 까지 끌어올렸다.
 */
export function broadcastWithBackpressure(
    clients: Iterable<WebSocket>,
    slowClientCounters: WeakMap<WebSocket, number>,
    data: Record<string, unknown>,
): void {
    const message = JSON.stringify(data);
    const threshold = WS_LIMITS.BROADCAST_BACKPRESSURE_THRESHOLD_BYTES;
    const terminateAfter = WS_LIMITS.BROADCAST_BACKPRESSURE_TERMINATE_AFTER;
    let skipped = 0;
    let terminated = 0;

    for (const client of clients) {
        if (client.readyState !== WebSocket.OPEN) continue;

        // 슬로우 클라이언트 감지 — bufferedAmount 가 임계 초과
        if (client.bufferedAmount > threshold) {
            const count = (slowClientCounters.get(client) ?? 0) + 1;
            slowClientCounters.set(client, count);
            skipped++;

            if (terminateAfter > 0 && count >= terminateAfter) {
                // 만성적 stall — 강제 종료 (close 핸들러가 cleanup 처리)
                client.terminate();
                slowClientCounters.delete(client);
                terminated++;
            }
            continue;
        }

        // 정상 송신 — slow 카운터 리셋
        if (slowClientCounters.has(client)) {
            slowClientCounters.delete(client);
        }
        client.send(message);
    }

    if (skipped > 0 || terminated > 0) {
        log.warn(
            `broadcast backpressure: skipped=${skipped}, terminated=${terminated} ` +
            `(threshold=${threshold}B, terminateAfter=${terminateAfter})`
        );
    }
}

/** 지정 연결 집합에 메시지 전송 (OPEN 만). 연결이 없으면 no-op. */
export function sendToConnections(
    connections: Iterable<WebSocket>,
    data: Record<string, unknown>,
): void {
    const message = JSON.stringify(data);
    for (const client of connections) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

/**
 * 하트비트 1회 스윕 — 좀비 연결을 수집해 반환하고, 살아있는 연결엔 ping 을 보낸다.
 * ⚠️ 순회 중 삭제 금지(Set 변경) — 종료 처리는 호출부가 반환된 목록으로 수행한다.
 */
export function sweepHeartbeat(
    clients: Iterable<WebSocket>,
    isTokenExpired: (ws: ExtendedWebSocket) => boolean,
): WebSocket[] {
    const dead: WebSocket[] = [];
    for (const ws of clients) {
        const extWs = ws as ExtendedWebSocket;
        if (!extWs._isAlive || isTokenExpired(extWs)) {
            dead.push(ws);
        } else if (ws.readyState === WebSocket.OPEN) {
            extWs._isAlive = false;
            ws.ping();
        }
    }
    return dead;
}
