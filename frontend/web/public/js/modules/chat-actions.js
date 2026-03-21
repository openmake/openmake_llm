/**
 * ============================================
 * Chat Actions Module - 사용자 액션 처리
 * ============================================
 * 클립보드 복사, 재생성, 피드백 전송, 새 대화, 제안 사용 등
 * 사용자 인터랙션 관련 기능을 담당합니다.
 *
 * @module chat-actions
 */

import { getState, setState } from './state.js';
import { showToast } from './ui.js';
import { authFetch } from './auth.js';

/**
 * 메시지 내용을 클립보드에 복사
 * Clipboard API를 사용하며, 성공/실패 시 토스트 알림을 표시합니다.
 * @param {string} messageId - 복사할 메시지의 DOM ID
 * @returns {void}
 */
function copyMessage(messageId) {
    const msgElement = document.getElementById(messageId);
    if (!msgElement) return;

    const content = msgElement.querySelector('.message-content');
    if (!content) return;

    const text = content.innerText;
    navigator.clipboard.writeText(text).then(() => {
        showToast('클립보드에 복사됨', 'success');
    }).catch(err => {
        console.error('복사 실패:', err);
        showToast('복사 실패', 'error');
    });
}

/**
 * 마지막 사용자 메시지를 재전송하여 AI 응답 재생성
 * 대화 메모리에서 마지막 user 메시지를 찾아 입력창에 설정 후 전송합니다.
 * @returns {void}
 */
function regenerateMessage() {
    // ES Module 순환 참조 — sendMessage는 chat.js에서 가져옴
    const { sendMessage } = require_sendMessage();

    const memory = getState('conversationMemory');
    const lastUserContent = memory.filter(m => m.role === 'user').pop();

    if (lastUserContent) {
        // 마지막 AI 메시지에 대한 regenerate 피드백 전송
        var messages = document.querySelectorAll('.chat-message.assistant');
        var lastAssistant = messages[messages.length - 1];
        if (lastAssistant && lastAssistant.id) {
            sendFeedback(lastAssistant.id, 'regenerate');
        }

        const input = document.getElementById('chatInput');
        input.value = lastUserContent.content;
        sendMessage();
    }
}

// sendMessage 콜백 — chat.js에서 주입 (순환 참조 방지)
let _sendMessage = null;

/**
 * sendMessage 콜백을 외부에서 주입
 * @param {Function} fn - sendMessage 함수
 */
function setSendMessage(fn) {
    _sendMessage = fn;
}

function require_sendMessage() {
    return { sendMessage: _sendMessage };
}

/**
 * 사용자 피드백을 서버에 전송
 * @param {string} msgElementId - 메시지 DOM 요소 ID
 * @param {string} signal - 피드백 유형 ('thumbs_up' | 'thumbs_down' | 'regenerate')
 * @returns {void}
 */
function sendFeedback(msgElementId, signal) {
    var msgElement = document.getElementById(msgElementId);
    var serverMsgId = msgElement ? msgElement.dataset.serverMessageId : null;
    var sessionId = getState('currentChatId');

    // 시각적 피드백 — 선택된 버튼 활성화
    if (msgElement && signal !== 'regenerate') {
        var feedbackBtns = msgElement.querySelectorAll('.feedback-btn');
        feedbackBtns.forEach(function (btn) {
            btn.classList.remove('feedback-active');
        });
        var activeBtn = msgElement.querySelector('[data-feedback="' + signal + '"]');
        if (activeBtn) {
            activeBtn.classList.add('feedback-active');
        }
    }

    // 서버 전송 (fire-and-forget)
    authFetch(API_ENDPOINTS.CHAT_FEEDBACK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messageId: serverMsgId || msgElementId,
            sessionId: sessionId || 'anonymous',
            signal: signal
        })
    }).catch(function (err) {
        console.error('[Feedback] 전송 실패:', err);
    });
}

/**
 * 새 대화 시작
 * 채팅 메시지 영역을 초기화하고, 대화 메모리/세션/파일 컨텍스트를 리셋합니다.
 * 다른 페이지에 있으면 채팅 뷰(/)로 먼저 이동합니다.
 * @returns {void}
 */
function newChat() {
    // 다른 페이지에 있으면 먼저 채팅 뷰로 전환
    if (window.Router && window.location.pathname !== '/') {
        window.Router.navigate('/');
    }

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.innerHTML = '';
    }

    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'flex';
    }

    setState('conversationMemory', []);
    setState('currentChatId', null);
    setState('attachedFiles', []);
    setState('activeDocumentContext', null);

    // 새 대화 시작 시 활성 스킬 상태 초기화
    setState('activeSkillNames', null);

    // 입력창 초기화
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = '';
        input.style.height = 'auto';
    }
}

/**
 * 제안 텍스트를 입력창에 설정
 * 환영 화면의 제안 버튼 클릭 시 호출됩니다.
 * @param {string} text - 입력창에 설정할 제안 텍스트
 * @returns {void}
 */
function useSuggestion(text) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = text;
        input.focus();
    }
}

/**
 * 피드백 버튼 이벤트 위임 등록
 * 모듈 로드 시 자동으로 document에 click 이벤트 리스너를 등록합니다.
 */
function initFeedbackDelegation() {
    document.addEventListener('click', function (e) {
        var feedbackBtn = e.target.closest('.feedback-btn');
        if (!feedbackBtn) return;

        var signal = feedbackBtn.dataset.feedback;
        var msgId = feedbackBtn.dataset.msgId;
        if (signal && msgId) {
            sendFeedback(msgId, signal);
        }
    });
}

// 모듈 로드 시 이벤트 위임 등록
initFeedbackDelegation();

export {
    copyMessage,
    regenerateMessage,
    sendFeedback,
    newChat,
    useSuggestion,
    setSendMessage
};
