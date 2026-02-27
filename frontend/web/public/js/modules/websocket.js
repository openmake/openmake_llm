/**
 * ============================================
 * WebSocket Module - 실시간 서버 통신 관리
 * ============================================
 * 서버와의 WebSocket 연결 수립, 자동 재연결(지수 백오프),
 * 시스템 메시지 핸들링(클러스터 이벤트, 에이전트 목록, 세션 생성 등),
 * 네트워크 복구 감지를 담당합니다.
 *
 * @module websocket
 */

import { getState, setState } from './state.js';
import { debugLog, debugWarn } from './utils.js';

/** @type {number} 현재 재연결 시도 횟수 */
let reconnectAttempts = 0;
/** @type {number} 최대 재연결 시도 횟수 */
const MAX_RECONNECT_ATTEMPTS = 10;
/** @type {number} 초기 재연결 대기 시간 (ms), 지수 백오프 적용 */
const INITIAL_RECONNECT_DELAY = 1000;

/**
 * WebSocket 연결 수립
 * 기존 연결이 있으면 먼저 정리(좀비 연결 방지)한 후 새 연결을 생성합니다.
 * 연결 성공 시 초기 데이터(refresh, agents)를 요청합니다.
 * 연결 종료 시 지수 백오프로 자동 재연결을 시도합니다.
 * @returns {WebSocket} 생성된 WebSocket 인스턴스
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

    // System Messages WebSocket (websocket.js)
    // Handles: agents list, refresh, heartbeat, connection status.
    // Chat streaming is handled by a separate WS in app.js.
    const ws = new WebSocket(wsUrl);
    setState('ws', ws);

    ws.onopen = () => {
        debugLog('[WebSocket] 연결됨');
        reconnectAttempts = 0;
        updateConnectionStatus('connected', '연결됨');

        // 초기 데이터 요청
        sendWsMessage({ type: 'refresh' });
        sendWsMessage({ type: 'request_agents' });
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
 * 연결이 OPEN 상태일 때만 전송하며, 실패 시 경고 로그를 출력합니다.
 * @param {Object} data - JSON 직렬화 가능한 전송 데이터
 * @returns {boolean} 전송 성공 여부
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
 * WebSocket 수신 메시지 핸들러
 * 메시지 타입에 따라 적절한 처리 함수를 호출합니다.
 * 지원 타입: init, stats, update, cluster_event, token, done, error, aborted, agents,
 *            agent_selected, discussion_progress, research_progress,
 *            progress, session_created
 * @param {Object} data - 파싱된 수신 메시지 객체
 * @param {string} data.type - 메시지 타입 식별자
 * @returns {void}
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
                finishAssistantMessage(null, data.messageId || null);
            }
            break;

        case 'token_warning':
            // 토큰 만료 임박 경고 — 자동 갱신 시도 (진행 중인 AI 응답에 영향 없음)
            debugWarn('[WebSocket] 토큰 만료 임박, 자동 갱신 시도...');
            if (typeof window.trySilentRefresh === 'function') {
                window.trySilentRefresh().then(function(refreshed) {
                    if (refreshed) {
                        var newToken = getState('auth.authToken');
                        if (newToken) {
                            sendWsMessage({ type: 'refresh', authToken: newToken });
                            debugLog('[WebSocket] 토큰 자동 갱신 성공, WebSocket 세션 갱신 완료');
                        }
                    } else {
                        debugWarn('[WebSocket] 토큰 자동 갱신 실패 — 곧 재로그인이 필요합니다');
                        if (typeof showToast === 'function') {
                            showToast('인증이 곧 만료됩니다. 페이지를 새로고침하거나 다시 로그인하세요.', 'warning');
                        }
                    }
                });
            }
            break;

        case 'error': {
            // 백엔드는 대부분 data.message로 에러를 전송하고, 레이트 리밋만 data.error 사용
            var errorMsg = data.message || data.error || '알 수 없는 오류가 발생했습니다';
            console.error('[Server] 오류:', errorMsg);
            if (typeof showError === 'function') {
                showError(errorMsg);
            }
            // 진행 중인 AI 응답이 있으면 에러 메시지로 종료 (UI 고착 방지)
            if (typeof finishAssistantMessage === 'function') {
                finishAssistantMessage(errorMsg);
            }
            break;
        }

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

        case 'stats':
            debugLog('[WebSocket] MCP 통계 수신:', data.stats);
            break;

        case 'update':
            if (data.data) {
                setState('nodes', data.data.nodes);
                if (typeof updateClusterInfo === 'function') {
                    updateClusterInfo(data.data);
                }
            }
            break;


        case 'agent_selected':
            debugLog('[WebSocket] 에이전트 선택:', data.agent);
            if (typeof showAgentBadge === 'function') {
                showAgentBadge(data.agent);
            }
            break;

        case 'skills_activated':
            debugLog('[WebSocket] 스킬 활성화:', data.skillNames);
            setState('activeSkillNames', Array.isArray(data.skillNames) ? data.skillNames : []);
            break;

        case 'rag_sources':
            debugLog('[WebSocket] RAG 출처 수신:', data.sources);
            setState('ragSources', Array.isArray(data.sources) ? data.sources : null);
            break;

        case 'discussion_progress':
            debugLog('[WebSocket] 토론 진행:', data.progress);
            if (typeof showDiscussionProgress === 'function') {
                showDiscussionProgress(data.progress);
            }
            break;

        case 'research_progress':
            debugLog('[WebSocket] 리서치 진행:', data.progress);
            if (typeof showResearchProgress === 'function') {
                showResearchProgress(data.progress);
            }
            break;

        default:
            debugLog('[WebSocket] 알 수 없는 메시지 타입:', data.type);
    }
}

/**
 * 연결 상태 UI 업데이트
 * 상태 표시 요소(status-dot, status-text)의 클래스와 텍스트를 변경합니다.
 * @param {string} status - 연결 상태 ('connected' | 'disconnected' | 'error')
 * @param {string} text - 사용자에게 표시할 상태 텍스트
 * @returns {void}
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
 * 현재 WebSocket 연결 상태 확인
 * @returns {boolean} WebSocket이 OPEN 상태인지 여부
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
window['sendWsMessage'] = sendWsMessage;
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
