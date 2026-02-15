/**
 * ============================================
 * Settings Module - 애플리케이션 설정 관리
 * ============================================
 * MCP 모듈(사고 모드, 웹 검색) 토글, 프롬프트 모드 전환,
 * 에이전트 모드 설정, 모델 정보 로드, 설정 저장/초기화 등
 * 사용자 설정 전반을 관리합니다.
 *
 * @module settings
 */

import { getState, setState } from './state.js';
import { authFetch } from './auth.js';
import { showToast } from './ui.js';

/**
 * localStorage에서 MCP 설정을 로드하여 AppState와 UI에 반영
 * thinking, webSearch 토글 상태를 복원합니다.
 * @returns {void}
 */
function loadMCPSettings() {
    const saved = localStorage.getItem('mcpSettings');
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            setState('thinkingEnabled', settings.thinking !== false);
            setState('webSearchEnabled', settings.webSearch === true);

            // UI 동기화
            updateMCPToggleUI();
        } catch (e) {
            console.error('MCP 설정 로드 오류:', e);
        }
    }
}

/**
 * 현재 MCP 설정을 localStorage에 JSON 형태로 저장
 * @returns {void}
 */
function saveMCPSettings() {
    const settings = {
        thinking: getState('thinkingEnabled'),
        webSearch: getState('webSearchEnabled')
    };
    localStorage.setItem('mcpSettings', JSON.stringify(settings));
}

/**
 * MCP 모듈 활성화/비활성화 토글
 * 상태를 반전시키고 UI를 업데이트한 후 설정을 저장합니다.
 * @param {string} module - 모듈 이름 ('thinking' | 'webSearch' | 'pdf' | 'github')
 * @returns {void}
 */
function toggleMCPModule(module) {
    switch (module) {
        case 'thinking':
            const thinkingEnabled = !getState('thinkingEnabled');
            setState('thinkingEnabled', thinkingEnabled);
            updateToggleUI('mcpThinking', thinkingEnabled);
            break;

        case 'webSearch':
            const webSearchEnabled = !getState('webSearchEnabled');
            setState('webSearchEnabled', webSearchEnabled);
            updateToggleUI('mcpWebSearch', webSearchEnabled);
            break;

        case 'pdf':
            // PDF 모듈은 항상 활성화
            break;

        case 'github':
            // GitHub 모듈 토글
            break;
    }

    saveMCPSettings();
}

/**
 * 개별 토글 체크박스 UI 업데이트
 * @param {string} id - 토글 체크박스 DOM ID
 * @param {boolean} enabled - 체크 상태 설정값
 * @returns {void}
 */
function updateToggleUI(id, enabled) {
    const toggle = document.getElementById(id);
    if (toggle) {
        toggle.checked = enabled;
    }
}

/**
 * 모든 MCP 토글 UI를 현재 AppState에 맞게 동기화
 * @returns {void}
 */
function updateMCPToggleUI() {
    updateToggleUI('mcpThinking', getState('thinkingEnabled'));
    updateToggleUI('mcpWebSearch', getState('webSearchEnabled'));
}

/**
 * 웹 검색 토글 (빠른 접근 버튼용)
 * 토글 후 버튼 active 클래스와 토스트 알림을 표시합니다.
 * @returns {void}
 */
function toggleWebSearch() {
    toggleMCPModule('webSearch');

    const btn = document.getElementById('webSearchBtn');
    if (btn) {
        btn.classList.toggle('active', getState('webSearchEnabled'));
    }

    const status = getState('webSearchEnabled') ? '웹 검색 활성화' : '웹 검색 비활성화';
    showToast(status);
}

/**
 * localStorage에서 프롬프트 모드를 로드하여 AppState에 반영
 * @returns {void}
 */
function loadPromptMode() {
    const saved = localStorage.getItem('promptMode');
    if (saved) {
        setState('promptMode', saved);
    }
}

/**
 * 프롬프트 모드 설정 및 저장
 * @param {string} mode - 모드 이름 (예: 'assistant', 'coder', 'writer' 등)
 * @returns {void}
 */
function setPromptMode(mode) {
    setState('promptMode', mode);
    localStorage.setItem('promptMode', mode);
}

/**
 * localStorage에서 에이전트 모드를 로드하여 AppState에 반영
 * @returns {void}
 */
function loadAgentMode() {
    const saved = localStorage.getItem('agentMode');
    setState('agentMode', saved === 'true');
}

/**
 * 에이전트 모드 활성화/비활성화 토글
 * A2A(Agent-to-Agent) 실행 여부를 제어합니다.
 * @returns {void}
 */
function toggleAgentMode() {
    const enabled = !getState('agentMode');
    setState('agentMode', enabled);
    localStorage.setItem('agentMode', enabled.toString());
}

/**
 * 서버에서 현재 활성 모델 정보를 로드하여 UI에 표시
 * @returns {Promise<void>}
 */
async function loadCurrentModel() {
    try {
        const response = await authFetch('/api/model');
        const data = await response.json();

        const modelNameEl = document.getElementById('activeModelName');
        if (modelNameEl) {
            modelNameEl.textContent = data.model || 'OpenMake LLM Auto';
        }
    } catch (e) {
        console.error('모델 정보 로드 오류:', e);
    }
}

/**
 * 모든 설정을 localStorage에 저장하고 성공 토스트를 표시
 * @returns {void}
 */
function saveSettings() {
    saveMCPSettings();
    showToast('설정이 저장되었습니다', 'success');
}

/**
 * 모든 설정을 기본값으로 초기화
 * MCP 설정, 프롬프트 모드, 에이전트 모드를 삭제하고
 * 테마를 다크로 리셋합니다.
 * @returns {void}
 */
function resetSettings() {
    localStorage.removeItem('mcpSettings');
    localStorage.removeItem('promptMode');
    localStorage.removeItem('agentMode');

    setState('thinkingEnabled', true);
    setState('webSearchEnabled', false);
    setState('promptMode', 'assistant');
    setState('agentMode', false);

    // 테마는 다크로 초기화
    localStorage.setItem('theme', 'dark');
    if (typeof applyTheme === 'function') {
        applyTheme('dark');
    }

    updateMCPToggleUI();
    showToast('설정이 초기화되었습니다');
}

/**
 * 접이식 섹션 열기/닫기 토글
 * collapsed 클래스를 토글하고 화살표 아이콘을 회전합니다.
 * @param {string} sectionId - 토글할 섹션의 DOM ID
 * @returns {void}
 */
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.classList.toggle('collapsed');
    }

    // 화살표 회전
    const header = section?.previousElementSibling;
    const arrow = header?.querySelector('.section-arrow');
    if (arrow) {
        arrow.style.transform = section.classList.contains('collapsed')
            ? 'rotate(-90deg)'
            : 'rotate(0deg)';
    }
}

// 전역 노출 (레거시 호환)
window.loadMCPSettings = loadMCPSettings;
window.saveMCPSettings = saveMCPSettings;
window.toggleMCPModule = toggleMCPModule;
window.toggleWebSearch = toggleWebSearch;
window.loadPromptMode = loadPromptMode;
window.setPromptMode = setPromptMode;
window.loadAgentMode = loadAgentMode;
window.toggleAgentMode = toggleAgentMode;
window.loadCurrentModel = loadCurrentModel;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.toggleSection = toggleSection;

export {
    loadMCPSettings,
    saveMCPSettings,
    toggleMCPModule,
    toggleWebSearch,
    loadPromptMode,
    setPromptMode,
    loadAgentMode,
    toggleAgentMode,
    loadCurrentModel,
    saveSettings,
    resetSettings,
    toggleSection
};
