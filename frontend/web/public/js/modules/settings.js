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
 * MCP 도구 마스터 목록 — 백엔드의 builtInTools + tool-tiers와 동기화
 * 카테고리별로 그룹화하여 설정 UI에서 사용합니다.
 * @type {Array<{category: string, emoji: string, tools: Array<{name: string, label: string, description: string}>}>}
 */
var MCP_TOOL_CATALOG = [
    {
        category: '비전',
        emoji: '👁️',
        tools: [
            { name: 'vision_ocr', label: '이미지 OCR', description: '이미지에서 텍스트를 추출합니다' },
            { name: 'analyze_image', label: '이미지 분석', description: '이미지 내용을 분석합니다' }
        ]
    },
    {
        category: '웹 검색',
        emoji: '🌐',
        tools: [
            { name: 'web_search', label: '웹 검색', description: '실시간 웹 검색을 수행합니다' },
            { name: 'fact_check', label: '팩트 체크', description: '정보의 사실 여부를 검증합니다' },
            { name: 'extract_webpage', label: '웹페이지 추출', description: '웹페이지 콘텐츠를 추출합니다' },
            { name: 'research_topic', label: '주제 연구', description: '주제에 대한 심층 연구를 수행합니다' }
        ]
    },
    {
        category: '추론',
        emoji: '🧠',
        tools: [
            { name: 'sequential_thinking', label: 'Sequential Thinking', description: '단계별 논리적 추론 체인' }
        ]
    },
    {
        category: '스크래핑',
        emoji: '🔥',
        tools: [
            { name: 'firecrawl_scrape', label: 'Firecrawl 스크래핑', description: '웹페이지를 스크래핑합니다' },
            { name: 'firecrawl_search', label: 'Firecrawl 검색', description: '웹을 검색합니다' },
            { name: 'firecrawl_map', label: 'Firecrawl URL 맵', description: 'URL 구조를 매핑합니다' },
            { name: 'firecrawl_crawl', label: 'Firecrawl 크롤링', description: '웹사이트를 크롤링합니다' }
        ]
    }
];

/**
 * localStorage에서 MCP 설정을 로드하여 AppState와 UI에 반영
 * thinking, webSearch 토글 상태 및 개별 도구 활성화 상태를 복원합니다.
 * @returns {void}
 */
function loadMCPSettings() {
    const saved = localStorage.getItem('mcpSettings');
    if (saved) {
        try {
            var settings = JSON.parse(saved);
            setState('thinkingEnabled', settings.thinking !== false);
            setState('webSearchEnabled', settings.webSearch === true);

            // MCP 도구 활성화 상태 로드 (기본: 전체 비활성)
            if (settings.enabledTools && typeof settings.enabledTools === 'object') {
                setState('mcpToolsEnabled', settings.enabledTools);
            } else {
                setState('mcpToolsEnabled', {});
            }

            // UI 동기화
            updateMCPToggleUI();
            updateMCPToolTogglesUI();
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
    var settings = {
        thinking: getState('thinkingEnabled'),
        webSearch: getState('webSearchEnabled'),
        enabledTools: getState('mcpToolsEnabled') || {}
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
    setState('mcpToolsEnabled', {});
    setState('promptMode', 'assistant');
    setState('agentMode', false);

    // 테마는 다크로 초기화
    localStorage.setItem('theme', 'dark');
    if (typeof applyTheme === 'function') {
        applyTheme('dark');
    }

    updateMCPToggleUI();
    updateMCPToolTogglesUI();
    showToast('설정이 초기화되었습니다');
}

/**
 * 개별 MCP 도구 활성화/비활성화 토글
 * @param {string} toolName - 도구 이름 (예: 'web_search', 'vision_ocr')
 * @returns {void}
 */
function toggleMCPTool(toolName) {
    var current = getState('mcpToolsEnabled') || {};
    var updated = Object.assign({}, current);
    updated[toolName] = !updated[toolName];
    setState('mcpToolsEnabled', updated);
    saveMCPSettings();

    var status = updated[toolName] ? '활성화' : '비활성화';
    console.log('[Settings] MCP 도구 토글:', toolName, status);
}

/**
 * MCP 도구 전체 활성화/비활성화
 * @param {boolean} enabled - 전체 활성화 여부
 * @returns {void}
 */
function setAllMCPTools(enabled) {
    var updated = {};
    MCP_TOOL_CATALOG.forEach(function(group) {
        group.tools.forEach(function(tool) {
            updated[tool.name] = enabled;
        });
    });
    setState('mcpToolsEnabled', updated);
    saveMCPSettings();
    updateMCPToolTogglesUI();

    showToast(enabled ? 'MCP 도구 전체 활성화' : 'MCP 도구 전체 비활성화');
}

/**
 * 현재 활성화된 MCP 도구 목록 반환 (WebSocket 전송용)
 * @returns {Object} 키: 도구명, 값: boolean
 */
function getEnabledTools() {
    return getState('mcpToolsEnabled') || {};
}

/**
 * MCP 도구 토글 UI 전체 동기화
 * @returns {void}
 */
function updateMCPToolTogglesUI() {
    var enabled = getState('mcpToolsEnabled') || {};
    MCP_TOOL_CATALOG.forEach(function(group) {
        group.tools.forEach(function(tool) {
            var toggle = document.getElementById('mcpTool_' + tool.name);
            if (toggle) {
                toggle.checked = enabled[tool.name] === true;
            }
        });
    });
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
window.toggleMCPTool = toggleMCPTool;
window.setAllMCPTools = setAllMCPTools;
window.getEnabledTools = getEnabledTools;
window.updateMCPToolTogglesUI = updateMCPToolTogglesUI;
window.MCP_TOOL_CATALOG = MCP_TOOL_CATALOG;
window.loadPromptMode = loadPromptMode;
window.setPromptMode = setPromptMode;
window.loadAgentMode = loadAgentMode;
window.toggleAgentMode = toggleAgentMode;
window.loadCurrentModel = loadCurrentModel;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.toggleSection = toggleSection;

export {
    MCP_TOOL_CATALOG,
    loadMCPSettings,
    saveMCPSettings,
    toggleMCPModule,
    toggleWebSearch,
    toggleMCPTool,
    setAllMCPTools,
    getEnabledTools,
    updateMCPToolTogglesUI,
    loadPromptMode,
    setPromptMode,
    loadAgentMode,
    toggleAgentMode,
    loadCurrentModel,
    saveSettings,
    resetSettings,
    toggleSection
};
