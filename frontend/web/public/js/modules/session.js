/**
 * ============================================
 * Session Management - 채팅 세션 관리
 * ============================================
 * 채팅 세션의 생성, 로드, 삭제, 히스토리 관리를 담당합니다.
 * 서버의 /api/chat/sessions 엔드포인트와 통신합니다.
 *
 * app.js에서 추출됨 (L2524-2904)
 *
 * @module session
 */

import { getState, setState, addToMemory, clearMemory } from './state.js';
import { escapeHtml, scrollToBottom, showToast } from './ui.js';
import { addChatMessage } from './chat.js';
import { clearAttachments } from './file-upload.js';

/**
 * 익명 사용자용 세션 ID를 생성 또는 반환
 * sessionStorage에 저장되어 브라우저 탭 단위로 유지됩니다.
 * @returns {string} 익명 세션 ID
 */
function getOrCreateAnonymousSessionId() {
    let anonSessionId = sessionStorage.getItem('anonSessionId');
    if (!anonSessionId) {
        anonSessionId = 'anon-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        sessionStorage.setItem('anonSessionId', anonSessionId);
        console.log('[Auth] 새 익명 세션 ID 생성:', anonSessionId);
    }
    return anonSessionId;
}

/**
 * 사이드바에 채팅 세션 목록을 로드하여 렌더링
 * @async
 * @returns {Promise<void>}
 */
async function loadChatSessions() {
    const historyList = document.getElementById('recentChats');
    if (!historyList) return;

    try {
        const authToken = localStorage.getItem('authToken');
        const userRole = JSON.parse(localStorage.getItem('user') || '{}').role;
        const isAdminUser = userRole === 'admin' || userRole === 'administrator';

        const params = new URLSearchParams({ limit: '20' });

        if (!authToken) {
            params.append('anonSessionId', getOrCreateAnonymousSessionId());
        }

        const viewAllCheckbox = document.getElementById('viewAllSessions');
        if (isAdminUser && viewAllCheckbox?.checked) {
            params.append('viewAll', 'true');
        }

        const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};

        const res = await fetch(`/api/chat/sessions?${params}`, { headers });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();

        const currentSessionId = getState('currentSessionId');
        const payload = data.data || data;
        if (data.success && payload.sessions && payload.sessions.length > 0) {
            historyList.innerHTML = payload.sessions.map(session => `
                <div class="history-item ${session.id === currentSessionId ? 'active' : ''}" 
                     data-session-id="${session.id}"
                     onclick="loadSession('${session.id}')"
                     title="${escapeHtml(session.title || '새 대화')}">
                    <span class="history-title">${escapeHtml((session.title || '새 대화').substring(0, 25))}${(session.title?.length > 25) ? '...' : ''}</span>
                    <span class="history-meta">${formatTimeAgo(session.updatedAt || session.createdAt)}</span>
                    <button class="history-delete" onclick="event.stopPropagation(); deleteSession('${session.id}')" title="삭제">✕</button>
                </div>
            `).join('');
        } else {
            historyList.innerHTML = '<div class="history-empty">대화 기록이 없습니다</div>';
        }
    } catch (error) {
        console.error('[ChatHistory] 세션 로드 실패:', error);
        historyList.innerHTML = '<div class="history-empty">로드 실패</div>';
    }
}

/**
 * 날짜 문자열을 상대 시간 텍스트로 변환
 * @param {string} dateStr - ISO 날짜 문자열
 * @returns {string} 상대 시간 (예: '방금', '5분 전')
 */
function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return date.toLocaleDateString('ko-KR');
}

/**
 * 새 채팅 세션을 서버에 생성
 * @async
 * @param {string} title - 세션 제목
 * @returns {Promise<Object|null>} 생성된 세션 객체 또는 null
 */
