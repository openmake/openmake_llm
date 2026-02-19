/**
 * ============================================
 * Error Handler - 에러 처리, 기능 카드, 도움말
 * ============================================
 * 기능 카드 시작, 인라인 도움말, 슬래시 명령어 처리,
 * 웹 검색 실행, MCP 설정 서버 동기화를 담당합니다.
 *
 * app.js에서 추출됨 (L4148-4539, L3393-3437, L3769-3829)
 *
 * @module error-handler
 */

import { getState, setState, addToMemory } from './state.js';
import { addChatMessage } from './chat.js';
import { showToast, showError, renderMarkdown, escapeHtml, scrollToBottom } from './ui.js';
import { closeGuideModal } from './guide.js';

/**
 * 환영 화면의 기능 카드 클릭 시 해당 기능의 AI 환영 메시지 표시
 * @param {'coding'|'document'|'data'|'chat'} feature - 선택한 기능 타입
 * @returns {void}
 */
function startFeatureChat(feature) {
    const prompts = {
        coding: '안녕하세요! 코딩 에이전트입니다. 코드 작성, 디버깅, 코드 리뷰 등을 도와드립니다. 어떤 코딩 작업을 도와드릴까요?',
        document: '안녕하세요! 문서 작성 도우미입니다. 블로그 글, 보고서 초안, 이메일 등을 작성해 드립니다. 어떤 문서를 작성할까요?',
        data: '안녕하세요! 데이터 분석 에이전트입니다. 데이터 시각화, 통계 분석, 인사이트 도출을 도와드립니다. 어떤 데이터를 분석할까요?',
        chat: '안녕하세요! 무엇이든 물어보세요. 저는 다양한 질문에 답변하고 도움을 드릴 수 있습니다. 😊'
    };

    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    const message = prompts[feature] || prompts.chat;
    addChatMessage('assistant', message);
    addToMemory('assistant', message);

    const input = document.getElementById('chatInput');
    if (input) input.focus();
}

/**
 * 슬래시 명령어('/') 처리
 * @param {string} command - 입력된 명령어 문자열
 * @returns {boolean} 명령어가 처리되었으면 true
 */
function handleCommand(command) {
    const cmd = command.toLowerCase().trim();

    if (cmd === '/help') {
        if (typeof window.showUserGuide === 'function') {
            window.showUserGuide();
        } else {
            showHelpAndMessage();
        }
        return true;
    }

    if (cmd === '/clear') {
        if (typeof window.newChat === 'function') {
            window.newChat();
        }
        showToast('💬 대화가 초기화되었습니다');
        return true;
    }

    if (cmd.startsWith('/mode ')) {
        const mode = cmd.substring(6).trim();
        const validModes = ['assistant', 'reasoning', 'coder', 'reviewer', 'explainer', 'generator', 'agent'];
        if (validModes.includes(mode)) {
            showToast(`🎯 프롬프트 모드: ${mode}`);
            return true;
        } else {
            showToast(`❌ 알 수 없는 모드. 사용 가능: ${validModes.join(', ')}`);
            return true;
        }
    }

    return false;
}

/**
 * /help 명령어 실행 시 채팅 영역에 인라인 도움말 메시지 표시
 * @returns {void}
 */
