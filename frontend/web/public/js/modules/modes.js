/**
 * ============================================
 * Modes - 토론/Thinking/Deep Research 모드 관리
 * ============================================
 * 멀티 에이전트 토론, Native Thinking, Deep Research 모드의
 * 토글과 진행 상황 UI를 담당합니다.
 *
 * app.js에서 추출됨 (L1600-1960)
 *
 * @module modes
 */

import { getState, setState } from './state.js';
import { showToast, escapeHtml } from './ui.js';
import { saveMCPSettings, syncWebSearchState, updateMCPToolTogglesUI } from './settings.js';
import { addChatMessage } from './chat-renderer.js';

/**
 * 멀티 에이전트 토론 모드 토글
 * 토론 모드와 웹 검색은 상호 배타적입니다.
 * @returns {void}
 */
function toggleDiscussionMode() {
    const current = getState('discussionMode');
    const newValue = !current;
    setState('discussionMode', newValue);

    // enabledTools 동기화
    var currentTools = (typeof getState === 'function' ? getState('mcpToolsEnabled') : null) || {};
    var updatedTools = Object.assign({}, currentTools);
    updatedTools.discussion_mode = newValue;
    setState('mcpToolsEnabled', updatedTools);

    const btn = document.getElementById('discussionModeBtn');
    if (btn) {
        btn.classList.toggle('active', newValue);
        btn.title = newValue ? '토론 모드 활성화됨' : '토론 모드 비활성화됨';
    }

    // 토론 모드와 웹 검색은 동시 사용 불가
    if (newValue && getState('webSearchEnabled')) {
        syncWebSearchState(false);
        updateMCPToolTogglesUI();
        const webSearchBtn = document.getElementById('webSearchBtn');
        if (webSearchBtn) {
            webSearchBtn.classList.remove('active');
        }
        showToast('멀티 에이전트 토론 모드 활성화 (웹 검색 비활성화됨)', 'info');
    } else {
        showToast(newValue ? '멀티 에이전트 토론 모드 활성화' : '일반 모드로 전환', 'info');
    }
    saveMCPSettings();
    updateMCPToolTogglesUI();
}

/**
 * Native Thinking 모드 토글
 * @returns {void}
 */
function toggleThinkingMode() {
    const current = getState('thinkingEnabled');
    const newValue = !current;
    setState('thinkingEnabled', newValue);

    // enabledTools 동기화
    var currentTools = (typeof getState === 'function' ? getState('mcpToolsEnabled') : null) || {};
    var updatedTools = Object.assign({}, currentTools);
    updatedTools.sequential_thinking = newValue;
    setState('mcpToolsEnabled', updatedTools);

    saveMCPSettings();
    updateMCPToolTogglesUI();

    const thinkingLevel = getState('thinkingLevel') || 'high';
    const btn = document.getElementById('thinkingModeBtn');
    if (btn) {
        btn.classList.toggle('active', newValue);
        btn.title = newValue ? `Thinking 모드 활성화 (${thinkingLevel})` : 'Thinking 모드 비활성화';
    }
    showToast(newValue ? `Thinking 모드 활성화 (레벨: ${thinkingLevel})` : '일반 모드로 전환', 'info');
}

/**
 * Deep Research 모드 토글
 * @returns {void}
 */
function toggleDeepResearch() {
    const current = getState('deepResearchMode');
    const newValue = !current;
    setState('deepResearchMode', newValue);

    // enabledTools 동기화
    var currentTools = (typeof getState === 'function' ? getState('mcpToolsEnabled') : null) || {};
    var updatedTools = Object.assign({}, currentTools);
    updatedTools.deep_research = newValue;
    setState('mcpToolsEnabled', updatedTools);

    const btn = document.getElementById('deepResearchBtn');
    if (btn) {
        btn.classList.toggle('active', newValue);
        btn.title = newValue ? 'Deep Research 모드 활성화' : 'Deep Research (심층 연구)';
    }

    // Deep Research 모드일 때 다른 모드 비활성화
    if (newValue) {
        if (getState('discussionMode')) {
            setState('discussionMode', false);
            updatedTools.discussion_mode = false;
            setState('mcpToolsEnabled', updatedTools);
            const discussionBtn = document.getElementById('discussionModeBtn');
            if (discussionBtn) discussionBtn.classList.remove('active');
        }
        showToast('Deep Research 모드 활성화\n주제를 입력하면 자동으로 심층 연구를 수행합니다.', 'info');
    } else {
        showToast('일반 모드로 전환', 'info');
    }
    saveMCPSettings();
    updateMCPToolTogglesUI();
}

