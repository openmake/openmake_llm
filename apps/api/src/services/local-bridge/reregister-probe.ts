/**
 * 재등록 생존 확인 (설계 2026-11-19 device-id-conflict §3.2) — 같은 deviceId 로 다른 연결이 오면 기존 소켓이 지금
 * 응답하는지 ping 하나로 묻는다. 확인마다 새 난수를 싣고 같은 내용의 pong 만 센다 — 30초 하트비트의 빈 pong 을
 * 확인 응답으로 잘못 읽지 않게(pong 은 ping 내용을 그대로 돌려준다, RFC 6455).
 *
 * 묻는 것은 "그 id 를 쥔 프로세스의 입출력이 살아 있는가" 하나다. 실행기가 정상인지는 묻지 않는다.
 *
 * @module services/local-bridge/reregister-probe
 */
import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';

/** alive: 맞는 pong 이 왔다 · silent: 시간 안에 오지 않았다 · closed: 소켓이 닫혔거나 확인이 취소됐다(다시 판정). */
export type ProbeOutcome = 'alive' | 'silent' | 'closed';

const PROBE_TOKEN_BYTES = 16;

/** 기존 소켓에 확인 ping 을 보내고 결과를 기다린다. 어떻게 끝나든 붙인 리스너·타이머를 떼고 끝난다. */
export function probeAlive(ws: WebSocket, timeoutMs: number, signal?: AbortSignal): Promise<ProbeOutcome> {
    if (ws.readyState !== ws.OPEN || signal?.aborted) return Promise.resolve('closed');
    const token = randomBytes(PROBE_TOKEN_BYTES);
    return new Promise<ProbeOutcome>((resolve) => {
        let settled = false;
        const finish = (outcome: ProbeOutcome): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            ws.off('pong', onPong);
            ws.off('close', onClose);
            signal?.removeEventListener('abort', onClose);
            resolve(outcome);
        };
        const onPong = (data: unknown): void => { if (Buffer.isBuffer(data) && data.equals(token)) finish('alive'); };
        const onClose = (): void => finish('closed');
        const timer = setTimeout(() => finish('silent'), timeoutMs);
        ws.on('pong', onPong);
        ws.on('close', onClose);
        signal?.addEventListener('abort', onClose);
        // 보내지 못하면 응답할 수 없는 소켓이다 — 무응답으로 본다(closed 로 두면 같은 소켓을 다시 확인하게 된다).
        try { ws.ping(token); } catch { finish('silent'); }
    });
}