function showHelpAndMessage() {
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) welcomeScreen.style.display = 'none';

    const container = document.getElementById('chatMessages');
    if (!container) return;

    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = 'chat-message assistant';
    div.innerHTML = `
        <div class="message-avatar">✨</div>
        <div class="message-wrapper">
            <div class="message-content help-message">
                <h3 style="margin-bottom: 16px; color: var(--accent-primary);">💡 OpenMake.Ai 사용 가이드</h3>
                <div style="margin-bottom: 16px;">
                    <h4 style="margin-bottom: 8px;">🎯 자동 프롬프트 감지</h4>
                    <p style="margin-bottom: 8px; color: var(--text-secondary);">질문 유형에 따라 자동으로 최적의 모드가 선택됩니다:</p>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead><tr style="background: var(--bg-tertiary);">
                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color);">질문 유형</th>
                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color);">감지 키워드</th>
                            <th style="padding: 8px; text-align: left; border-bottom: 1px solid var(--border-color);">프롬프트</th>
                        </tr></thead>
                        <tbody>
                            <tr><td style="padding: 6px 8px;">🧮 수학/비교</td><td style="padding: 6px 8px;">"크다", "비교", "계산"</td><td style="padding: 6px 8px;"><code>reasoning</code></td></tr>
                            <tr><td style="padding: 6px 8px;">💻 코드 작성</td><td style="padding: 6px 8px;">"코드", "함수", "개발"</td><td style="padding: 6px 8px;"><code>coder</code></td></tr>
                            <tr><td style="padding: 6px 8px;">🚀 프로젝트 생성</td><td style="padding: 6px 8px;">"만들어", "앱", "프로젝트"</td><td style="padding: 6px 8px;"><code>generator</code></td></tr>
                            <tr><td style="padding: 6px 8px;">🔍 코드 리뷰</td><td style="padding: 6px 8px;">"검토", "리뷰"</td><td style="padding: 6px 8px;"><code>reviewer</code></td></tr>
                            <tr><td style="padding: 6px 8px;">📚 개념 설명</td><td style="padding: 6px 8px;">"설명", "뭐야"</td><td style="padding: 6px 8px;"><code>explainer</code></td></tr>
                            <tr><td style="padding: 6px 8px;">🤖 도구 호출</td><td style="padding: 6px 8px;">"검색", "찾아", "도구"</td><td style="padding: 6px 8px;"><code>agent</code></td></tr>
                            <tr><td style="padding: 6px 8px;">💬 일반 대화</td><td style="padding: 6px 8px;">그 외</td><td style="padding: 6px 8px;"><code>assistant</code></td></tr>
                        </tbody>
                    </table>
                </div>
                <div style="margin-bottom: 16px;">
                    <h4 style="margin-bottom: 8px;">⌨️ 사용 가능한 명령어</h4>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        <li style="padding: 4px 0;"><code>/help</code> - 이 도움말 표시</li>
                        <li style="padding: 4px 0;"><code>/clear</code> - 대화 초기화</li>
                        <li style="padding: 4px 0;"><code>/mode [타입]</code> - 프롬프트 모드 전환</li>
                    </ul>
                </div>
                <div style="margin-bottom: 16px;">
                    <h4 style="margin-bottom: 8px;">🔧 프롬프트 모드</h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        <span class="mode-tag">assistant</span>
                        <span class="mode-tag">reasoning</span>
                        <span class="mode-tag">coder</span>
                        <span class="mode-tag">reviewer</span>
                        <span class="mode-tag">explainer</span>
                        <span class="mode-tag">generator</span>
                        <span class="mode-tag">agent</span>
                    </div>
                </div>
            </div>
            <div class="message-time">${timestamp}</div>
        </div>
    `;

    container.appendChild(div);
    scrollToBottom();
}

/**
 * 웹 검색 실행 및 결과를 채팅 영역에 표시
 * @async
 * @param {string} query - 검색 쿼리
 * @param {string} model - 사용할 모델 ID
 * @returns {Promise<void>}
 */
async function performWebSearch(query, model) {
    const currentAssistantMessage = getState('currentAssistantMessage');

    try {
        if (currentAssistantMessage) {
            const content = currentAssistantMessage.querySelector('.message-content');
            content.innerHTML = '<span class="loading-spinner"></span> 웹에서 검색 중...';
        }

        const res = await fetch('/api/web-search', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, model })
        });

        const data = await res.json();
        const payload = data.data || data;

        if (payload.answer) {
            if (currentAssistantMessage) {
                const content = currentAssistantMessage.querySelector('.message-content');
                renderMarkdown(content, payload.answer);

                if (payload.sources && payload.sources.length > 0) {
                    const sourcesDiv = document.createElement('div');
                    sourcesDiv.style.cssText = 'margin-top: 12px; padding: 10px; background: #f8f9fa; border-radius: 8px; font-size: 13px;';
                    sourcesDiv.innerHTML = '<b>📚 검색 출처:</b><br>' + payload.sources.map((s, i) =>
                        `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" style="color: #0369a1; display: block; margin-top: 4px;">[${i + 1}] ${escapeHtml(s.title || new URL(s.url).hostname)}</a>`
                    ).join('');
                    content.appendChild(sourcesDiv);
                }
            }
        } else {
            const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
            showError(errorMsg || '검색 실패');
        }
    } catch (e) {
        showError(e.message);
    }

    setState('currentAssistantMessage', null);
    setState('isSending', false);
}

