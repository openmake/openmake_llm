/**
 * 앱 수준 생존 확인 ping → pong (2026-10-29).
 *
 * 브라우저 코드는 프로토콜 ping/pong 을 볼 수 없다. 네트워크가 바뀌어 소켓이 half-open 이 되면
 * 서버는 하트비트로 끊지만 브라우저는 FIN 을 받지 못해 `onclose` 가 1~2분 늦게 오고, 그 사이 보낸
 * 중단·승인 응답이 죽은 소켓으로 사라진다. 그래서 클라이언트가 `{type:'ping', t?}` 를 보내면
 * 즉시 `{type:'pong', t}` 로 답해 클라이언트가 응답 유무로 소켓의 생존을 판정하게 한다.
 *
 * 내용이 없는 전송 계층 메시지라 메시지 빈도 제한·활동 갱신·span·로그 밖에서 처리한다
 * (주기 ping 이 사용자 메시지 한도를 깎거나 유휴 연결을 활동 중으로 보이게 하지 않도록).
 *
 * @module sockets/ws-app-ping
 */
import { WebSocket } from 'ws';

/**
 * 파싱된 메시지가 앱 수준 ping 이면 pong 으로 답하고 true(소비함)를 돌려준다.
 * ping 이 아니면 아무것도 하지 않고 false — 호출자가 평소대로 처리한다.
 */
export function replyToAppPing(ws: WebSocket, parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object' || (parsed as { type?: unknown }).type !== 'ping') return false;
    if (ws.readyState !== WebSocket.OPEN) return true;
    const t = (parsed as { t?: unknown }).t;
    try {
        ws.send(JSON.stringify(typeof t === 'number' && Number.isFinite(t) ? { type: 'pong', t } : { type: 'pong' }));
    } catch {
        /* 닫히는 중 — 클라이언트는 pong 이 없으면 스스로 재연결한다 */
    }
    return true;
}