/**
 * 멀티 에이전트 토론 진행 상황을 미니바 스타일로 표시
 * @param {Object} progress - 토론 진행 정보
 * @param {number} progress.progress - 진행률 (0-100)
 * @param {string} progress.message - 현재 상태 메시지
 * @param {string} [progress.phase] - 토론 단계
 * @returns {void}
 */
function showDiscussionProgress(progress) {
    let progressEl = document.getElementById('discussionProgress');

    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = 'discussionProgress';
        progressEl.innerHTML = `
            <style>
                #discussionProgress {
                    margin: 0 auto 10px auto;
                    max-width: 600px;
                    background: var(--bg-card);
                    border: 2px solid var(--border-light);
                    border-radius: 20px;
                    padding: 8px 16px;
                    box-shadow: 2px 2px 0 #000;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-size: 0.85rem;
                    color: var(--text-primary);
                    animation: slideUp 0.3s ease-out;
                }
                [data-theme="dark"] #discussionProgress { background: var(--bg-card); border-color: var(--border-light); }
                #discussionProgress .progress-icon { font-size: 1.2rem; animation: pulse 2s infinite; }
                #discussionProgress .progress-content { flex: 1; display: flex; flex-direction: column; gap: 4px; }
                #discussionProgress .progress-header { font-weight: 600; display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--accent-primary); }
                #discussionProgress .progress-bar-bg { background: var(--bg-tertiary); height: 4px; border-radius: 2px; overflow: hidden; width: 100%; }
                #discussionProgress .progress-fill { background: var(--accent-primary); height: 100%; width: 0%; transition: width 0.4s ease; border-radius: 2px; }
                #discussionProgress .progress-message { font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.8; } 100% { transform: scale(1); opacity: 1; } }
            </style>
            <div class="progress-icon"><iconify-icon icon="lucide:users"></iconify-icon></div>
            <div class="progress-content">
                <div class="progress-header">
                    <span><iconify-icon icon="lucide:users"></iconify-icon> 멀티 에이전트 토론 (v2)</span>
                    <span class="progress-percent">0%</span>
                </div>
                <div class="progress-bar-bg"><div class="progress-fill"></div></div>
                <div class="progress-message">토론 준비 중...</div>
            </div>
        `;

        const inputContainer = document.querySelector('.input-container');
        if (inputContainer) {
            inputContainer.insertBefore(progressEl, inputContainer.firstChild);
        } else {
            document.body.appendChild(progressEl);
        }
    }

    const fillEl = progressEl.querySelector('.progress-fill');
    const msgEl = progressEl.querySelector('.progress-message');
    const percentEl = progressEl.querySelector('.progress-percent');

    if (fillEl) fillEl.style.width = `${progress.progress}%`;
    if (msgEl) msgEl.textContent = progress.message;
    if (percentEl) percentEl.textContent = `${Math.round(progress.progress)}%`;

    if (progress.phase === 'complete') {
        setTimeout(() => {
            progressEl.style.opacity = '0';
            progressEl.style.transform = 'translateY(10px)';
            progressEl.style.transition = 'all 0.3s ease';
            setTimeout(() => progressEl.remove(), 300);
        }, 1500);
    }
}

/**
 * Deep Research currentStep → 한글 단계 라벨 매핑.
 * 백엔드 DeepResearchService.reportProgress 가 emit 하는 currentStep 값 집합:
 *   '초기화' | 'decompose' | 'search' | 'scrape' | 'synthesize' | 'report'
 *   | 'completed' | 'cancelled' | 'error'
 * (legacy/방어용 alias 포함)
 */
const RESEARCH_STAGE_LABELS = {
    'starting': '시작', '초기화': '초기화',
    'decompose': '주제 분석', 'decomposing': '주제 분석',
    'search': '웹 검색', 'searching': '웹 검색',
    'scrape': '콘텐츠 수집', 'scraping': '콘텐츠 수집',
    'synthesize': '정보 합성', 'synthesizing': '정보 합성',
    'report': '보고서 작성', 'generating': '보고서 작성',
    'complete': '완료', 'completed': '완료',
    'cancelled': '취소됨', 'error': '오류', 'failed': '실패'
};

/** status → badge 라벨 (Agent Task 카드와 동등한 어휘) */
const RESEARCH_STATUS_LABELS = {
    pending: '대기중', running: '진행중',
    completed: '완료', failed: '실패', cancelled: '취소됨'
};