/**
 * 현재 MCP 설정을 WebSocket으로 서버에 동기화
 * @returns {void}
 */
function syncMCPSettingsToServer() {
    const ws = getState('ws');
    if (ws && ws.readyState === WebSocket.OPEN) {
        // mcpSettings는 settings.js의 전역 변수를 window에서 참조
        const mcpSettings = window.mcpSettings || {};
        const serverSettings = {
            sequentialThinking: mcpSettings.thinking,
            pdfTools: mcpSettings.pdf,
            webSearch: mcpSettings.webSearch
        };

        ws.send(JSON.stringify({
            type: 'mcp_settings',
            settings: serverSettings
        }));

        console.log('[MCP] 서버에 설정 동기화:', serverSettings);
    } else {
        console.warn('[MCP] WebSocket 연결 없음, 서버 동기화 실패');
    }
}

/**
 * 서버에서 수신한 MCP 설정을 로컬 상태와 UI에 동기화
 * @param {Object} serverSettings - 서버 MCP 설정 객체
 * @returns {void}
 */
function syncMCPSettingsFromServer(serverSettings) {
    if (!serverSettings) return;

    const mcpSettings = window.mcpSettings || {};
    const settingsMap = {
        sequentialThinking: 'thinking',
        pdfTools: 'pdf',
        webSearch: 'webSearch'
    };

    for (const [serverKey, localKey] of Object.entries(settingsMap)) {
        if (serverKey in serverSettings) {
            mcpSettings[localKey] = serverSettings[serverKey];

            const checkboxId = `mcp${localKey.charAt(0).toUpperCase() + localKey.slice(1)}`;
            const checkbox = document.getElementById(checkboxId);
            if (checkbox) {
                checkbox.checked = serverSettings[serverKey];
            }
        }
    }

    setState('thinkingEnabled', mcpSettings.thinking);
    setState('webSearchEnabled', mcpSettings.webSearch);

    console.log('[MCP] UI 설정 동기화 완료:', mcpSettings);
}

// 레거시 빈 함수 (호환성 유지용)
/** @deprecated 호환성 유지용 빈 함수 */
function showHelpPopup() { }
/** @deprecated 호환성 유지용 빈 함수 */
function hideHelpPopup() { }
/** @deprecated 호환성 유지용 빈 함수 */
function hideHelpPopupDelayed() { }
/** @deprecated 호환성 유지용 빈 함수 */
function closeHelpPopup() { }

// 전역 노출 (레거시 호환)
window.startFeatureChat = startFeatureChat;
window.handleCommand = handleCommand;
window.showHelpAndMessage = showHelpAndMessage;
window.performWebSearch = performWebSearch;
window.syncMCPSettingsToServer = syncMCPSettingsToServer;
window.syncMCPSettingsFromServer = syncMCPSettingsFromServer;
window.showHelpPopup = showHelpPopup;
window.hideHelpPopup = hideHelpPopup;
window.hideHelpPopupDelayed = hideHelpPopupDelayed;
window.closeHelpPopup = closeHelpPopup;

export {
    startFeatureChat,
    handleCommand,
    showHelpAndMessage,
    performWebSearch,
    syncMCPSettingsToServer,
    syncMCPSettingsFromServer,
    showHelpPopup,
    hideHelpPopup,
    hideHelpPopupDelayed,
    closeHelpPopup
};
