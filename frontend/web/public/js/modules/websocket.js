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
import { hideAbortButton } from './chat.js';
import { debugLog, debugWarn } from './utils.js';
import { showSystemToast } from './system-toast.js';
// 2026-05-26 Phase 1.D Artifacts
import {
    openArtifactPanel,
    appendArtifactChunk,
    finalizeArtifact,
    setArtifactSessionId,
    appendReasoningToken,
    setToolEntry,
} from '../components/artifact-panel.js';
import { insertArtifactCard } from '../components/artifact-card.js';

/**
 * 2026-05-26 Phase 3 — 분기된 세션 배너 표시.
 * session metadata 의 parentSessionId 가 있으면 채팅 상단에 "🔀 분기된 대화" 배너 + 부모로 이동 link.
 * GET /api/sessions/:sid/meta — backend 가 metadata jsonb 노출.
 */
async function checkAndRenderBranchBanner(sessionId) {
    if (!sessionId) return;
    try {
        const fetchFn = window.authFetch || fetch;
        const res = await fetchFn(`/api/sessions/${encodeURIComponent(sessionId)}/meta`);
        const data = await (res.json ? res.json() : Promise.resolve(res));
        const meta = (data && data.data && data.data.metadata) || (data && data.metadata) || null;
        // 기존 배너 제거 (새 session 진입 시)
        const old = document.querySelector('.branch-banner');
        if (old) old.remove();
        if (!meta || !meta.parentSessionId) return;
        const mainEl = document.getElementById('chatMessages')?.parentElement
            || document.getElementById('chatMessages');
        if (!mainEl) return;
        const banner = document.createElement('div');
        banner.className = 'branch-banner';
        banner.innerHTML = `
            <iconify-icon icon="lucide:git-branch"></iconify-icon> <strong>분기된 대화</strong> — 사용자 메시지 편집으로 새로 시작됨
            <button class="branch-banner-back" data-parent="${meta.parentSessionId}">← 원본 대화로 돌아가기</button>
        `;
        mainEl.insertBefore(banner, mainEl.firstChild);
        banner.querySelector('.branch-banner-back').addEventListener('click', () => {
            // 부모 sessionId 로 router 이동 — chat.js 의 selectChat(id) 사용
            const pid = meta.parentSessionId;
            if (typeof window.selectChat === 'function') {
                window.selectChat(pid);
            } else {
                // fallback: 직접 history.pushState
                location.href = `/?session=${encodeURIComponent(pid)}`;
            }
        });
    } catch (e) {
        debugLog('[WebSocket] branch banner 조회 실패 (무시):', e);
    }
}

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
        } catch {
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
        
        // 🔒 Phase 3: P1-1 재연결 시 UI 상태 초기화 (전송/중단 버튼 복구)
        setState('isGenerating', false);
        setState('isSending', false);
        try {
            hideAbortButton();
        } catch {
            // DOM 접근 에러 무시
        }

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
 * WebSocket 메시지 타입별 처리 핸들러 맵
 */
const messageHandlers = {
    'init': (data) => {
        if (data.nodes) {
            setState('nodes', data.nodes);
            if (typeof updateClusterInfo === 'function') {
                updateClusterInfo(data);
            }
        }
    },
    'cluster_event': (data) => {
        if (typeof handleClusterEvent === 'function') {
            handleClusterEvent(data.event);
        }
    },
    'token': (data) => {
        if (typeof appendToken === 'function') {
            appendToken(data.token);
        }
    },
    'done': (data) => {
        // Phase 1.F.2 (2026-05-26): backend 가 artifact 추출로 본문을 정리한 경우,
        // 클라이언트의 raw token 누적 본문을 cleanedContent 로 reset.
        // [[artifact:id]] placeholder 는 시각 노이즈라 제거 — 카드는 별도 button 으로 이미 존재.
        //
        // 1.F.2 검증 중 버그 발견 (2026-05-26): chat-renderer 의 finishAssistantMessage 가
        // `dataset.rawText || textContent` falsy fallback 을 사용. cleaned 가 빈 문자열이면
        // 이미 token 으로 렌더된 textContent 가 fallback 되어 reset 이 무효. 두 가지 해결:
        //   (a) cleaned 가 비었으면 innerHTML 도 직접 clear
        //   (b) cleaned 가 비었으면 finishAssistantMessage 호출 자체 skip (innerHTML 보존도 안 함)
        // 본 patch 는 (a) — finishAssistantMessage 로직 자체는 건드리지 않고 표시만 정정.
        if (typeof data.cleanedContent === 'string') {
            try {
                const msgs = document.querySelectorAll('.message-content');
                const lastMsg = msgs[msgs.length - 1];
                if (lastMsg) {
                    const cleaned = data.cleanedContent.replace(/\[\[artifact:[^\]]+\]\]\s*/g, '');
                    lastMsg.dataset.rawText = cleaned;
                    if (cleaned.trim() === '') {
                        // artifact 본문만 있고 일반 텍스트가 없는 응답 — message-content 는 카드만 보이게 비움.
                        // 카드 button 자식들은 보존 (innerHTML reset 시 사라지지 않도록 분리 처리).
                        const cards = lastMsg.querySelectorAll('.artifact-card');
                        lastMsg.innerHTML = '';
                        cards.forEach(c => lastMsg.appendChild(c));
                    }
                }
            } catch (e) {
                console.warn('[WebSocket] cleanedContent 적용 실패:', e);
            }
        }
        if (typeof finishAssistantMessage === 'function') {
            finishAssistantMessage(null, data.messageId || null);
        }
    },
    'token_warning': () => {
        debugWarn('[WebSocket] 토큰 만료 임박, 자동 갱신 시도...');
        if (typeof window.trySilentRefresh === 'function') {
            window.trySilentRefresh().then((refreshed) => {
                if (refreshed) {
                    const newToken = getState('auth.authToken');
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
    },
    'error': (data) => {
        const errorMsg = data.message || data.error || '알 수 없는 오류가 발생했습니다';
        console.error('[Server] 오류:', errorMsg);
        if (typeof showError === 'function') {
            showError(errorMsg);
        }
        if (typeof finishAssistantMessage === 'function') {
            finishAssistantMessage(errorMsg);
        }
    },
    'aborted': () => {
        debugLog('[WebSocket] 응답 생성 중단됨');
        if (typeof finishAssistantMessage === 'function') {
            finishAssistantMessage('응답 생성이 중단되었습니다.');
        }
        if (typeof showToast === 'function') {
            showToast('응답 생성이 중단되었습니다.', 'info');
        }
    },
    // B+ Phase B4 후속: 에러 발생 시 백엔드가 본문을 디버그 큐에 자동 보존했음을 사용자에게 알림
    // saveHistory=false 환경에서도 운영자가 디버깅 가능하도록, 그러나 사용자에게는 명시적으로 통지
    'debug_retained': (data) => {
        const ttlHours = typeof data.ttlHours === 'number' ? data.ttlHours : 24;
        const expiresAt = data.expiresAt ? new Date(data.expiresAt).toLocaleString() : '';
        const message = `오류 재현용으로 본문이 임시 저장되었습니다 (${ttlHours}시간 후 자동 삭제${expiresAt ? `: ${expiresAt}` : ''}).`;
        debugLog('[WebSocket] debug_retained:', data.captureId, 'expires:', data.expiresAt);
        if (typeof showToast === 'function') {
            showToast(message, 'info');
        }
    },
    'agents': (data) => {
        if (data.agents && typeof renderAgentList === 'function') {
            renderAgentList(data.agents);
        }
    },
    'document_progress': (data) => {
        debugLog('[WebSocket] 문서 진행 이벤트 수신:', data.stage, data.message, data.progress);
        if (typeof showDocumentProgress === 'function') {
            showDocumentProgress(data);
        } else {
            debugWarn('[WebSocket] showDocumentProgress 함수를 찾을 수 없음');
        }
    },
    'session_created': (data) => {
        if (data.sessionId) {
            debugLog('[WebSocket] 세션 생성됨:', data.sessionId);
            setState('currentChatId', data.sessionId);
            try { setArtifactSessionId(data.sessionId); } catch (_e) { /* noop */ }
            // 2026-05-26 Phase 3 future #1: 분기된 세션이면 배너 표시.
            // session metadata 조회 → parentSessionId 있으면 채팅 상단에 link.
            checkAndRenderBranchBanner(data.sessionId);
        }
    },
    'stats': (data) => {
        debugLog('[WebSocket] MCP 통계 수신:', data.stats);
    },
    'update': (data) => {
        if (data.data) {
            setState('nodes', data.data.nodes);
            if (typeof updateClusterInfo === 'function') {
                updateClusterInfo(data.data);
            }
        }
    },
    'agent_selected': (data) => {
        debugLog('[WebSocket] 에이전트 선택:', data.agent);
        if (typeof showAgentBadge === 'function') {
            showAgentBadge(data.agent);
        }
    },
    'skills_activated': (data) => {
        debugLog('[WebSocket] 스킬 활성화:', data.skillNames);
        setState('activeSkillNames', Array.isArray(data.skillNames) ? data.skillNames : []);
    },
    'discussion_progress': (data) => {
        debugLog('[WebSocket] 토론 진행:', data.progress);
        if (typeof showDiscussionProgress === 'function') {
            showDiscussionProgress(data.progress);
        }
    },
    'research_progress': (data) => {
        debugLog('[WebSocket] 리서치 진행:', data.progress);
        if (typeof showResearchProgress === 'function') {
            showResearchProgress(data.progress);
        }
    },
    'agent_task_progress': (data) => {
        // 에이전트 작업 진행 — agent-tasks 페이지가 등록한 핸들러로 전달 (순수 overlay)
        if (typeof window.onAgentTaskProgress === 'function') {
            window.onAgentTaskProgress(data);
        }
    },
    'thinking': (data) => {
        if (typeof appendThinkingToken === 'function') {
            appendThinkingToken(data.token);
        }
        // 우측 컨텍스트 패널 '추론' 탭으로 미러 (인라인 렌더는 그대로)
        try { appendReasoningToken(data.token); } catch (e) { /* 패널 미초기화 무시 */ }
    },
    /**
     * MCP tool 호출 결과의 resource content — 인라인 카드 렌더링.
     * 현재 지원하는 resource URI prefix:
     *   - openmake://skill-draft/{id}       → skill-draft-card 컴포넌트 (Phase 1.5/2.5)
     *   - openmake://agent-draft/{id}       → agent-draft-card 컴포넌트 (Phase 3.5)
     *   - openmake://mcp-server-draft/{id}  → mcp-server-draft-card 컴포넌트 (Phase 4.5)
     * 다른 prefix 는 무시 (확장 시 분기 추가).
     *
     * Payload: { type: 'mcp_tool_result', toolName, resources: [{ uri, mimeType?, text? }], messageId }
     */
    'mcp_tool_result': async (data) => {
        if (!Array.isArray(data?.resources) || data.resources.length === 0) return;
        // 우측 컨텍스트 패널 '도구' 탭으로 미러 (인라인 카드 렌더는 그대로)
        try { setToolEntry(data.toolName, data.resources.map((r) => r && r.uri).filter(Boolean).join('\n')); } catch (e) { /* noop */ }
        for (const res of data.resources) {
            const uri = res && res.uri;
            if (typeof uri !== 'string') continue;

            const isSkillDraft = uri.startsWith('openmake://skill-draft/');
            const isAgentDraft = uri.startsWith('openmake://agent-draft/');
            const isMcpServerDraft = uri.startsWith('openmake://mcp-server-draft/');
            if (!isSkillDraft && !isAgentDraft && !isMcpServerDraft) continue;

            try {
                const payload = JSON.parse(res.text || '{}');
                const previewCard = payload.previewCard;
                if (!previewCard) continue;

                let card;
                if (isSkillDraft && previewCard.kind === 'skill-draft') {
                    const { renderSkillDraftCard, handleSkillDraftAction } = await import('/js/components/skill-draft-card.js?v=1');
                    card = renderSkillDraftCard(previewCard, {
                        mode: 'inline',
                        onAction: (action, skillId) => handleSkillDraftAction(action, skillId, {
                            onToast: (msg, type) => window.showToast && window.showToast(msg, type),
                        }),
                    });
                } else if (isAgentDraft && previewCard.kind === 'agent-draft') {
                    const { renderAgentDraftCard, handleAgentDraftAction } = await import('/js/components/agent-draft-card.js?v=1');
                    card = renderAgentDraftCard(previewCard, {
                        mode: 'inline',
                        onAction: (action, agentId) => handleAgentDraftAction(action, agentId, {
                            onToast: (msg, type) => window.showToast && window.showToast(msg, type),
                        }),
                    });
                } else if (isMcpServerDraft && previewCard.kind === 'mcp-server-draft') {
                    const { renderMcpServerDraftCard, handleMcpServerDraftAction } = await import('/js/components/mcp-server-draft-card.js?v=1');
                    card = renderMcpServerDraftCard(previewCard, {
                        mode: 'inline',
                        onAction: (action, serverId, ctx) => {
                            // 채팅 인라인에서는 envOverrides UI 가 어려움 — required_env 있으면 mcp-servers 페이지로 안내
                            const augCtx = Object.assign({}, ctx);
                            if (action === 'approve' && Array.isArray(ctx.requiredEnv) && ctx.requiredEnv.length > 0) {
                                const overrides = {};
                                for (const key of ctx.requiredEnv) {
                                    const cur = (ctx.draft.env || {})[key];
                                    if (cur && !/^\$\{.+\}$/.test(String(cur))) continue;
                                    const v = window.prompt(`required_env: ${key}\n실제 값을 입력하세요 (취소하면 승인 중단)`, '');
                                    if (v == null) return;
                                    if (v) overrides[key] = v;
                                }
                                augCtx.envOverrides = overrides;
                            }
                            handleMcpServerDraftAction(action, serverId, augCtx, {
                                onToast: (msg, type) => window.showToast && window.showToast(msg, type),
                            });
                        },
                    });
                } else {
                    continue;
                }

                // 현재 assistant 메시지 컨테이너에 추가 (state.currentAssistantMessage)
                const assistantEl = (typeof getState === 'function') ? getState('currentAssistantMessage') : null;
                const target = assistantEl?.querySelector?.('.message-content') || assistantEl;
                if (target) {
                    target.appendChild(card);
                } else {
                    // fallback — chat 영역의 마지막 메시지 끝에 붙임
                    const last = document.querySelector('.chat-messages .message.assistant:last-child .message-content')
                        || document.querySelector('.chat-messages .message.assistant:last-child');
                    if (last) last.appendChild(card);
                }
                if (payload.assistantText) {
                    const p = document.createElement('p');
                    p.className = 'skill-draft-card__assistant-text';
                    p.textContent = payload.assistantText;
                    (target || card.parentNode)?.appendChild(p);
                }
            } catch (e) {
                console.warn('[WS mcp_tool_result] draft resource 처리 실패:', e);
            }
        }
    },
    /**
     * 시스템 이벤트 (백엔드 onSystemEvent 콜백)
     * 형식: { type: 'system_event', payload: { type, message, metadata? } }
     * 자동 토론 활성화 등 메타 알림을 우측 상단 토스트로 표시.
     */
    'system_event': (data) => {
        const payload = data && data.payload;
        if (!payload || typeof payload !== 'object') {
            debugWarn('[WebSocket] system_event payload 누락');
            return;
        }
        debugLog('[WebSocket] 시스템 이벤트:', payload.type, payload.message);
        try {
            showSystemToast(payload);
        } catch (e) {
            console.error('[WebSocket] showSystemToast 호출 실패:', e);
        }
    },

    /**
     * Artifacts (2026-05-26 Phase 1.D) — LLM 응답의 <artifact> 블록.
     * Server: ArtifactStreamParser 가 incremental 분리 → 3종 이벤트 dispatch.
     * Client: 우측 패널 슬라이드 + 인라인 카드 + 본문 streaming.
     */
    'artifact_start': (data) => {
        const info = data.artifact;
        if (!info || !info.id) return;
        try {
            openArtifactPanel(info);
            // 우선순위: state → 가장 마지막 .message-content (fallback).
            // ws-handler 의 result.artifacts 발행은 done 직전 — token 종료 후 state 가 stale
            // 일 수 있어 마지막 메시지 컨테이너를 직접 찾는 안전망 추가.
            let container = getState('currentAssistantMessageContent');
            if (!container) {
                const all = document.querySelectorAll('.message-content');
                container = all[all.length - 1] || null;
            }
            if (container) insertArtifactCard(container, info);
        } catch (e) {
            console.error('[WebSocket] artifact_start 처리 실패:', e);
        }
    },
    'artifact_chunk': (data) => {
        if (!data.id) return;
        try { appendArtifactChunk(data.id, data.delta || ''); } catch (e) {
            console.error('[WebSocket] artifact_chunk 처리 실패:', e);
        }
    },
    'artifact_end': (data) => {
        if (!data.id) return;
        try { finalizeArtifact(data.id); } catch (e) {
            console.error('[WebSocket] artifact_end 처리 실패:', e);
        }
    },
};

/**
 * WebSocket 수신 메시지 핸들러
 * 메시지 타입에 따라 적절한 처리 함수를 호출합니다.
 * @param {Object} data - 파싱된 수신 메시지 객체
 */
function handleMessage(data) {
    const handler = messageHandlers[data.type];
    if (handler) {
        handler(data);
    } else {
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
