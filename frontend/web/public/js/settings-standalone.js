/**
 * ============================================
 * Settings Standalone — settings.html 전용 스크립트
 * ============================================
 * settings.html을 직접 접근(URL, 북마크, 새로고침)할 때 사용되는
 * 독립 실행형 설정 페이지 로직입니다.
 *
 * SPA 내 설정은 modules/pages/settings.js가 담당합니다.
 * MCP 설정 스키마는 modules/pages/settings.js와 동기화되어야 합니다.
 *
 * localStorage 'mcpSettings' 스키마:
 *   { thinking: boolean, webSearch: boolean, rag: boolean, enabledTools: { [toolName]: boolean } }
 *
 * @module settings-standalone
 */
(function () {
    'use strict';

    // SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
    var safeStorage = window.SafeStorage;
    var AUTO_MODEL = window.DEFAULT_AUTO_MODEL || 'openmake_llm_auto';
    var SK = window.STORAGE_KEYS || {};

    // ─── 관리자 확인 헬퍼 ───
    function isAdmin() {
        var savedUser = safeStorage.getItem(SK.USER || 'user');
        if (!savedUser) return false;
        try {
            var user = JSON.parse(savedUser);
            return user.role === 'admin' || user.role === 'administrator';
        } catch (e) { return false; }
    }

    // ─── 모델 목록 로드 ───
    async function loadModels() {
        var modelSelect = document.getElementById('modelSelect');
        if (!modelSelect) return;

        // 관리자가 아니면 모델 이름 숨김
        if (!isAdmin()) {
            modelSelect.innerHTML = '<option value="' + AUTO_MODEL + '">OpenMake LLM Auto</option>';
            modelSelect.disabled = true;
            modelSelect.style.cursor = 'default';
            return;
        }

        try {
            var response = await fetch('/api/models');
            if (response.ok) {
                var rawData = await response.json();
                var data = rawData.data || rawData;
                if (data.models && data.models.length > 0) {
                    var savedModel = safeStorage.getItem(SK.SELECTED_MODEL || 'selectedModel');
                    var defaultModel = data.defaultModel || AUTO_MODEL;

                    modelSelect.innerHTML = data.models.map(function (model) {
                        var modelId = model.modelId || model.name;
                        var displayName = model.name;
                        var desc = model.description || '';
                        var isSelected = savedModel ? modelId === savedModel : modelId === defaultModel;
                        return '<option value="' + modelId + '" ' + (isSelected ? 'selected' : '') + '>' +
                            displayName + (desc ? ' — ' + desc : '') + '</option>';
                    }).join('');
                }
            }
        } catch (e) {
            console.error('모델 로드 실패:', e);
            var savedModel = safeStorage.getItem(SK.SELECTED_MODEL || 'selectedModel');
            if (savedModel) {
                modelSelect.innerHTML = '<option value="' + savedModel + '">' + savedModel + '</option>';
            }
        }
    }

    // ─── 시스템 정보 로드 ───
    async function loadSystemInfo() {
        try {
            var res = await fetch('/health');
            if (res.ok) {
                var json = await res.json();
                var d = json.data || json;
                var verEl = document.getElementById('sysVersion');
                var statusEl = document.getElementById('sysStatus');
                var nodesEl = document.getElementById('sysNodes');
                var updateEl = document.getElementById('sysLastUpdate');
                if (verEl) verEl.textContent = 'v' + (d.version || '?');
                if (statusEl) {
                    statusEl.textContent = '● ' + (d.status === 'healthy' ? '온라인' : '오프라인');
                    statusEl.style.color = d.status === 'healthy' ? 'var(--success)' : 'var(--error)';
                }
                if (nodesEl && d.cluster) {
                    nodesEl.textContent = d.cluster.onlineNodes + '/' + d.cluster.totalNodes + ' (' + d.cluster.totalModels + ' 모델)';
                }
                if (updateEl && d.build && d.build.gitDate) {
                    updateEl.textContent = d.build.gitDate;
                }
            }
        } catch (e) {
            console.warn('시스템 정보 로드 실패:', e);
        }
    }

    // ─── 계정 카드 초기화 ───
    function initAccountCard() {
        var accountCard = document.getElementById('accountCard');
        var adminLink = document.getElementById('adminLink');
        var savedUser = safeStorage.getItem(SK.USER || 'user');
        var loggedIn = !!savedUser && savedUser !== '{}' && savedUser !== 'null';
        if (loggedIn && accountCard) {
            accountCard.style.display = '';
            if (isAdmin() && adminLink) adminLink.style.display = '';
        }
    }

    // ─── 테마 설정 ───
    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        safeStorage.setItem('theme', theme);
    }

    // ─── 설정 저장 (mcpSettings 스키마: modules/pages/settings.js 동기화) ───
    function saveSettings() {
        var themeSelect = document.getElementById('themeSelect');
        var modelSelect = document.getElementById('modelSelect');
        var thinkingToggle = document.getElementById('thinkingToggle');
        var webSearchToggle = document.getElementById('webSearchToggle');
        var ragToggle = document.getElementById('ragToggle');
        var langSelect = document.getElementById('langSelect');
        var saveHistoryToggle = document.getElementById('saveHistoryToggle');

        if (themeSelect) setTheme(themeSelect.value);
        if (modelSelect) safeStorage.setItem(SK.SELECTED_MODEL || 'selectedModel', modelSelect.value);

        // mcpSettings: read-merge-write 패턴으로 enabledTools 등 기존 필드 보존
        var mcpSettings = JSON.parse(safeStorage.getItem(SK.MCP_SETTINGS || 'mcpSettings') || '{}');
        if (thinkingToggle) mcpSettings.thinking = thinkingToggle.checked;
        var webSearchChecked = webSearchToggle ? webSearchToggle.checked : false;
        mcpSettings.webSearch = webSearchChecked;
        if (ragToggle) mcpSettings.rag = ragToggle.checked;
        // 양방향 동기화: webSearchToggle ↔ enabledTools.web_search
        if (!mcpSettings.enabledTools) mcpSettings.enabledTools = {};
        mcpSettings.enabledTools.web_search = webSearchChecked;
        safeStorage.setItem(SK.MCP_SETTINGS || 'mcpSettings', JSON.stringify(mcpSettings));

        if (langSelect && saveHistoryToggle) {
            safeStorage.setItem(SK.GENERAL_SETTINGS || 'generalSettings', JSON.stringify({
                lang: langSelect.value,
                saveHistory: saveHistoryToggle.checked
            }));
        }

        alert('설정이 저장되었습니다.');
    }

    // ─── 설정 로드 (mcpSettings 스키마: modules/pages/settings.js 동기화) ───
    function loadSettings() {
        var theme = safeStorage.getItem(SK.THEME || 'theme') || 'dark';
        var themeSelect = document.getElementById('themeSelect');
        if (themeSelect) {
            themeSelect.value = theme;
        }
        setTheme(theme);

        var selectedModel = safeStorage.getItem(SK.SELECTED_MODEL || 'selectedModel');
        if (selectedModel) {
            var modelSelect = document.getElementById('modelSelect');
            if (modelSelect) {
                var opts = modelSelect.options;
                for (var i = 0; i < opts.length; i++) {
                    if (opts[i].value === selectedModel) {
                        modelSelect.value = selectedModel;
                        break;
                    }
                }
            }
        }

        var savedMcp = safeStorage.getItem(SK.MCP_SETTINGS || 'mcpSettings');
        if (savedMcp) {
            try {
                var mcp = JSON.parse(savedMcp);
                var thinkingEl = document.getElementById('thinkingToggle');
                var webSearchEl = document.getElementById('webSearchToggle');
                var ragEl = document.getElementById('ragToggle');
                if (thinkingEl) thinkingEl.checked = mcp.thinking !== false;
                // 양방향 동기화: enabledTools.web_search 우선, 레거시 webSearch 폴백
                var webSearchOn = (mcp.enabledTools && mcp.enabledTools.web_search === true) || mcp.webSearch === true;
                if (webSearchEl) webSearchEl.checked = webSearchOn;
                if (ragEl) ragEl.checked = mcp.rag === true;
            } catch (e) {
                console.warn('mcpSettings 파싱 실패:', e);
            }
        }

        var savedGeneral = safeStorage.getItem(SK.GENERAL_SETTINGS || 'generalSettings');
        if (savedGeneral) {
            try {
                var general = JSON.parse(savedGeneral);
                var langEl = document.getElementById('langSelect');
                var historyEl = document.getElementById('saveHistoryToggle');
                if (langEl) langEl.value = general.lang || 'ko';
                if (historyEl) historyEl.checked = general.saveHistory !== false;
            } catch (e) {
                console.warn('generalSettings 파싱 실패:', e);
            }
        }
    }

    // ─── 설정 초기화 ───
    function resetSettings() {
        if (confirm('모든 설정을 초기화하시겠습니까?')) {
            safeStorage.removeItem(SK.THEME || 'theme');
            safeStorage.removeItem(SK.SELECTED_MODEL || 'selectedModel');
            safeStorage.removeItem(SK.MCP_SETTINGS || 'mcpSettings');
            safeStorage.removeItem(SK.GENERAL_SETTINGS || 'generalSettings');
            location.reload();
        }
    }

    // ─── 데이터 내보내기 (스텁) ───
    function exportData() {
        alert('데이터 내보내기 기능은 준비 중입니다.');
    }

    // ─── 대화 기록 삭제 (스텁) ───
    function clearHistory() {
        if (confirm('모든 대화 기록을 삭제하시겠습니까?')) {
            alert('대화 기록이 삭제되었습니다.');
        }
    }

    // ─── 초기화 ───
    async function initSettings() {
        await loadModels();
        loadSettings();
        loadSystemInfo();
        initAccountCard();
    }

    // ─── 전역 노출 (sidebar.js 등 외부 참조용) ───
    window.setTheme = setTheme;

    // ─── DOM 준비 후 초기화 및 이벤트 바인딩 ───
    document.addEventListener('DOMContentLoaded', function () {
        initSettings();

        // 테마 셀렉트 변경 이벤트
        var themeSelect = document.getElementById('themeSelect');
        if (themeSelect) {
            themeSelect.addEventListener('change', function () {
                setTheme(this.value);
            });
        }

        // 설정 저장 버튼
        var saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', saveSettings);
        }

        // 초기화 버튼
        var resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', resetSettings);
        }

        // 데이터 내보내기 버튼
        var exportBtn = document.getElementById('exportBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', exportData);
        }

        // 대화 기록 삭제 버튼
        var clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', clearHistory);
        }
    });
})();
