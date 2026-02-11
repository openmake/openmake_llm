/**
 * Chat Module
 * 채팅 기능을 담당합니다.
 */

import { getState, setState, addToMemory } from './state.js';
import { sendWsMessage } from './websocket.js';
import { scrollToBottom, escapeHtml, renderMarkdown, showToast } from './ui.js';
import { authFetch } from './auth.js';

/**
 * 응답 생성 중단
 */
function abortChat() {
    if (!getState('isGenerating')) return;
    
    console.log('[Chat] 응답 생성 중단 요청');
    sendWsMessage({ type: 'abort' });
    
    // UI 상태 업데이트
    setState('isGenerating', false);
    hideAbortButton();
}

/**
 * 중단 버튼 표시
 */
function showAbortButton() {
    let abortBtn = document.getElementById('abortButton');
    
    if (!abortBtn) {
        // 중단 버튼 생성
        const inputArea = document.querySelector('.input-area') || document.querySelector('.chat-input-container');
        if (inputArea) {
            abortBtn = document.createElement('button');
            abortBtn.id = 'abortButton';
            abortBtn.className = 'abort-button';
            abortBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                </svg>
                <span>중단</span>
            `;
            abortBtn.onclick = abortChat;
            abortBtn.title = '응답 생성 중단';
            
            // 전송 버튼 옆에 삽입
            const sendBtn = document.getElementById('sendButton');
            if (sendBtn) {
                sendBtn.parentNode.insertBefore(abortBtn, sendBtn);
            } else {
                inputArea.appendChild(abortBtn);
            }
        }
    }
    
    if (abortBtn) {
        abortBtn.style.display = 'flex';
    }
}

/**
 * 중단 버튼 숨기기
 */
function hideAbortButton() {
    const abortBtn = document.getElementById('abortButton');
    if (abortBtn) {
        abortBtn.style.display = 'none';
    }
}

/**
 * 메시지 전송
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
    addToMemory('user', message);

    // 입력창 초기화
    input.value = '';
    input.style.height = 'auto';

    // AI 응답 메시지 생성
    const assistantDiv = addChatMessage('assistant', '');
    setState('currentAssistantMessage', assistantDiv);
    setState('messageStartTime', Date.now());
    setState('isGenerating', true);
    
    // 중단 버튼 표시
    showAbortButton();

    try {
        // WebSocket으로 메시지 전송
        const payload = {
            type: 'chat',
            message: message,
            model: document.getElementById('modelSelect')?.value || localStorage.getItem('selectedModel') || 'default',
            memory: getState('conversationMemory'),
            webSearch: getState('webSearchEnabled'),
            thinking: getState('thinkingEnabled'),
            sessionId: getState('currentChatId') // 세션 ID 포함
        };

        // 파일이 첨부된 경우
        if (attachedFiles.length > 0) {
            payload.files = attachedFiles.map(f => ({
                id: f.id,
                name: f.name,
                type: f.type
            }));
        }

        // 문서 컨텍스트가 있는 경우
        const docContext = getState('activeDocumentContext');
        if (docContext) {
            payload.documentId = docContext.docId;
        }

        // 🔐 인증된 사용자 정보를 WebSocket 메시지에 포함
        const storedUser = localStorage.getItem('user');
        const parsedUser = storedUser ? JSON.parse(storedUser) : {};
        if (parsedUser.userId || parsedUser.id) payload.userId = parsedUser.userId || parsedUser.id;
        if (parsedUser.role) payload.userRole = parsedUser.role;
        if (parsedUser.tier) payload.userTier = parsedUser.tier;

        sendWsMessage(payload);

    } catch (error) {
        console.error('[Chat] 전송 오류:', error);
        finishAssistantMessage('오류가 발생했습니다: ' + error.message);
        setState('isGenerating', false);
        hideAbortButton();
    }

    setState('isSending', false);
}

/**
 * 채팅 메시지 추가
 * @param {string} role - 역할 (user, assistant)
 * @param {string} content - 내용
 */
function addChatMessage(role, content) {
    const container = document.getElementById('chatMessages');
    if (!container) return null;

    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    const messageId = `msg-${Date.now()}`;

    const div = document.createElement('div');
    div.className = `chat-message ${role}`;
    div.id = messageId;

    if (role === 'user') {
        div.innerHTML = `
            <div class="message-wrapper">
                <div class="message-content">${escapeHtml(content).replace(/\n/g, '<br>')}</div>
                <div class="message-time">${timestamp}</div>
            </div>
            <div class="message-avatar">👤</div>
        `;
    } else {
        div.innerHTML = `
            <div class="message-avatar">✨</div>
            <div class="message-wrapper">
                <div class="message-content">${content || '<span class="loading-spinner"></span> 생각 중...'}</div>
                <div class="message-actions">
                    <button class="message-action-btn" onclick="copyMessage('${messageId}')" title="복사">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        복사
                    </button>
                    <button class="message-action-btn" onclick="regenerateMessage()" title="재생성">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 4v6h6"/><path d="M23 20v-6h-6"/>
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
                        </svg>
                        재생성
                    </button>
                </div>
                <div class="message-time" id="${messageId}-time">${timestamp}</div>
            </div>
        `;
    }

    container.appendChild(div);
    scrollToBottom();

    return div;
}

/**
 * 토큰 추가 (스트리밍)
 * @param {string} token - 토큰
 */
function appendToken(token) {
    const currentMsg = getState('currentAssistantMessage');
    if (!currentMsg) return;

    const content = currentMsg.querySelector('.message-content');
    if (!content) return;

    // 로딩 스피너 제거
    const spinner = content.querySelector('.loading-spinner');
    if (spinner) spinner.remove();

    // 원본 텍스트 저장
    if (!content.dataset.rawText) content.dataset.rawText = '';
    content.dataset.rawText += token;

    const fullText = content.dataset.rawText;

    // 단계 패턴 감지
    const stepPattern = /\[(\d+)\/(\d+)\]/g;
    const matches = [...fullText.matchAll(stepPattern)];

    // 마지막 단계 찾기
    let finalStepIndex = -1;
    if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const lastStepNum = parseInt(lastMatch[1]);
        const totalSteps = parseInt(lastMatch[2]);

        if (lastStepNum === totalSteps) {
            finalStepIndex = fullText.lastIndexOf(lastMatch[0]);
        }
    }

    // 최종 답변 마커 확인
    const finalAnswerMarkers = ['## 최종 답변', '## 답변', '## 결론', '## 요약'];
    for (const marker of finalAnswerMarkers) {
        const idx = fullText.lastIndexOf(marker);
        if (idx !== -1 && idx > finalStepIndex) {
            finalStepIndex = idx;
        }
    }

    // 생각 과정 패턴 감지
    const isThinking = /\[\d+\/\d+\]/.test(fullText) || /##\s*(단계|분석|Step)/i.test(fullText);

    if (finalStepIndex !== -1) {
        content.textContent = fullText.substring(finalStepIndex);
    } else if (isThinking && fullText.length > 50) {
        const stepCount = matches.length;
        content.innerHTML = `<div style="color: var(--text-muted); font-style: italic;">🤔 분석 중... ${stepCount > 0 ? `(${stepCount}단계 진행)` : ''}</div>`;
    } else {
        content.textContent = fullText;
    }

    scrollToBottom();
}

/**
 * AI 응답 완료
 */
function finishAssistantMessage(errorMessage = null) {
    const currentMsg = getState('currentAssistantMessage');
    if (!currentMsg) return;

    const content = currentMsg.querySelector('.message-content');
    if (!content) return;

    if (errorMessage) {
        content.innerHTML = `<span style="color: var(--danger);">${escapeHtml(errorMessage)}</span>`;
    } else {
        const rawText = content.dataset.rawText || content.textContent;

        // 생각 과정 분리
        const thinkingPattern = /\[\d+\/\d+\][\s\S]*?(?=\[(\d+)\/\2\]|## (최종 답변|답변|결론|요약)|$)/g;
        let thinkingProcess = '';
        let finalAnswer = rawText;

        const matches = [...rawText.matchAll(thinkingPattern)];
        if (matches.length > 0) {
            thinkingProcess = matches.map(m => m[0]).join('\n\n');

            const lastMatch = matches[matches.length - 1];
            const finalIdx = rawText.lastIndexOf(lastMatch[0]) + lastMatch[0].length;
            finalAnswer = rawText.substring(finalIdx).trim() || rawText;
        }

        // 마크다운 렌더링
        if (thinkingProcess) {
            content.innerHTML = `
                <details class="thinking-block">
                    <summary>💭 분석 과정 보기 (단계 1-${matches.length})</summary>
                    <div class="thinking-content"></div>
                </details>
                <div class="final-answer"></div>
            `;

            const thinkingContent = content.querySelector('.thinking-content');
            const finalContent = content.querySelector('.final-answer');

            renderMarkdown(thinkingContent, thinkingProcess);
            renderMarkdown(finalContent, finalAnswer);
        } else {
            renderMarkdown(content, finalAnswer);
        }

        // 메모리에 추가
        addToMemory('assistant', rawText);
    }

    // 응답 시간 표시
    const startTime = getState('messageStartTime');
    if (startTime) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const timeEl = currentMsg.querySelector('.message-time');
        if (timeEl) {
            timeEl.textContent += ` · ${duration}초`;
        }
    }

    setState('currentAssistantMessage', null);
    setState('messageStartTime', null);
    setState('isGenerating', false);
    hideAbortButton();
}

/**
 * 메시지 복사
 * @param {string} messageId - 메시지 ID
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
 * 메시지 재생성
 */
function regenerateMessage() {
    const memory = getState('conversationMemory');
    const lastUserContent = memory.filter(m => m.role === 'user').pop();

    if (lastUserContent) {
        const input = document.getElementById('chatInput');
        input.value = lastUserContent.content;
        sendMessage();
    }
}

/**
 * 새 대화 시작
 */
function newChat() {
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

    // 입력창 초기화
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = '';
        input.style.height = 'auto';
    }
}

/**
 * 제안 사용
 * @param {string} text - 제안 텍스트
 */
function useSuggestion(text) {
    const input = document.getElementById('chatInput');
    if (input) {
        input.value = text;
        input.focus();
    }
}

// 전역 노출 (레거시 호환)
window.sendMessage = sendMessage;
window.addChatMessage = addChatMessage;
window.appendToken = appendToken;
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
    finishAssistantMessage,
    copyMessage,
    regenerateMessage,
    newChat,
    useSuggestion,
    abortChat
};
