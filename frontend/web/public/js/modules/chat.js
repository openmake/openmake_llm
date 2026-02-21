/**
 * ============================================
 * Chat Module - 채팅 메시지 전송 및 렌더링
 * ============================================
 * WebSocket 기반 실시간 채팅 메시지 전송, 스트리밍 토큰 수신,
 * 사용자/AI 메시지 DOM 렌더링, 생각 과정(thinking) 분리,
 * 마크다운 렌더링, 응답 중단(abort) 기능을 제공합니다.
 *
 * @module chat
 */

import { getState, setState, addToMemory } from './state.js';
import { sendWsMessage } from './websocket.js';
import { scrollToBottom, escapeHtml, renderMarkdown, showToast } from './ui.js';
import { authFetch } from './auth.js';

/**
 * AI 응답 생성 중단 요청
 * WebSocket을 통해 서버에 abort 메시지를 전송하고 UI를 업데이트합니다.
 * @returns {void}
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
 * 버튼이 없으면 동적으로 생성하여 전송 버튼 옆에 삽입합니다.
 * @returns {void}
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
 * @returns {void}
 */
function hideAbortButton() {
    const abortBtn = document.getElementById('abortButton');
    if (abortBtn) {
        abortBtn.style.display = 'none';
    }
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
            model: document.getElementById('modelSelect')?.value || localStorage.getItem('selectedModel') || 'openmake_llm_auto',
            history: getState('conversationMemory'),
            webSearch: getState('webSearchEnabled'),
            thinkingMode: getState('thinkingEnabled'),
            enabledTools: getState('mcpToolsEnabled') || {},
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
 * 채팅 메시지를 DOM에 추가
 * user 역할은 escapeHtml 처리된 내용을, assistant 역할은 로딩 스피너와
 * 복사/재생성 액션 버튼이 포함된 메시지를 렌더링합니다.
 * @param {string} role - 메시지 역할 ('user' | 'assistant')
 * @param {string} content - 메시지 내용 (빈 문자열이면 로딩 상태 표시)
 * @returns {HTMLDivElement|null} 생성된 메시지 DOM 요소, 컨테이너 없으면 null
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
                    <span class="feedback-divider"></span>
                    <button class="message-action-btn feedback-btn" data-feedback="thumbs_up" data-msg-id="${messageId}" title="좋아요">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>
                        </svg>
                    </button>
                    <button class="message-action-btn feedback-btn" data-feedback="thumbs_down" data-msg-id="${messageId}" title="별로예요">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/>
                        </svg>
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
 * 스트리밍 토큰 추가
 * WebSocket에서 수신된 토큰을 현재 AI 메시지에 누적 합산합니다.
 * 생각 과정([N/M] 패턴) 감지 시 진행 상태를 표시하고,
 * 최종 답변 마커 발견 시 최종 답변만 표시합니다.
 * @param {string} token - 수신된 텍스트 토큰 조각
 * @returns {void}
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

    // [N/M] 사고 단계 위치 수집
    var stepPositions = [];
    var stepRegex = /\[\d+\/\d+\]/g;
    var sMatch;
    while ((sMatch = stepRegex.exec(fullText)) !== null) {
        stepPositions.push(sMatch.index);
    }
    var stepCount = stepPositions.length;

    // 결론 마커 위치 찾기
    var streamConclusionMarkers = ['## \uCD5C\uC885 \uB2F5\uBCC0', '## \uB2F5\uBCC0', '## \uACB0\uB860', '## \uC694\uC57D'];
    var streamConclusionIdx = -1;
    for (var ci = 0; ci < streamConclusionMarkers.length; ci++) {
        var cidx = fullText.indexOf(streamConclusionMarkers[ci]);
        if (cidx !== -1 && (streamConclusionIdx === -1 || cidx < streamConclusionIdx)) {
            streamConclusionIdx = cidx;
        }
    }

    if (stepCount > 0) {
        var firstStepPos = stepPositions[0];

        if (firstStepPos > 0) {
            // 결론이 먼저 (신 형식) → 결론 부분만 표시
            var conclusionText = fullText.substring(0, firstStepPos).replace(/---\s*$/, '').trim();
            // 사고 과정 섹션 제거 (## 사고 과정, ## 사고과정 등)
            var streamThinkMarkers = ['## \uC0AC\uACE0 \uACFC\uC815', '## \uC0AC\uACE0\uACFC\uC815', '## Thinking Process'];
            for (var sti = 0; sti < streamThinkMarkers.length; sti++) {
                var stIdx = conclusionText.indexOf(streamThinkMarkers[sti]);
                if (stIdx !== -1) {
                    conclusionText = conclusionText.substring(0, stIdx).replace(/\s*---\s*$/, '').trim();
                }
            }
            content.textContent = conclusionText;
            var indicator = document.createElement('div');
            indicator.style.cssText = 'color: var(--text-muted); font-style: italic; margin-top: 12px; font-size: 0.85em;';
            indicator.textContent = '\uD83D\uDCAD \uC0AC\uACE0 \uACFC\uC815 \uAE30\uB85D \uC911... (' + stepCount + '\uB2E8\uACC4 \uC9C4\uD589)';
            content.appendChild(indicator);
        } else if (streamConclusionIdx !== -1) {
            // 사고가 먼저 (구 형식), 결론 마커 발견 → 결론 부분 표시
            content.textContent = fullText.substring(streamConclusionIdx);
        } else {
            // 사고 진행 중, 아직 결론 없음
            content.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">\uD83E\uDD14 \uBD84\uC11D \uC911... (' + stepCount + '\uB2E8\uACC4 \uC9C4\uD589)</div>';
        }
    } else {
        // 사고 단계 없음 → 전체 텍스트 표시
        content.textContent = fullText;
    }

    scrollToBottom();
}

