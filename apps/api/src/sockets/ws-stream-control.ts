/**
 * 채팅 스트림 중단·이어받기 요청 처리 — handler.ts 의 `abort`·`resume` 메시지(파일 크기 상한으로 분리, 2026-10-29).
 *
 * - abort: 이 소켓의 생성을 멈추고 `aborted` 로 답한다. 레지스트리에 붙은 스트림이면 그 streamId 를 싣는다 —
 *   클라이언트가 늦게 온 중단 응답을 다른(새) 생성의 것으로 오인하지 않게 한다.
 * - resume: 끊겼던 스트림을 이 소켓에 붙인다. `exact:true`(새 클라이언트)면 streamId 가 등록된 스트림과 정확히
 *   같을 때만 붙고, 아니면 아무것도 바꾸지 않고 `resume_none{streamId}` — 같은 키로 생성 중인 다른 탭을 빼앗지 않는다.
 *   exact 가 없으면 종전 동작(커서가 달라도 붙음).
 *
 * @module sockets/ws-stream-control
 */
import type { WebSocket } from 'ws';
import type { ExtendedWebSocket, WSMessage } from './ws-types';
import { createLogger } from '../utils/logger';
import { getInFlightStreamRegistry, normalizeClientStreamId, resolveStreamKey } from './ws-stream-registry';

const log = createLogger('WebSocketHandler');

/** init 에 싣는 서버 기능 — 클라이언트는 연결마다 이 값을 보고 새 계약을 쓴다(구 서버는 필드가 없다). */
export const WS_CHAT_CAPABILITIES = { exactResume: true } as const;

/** 채팅 중단 처리 */
export function handleStreamAbort(ws: WebSocket): void {
    const extWs = ws as ExtendedWebSocket;
    if (extWs._abortController) {
        log.info('[WS] 채팅 중단 요청 수신');
        const registry = getInFlightStreamRegistry();
        const streamId = registry.streamIdOf(extWs);
        extWs._abortController.abort();
        extWs._abortController = null;
        registry.abortByWs(extWs);
        ws.send(JSON.stringify({ type: 'aborted', message: '응답 생성이 중단되었습니다.', ...(streamId ? { streamId } : {}) }));
    } else {
        log.debug('[WS] 중단할 진행 중인 채팅 없음');
    }
}

/**
 * 끊겼던 스트림 이어받기 — 인증 사용자는 userId, 게스트는 anonSessionId 로 찾는다.
 * 스트림이 없으면(이미 끝나 보관도 만료·애초에 없음) resume_none 으로 답해 클라이언트가 대기를 푼다.
 */
export function handleStreamResume(ws: WebSocket, msg: WSMessage): void {
    const extWs = ws as ExtendedWebSocket;
    const key = resolveStreamKey(extWs, msg.anonSessionId, msg.lane);
    const exact = msg.exact === true;
    const exactId = exact ? normalizeClientStreamId(msg.streamId) : null;
    // 이어받기 커서(F19.11) — 형식이 틀리면 무시하고 종전(커서 없음) 재생. exact 면 형식이 틀린 id 는 어떤 스트림과도 같지 않다.
    const cursor = {
        ...(exact
            ? (exactId ? { streamId: exactId } : {})
            : (typeof msg.streamId === 'string' && /^[0-9a-f-]{36}$/i.test(msg.streamId) ? { streamId: msg.streamId } : {})),
        ...(Number.isInteger(msg.afterSeq) && (msg.afterSeq as number) >= 0 ? { afterSeq: msg.afterSeq as number } : {}),
    };
    const attached = key ? getInFlightStreamRegistry().attach(key, extWs, cursor, { exact }) : false;
    if (!attached) ws.send(JSON.stringify({ type: 'resume_none', ...(exactId ? { streamId: exactId } : {}) }));
}
