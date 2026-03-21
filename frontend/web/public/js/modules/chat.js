/**
 * ============================================
 * Chat Module - 채팅 메시지 전송 및 오케스트레이션
 * ============================================
 * WebSocket 기반 실시간 채팅 메시지 전송, 응답 중단(abort),
 * 전송 버튼 상태 관리를 담당합니다.
 * DOM 렌더링은 chat-renderer.js, 사용자 액션은 chat-actions.js에 위임합니다.
 *
 * @module chat
 */

import { getState, setState, addToMemory } from './state.js';
import { sendWsMessage } from './websocket.js';
import { DEFAULT_AUTO_MODEL, STORAGE_KEY_GENERAL_SETTINGS, STORAGE_KEY_SELECTED_MODEL, STORAGE_KEY_USER } from './constants.js';

// 하위 모듈 import
import { addChatMessage, appendToken, appendThinkingToken, finishAssistantMessage, setHideAbortButton } from './chat-renderer.js';
import { copyMessage, regenerateMessage, sendFeedback, newChat, useSuggestion, setSendMessage } from './chat-actions.js';

// SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
const SS = window.SafeStorage;

// 전송 버튼의 원본 SVG (abort 모드 해제 시 복원용)
const SEND_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z"/></svg>`;
const ABORT_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

/** 스크린 리더용 상태 공지 (P1-14 접근성) */
function announceA11y(message) {
    const el = document.getElementById('a11y-announcer');
    if (!el) return;
    // 동일 메시지 반복 시에도 aria-live 트리거 되도록 빈 값 후 설정
    el.textContent = '';
    requestAnimationFrame(() => { el.textContent = message; });
}

/**
 * AI 응답 생성 중단 요청
 * WebSocket을 통해 서버에 abort 메시지를 전송하고 UI를 업데이트합니다.
 * @returns {void}
 */
function abortChat() {
    if (!getState('isGenerating')) return;

    console.log('[Chat] 응답 생성 중단 요청');
    sendWsMessage({ type: 'abort' });

    setState('isGenerating', false);
    hideAbortButton();
}

/**
 * 전송 버튼을 중단 모드로 전환
 * 전송 버튼의 스타일과 동작을 abort 모드로 변경합니다.
 * @returns {void}
 */
function showAbortButton() {
    const sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) return;

    sendBtn.classList.add('abort-mode');
    sendBtn.innerHTML = ABORT_ICON_SVG;
    sendBtn.title = '응답 생성 중단';
    announceA11y('AI가 응답을 생성하고 있습니다.');
}

/**
 * 전송 버튼을 원래 상태로 복원
 * @returns {void}
 */
function hideAbortButton() {
    const sendBtn = document.getElementById('sendBtn');
    if (!sendBtn) return;

    sendBtn.classList.remove('abort-mode');
    sendBtn.innerHTML = SEND_ICON_SVG;
    sendBtn.title = '전송 (Enter)';
    announceA11y('AI 응답이 완료되었습니다.');
}