/**
 * Deep Research 진행을 채팅 메시지 영역의 인라인 카드로 렌더/갱신한다.
 * Agent Task 채팅 카드(chat.js _renderAgentTaskCard)와 시각적으로 동등한 UX —
 * 미니바(일시적, input 위) 대신 채팅 히스토리에 카드가 남는다.
 *
 * 같은 sessionId 동안 카드 1개를 생성/갱신하며, 완료/실패/취소(terminal) 시에도
 * 카드를 제거하지 않고 상태만 고정한다. 보고서 본문은 백엔드가 이 카드 뒤의
 * 일반 assistant 버블로 onToken 스트리밍하므로 여기서는 진행만 표시한다.
 *
 * @param {Object} progress - ResearchProgress (백엔드 deep-research-types.ts)
 * @param {string} progress.sessionId - 리서치 세션 ID (카드 추적 키)
 * @param {string} progress.status - 'pending'|'running'|'completed'|'failed'|'cancelled'
 * @param {number} [progress.currentLoop] - 현재 루프 번호
 * @param {number} [progress.totalLoops] - 총 루프 수
 * @param {string} [progress.currentStep] - 현재 단계 키 (RESEARCH_STAGE_LABELS)
 * @param {number} [progress.progress] - 진행률 0-100
 * @param {string} [progress.message] - 상태 메시지
 * @returns {void}
 */
function showResearchProgress(progress) {
    if (!progress) return;
    const sessionId = progress.sessionId || '_';

    // sessionId 기준 단일 카드 — 채팅 메시지 영역에서 조회
    let cardMsg = document.querySelector('[data-research-session="' + cssEscapeAttr(sessionId) + '"]');
    if (!cardMsg) {
        // 환영 화면 숨김 (첫 진행 카드 = 대화 시작)
        const welcomeScreen = document.getElementById('welcomeScreen');
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        cardMsg = addChatMessage('assistant', '');
        if (!cardMsg) return;
        cardMsg.dataset.researchSession = sessionId;
        // sendMessage 가 딥리서치 전송 시 보고서용 빈 assistant 버블을 먼저 생성한다.
        // 진행 카드는 그 뒤에 append 되므로 순서가 역전된다 → 보고서 버블 앞으로 이동시켜
        // "진행 카드 → 보고서 버블" 순서를 보장한다.
        const reportBubble = getState('currentAssistantMessage');
        if (reportBubble && reportBubble.parentNode && reportBubble !== cardMsg) {
            reportBubble.parentNode.insertBefore(cardMsg, reportBubble);
        }
    }
    const content = cardMsg.querySelector('.message-content') || cardMsg;
    content.innerHTML = _renderResearchProgressCard(progress);
}

/**
 * 딥리서치 진행 카드 정적 HTML 생성.
 * 모든 동적 텍스트(message)는 escapeHtml 처리 — XSS 방어.
 * iconify lucide:flask-conical 은 modes.js 에서 이미 사용 중 (CSP/CDN 허용 아이콘).
 * @param {Object} p - ResearchProgress
 * @returns {string} 카드 innerHTML
 */
function _renderResearchProgressCard(p) {
    const status = p.status || 'running';
    const terminal = (status === 'completed' || status === 'failed' || status === 'cancelled');
    const pct = Math.max(0, Math.min(100, Math.round(p.progress || 0)));
    const stageLabel = RESEARCH_STAGE_LABELS[p.currentStep] || p.currentStep || '진행중';
    const statusLabel = RESEARCH_STATUS_LABELS[status] || status;

    const statusColors = {
        completed: 'var(--success, #16a34a)',
        failed: 'var(--danger)',
        cancelled: 'var(--text-secondary)'
    };
    const badgeColor = statusColors[status] || 'var(--accent-primary)';

    let html = '<div class="research-progress-chat-card" style="border:1px solid var(--border-light);border-radius:8px;padding:12px;">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">' +
        '<iconify-icon icon="lucide:flask-conical"></iconify-icon><strong>Deep Research</strong>' +
        '<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:var(--bg-tertiary);color:var(--accent-primary);font-weight:500;">' + escapeHtml(stageLabel) + '</span>' +
        '<span style="margin-left:auto;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--bg-tertiary);color:' + badgeColor + ';">' + escapeHtml(statusLabel) + '</span>' +
        '</div>';

    // 루프 N/M (totalLoops > 0 일 때만)
    if (p.totalLoops > 0) {
        html += '<div style="color:var(--text-secondary);font-size:12px;margin-bottom:6px;">루프 ' +
            (Math.max(0, p.currentLoop || 0)) + '/' + p.totalLoops + '</div>';
    }

    // progress bar — terminal(완료/실패/취소) 시 100% 채움
    const barWidth = terminal ? 100 : pct;
    html += '<div style="height:5px;background:var(--bg-tertiary);border-radius:3px;overflow:hidden;">' +
        '<div style="height:100%;background:' + (status === 'failed' ? 'var(--danger)' : 'var(--accent-primary)') +
        ';width:' + barWidth + '%;transition:width .3s;"></div></div>';

    // 상태 메시지 + 퍼센트
    const msg = p.message || (terminal ? statusLabel : '처리 중...');
    html += '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:13px;color:var(--text-secondary);">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(msg) + '</span>' +
        '<span style="flex-shrink:0;">' + barWidth + '%</span>' +
        '</div></div>';
    return html;
}

