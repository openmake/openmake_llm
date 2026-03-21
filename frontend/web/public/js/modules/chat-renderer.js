/**
 * ============================================
 * Chat Renderer Module - 채팅 메시지 DOM 렌더링
 * ============================================
 * 사용자/AI 메시지 DOM 생성, 스트리밍 토큰 누적,
 * Thinking 토큰 표시, 응답 완료 처리를 담당합니다.
 *
 * @module chat-renderer
 */

import { getState, setState, addToMemory } from './state.js';
import { scrollToBottom, escapeHtml, renderMarkdown } from './ui.js';
import { STORAGE_KEY_GENERAL_SETTINGS } from './constants.js';

// SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
const SS = window.SafeStorage;

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
    const content = getState('currentAssistantMessageContent');
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
 * Thinking 토큰 추가
 * Ollama Thinking 모드에서 수신된 추론 과정 토큰을 접이식 UI로 표시합니다.
 * @param {string} token - 수신된 thinking 텍스트 토큰 조각
 * @returns {void}
 */
function appendThinkingToken(token) {
    const content = getState('currentAssistantMessageContent');
    if (!content) return;

    // 로딩 스피너 제거
    const spinner = content.querySelector('.loading-spinner');
    if (spinner) spinner.remove();

    // thinking 컨테이너 찾기 또는 생성
    let thinkingEl = content.querySelector('.thinking-trace');
    if (!thinkingEl) {
        thinkingEl = document.createElement('details');
        thinkingEl.className = 'thinking-trace';
        thinkingEl.open = false;
        thinkingEl.innerHTML = '<summary style="cursor:pointer;color:var(--text-muted);font-size:0.85em;margin-bottom:8px;">\uD83E\uDD14 \uCD94\uB860 \uACFC\uC815 \uBCF4\uAE30</summary><pre class="thinking-content" style="white-space:pre-wrap;font-size:0.82em;color:var(--text-muted);background:var(--bg-tertiary);padding:12px;border-radius:var(--radius-md);max-height:300px;overflow-y:auto;"></pre>';
        content.prepend(thinkingEl);
    }

    const pre = thinkingEl.querySelector('.thinking-content');
    if (pre) {
        pre.textContent += token;
        // 자동 스크롤 (열려있을 때만)
        if (thinkingEl.open) {
            pre.scrollTop = pre.scrollHeight;
        }
    }
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

        // Ollama Thinking trace 보존: renderMarkdown이 innerHTML을 덮어쓰기 전에 저장
        var existingThinkingTrace = content.querySelector('.thinking-trace');
        var thinkingTraceHtml = existingThinkingTrace ? existingThinkingTrace.outerHTML : '';

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

        // Ollama Thinking trace 복원: renderMarkdown 후 최상단에 다시 삽입
        if (thinkingTraceHtml) {
            content.insertAdjacentHTML('afterbegin', thinkingTraceHtml);
        }

        // saveHistory 설정이 활성화된 경우에만 메모리에 추가
        const gSettings = JSON.parse(SS.getItem(STORAGE_KEY_GENERAL_SETTINGS) || '{}');
        if (gSettings.saveHistory !== false) {
            addToMemory('assistant', rawText);
        }
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

    // 스킬 attribution: 해당 응답 메시지에 어떤 스킬로 생성되었는지 표시
    const activeSkillNames = getState('activeSkillNames');
    if (!errorMessage && activeSkillNames && activeSkillNames.length > 0) {
        const wrapper = currentMsg.querySelector('.message-wrapper');
        const timeEl = currentMsg.querySelector('.message-time');
        if (wrapper && timeEl) {
            function escSkill(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
            const chips = activeSkillNames.map(function(n) {
                return '<span class="attribution-chip">' + escSkill(n) + '</span>';
            }).join('');
            const attrEl = document.createElement('div');
            attrEl.className = 'message-attribution';
            attrEl.innerHTML = '<span class="attribution-label">✶ 스킬 적용</span><div class="attribution-chips">' + chips + '</div>';
            wrapper.insertBefore(attrEl, timeEl);
        }
        setState('activeSkillNames', null);
    }

    setState('currentAssistantMessage', null);
    setState('messageStartTime', null);
    setState('isGenerating', false);

    // hideAbortButton 호출 — chat.js에서 주입된 콜백 사용
    _hideAbortButton();

    // AI 상태 토스트 숨김
    const agentBadge = document.getElementById('agentBadge');
    if (agentBadge) agentBadge.style.display = 'none';
}

// hideAbortButton 콜백 — chat.js에서 주입
let _hideAbortButton = () => {};

/**
 * hideAbortButton 콜백을 외부에서 주입
 * 순환 참조를 피하기 위해 chat.js 초기화 시 호출됩니다.
 * @param {Function} fn - hideAbortButton 함수
 */
function setHideAbortButton(fn) {
    _hideAbortButton = fn;
}

export {
    addChatMessage,
    appendToken,
    appendThinkingToken,
    finishAssistantMessage,
    setHideAbortButton
};