async function createNewSession(title) {
    try {
        const model = document.getElementById('modelSelect')?.value || 'default';
        const authToken = localStorage.getItem('authToken');
        const anonSessionId = !authToken ? getOrCreateAnonymousSessionId() : undefined;

        const headers = {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
        };

        const res = await fetch('/api/chat/sessions', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({ title, model, anonSessionId })
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        const payload = data.data || data;
        if (data.success) {
            setState('currentSessionId', payload.session.id);
            loadChatSessions();
            return payload.session;
        }
    } catch (error) {
        console.error('[ChatHistory] 세션 생성 실패:', error);
    }
    return null;
}

/**
 * 특정 세션의 대화 내역을 서버에서 로드하여 채팅 영역에 복원
 * @async
 * @param {string} sessionId - 로드할 세션 ID
 * @returns {Promise<void>}
 */
async function loadSession(sessionId) {
    // 다른 페이지에 있으면 먼저 채팅 뷰로 전환
    if (window.Router && window.location.pathname !== '/') {
        window.Router.navigate('/');
    }

    try {
        const res = await fetch(`/api/chat/sessions/${sessionId}/messages`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();

        const payload = data.data || data;
        if (data.success) {
            setState('currentSessionId', sessionId);

            // 채팅 영역 초기화
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = '';
            document.getElementById('welcomeScreen').style.display = 'none';

            // 메시지 복원
            setState('conversationMemory', []);
            payload.messages.forEach(msg => {
                if (msg.role === 'assistant') {
                    addRestoredAssistantMessage(msg.content);
                } else {
                    addChatMessage(msg.role, msg.content);
                }
                addToMemory(msg.role, msg.content);
            });

            // 활성 상태 업데이트
            document.querySelectorAll('.history-item').forEach(item => {
                item.classList.toggle('active', item.dataset.sessionId === sessionId);
            });

            scrollToBottom();
            showToast('💬 대화를 불러왔습니다', 'success');
        }
    } catch (error) {
        console.error('[ChatHistory] 세션 로드 실패:', error);
        showToast('대화를 불러올 수 없습니다', 'error');
    }
}

/**
 * 세션 복원 시 AI 응답 메시지를 마크다운 렌더링하여 추가
 * @param {string} content - AI 응답 원문 (마크다운)
 * @returns {HTMLElement} 생성된 메시지 DOM 요소
 */
function addRestoredAssistantMessage(content) {
    const container = document.getElementById('chatMessages');
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const div = document.createElement('div');
    div.className = 'chat-message assistant';
    div.id = messageId;

    // 마크다운 렌더링
    let renderedContent = content;
    if (typeof marked !== 'undefined') {
        try {
            renderedContent = window.purifyHTML(marked.parse(content));
        } catch (e) {
            console.warn('마크다운 파싱 실패:', e);
            renderedContent = content.replace(/\n/g, '<br>');
        }
    }

    div.innerHTML = `
        <div class="message-avatar">✨</div>
        <div class="message-wrapper">
            <div class="message-content">${renderedContent}</div>
            <div class="message-actions">
                <button class="message-action-btn" onclick="copyMessage('${messageId}')" title="복사">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    복사
                </button>
            </div>
            <div class="message-time">${timestamp} · 저장됨</div>
        </div>
    `;

    container.appendChild(div);

    // 코드 하이라이팅 적용
    if (typeof hljs !== 'undefined') {
        div.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    return div;
}

/**
 * 메시지를 현재 세션에 서버 저장
 * @async
 * @param {'user'|'assistant'} role - 메시지 발화자 역할
 * @param {string} content - 메시지 내용
 * @param {Object} [options={}] - 추가 옵션
 * @returns {Promise<void>}
 */
async function saveMessageToSession(role, content, options = {}) {
    let currentSessionId = getState('currentSessionId');
    if (!currentSessionId) {
        const title = content.substring(0, 50);
        await createNewSession(title);
        currentSessionId = getState('currentSessionId');
    }

    if (currentSessionId) {
        try {
            await fetch(`/api/chat/sessions/${currentSessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role, content, ...options })
            });
        } catch (error) {
            console.error('[ChatHistory] 메시지 저장 실패:', error);
        }
    }
}

/**
 * 채팅 세션을 서버에서 삭제
 * @async
 * @param {string} sessionId - 삭제할 세션 ID
 * @returns {Promise<void>}
 */
async function deleteSession(sessionId) {
    if (!confirm('이 대화를 삭제하시겠습니까?')) return;

    try {
        const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();

        if (data.success) {
            if (getState('currentSessionId') === sessionId) {
                newChat();
            }
            loadChatSessions();
            showToast('🗑️ 대화가 삭제되었습니다', 'info');
        }
    } catch (error) {
        console.error('[ChatHistory] 세션 삭제 실패:', error);
        showToast('삭제 실패', 'error');
    }
}

/**
 * 사용자 메시지를 서버 세션에 저장 (하위 호환 래퍼)
 * @param {string} message - 사용자 메시지
 * @returns {void}
 */
function addToChatHistory(message) {
    saveMessageToSession('user', message);
}

/**
 * 새 대화 시작 - 채팅 영역 초기화
 * @returns {void}
 */
function newChat() {
    // 다른 페이지에 있으면 먼저 채팅 뷰로 전환
    if (window.Router && window.location.pathname !== '/') {
        window.Router.navigate('/');
    }

    setState('currentSessionId', null);
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) chatMessages.innerHTML = '';
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'flex';
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.value = '';

    clearAttachments();
    clearMemory();

    // 활성 상태 해제
    document.querySelectorAll('.history-item').forEach(item => {
        item.classList.remove('active');
    });
}

// 전역 노출 (레거시 호환)
window.getOrCreateAnonymousSessionId = getOrCreateAnonymousSessionId;
window.loadChatSessions = loadChatSessions;
window.formatTimeAgo = formatTimeAgo;
window.createNewSession = createNewSession;
window.loadSession = loadSession;
window.loadConversation = loadSession;
window.addRestoredAssistantMessage = addRestoredAssistantMessage;
window.saveMessageToSession = saveMessageToSession;
window.deleteSession = deleteSession;
window.addToChatHistory = addToChatHistory;
window.newChat = newChat;

export {
    getOrCreateAnonymousSessionId,
    loadChatSessions,
    formatTimeAgo,
    createNewSession,
    loadSession,
    addRestoredAssistantMessage,
    saveMessageToSession,
    deleteSession,
    addToChatHistory,
    newChat
};