/**
 * AI 응답 완료 처리
 * 생각 과정과 최종 답변을 분리하여 마크다운으로 렌더링하고,
 * 응답 시간을 표시합니다. 에러 메시지가 있으면 에러 스타일로 표시합니다.
 * @param {string|null} [errorMessage=null] - 에러 메시지 (null이면 정상 완료)
 * @param {string|null} [serverMessageId=null] - 서버에서 생성한 메시지 ID (피드백 연동용)
 * @returns {void}
 */
function finishAssistantMessage(errorMessage = null, serverMessageId = null) {
    const currentMsg = getState('currentAssistantMessage');
    if (!currentMsg) return;

    if (serverMessageId) {
        currentMsg.dataset.serverMessageId = serverMessageId;
    }

    const content = currentMsg.querySelector('.message-content');
    if (!content) return;

    if (errorMessage) {
        content.innerHTML = `<span style="color: var(--danger);">${escapeHtml(errorMessage)}</span>`;
    } else {
        const rawText = content.dataset.rawText || content.textContent;

        // [N/M] 사고 단계 위치 수집
        var stepPositions = [];
        var stepRegex = /\[\d+\/\d+\]/g;
        var sMatch;
        while ((sMatch = stepRegex.exec(rawText)) !== null) {
            stepPositions.push(sMatch.index);
        }
        var stepCount = stepPositions.length;

        // 결론 마커 위치 찾기
        var conclusionMarkers = ['## \uCD5C\uC885 \uB2F5\uBCC0', '## \uB2F5\uBCC0', '## \uACB0\uB860', '## \uC694\uC57D'];
        var conclusionIdx = -1;
        for (var ci = 0; ci < conclusionMarkers.length; ci++) {
            var cidx = rawText.indexOf(conclusionMarkers[ci]);
            if (cidx !== -1 && (conclusionIdx === -1 || cidx < conclusionIdx)) {
                conclusionIdx = cidx;
            }
        }

        var thinkingProcess = '';
        var finalAnswer = rawText;

        if (stepCount > 0) {
            var firstStepPos = stepPositions[0];

            if (conclusionIdx !== -1 && conclusionIdx < firstStepPos) {
                // 신 형식: 결론 먼저 → 사고 단계 뒤
                finalAnswer = rawText.substring(0, firstStepPos).replace(/\s*---\s*$/, '').trim();
                thinkingProcess = rawText.substring(firstStepPos).trim();
            } else if (conclusionIdx !== -1 && conclusionIdx > firstStepPos) {
                // 구 형식: 사고 단계 먼저 → 결론 뒤
                thinkingProcess = rawText.substring(firstStepPos, conclusionIdx).replace(/\s*---\s*$/, '').trim();
                finalAnswer = rawText.substring(conclusionIdx).trim();
            } else if (firstStepPos > 0) {
                // 결론 마커 없이 텍스트가 먼저 → 사고 단계 뒤
                finalAnswer = rawText.substring(0, firstStepPos).replace(/\s*---\s*$/, '').trim();
                thinkingProcess = rawText.substring(firstStepPos).trim();
            }
            // else: 사고 단계만 존재 (firstStepPos===0, 결론 마커 없음) → 전체를 finalAnswer로
        }

        // 중복 제거: 사고 과정의 마지막 단계가 결론과 동일 내용이면 제거
        if (thinkingProcess) {
            thinkingProcess = thinkingProcess.replace(/\[\d+\/\d+\]\s*(?:\uACB0\uB860\s*\uB3C4\uCD9C|(?:\uCD5C\uC885\s*)?\uC815\uB9AC|(?:\uCD5C\uC885\s*)?\uACB0\uB860)[:\uFF1A]\s*[\s\S]*$/i, '').trim();
        }

        // finalAnswer에서 사고 과정 섹션 제거 (결론 이후 불필요한 내용 제거)
        if (finalAnswer) {
            var thinkingSectionMarkers = ['## \uC0AC\uACE0 \uACFC\uC815', '## \uC0AC\uACE0\uACFC\uC815', '## Thinking Process'];
            for (var ti = 0; ti < thinkingSectionMarkers.length; ti++) {
                var tIdx = finalAnswer.indexOf(thinkingSectionMarkers[ti]);
                if (tIdx !== -1) {
                    finalAnswer = finalAnswer.substring(0, tIdx).replace(/\s*---\s*$/, '').trim();
                }
            }
            // --- 구분선 이후 내용도 제거 (사고 과정 마커가 없더라도, 결론 후반부 구분선 이후는 불필요)
            var dividerMatch = finalAnswer.match(/\n---\s*\n/);
            if (dividerMatch && dividerMatch.index > finalAnswer.length * 0.3) {
                var afterDivider = finalAnswer.substring(dividerMatch.index + dividerMatch[0].length).trim();
                // 구분선 이후에 사고/분석 관련 내용이 있으면 제거
                if (/^(\*\*|##\s|\uC0AC\uACE0|\uBD84\uC11D|\uB2E8\uACC4|\uACFC\uC815|Thinking|Step)/i.test(afterDivider) || afterDivider.length < 100) {
                    finalAnswer = finalAnswer.substring(0, dividerMatch.index).trim();
                }
            }
        }

        // 마크다운 렌더링: 접힌 사고 과정 상단, 결론 하단 (이미지 레이아웃)
        if (thinkingProcess && finalAnswer) {
            content.innerHTML = '<details class="thinking-block"><summary>\uD83D\uDCAD \uBD84\uC11D \uACFC\uC815 \uBCF4\uAE30 (\uB2E8\uACC4 1-' + stepCount + ')</summary><div class="thinking-content"></div></details><div class="final-answer"></div>';

            var thinkingContent = content.querySelector('.thinking-content');
            var finalContent = content.querySelector('.final-answer');

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
        feedbackBtns.forEach(function(btn) {
            btn.classList.remove('feedback-active');
        });
        var activeBtn = msgElement.querySelector('[data-feedback="' + signal + '"]');
        if (activeBtn) {
            activeBtn.classList.add('feedback-active');
        }
    }

    // 서버 전송 (fire-and-forget)
    authFetch('/api/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messageId: serverMsgId || msgElementId,
            sessionId: sessionId || 'anonymous',
            signal: signal
        })
    }).catch(function(err) {
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

// 피드백 버튼 이벤트 위임
document.addEventListener('click', function(e) {
    var feedbackBtn = e.target.closest('.feedback-btn');
    if (!feedbackBtn) return;

    var signal = feedbackBtn.dataset.feedback;
    var msgId = feedbackBtn.dataset.msgId;
    if (signal && msgId) {
        sendFeedback(msgId, signal);
    }
});

// 전역 노출 (레거시 호환)
window.sendFeedback = sendFeedback;
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
    sendFeedback,
    newChat,
    useSuggestion,
    abortChat
};
