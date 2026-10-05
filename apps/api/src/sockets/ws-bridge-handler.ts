/**
 * Local Bridge WS 핸들러 (Cowork D1a) — 데스크톱 로컬 실행기 등록·도구 결과 수신.
 * handler.ts 의 메시지 스위치에서 위임(파일 크기 가드 분리). 인증 필수(게스트 거부),
 * 등록 상한은 유저당 PC 수(LOCAL_BRIDGE.MAX_DEVICES)와 PC 당 폴더 수 — 같은 deviceId 재등록은 기존을 대체한다.
 *
 * @module sockets/ws-bridge-handler
 */
import type { WebSocket } from 'ws';
import type { WSMessage, ExtendedWebSocket } from './ws-types';
import { getLocalBridgeRegistry, normalizeCapabilities, type BridgeResult } from '../services/local-bridge/registry';
import { LOCAL_BRIDGE } from '../config/local-bridge';
import { apiKeyHasScope, API_KEY_SCOPES } from '../config/api-key-scopes';

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
    // 브리지는 API key 연결만 받는다 — Companion·CLI 가 이 경로다(ws-auth 는 API key 연결에 항상
    // 스코프 배열을 싣는다: 미지정 키는 ['*']). JWT/쿠키 연결(_apiKeyScopes=undefined)로 등록하던 것은
    // 구 Electron 데스크톱 앱뿐이었고, macOS 는 네이티브 컴패니언만 지원하므로(2026-09-11) 거부한다.
    if (extWs._apiKeyScopes === undefined) {
        ws.send(JSON.stringify({ type: 'error', message: '로컬 실행은 OpenMake Companion 또는 CLI 로만 연결할 수 있습니다 — bridge 스코프 API key 로 접속하세요' }));
        try { ws.close(1008, 'bridge_api_key_required'); } catch { /* already closing */ }
        return;
    }
    // API key 연결이면 bridge 스코프 필수 — 스코프 없는(예: chat 전용) 키의 브리지 등록 차단.
    if (!apiKeyHasScope(extWs._apiKeyScopes, API_KEY_SCOPES.BRIDGE)) {
        ws.send(JSON.stringify({ type: 'error', message: `이 API key 는 '${API_KEY_SCOPES.BRIDGE}' 스코프가 없습니다 — bridge 스코프 키를 발급하세요` }));
        try { ws.close(1008, 'bridge_scope_required'); } catch { /* already closing */ }
        return;
    }
    const registry = getLocalBridgeRegistry();
    if (msg.type === 'bridge_hello') {
        const deviceId = typeof msg.deviceId === 'string' && msg.deviceId.trim() ? msg.deviceId.trim().slice(0, 64) : 'unknown';
        const label = typeof msg.label === 'string' && msg.label.trim() ? msg.label.trim().slice(0, 120) : deviceId;
        const folderName = typeof msg.folderName === 'string' ? msg.folderName.trim().slice(0, 200) : '';
        // hostId·capabilities 는 2026-10-04 추가 필드 — 보내지 않는 구버전은 레지스트리가 현행대로 처리한다.
        const hostId = typeof msg.hostId === 'string' && msg.hostId.trim() ? msg.hostId.trim().slice(0, 64) : undefined;
        const capabilities = normalizeCapabilities(msg.capabilities);
        const ok = registry.register({ userId, deviceId, label, folderName, hostId, capabilities, ws, connectedAt: Date.now() });
        if (!ok) {
            ws.send(JSON.stringify({ type: 'error', message: `브리지 디바이스 상한(${LOCAL_BRIDGE.MAX_DEVICES}대)을 초과했습니다 — 다른 디바이스 연결을 해제하세요` }));
            // 미등록 소켓을 열어두면 좀비로 남아 MAX_CONNECTIONS_PER_USER 만 갉아먹는다 — 명시 종료.
            try { ws.close(1008, 'bridge_device_limit'); } catch { /* already closing */ }
            return;
        }
        ws.send(JSON.stringify({ type: 'bridge_ready', deviceId }));
        // 이 기기를 기다리던 작업을 이어서 실행한다 — 등록 응답을 막지 않는다(실패는 주차 스윕이 다시 시도).
        void import('../services/agent-task/device-wait').then((m) => m.resumeDeviceWaitingTasks(userId)).catch(() => undefined);
        return;
    }
    // bridge_event — 기기→서버 단방향 알림(2026-10-05 추가 프레임). 지금은 브라우저 제어권(browser_control)뿐이고 응답하지 않는다.
    // 돌려받으면(user=false) 넘겨받기로 멈춘 그 사용자의 작업을 재개한다(실패는 주차 스윕이 다시 시도).
    if (msg.type === 'bridge_event') {
        if (msg.kind !== 'browser_control' || typeof msg.user !== 'boolean') return;
        registry.setBrowserUserControl(userId, ws, msg.user);
        if (!msg.user) void import('../services/agent-task/browser-takeover').then((m) => m.resumeBrowserTakeoverTasks(userId)).catch(() => undefined);
        return;
    }
    // bridge_result — reqId 상관관계 해소 (소유 검증은 레지스트리가 수행). 발신 소켓의
    // deviceId 를 함께 넘겨 요청을 라우팅한 디바이스와 일치하는지 검증(교차 디바이스 주입 차단).
    if (typeof msg.reqId === 'string' && msg.result && typeof msg.result === 'object') {
        const senderDeviceId = registry.getDeviceIdByWs(userId, ws) ?? undefined;
        registry.handleResult(userId, msg.reqId, msg.result as unknown as BridgeResult, senderDeviceId);
    }
}