/**
 * 사용자 메시지 전송
 * 입력창 내용과 첨부 파일을 WebSocket을 통해 서버에 전송합니다.
 * 모델 선택, 웹 검색, 사고 모드, 문서 컨텍스트 등 옵션을 포함합니다.
 * @returns {Promise<void>}
 */
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    const attachedFiles = getState('attachedFiles');

    // 중복 전송 방지
    if (getState('isSending')) return;
    if (!message && attachedFiles.length === 0) return;

    setState('isSending', true);

    // 환영 화면 숨기기
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) {
        welcomeScreen.style.display = 'none';
    }

    // 사용자 메시지 추가
    addChatMessage('user', message);
    // saveHistory 설정이 활성화된 경우에만 메모리에 저장
    const generalSettingsForHistory = JSON.parse(SS.getItem(STORAGE_KEY_GENERAL_SETTINGS) || '{}');
    if (generalSettingsForHistory.saveHistory !== false) {
        addToMemory('user', message);
    }

    // 입력창 초기화
    input.value = '';
    input.style.height = 'auto';

    // AI 응답 메시지 생성
    const assistantDiv = addChatMessage('assistant', '');
    setState('currentAssistantMessage', assistantDiv);
    setState('currentAssistantMessageContent', assistantDiv.querySelector('.message-content'));
    setState('messageStartTime', Date.now());
    setState('isGenerating', true);

    // 중단 버튼 표시
    showAbortButton();

    try {
        // WebSocket으로 메시지 전송
        const payload = {
            type: 'chat',
            message: message,
            model: document.getElementById('modelSelect')?.value || SS.getItem(STORAGE_KEY_SELECTED_MODEL) || DEFAULT_AUTO_MODEL,
            history: getState('conversationMemory'),
            webSearch: getState('webSearchEnabled') || (getState('mcpToolsEnabled') || {}).web_search === true,
            thinkingMode: getState('thinkingEnabled'),
            thinkingLevel: getState('thinkingLevel') || 'high',
            discussionMode: getState('discussionMode') || false,
            deepResearchMode: getState('deepResearchMode') || false,
            enabledTools: getState('mcpToolsEnabled') || {},
            sessionId: getState('currentChatId') // 세션 ID 포함
        };

        // 사용자 언어 설정을 WebSocket 메시지에 포함
        const generalSettings = JSON.parse(SS.getItem(STORAGE_KEY_GENERAL_SETTINGS) || '{}');
        if (generalSettings.lang) {
            payload.language = generalSettings.lang;
        }

        // 파일이 첨부된 경우
        if (attachedFiles.length > 0) {
            payload.files = attachedFiles.map(f => ({
                id: f.docId || f.id,
                name: f.filename || f.name,
                type: f.type
            }));

            // 이미지 파일의 base64 데이터를 images 배열로 전달
            const imageBase64List = attachedFiles
                .filter(f => f.isImage && f.base64)
                .map(f => f.base64);
            if (imageBase64List.length > 0) {
                payload.images = imageBase64List;
            }
        }

        // 문서 컨텍스트가 있는 경우 (PDF + 이미지 모두)
        const docContext = getState('activeDocumentContext');
        if (docContext) {
            payload.docId = docContext.docId;
        }

        // 인증된 사용자 정보를 WebSocket 메시지에 포함
        const storedUser = SS.getItem(STORAGE_KEY_USER);
        const parsedUser = storedUser ? JSON.parse(storedUser) : {};
        if (parsedUser.userId || parsedUser.id) payload.userId = parsedUser.userId || parsedUser.id;
        if (parsedUser.role) payload.userRole = parsedUser.role;
        if (parsedUser.tier) payload.userTier = parsedUser.tier;

        sendWsMessage(payload);

    } catch (error) {
        console.error('[Chat] 전송 오류:', error);
        finishAssistantMessage('오류가 발생했습니다: ' + error.message);
    }

    setState('isSending', false);
}

// 하위 모듈에 콜백 주입 (순환 참조 방지)
setHideAbortButton(hideAbortButton);
setSendMessage(sendMessage);

// 전역 노출 (레거시 호환)
window.sendFeedback = sendFeedback;
window.sendMessage = sendMessage;
window.addChatMessage = addChatMessage;
window.appendToken = appendToken;
window.appendThinkingToken = appendThinkingToken;
window.finishAssistantMessage = finishAssistantMessage;
window.copyMessage = copyMessage;
window.regenerateMessage = regenerateMessage;
window.newChat = newChat;
window.useSuggestion = useSuggestion;
window.abortChat = abortChat;

export {
    sendMessage,
    addChatMessage,
    appendToken,
    appendThinkingToken,
    finishAssistantMessage,
    copyMessage,
    regenerateMessage,
    sendFeedback,
    newChat,
    useSuggestion,
    abortChat,
    hideAbortButton
};
