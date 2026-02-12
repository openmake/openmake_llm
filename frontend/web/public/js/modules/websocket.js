/**
 * WebSocket Module
 * 서버와의 실시간 통신을 관리합니다.
 */

import { getState, setState } from './state.js';
import { debugLog, debugWarn } from './utils.js';

let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const INITIAL_RECONNECT_DELAY = 1000;

/**
 * WebSocket 연결
 */
function connectWebSocket() {
    // 🔒 Phase 3: 기존 연결이 있으면 먼저 닫기 (좀비 연결 방지)
    const existingWs = getState('ws');
    if (existingWs) {
        try {
            existingWs.onclose = null; // 재연결 트리거 방지
            existingWs.onerror = null;
            existingWs.onmessage = null;
            existingWs.close();
        } catch (e) {
            // 이미 닫힌 상태일 수 있음 — 무시
        }
        setState('ws', null);
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    const ws = new WebSocket(wsUrl);
    setState('ws', ws);

    ws.onopen = () => {
        debugLog('[WebSocket] 연결됨');
        reconnectAttempts = 0;
        updateConnectionStatus('connected', '연결됨');

        // 초기 데이터 요청
        sendWsMessage({ type: 'init' });
        sendWsMessage({ type: 'get_agents' });
    };

    ws.onclose = (event) => {
        debugLog('[WebSocket] 연결 종료:', event.code);
        setState('ws', null);
        updateConnectionStatus('disconnected', '연결 끊김');

        // 자동 재연결
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts);
            debugLog(`[WebSocket] ${delay}ms 후 재연결 시도... (${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
            reconnectAttempts++;
            setTimeout(connectWebSocket, delay);
        }
    };

    ws.onerror = (error) => {
        console.error('[WebSocket] 오류:', error);
        updateConnectionStatus('error', '오류');
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleMessage(data);
        } catch (e) {
            console.error('[WebSocket] 메시지 파싱 오류:', e);
        }
    };

    return ws;
}

/**
 * WebSocket 메시지 전송
 * @param {object} data - 전송할 데이터
 */
function sendWsMessage(data) {
    const ws = getState('ws');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
        return true;
    }
    debugWarn('[WebSocket] 연결되지 않음');
    return false;
}

/**
 * 메시지 핸들러
 * @param {object} data - 수신된 데이터
 */
function handleMessage(data) {
    switch (data.type) {
        case 'init':
            if (data.nodes) {
                setState('nodes', data.nodes);
                if (typeof updateClusterInfo === 'function') {
                    updateClusterInfo(data);
                }
            }
            break;

        case 'cluster_event':
            if (typeof handleClusterEvent === 'function') {
                handleClusterEvent(data.event);
            }
            break;

        case 'token':
            if (typeof appendToken === 'function') {
                appendToken(data.token);
            }
            break;

        case 'done':
            if (typeof finishAssistantMessage === 'function') {
                finishAssistantMessage();
            }
            break;

        case 'error':
            console.error('[Server] 오류:', data.error);
            if (typeof showError === 'function') {
                showError(data.error);
            }
            break;

        case 'aborted':
            debugLog('[WebSocket] 응답 생성 중단됨');
            if (typeof finishAssistantMessage === 'function') {
                finishAssistantMessage('⏹️ 응답 생성이 중단되었습니다.');
            }
            if (typeof showToast === 'function') {
                showToast('응답 생성이 중단되었습니다.', 'info');
            }
            break;

        case 'agents':
            if (data.agents && typeof renderAgentList === 'function') {
                renderAgentList(data.agents);
            }
            break;

        case 'progress':
            if (typeof showDocumentProgress === 'function') {
                showDocumentProgress(data);
            }
            break;

        case 'session_created':
            if (data.sessionId) {
                debugLog('[WebSocket] 세션 생성됨:', data.sessionId);
                setState('currentChatId', data.sessionId);
            }
            break;

        default:
            debugLog('[WebSocket] 알 수 없는 메시지 타입:', data.type);
    }
}

/**
 * 연결 상태 UI 업데이트
 * @param {string} status - 상태 (connected, disconnected, error)
 * @param {string} text - 표시할 텍스트
 */
function updateConnectionStatus(status, text) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;

    const dot = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');

    if (dot) {
        dot.className = 'status-dot';
        if (status === 'connected') dot.classList.add('online');
        else if (status === 'disconnected') dot.classList.add('offline');
        else if (status === 'error') dot.classList.add('error');
    }

    if (textEl) {
        textEl.textContent = text;
    }
}

/**
 * 연결 상태 확인
 */
function isConnected() {
    const ws = getState('ws');
    return ws && ws.readyState === WebSocket.OPEN;
}

/**
 * 네트워크 복구 시 즉시 재연결
 */
window.addEventListener('online', () => {
    debugLog('[WebSocket] 네트워크 복구 — 즉시 재연결');
    reconnectAttempts = 0;
    if (!isConnected()) {
        connectWebSocket();
    }
});

/**
 * 네트워크 끊김 감지
 */
window.addEventListener('offline', () => {
    debugLog('[WebSocket] 네트워크 끊김 감지');
});

// 전역 노출 (레거시 호환)
window.connectWebSocket = connectWebSocket;
window.sendWsMessage = sendWsMessage;
window.handleMessage = handleMessage;
window.updateConnectionStatus = updateConnectionStatus;
window.isConnected = isConnected;

export {
    connectWebSocket,
    sendWsMessage,
    handleMessage,
    updateConnectionStatus,
    isConnected
};
