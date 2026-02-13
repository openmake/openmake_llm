/**
 * Settings Module
 * 설정 관리를 담당합니다.
 */

import { getState, setState } from './state.js';
import { authFetch } from './auth.js';
import { showToast } from './ui.js';

/**
 * MCP 설정 로드
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
 * MCP 설정 저장
 */
function saveMCPSettings() {
    const settings = {
        thinking: getState('thinkingEnabled'),
        webSearch: getState('webSearchEnabled')
    };
    localStorage.setItem('mcpSettings', JSON.stringify(settings));
}

/**
 * MCP 모듈 토글
 * @param {string} module - 모듈 이름
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
 * 토글 UI 업데이트
 * @param {string} id - 토글 ID
 * @param {boolean} enabled - 활성화 여부
 */
function updateToggleUI(id, enabled) {
    const toggle = document.getElementById(id);
    if (toggle) {
        toggle.checked = enabled;
    }
}

/**
 * MCP 토글 UI 전체 업데이트
 */
function updateMCPToggleUI() {
    updateToggleUI('mcpThinking', getState('thinkingEnabled'));
    updateToggleUI('mcpWebSearch', getState('webSearchEnabled'));
}

/**
 * 웹 검색 토글 (빠른 접근용)
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
 * 프롬프트 모드 로드
 */
function loadPromptMode() {
    const saved = localStorage.getItem('promptMode');
    if (saved) {
        setState('promptMode', saved);
    }
}

/**
 * 프롬프트 모드 설정
 * @param {string} mode - 모드 이름
 */
function setPromptMode(mode) {
    setState('promptMode', mode);
    localStorage.setItem('promptMode', mode);
}

/**
 * Agent Mode 로드
 */
function loadAgentMode() {
    const saved = localStorage.getItem('agentMode');
    setState('agentMode', saved === 'true');
}

/**
 * Agent Mode 토글
 */
function toggleAgentMode() {
    const enabled = !getState('agentMode');
    setState('agentMode', enabled);
    localStorage.setItem('agentMode', enabled.toString());
}

/**
 * 현재 모델 정보 로드
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
 * 설정 저장
 */
function saveSettings() {
    saveMCPSettings();
    showToast('설정이 저장되었습니다', 'success');
}

/**
 * 설정 초기화
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
 * 섹션 토글 (접이식)
 * @param {string} sectionId - 섹션 ID
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
