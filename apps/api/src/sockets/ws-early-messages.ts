/**
 * WS 연결 직후 도착한 프레임 버퍼 — 인증이 끝나기 전에 온 메시지가 조용히 사라지던 것을 막는다.
 *
 * `wss.on('connection')` 콜백은 async 라 인증(`await authenticateWebSocket`)과 초기 전송을 마친
 * 뒤에야 `ws.on('message')` 를 등록한다. 그 사이에 도착한 프레임은 받는 리스너가 없어 ws 가
 * 그대로 버린다(오류도 로그도 남지 않는다). 브리지 코어는 `open` 즉시 `bridge_hello` 를 보내므로
 * 왕복 지연이 거의 없는 로컬 직결(`ws://127.0.0.1:52416`)에서 디바이스 등록이 유실됐다
 * (2026-09-11 실측: 즉시 전송 → 8초 무응답 / `init` 수신 후 전송 → 8ms 에 `bridge_ready`).
 *
 * 인증 전 연결이 메모리를 점유하지 못하도록 프레임 수·총 바이트 상한을 두고 넘치면 버린다
 * (정상 클라이언트의 첫 프레임은 hello·resume 같은 작은 메시지다).
 *
 * @module sockets/ws-early-messages
 */
import type { RawData, WebSocket } from 'ws';
import { WS_LIMITS } from '../config/timeouts';
import { createLogger } from '../utils/logger';

const log = createLogger('WSEarly');

export interface EarlyMessageBuffer {
    /** 실제 메시지 핸들러를 붙이고, 모아 둔 프레임을 도착 순서대로 넘긴다. */
    attach(handler: (data: RawData) => void): void;
    /** 연결이 거부돼 핸들러를 붙이지 않을 때 — 리스너만 떼고 버린다. */
    discard(): void;
}

/** RawData(Buffer | ArrayBuffer | Buffer[])의 바이트 크기. */
function frameSize(data: RawData): number {
    if (Array.isArray(data)) return data.reduce((n, b) => n + b.length, 0);
    if (Buffer.isBuffer(data)) return data.length;
    return (data as ArrayBuffer).byteLength || 0;
}

/**
 * 연결 콜백 진입 직후 호출한다. 반환한 버퍼는 반드시 `attach()` 또는 `discard()` 로 끝내야
 * 임시 리스너가 남지 않는다.
 */
export function bufferEarlyMessages(ws: WebSocket): EarlyMessageBuffer {
    const frames: RawData[] = [];
    let bytes = 0;
    let dropped = 0;

    const collect = (data: RawData): void => {
        const size = frameSize(data);
        if (frames.length >= WS_LIMITS.EARLY_BUFFER_MAX_FRAMES || bytes + size > WS_LIMITS.EARLY_BUFFER_MAX_BYTES) {
            dropped += 1;
            return;
        }
        frames.push(data);
        bytes += size;
    };
    ws.on('message', collect);

    return {
        attach(handler: (data: RawData) => void): void {
            ws.off('message', collect);
            ws.on('message', handler);
            if (dropped > 0) {
                log.warn(`인증 전 프레임 ${dropped}건 상한 초과로 폐기 (상한 ${WS_LIMITS.EARLY_BUFFER_MAX_FRAMES}건/${WS_LIMITS.EARLY_BUFFER_MAX_BYTES}B)`);
            }
            const pending = frames.splice(0, frames.length);
            bytes = 0;
            if (pending.length > 0) {
                log.info(`인증 전 도착 프레임 ${pending.length}건 재생`);
                for (const data of pending) handler(data);
            }
        },
        discard(): void {
            ws.off('message', collect);
            frames.length = 0;
            bytes = 0;
        },
    };
}
