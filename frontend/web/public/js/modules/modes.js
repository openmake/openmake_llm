/**
 * ============================================
 * Modes - 토론/Thinking/Deep Research 모드 관리
 * ============================================
 * 멀티 에이전트 토론, Ollama Native Thinking, Deep Research 모드의
 * 토글과 진행 상황 UI를 담당합니다.
 *
 * app.js에서 추출됨 (L1600-1960)
 *
 * @module modes
 */

import { getState, setState } from './state.js';
import { showToast } from './ui.js';

/**
 * 멀티 에이전트 토론 모드 토글
 * 토론 모드와 웹 검색은 상호 배타적입니다.
 * @returns {void}
 */
function toggleDiscussionMode() {
    const current = getState('discussionMode');
    const newValue = !current;
    setState('discussionMode', newValue);

    const btn = document.getElementById('discussionModeBtn');
    if (btn) {
        btn.classList.toggle('active', newValue);
        btn.title = newValue ? '토론 모드 활성화됨' : '토론 모드 비활성화됨';
    }

    // 토론 모드와 웹 검색은 동시 사용 불가
    if (newValue && getState('webSearchEnabled')) {
        setState('webSearchEnabled', false);
        const webSearchBtn = document.getElementById('webSearchBtn');
        if (webSearchBtn) {
            webSearchBtn.classList.remove('active');
        }
        showToast('🎯 멀티 에이전트 토론 모드 활성화 (웹 검색 비활성화됨)', 'info');
    } else {
        showToast(newValue ? '🎯 멀티 에이전트 토론 모드 활성화' : '💬 일반 모드로 전환', 'info');
    }
}

/**
 * Ollama Native Thinking 모드 토글
 * @returns {void}
 */
function toggleThinkingMode() {
    const current = getState('thinkingMode');
    const newValue = !current;
    setState('thinkingMode', newValue);

    const thinkingLevel = getState('thinkingLevel') || 'high';
    const btn = document.getElementById('thinkingModeBtn');
    if (btn) {
        btn.classList.toggle('active', newValue);
        btn.title = newValue ? `Thinking 모드 활성화 (${thinkingLevel})` : 'Thinking 모드 비활성화';
    }
    showToast(newValue ? `🧠 Thinking 모드 활성화 (레벨: ${thinkingLevel})` : '💬 일반 모드로 전환', 'info');
}

/**
 * Deep Research 모드 토글
 * @returns {void}
 */
function toggleDeepResearch() {
    const current = getState('deepResearchMode');
    const newValue = !current;
    setState('deepResearchMode', newValue);

    const btn = document.getElementById('deepResearchBtn');
    if (btn) {
        btn.classList.toggle('active', newValue);
        btn.title = newValue ? 'Deep Research 모드 활성화' : 'Deep Research (심층 연구)';
    }

    // Deep Research 모드일 때 다른 모드 비활성화
    if (newValue) {
        if (getState('discussionMode')) {
            setState('discussionMode', false);
            const discussionBtn = document.getElementById('discussionModeBtn');
            if (discussionBtn) discussionBtn.classList.remove('active');
        }
        showToast('🔬 Deep Research 모드 활성화\n주제를 입력하면 자동으로 심층 연구를 수행합니다.', 'info');
    } else {
        showToast('💬 일반 모드로 전환', 'info');
    }
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
            <div class="progress-icon">🎯</div>
            <div class="progress-content">
                <div class="progress-header">
                    <span>🎯 멀티 에이전트 토론 (v2)</span>
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
 * Deep Research 진행 상황을 미니바 스타일로 표시
 * @param {Object} progress - 리서치 진행 정보
 * @param {string} progress.stage - 현재 단계
 * @param {number} progress.progress - 진행률 (0-100)
 * @param {string} progress.message - 현재 상태 메시지
 * @returns {void}
 */
function showResearchProgress(progress) {
    let progressEl = document.getElementById('researchProgress');

    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = 'researchProgress';
        progressEl.innerHTML = `
            <style>
                #researchProgress {
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
                [data-theme="dark"] #researchProgress { background: var(--bg-card); border-color: var(--border-light); }
                #researchProgress .progress-icon { font-size: 1.2rem; animation: researchPulse 2s infinite; }
                #researchProgress .progress-content { flex: 1; display: flex; flex-direction: column; gap: 4px; }
                #researchProgress .progress-header { font-weight: 600; display: flex; justify-content: space-between; font-size: 0.8rem; color: #8B5CF6; }
                #researchProgress .progress-bar-bg { background: var(--bg-tertiary); height: 4px; border-radius: 2px; overflow: hidden; width: 100%; }
                #researchProgress .progress-fill { background: var(--accent-primary); height: 100%; width: 0%; transition: width 0.4s ease; border-radius: 2px; }
                #researchProgress .progress-message { font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                #researchProgress .stage-badge { font-size: 0.65rem; padding: 2px 6px; background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 8px; color: var(--accent-primary); font-weight: 500; }
                @keyframes researchPulse { 0% { transform: scale(1) rotate(0deg); opacity: 1; } 25% { transform: scale(1.1) rotate(5deg); opacity: 0.9; } 50% { transform: scale(1) rotate(0deg); opacity: 1; } 75% { transform: scale(1.1) rotate(-5deg); opacity: 0.9; } 100% { transform: scale(1) rotate(0deg); opacity: 1; } }
            </style>
            <div class="progress-icon">🔬</div>
            <div class="progress-content">
                <div class="progress-header">
                    <span>🔬 Deep Research</span>
                    <span class="stage-badge">준비중</span>
                    <span class="progress-percent">0%</span>
                </div>
                <div class="progress-bar-bg"><div class="progress-fill"></div></div>
                <div class="progress-message">심층 연구 시작 중...</div>
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
    const stageEl = progressEl.querySelector('.stage-badge');

    const stageLabels = {
        'starting': '시작', '초기화': '초기화', 'decompose': '주제 분석', 'decomposing': '분석중',
        'search': '웹 검색', 'searching': '검색중', 'scrape': '콘텐츠 수집',
        'synthesize': '정보 합성', 'synthesizing': '합성중', 'report': '보고서 작성',
        'generating': '작성중', 'complete': '완료', 'completed': '완료'
    };

    if (fillEl) fillEl.style.width = `${progress.progress || 0}%`;
    if (msgEl) msgEl.textContent = progress.message || '처리 중...';
    if (percentEl) percentEl.textContent = `${Math.round(progress.progress || 0)}%`;
    if (stageEl) stageEl.textContent = stageLabels[progress.stage] || progress.stage || '진행중';

    if (progress.stage === 'complete' || progress.stage === 'completed') {
        setTimeout(() => {
            progressEl.style.opacity = '0';
            progressEl.style.transform = 'translateY(10px)';
            progressEl.style.transition = 'all 0.3s ease';
            setTimeout(() => progressEl.remove(), 300);
        }, 2000);
    }
}

// 전역 노출 (레거시 호환)
window.toggleDiscussionMode = toggleDiscussionMode;
window.toggleThinkingMode = toggleThinkingMode;
window.toggleDeepResearch = toggleDeepResearch;
window.showDiscussionProgress = showDiscussionProgress;
window.showResearchProgress = showResearchProgress;

export {
    toggleDiscussionMode,
    toggleThinkingMode,
    toggleDeepResearch,
    showDiscussionProgress,
    showResearchProgress
};
