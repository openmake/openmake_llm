/**
 * ============================================
 * Document - 문서 질의응답 및 진행 현황
 * ============================================
 * 업로드된 문서에 대한 Q&A, 활성 문서 컨텍스트 관리,
 * 문서 분석 진행률 표시를 담당합니다.
 *
 * app.js에서 추출됨 (L1449-1491, L3217-3340, L4385-4502)
 *
 * @module document
 */

import { getState, setState, addToMemory } from './state.js';
import { renderMarkdown, showError, showToast, escapeHtml } from './ui.js';
import { truncateFilename } from './utils.js';

/**
 * 활성 문서 컨텍스트 배지를 채팅 입력 영역에 표시/제거
 * @returns {void}
 */
function updateActiveDocumentUI() {
    const activeDocumentContext = getState('activeDocumentContext');
    let badge = document.getElementById('activeDocBadge');

    if (!activeDocumentContext) {
        if (badge) badge.remove();
        return;
    }

    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'activeDocBadge';
        badge.className = 'active-doc-badge';
        badge.innerHTML = `
            <span class="doc-icon">📄</span>
            <span class="doc-name"></span>
            <button class="doc-clear" onclick="clearActiveDocument()" title="문서 컨텍스트 해제">✕</button>
        `;

        const chatInputArea = document.querySelector('.chat-input-area');
        if (chatInputArea) {
            chatInputArea.insertBefore(badge, chatInputArea.firstChild);
        }
    }

    const docName = badge.querySelector('.doc-name');
    if (docName) {
        const truncatedName = activeDocumentContext.filename.length > 30
            ? activeDocumentContext.filename.substring(0, 27) + '...'
            : activeDocumentContext.filename;
        docName.textContent = `${truncatedName} (${(activeDocumentContext.textLength / 1000).toFixed(1)}K자)`;
    }
}

/**
 * 활성 문서 컨텍스트를 해제하고 배지 제거
 * @returns {void}
 */
function clearActiveDocument() {
    setState('activeDocumentContext', null);
    updateActiveDocumentUI();
    showToast('📄 문서 컨텍스트가 해제되었습니다', 'info');
}

/**
 * 업로드된 문서에 대해 질문하고 AI 응답을 표시
 * @async
 * @param {string} docId - 질문 대상 문서 ID
 * @param {string} question - 사용자 질문
 * @param {string} model - 사용할 모델 ID
 * @returns {Promise<void>}
 */
async function askDocumentQuestion(docId, question, model) {
    const currentAssistantMessage = getState('currentAssistantMessage');

    try {
        const res = await fetch(API_ENDPOINTS.DOCUMENT_ASK, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId, question, model })
        });

        const data = await res.json();
        const payload = data.data || data;

        if (payload.answer) {
            let answerText = payload.answer;

            if (typeof payload.answer === 'object') {
                if (payload.answer.answer) {
                    answerText = payload.answer.answer;
                } else if (payload.answer.summary) {
                    answerText = formatSummaryResponse(payload.answer);
                } else {
                    answerText = JSON.stringify(payload.answer, null, 2);
                }

                if (payload.answer.evidence) {
                    answerText += '\n\n**📌 근거:**\n' + payload.answer.evidence;
                }
                if (payload.answer.additional_info) {
                    answerText += '\n\n**💡 추가 정보:**\n' + payload.answer.additional_info;
                }
            }

            if (currentAssistantMessage) {
                const content = currentAssistantMessage.querySelector('.message-content');
                renderMarkdown(content, answerText);
                addToMemory('assistant', answerText);
            }
        } else {
            const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
            showError(errorMsg || '답변 생성 실패');
        }
    } catch (e) {
        showError(e.message);
    }

    setState('currentAssistantMessage', null);
}

/**
 * 요약 응답 객체를 마크다운 문자열로 포맷팅
 * @param {Object} obj - 요약 응답 객체
 * @returns {string} 포맷팅된 마크다운 문자열
 */
function formatSummaryResponse(obj) {
    let result = '';

    if (obj.title) result += `## ${obj.title}\n\n`;
    if (obj.category) result += `**분류:** ${obj.category}\n\n`;

    if (obj.summary) {
        if (Array.isArray(obj.summary)) {
            result += '### 📋 요약\n';
            obj.summary.forEach(item => { result += `- ${item}\n`; });
            result += '\n';
        } else {
            result += `### 📋 요약\n${obj.summary}\n\n`;
        }
    }

    if (obj.sections && Array.isArray(obj.sections)) {
        obj.sections.forEach(section => {
            result += `### ${section.title}\n${section.content}\n\n`;
        });
    }

    if (obj.implications) result += `### 💡 시사점\n${obj.implications}\n`;

    return result.trim();
}

/** @type {number|null} 문서 진행률 숨김 타이머 ID */
let progressHideTimeout = null;

/**
 * 문서 분석 진행 현황을 채팅 입력 영역 위에 표시
 * @param {Object} event - 문서 진행 이벤트 데이터
 * @returns {void}
 */
function showDocumentProgress(event) {
    let progressContainer = document.getElementById('documentProgress');

    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.id = 'documentProgress';
        progressContainer.className = 'document-progress';

        const inputContainer = document.querySelector('.chat-input-container');
        if (inputContainer) {
            inputContainer.insertBefore(progressContainer, inputContainer.firstChild);
        } else {
            document.body.appendChild(progressContainer);
        }
    }

    if (progressHideTimeout) {
        clearTimeout(progressHideTimeout);
        progressHideTimeout = null;
    }

    const stageIcons = {
        'upload': '📤', 'extract': '📋', 'pdf_parse': '📄', 'ocr_prepare': '🔧',
        'ocr_convert': '🖼️', 'ocr_recognize': '🔍', 'ocr_complete': '✅',
        'excel_parse': '📊', 'image_ocr': '🖼️', 'text_read': '📝',
        'complete': '✅', 'error': '❌'
    };

    const icon = stageIcons[event.stage] || '⏳';
    const isComplete = event.stage === 'complete';
    const isError = event.stage === 'error';
    const progressBar = event.progress !== undefined
        ? `<div class="progress-bar">
             <div class="progress-fill ${isComplete ? 'complete' : ''} ${isError ? 'error' : ''}" 
                  style="width: ${event.progress}%"></div>
           </div>`
        : '';

    const filenameDisplay = event.filename
        ? `<span class="progress-filename">${escapeHtml(truncateFilename(event.filename, 30))}</span>`
        : '';

    progressContainer.innerHTML = `
        <div class="progress-content">
            <span class="progress-icon ${isComplete || isError ? '' : 'animate'}">${icon}</span>
            <div class="progress-info">
                ${filenameDisplay}
                <span class="progress-message">${escapeHtml(event.message)}</span>
            </div>
            ${progressBar}
        </div>
    `;

    progressContainer.style.display = 'flex';
    progressContainer.classList.remove('hiding');

    if (isComplete || isError) {
        progressHideTimeout = setTimeout(() => {
            progressContainer.classList.add('hiding');
            setTimeout(() => {
                progressContainer.style.display = 'none';
                progressContainer.classList.remove('hiding');
            }, 300);
        }, 3000);
    }
}

// 전역 노출 (레거시 호환)
window.updateActiveDocumentUI = updateActiveDocumentUI;
window.clearActiveDocument = clearActiveDocument;
window.askDocumentQuestion = askDocumentQuestion;
window.formatSummaryResponse = formatSummaryResponse;
window.showDocumentProgress = showDocumentProgress;

export {
    updateActiveDocumentUI,
    clearActiveDocument,
    askDocumentQuestion,
    formatSummaryResponse,
    showDocumentProgress
};