/**
 * 속성 선택자(attr value)용 최소 이스케이프 — sessionId 에 따옴표/역슬래시가 있어도
 * querySelector 가 깨지지 않게 한다. (sessionId 는 통상 UUID 라 사실상 no-op)
 * @param {string} v
 * @returns {string}
 */
function cssEscapeAttr(v) {
    return String(v).replace(/["\\]/g, '\\$&');
}
/**
 * Phase A (2026-05-26): 응답 스타일 (Concise/Default/Verbose) cycle 토글.
 * claude.ai Style dropdown 동등 — system prompt prepend 으로 작동.
 * Custom Instructions (영구) 와 독립, per-session 적용.
 *
 * 3개 chip 형태 대신 단일 버튼 cycle 패턴 채택:
 *   ⚡ Concise → 📝 Default → 📚 Verbose → ⚡ Concise ...
 * 버튼 1개로 UI 공간 절약 + 명시적 chip 3개 대비 cognitive load 낮음.
 */
const STYLE_CYCLE = ['default', 'concise', 'verbose'];
const STYLE_META = {
    default: { icon: 'pencil', label: '기본', tooltip: '응답 스타일: 기본 (균형)' },
    concise: { icon: 'zap', label: '간결', tooltip: '응답 스타일: 간결 (핵심만)' },
    verbose: { icon: 'book-open', label: '상세', tooltip: '응답 스타일: 상세 (근거·예시 포함)' }
};

function cycleResponseStyle() {
    const current = getState('responseStyle') || 'default';
    const idx = STYLE_CYCLE.indexOf(current);
    const next = STYLE_CYCLE[(idx + 1) % STYLE_CYCLE.length];
    setState('responseStyle', next);
    updateResponseStyleButton();
    const meta = STYLE_META[next];
    showToast(meta.tooltip, 'info');
}

function updateResponseStyleButton() {
    const btn = document.getElementById('responseStyleBtn');
    if (!btn) return;
    const current = getState('responseStyle') || 'default';
    const meta = STYLE_META[current];
    btn.innerHTML = '<iconify-icon icon="lucide:' + meta.icon + '"></iconify-icon>';
    btn.title = meta.tooltip;
    btn.dataset.style = current;
    // default 가 아닐 때만 active 시각 표시
    btn.classList.toggle('active', current !== 'default');
}

function toggleAgentTask() {
    const newValue = !getState('agentTaskMode');
    setState('agentTaskMode', newValue);
    const btn = document.getElementById('agentTaskBtn');
    if (btn) {
        btn.classList.toggle('active', newValue);
        btn.title = newValue ? '에이전트 작업 모드 ON (전송 시 백그라운드 자율 수행)' : '에이전트 작업 (백그라운드 자율 수행)';
    }
    // 다른 모드와 배타 — 켜질 때 deepResearch/discussion 끔
    if (newValue) {
        setState('deepResearchMode', false);
        setState('discussionMode', false);
        const dr = document.getElementById('deepResearchBtn'); if (dr) dr.classList.remove('active');
        const dc = document.getElementById('discussionModeBtn'); if (dc) dc.classList.remove('active');
    }
}

// 전역 노옥 (레거시 호환)
window.toggleAgentTask = toggleAgentTask;
window.toggleDiscussionMode = toggleDiscussionMode;
window.toggleThinkingMode = toggleThinkingMode;
window.toggleDeepResearch = toggleDeepResearch;
window.cycleResponseStyle = cycleResponseStyle;
window.updateResponseStyleButton = updateResponseStyleButton;
window.showDiscussionProgress = showDiscussionProgress;
window.showResearchProgress = showResearchProgress;
export {
    toggleDiscussionMode,
    toggleThinkingMode,
    toggleDeepResearch,
    cycleResponseStyle,
    updateResponseStyleButton,
    showDiscussionProgress,
    showResearchProgress
};
