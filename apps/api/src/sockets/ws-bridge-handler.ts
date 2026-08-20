/**
 * Local Bridge WS 핸들러 (Cowork D1a) — 데스크톱 로컬 실행기 등록·도구 결과 수신.
 * handler.ts 의 메시지 스위치에서 위임(파일 크기 가드 분리). 인증 필수(게스트 거부),
 * 등록은 유저당 1대(새 등록이 기존 대체).
 *
 * @module sockets/ws-bridge-handler
 */
import type { WebSocket } from 'ws';
import type { WSMessage, ExtendedWebSocket } from './ws-types';
import { getLocalBridgeRegistry, type BridgeResult } from '../services/local-bridge/registry';
import { LOCAL_BRIDGE } from '../config/local-bridge';

export async function handleBridgeMessage(ws: WebSocket, msg: WSMessage): Promise<void> {
    const extWs = ws as ExtendedWebSocket;
    const userId = extWs._authenticatedUserId;
    if (!userId) {
        ws.send(JSON.stringify({ type: 'error', message: '로컬 브리지는 로그인이 필요합니다' }));
        return;
    }
    if (!LOCAL_BRIDGE.ENABLED) {
        ws.send(JSON.stringify({ type: 'error', message: '로컬 실행 기능이 비활성화되어 있습니다 (LOCAL_EXECUTOR_ENABLED)' }));
        return;
    }
    const registry = getLocalBridgeRegistry();
    if (msg.type === 'bridge_hello') {
        const deviceId = typeof msg.deviceId === 'string' && msg.deviceId.trim() ? msg.deviceId.trim().slice(0, 64) : 'unknown';
        const label = typeof msg.label === 'string' && msg.label.trim() ? msg.label.trim().slice(0, 120) : deviceId;
        const folderName = typeof msg.folderName === 'string' ? msg.folderName.trim().slice(0, 200) : '';
        const ok = registry.register({ userId, deviceId, label, folderName, ws, connectedAt: Date.now() });
        if (!ok) {
            ws.send(JSON.stringify({ type: 'error', message: `브리지 디바이스 상한(${LOCAL_BRIDGE.MAX_DEVICES}대)을 초과했습니다 — 다른 디바이스 연결을 해제하세요` }));
            return;
        }
        ws.send(JSON.stringify({ type: 'bridge_ready', deviceId }));
        return;
    }
    // bridge_result — reqId 상관관계 해소 (소유 검증은 레지스트리가 수행)
    if (typeof msg.reqId === 'string' && msg.result && typeof msg.result === 'object') {
        registry.handleResult(userId, msg.reqId, msg.result as unknown as BridgeResult);
    }
}
