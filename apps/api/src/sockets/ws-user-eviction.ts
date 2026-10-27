/**
 * ============================================================
 * 인증 철회 → 열린 채팅 WebSocket 즉시 종료 (보안 점검 A3 보조 방어)
 * ============================================================
 * 강등·비활성화·삭제·비밀번호 변경(data/user-manager 가 USER_AUTH_REVOKED 발행) 시 그 사용자의 열린 소켓을
 * 정리하고 1008 'auth_revoked' 로 닫는다. 웹 클라이언트는 onclose 재연결 → 쿠키 재인증 → DB 기준 role 로 다시 붙는다.
 * handler.ts 에서 분리(파일 크기 가드) — handler 는 생성 시 1회 구독하고 종료 시 해제한다.
 *
 * ⚠️ 한계: event-bus 는 in-process 라 PM2 cluster 모드에서는 발행한 worker 의 소켓만 닫힌다(event-bus.ts·브리지 registry 와
 * 같은 한계). 1차 방어선은 연결·refresh 때의 DB 재검증(ws-auth) + access 토큰 만료(≤15분) 종료이고, 이것은 best-effort 보조다.
 *
 * @module sockets/ws-user-eviction
 */
import { WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import { getEventBus, USER_AUTH_REVOKED, type UserAuthRevokedEvent } from '../utils/event-bus';
import { getInFlightStreamRegistry } from './ws-stream-registry';
import type { WsConnectionGuard } from './ws-connection-guard';
import type { ExtendedWebSocket } from './ws-types';

const log = createLogger('WsUserEviction');

/**
 * USER_AUTH_REVOKED 를 구독한다. `unregister` 는 handler 의 연결 해제(clients·guard 레지스트리·analytics 세션).
 * @returns 구독 해제 함수
 */
export function subscribeUserAuthRevoked(
    guard: Pick<WsConnectionGuard, 'getUserConnections'>,
    unregister: (ws: WebSocket) => void,
): () => void {
    const listener = ({ userId, reason }: UserAuthRevokedEvent): void => {
        // unregister 가 레지스트리 Set 을 바꾸므로 복사해서 순회한다.
        const connections = Array.from(guard.getUserConnections(userId));
        let closed = 0;
        for (const ws of connections) {
            try {
                const extWs = ws as ExtendedWebSocket;
                // 진행 중 생성은 하트비트 종료와 같게 — detach(유예 후 abort), 이어받기 대상이 아니면 즉시 중단.
                if (!getInFlightStreamRegistry().detach(extWs) && extWs._abortController) {
                    extWs._abortController.abort();
                    extWs._abortController = null;
                }
                unregister(ws);
                if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) continue;
                ws.close(1008, 'auth_revoked');
                closed++;
            } catch (err) {
                // 발행자(user-manager)는 DB 변경을 이미 끝냈다 — 소켓 정리 실패가 그 요청을 깨지 않게 삼키고 남긴다.
                log.warn(`[WS] 인증 철회 소켓 정리 실패: userId=${userId} reason=${reason}`, err);
            }
        }
        if (connections.length > 0) log.info(`[WS] 인증 철회 → 연결 종료: userId=${userId} reason=${reason} closed=${closed}`);
    };
    const bus = getEventBus();
    bus.on(USER_AUTH_REVOKED, listener);
    return () => { bus.off(USER_AUTH_REVOKED, listener); };
}
