/**
 * ============================================
 * Settings Page - 사용자 설정 (글래스모피즘 UI)
 * ============================================
 * 테마, 모델 선택, MCP 모듈 토글, 프롬프트 모드,
 * 알림 설정, 계정 관리 등 사용자 설정 전반을
 * 글래스모피즘 디자인으로 제공하는 SPA 페이지 모듈입니다.
 *
 * @module pages/settings
 */
(function () {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    var CSS = '' +
        '.page-settings { position: relative; min-height: 100%; background: var(--bg-app); }' +
        '.settings-container { max-width: 680px; margin: 0 auto; padding: var(--space-8) var(--space-6); }' +
        '.settings-hero { text-align: center; margin-bottom: var(--space-10); }' +
        '.settings-hero-icon { font-size: 3rem; margin-bottom: var(--space-4); display: block; filter: drop-shadow(2px 2px 0 rgba(0,0,0,0.5)); }' +
        '.settings-hero h1 {' +
        'font-size: var(--font-size-3xl); font-weight: var(--font-weight-bold);' +
        'background: var(--gradient-primary); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;' +
        'margin-bottom: var(--space-2); letter-spacing: -0.02em;' +
        '}' +
        '.settings-hero p { color: var(--text-secondary); font-size: var(--font-size-base); }' +
        '.s-card {' +
        'background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);' +
        'border: 1px solid var(--glass-border); border-radius: var(--radius-xl); padding: 0; margin-bottom: var(--space-6);' +
        'box-shadow: 4px 4px 0 #000; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); overflow: hidden;' +
        'animation: s-slideUp 0.5s ease both;' +
        '}' +
        '.s-card:nth-child(2) { animation-delay: 0.05s; }' +
        '.s-card:nth-child(3) { animation-delay: 0.1s; }' +
        '.s-card:nth-child(4) { animation-delay: 0.15s; }' +
        '.s-card:nth-child(5) { animation-delay: 0.2s; }' +
        '.s-card:hover { border-color: var(--border-medium); box-shadow: 6px 6px 0 #000; transform: translate(-2px, -2px); }' +
        '.s-card-header {' +
        'display: flex; align-items: center; gap: var(--space-3); padding: var(--space-5) var(--space-6);' +
        'border-bottom: 1px solid var(--glass-border); position: relative;' +
        '}' +
        '.s-card-header::after {' +
        'content: ""; position: absolute; bottom: -1px; left: var(--space-6); right: var(--space-6); height: 1px;' +
        'background: var(--accent-primary);' +
        '}' +
        '.s-card-icon { font-size: 1.3rem; }' +
        '.s-card-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-primary); }' +
        '.s-card-body { padding: var(--space-4) var(--space-6) var(--space-6); }' +
        '.setting-row {' +
        'display: flex; justify-content: space-between; align-items: center;' +
        'padding: var(--space-4) 0; border-bottom: 1px solid var(--border-light); gap: var(--space-4);' +
        '}' +
        '.setting-row:last-child { border-bottom: none; }' +
        '.setting-info { flex: 1; min-width: 0; }' +
        '.setting-info h4 { font-size: var(--font-size-base); font-weight: var(--font-weight-medium); color: var(--text-primary); margin-bottom: 2px; }' +
        '.setting-info p { font-size: var(--font-size-sm); color: var(--text-muted); line-height: 1.4; }' +
        '.s-select {' +
        'appearance: none; -webkit-appearance: none; background: var(--glass-bg); border: 1px solid var(--glass-border);' +
        'border-radius: var(--radius-md); padding: var(--space-2) var(--space-8) var(--space-2) var(--space-3);' +
        'color: var(--text-primary); font-size: var(--font-size-sm); font-family: inherit; cursor: pointer; min-width: 160px;' +
        'transition: all var(--transition-normal);' +
        "background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23a1a1aa' d='M6 8L1 3h10z'/%3E%3C/svg%3E\");" +
        'background-repeat: no-repeat; background-position: right 12px center; flex-shrink: 0;' +
        '}' +
        '.s-select:focus { outline: none; border-color: var(--accent-primary); box-shadow: var(--glow-input-focus); }' +
        '.s-select:hover { border-color: var(--border-medium); }' +
        '.s-select option { background: var(--bg-secondary); color: var(--text-primary); }' +
        '.toggle { position: relative; display: inline-block; width: 48px; height: 26px; flex-shrink: 0; }' +
        '.toggle input { opacity: 0; width: 0; height: 0; }' +
        '.toggle-slider {' +
        'position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;' +
        'background: var(--bg-tertiary); border-radius: 26px; transition: all 0.3s cubic-bezier(0.4,0,0.2,1);' +
        '}' +
        '.toggle-slider:before {' +
        'position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px;' +
        'background: white; border-radius: 50%; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); box-shadow: var(--shadow-sm);' +
        '}' +
        '.toggle input:checked + .toggle-slider { background: var(--accent-primary); box-shadow: 2px 2px 0 #000; }' +
        '.toggle input:checked + .toggle-slider:before { transform: translateX(22px); }' +
        '.info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); }' +
        '.info-item {' +
        'background: var(--glass-bg); border: 1px solid var(--glass-border); padding: var(--space-4);' +
        'border-radius: var(--radius-lg); transition: all var(--transition-normal);' +
        '}' +
        '.info-item:hover { background: var(--glass-bg-hover); border-color: var(--border-medium); transform: translate(-2px, -2px); box-shadow: 4px 4px 0 #000; }' +
        '.info-label { font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-2); }' +
        '.info-value { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-primary); }' +
        '.s-btn-row { display: flex; gap: var(--space-3); margin-top: var(--space-4); }' +
        '.s-btn {' +
        'display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-5);' +
        'border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);' +
        'font-family: inherit; cursor: pointer; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); border: none; position: relative; overflow: hidden;' +
        '}' +
        '.s-btn-primary { background: var(--gradient-primary); color: #ffffff; }' +
        '.s-btn-primary:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 #000; }' +
        '.s-btn-primary:active { transform: translateY(0); }' +
        '.s-btn-secondary { background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }' +
        '.s-btn-secondary:hover { background: var(--glass-bg-hover); color: var(--text-primary); border-color: var(--border-medium); }' +
        '.s-btn-danger { background: var(--glass-bg); border: 2px solid var(--danger); color: var(--danger); }' +
        '.s-btn-danger:hover { background: var(--bg-hover, #323250); border-color: var(--danger); }' +
        '.s-footer { display: flex; gap: var(--space-3); padding-top: var(--space-4); animation: s-slideUp 0.5s ease 0.25s both; }' +
        '@keyframes s-slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }' +
        '@media (max-width: 768px) {' +
        '.settings-container { padding: var(--space-6) var(--space-4); }' +
        '.settings-hero { margin-bottom: var(--space-6); }' +
        '.settings-hero h1 { font-size: var(--font-size-2xl); }' +
        '.s-card-header { padding: var(--space-4) var(--space-5); }' +
        '.s-card-body { padding: var(--space-3) var(--space-5) var(--space-5); }' +
        '.setting-row { flex-direction: column; align-items: flex-start; gap: var(--space-3); }' +
        '.s-select { width: 100%; min-width: unset; }' +
        '.info-grid { grid-template-columns: 1fr 1fr; gap: var(--space-3); }' +
        '.s-btn-row { flex-wrap: wrap; }' +
        '.s-btn { flex: 1; justify-content: center; min-width: 0; }' +
        '.s-footer { flex-wrap: wrap; }' +
        '.s-footer .s-btn { flex: 1; justify-content: center; }' +
        '}' +
        '@media (max-width: 400px) { .info-grid { grid-template-columns: 1fr; } }' +
        '.toast {' +
        'position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(100px);' +
        'background: var(--glass-bg);' +
        'border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: var(--space-3) var(--space-5);' +
        'color: var(--text-primary); font-size: var(--font-size-sm); z-index: 9999; opacity: 0;' +
        'transition: all 0.3s ease; pointer-events: none; box-shadow: 6px 6px 0 #000;' +
        '}' +
        '.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }' +
        /* Tier badge styles */
        '.tier-badge { display:inline-block; font-size:9px; padding:1px 6px; border-radius:3px; font-weight:700; letter-spacing:0.5px; margin-left:6px; vertical-align:middle; text-transform:uppercase; }' +
        '.tier-badge-pro { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; }' +
        '.tier-badge-enterprise { background:linear-gradient(135deg,#f59e0b,#ef4444); color:#fff; }' +
        '.mcp-tool-locked { opacity:0.45; pointer-events:none; }' +
        '.mcp-tool-locked .toggle-slider { cursor:not-allowed !important; }';

    var HTML =
        '<div class="settings-container">' +
        '<div class="settings-hero">' +
        '<span class="settings-hero-icon">\u2699\uFE0F</span>' +
        '<h1>\uC124\uC815</h1>' +
        '<p>\uC571 \uD658\uACBD \uBC0F AI \uBAA8\uB378 \uC124\uC815</p>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon">\uD83C\uDFA8</span>' +
        '<span class="s-card-title">\uC678\uAD00</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uD14C\uB9C8</h4><p>\uC571\uC758 \uC0C9\uC0C1 \uD14C\uB9C8\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4</p></div>' +
        '<select id="themeSelect" class="s-select" onchange="setTheme(this.value)">' +
        '<option value="dark">\uB2E4\uD06C \uBAA8\uB4DC</option>' +
        '<option value="light">\uB77C\uC774\uD2B8 \uBAA8\uB4DC</option>' +
        '<option value="system">\uC2DC\uC2A4\uD15C \uC124\uC815</option>' +
        '</select>' +
        '</div>' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uC5B8\uC5B4</h4><p>\uC778\uD130\uD398\uC774\uC2A4 \uC5B8\uC5B4\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4 <span style="font-size:var(--font-size-xs);color:var(--text-muted);opacity:0.7;">(\uC900\uBE44 \uC911)</span></p></div>' +
        '<select id="langSelect" class="s-select" disabled style="opacity:0.5;cursor:not-allowed;">' +
        '<option value="ko">\uD55C\uAD6D\uC5B4</option>' +
        '<option value="en">English</option>' +
        '<option value="ja">\u65E5\u672C\u8A9E</option>' +
        '</select>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon">\uD83E\uDD16</span>' +
        '<span class="s-card-title">AI \uBAA8\uB378</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uAE30\uBCF8 \uBAA8\uB378</h4><p>\uCC44\uD305\uC5D0 \uC0AC\uC6A9\uD560 AI \uBAA8\uB378\uC744 \uC120\uD0DD\uD569\uB2C8\uB2E4</p></div>' +
        '<select id="modelSelect" class="s-select">' +
        '<option value="openmake_llm_auto">OpenMake LLM Auto</option>' +
        '<option value="openmake_llm">OpenMake LLM</option>' +
        '<option value="openmake_llm_pro">OpenMake LLM Pro</option>' +
        '<option value="openmake_llm_fast">OpenMake LLM Fast</option>' +
        '<option value="openmake_llm_think">OpenMake LLM Think</option>' +
        '<option value="openmake_llm_code">OpenMake LLM Code</option>' +
        '<option value="openmake_llm_vision">OpenMake LLM Vision</option>' +
        '</select>' +
        '</div>' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>Sequential Thinking</h4><p>Chain-of-Thought \uCD94\uB860 \uD65C\uC131\uD654</p></div>' +
        '<label class="toggle"><input type="checkbox" checked id="thinkingToggle"><span class="toggle-slider"></span></label>' +
        '</div>' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uC6F9 \uAC80\uC0C9</h4><p>\uC2E4\uC2DC\uAC04 \uC6F9 \uAC80\uC0C9 \uAE30\uB2A5 \uD65C\uC131\uD654</p></div>' +
        '<label class="toggle"><input type="checkbox" checked id="webSearchToggle"><span class="toggle-slider"></span></label>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon">\uD83D\uDD27</span>' +
        '<span class="s-card-title">MCP \uB3C4\uAD6C</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>MCP \uB3C4\uAD6C \uAD00\uB9AC</h4><p>AI\uAC00 \uC0AC\uC6A9\uD560 \uC218 \uC788\uB294 \uC678\uBD80 \uB3C4\uAD6C\uB97C \uAC1C\uBCC4\uC801\uC73C\uB85C \uD65C\uC131\uD654/\uBE44\uD65C\uC131\uD654\uD569\uB2C8\uB2E4</p></div>' +
        '<div class="s-btn-row" style="gap:6px;">' +
        '<button class="s-btn s-btn-secondary" style="font-size:var(--font-size-xs);padding:4px 10px;" id="mcpEnableAllBtn">\uC804\uCCB4 \uD65C\uC131\uD654</button>' +
        '<button class="s-btn s-btn-secondary" style="font-size:var(--font-size-xs);padding:4px 10px;" id="mcpDisableAllBtn">\uC804\uCCB4 \uBE44\uD65C\uC131\uD654</button>' +
        '</div>' +
        '</div>' +
        '<div id="mcpToolToggles"></div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon">\uD83D\uDCBE</span>' +
        '<span class="s-card-title">\uB370\uC774\uD130</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uB300\uD654 \uAE30\uB85D \uC800\uC7A5</h4><p>\uB300\uD654 \uB0B4\uC6A9\uC744 \uC11C\uBC84\uC5D0 \uC800\uC7A5\uD569\uB2C8\uB2E4</p></div>' +
        '<label class="toggle"><input type="checkbox" checked id="saveHistoryToggle"><span class="toggle-slider"></span></label>' +
        '</div>' +
        '<div class="s-btn-row">' +
        '<button class="s-btn s-btn-secondary" onclick="exportData()">\uD83D\uDCE5 \uB370\uC774\uD130 \uB0B4\uBCF4\uB0B4\uAE30</button>' +
        '<button class="s-btn s-btn-danger" onclick="clearHistory()">\uD83D\uDDD1\uFE0F \uAE30\uB85D \uC0AD\uC81C</button>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon">\uD83D\uDD10</span>' +
        '<span class="s-card-title">API \uD0A4 \uAD00\uB9AC</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info">' +
        '<h4>\uC678\uBD80 API \uC5F0\uB3D9</h4>' +
        '<p>API \uD0A4\uB97C \uBC1C\uAE09\uD558\uC5EC \uC678\uBD80 \uC11C\uBE44\uC2A4\uC5D0\uC11C OpenMake.AI\uB97C \uC0AC\uC6A9\uD558\uC138\uC694</p>' +
        '</div>' +
        '<span id="apiKeyCount" style="font-size:var(--font-size-sm); color:var(--text-muted); white-space:nowrap;"></span>' +
        '</div>' +
        '<div class="s-btn-row">' +
        '<a href="/api-keys.html" class="s-btn s-btn-primary" style="text-decoration:none;">\uD83D\uDD11 API \uD0A4 \uAD00\uB9AC</a>' +
        '<a href="/developer.html" class="s-btn s-btn-secondary" style="text-decoration:none;">\uD83D\uDCCB API \uBB38\uC11C</a>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card" id="accountCard" style="display:none;">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon">\uD83D\uDC64</span>' +
        '<span class="s-card-title">\uACC4\uC815 \uAD00\uB9AC</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info">' +
        '<h4>\uACC4\uC815 \uC124\uC815</h4>' +
        '<p>\uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD \uBC0F \uC0AC\uC6A9\uC790 \uAD00\uB9AC</p>' +
        '</div>' +
        '</div>' +
        '<div class="s-btn-row">' +
        '<a href="/password-change.html" class="s-btn s-btn-primary" style="text-decoration:none;">\uD83D\uDD11 \uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD</a>' +
        '<a href="/admin.html" class="s-btn s-btn-secondary" id="adminLink" style="text-decoration:none;display:none;">\uD83D\uDC65 \uC0AC\uC6A9\uC790 \uAD00\uB9AC</a>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon">\u2139\uFE0F</span>' +
        '<span class="s-card-title">\uC2DC\uC2A4\uD15C \uC815\uBCF4</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="info-grid">' +
        '<div class="info-item"><div class="info-label">버전</div><div class="info-value" id="sysVersion">로딩...</div></div>' +
        '<div class="info-item"><div class="info-label">서버 상태</div><div class="info-value" id="sysStatus">확인 중...</div></div>' +
        '<div class="info-item"><div class="info-label">활성 노드</div><div class="info-value" id="sysNodes">-</div></div>' +
        '<div class="info-item"><div class="info-label">마지막 업데이트</div><div class="info-value" id="sysLastUpdate">-</div></div>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-footer">' +
        '<button class="s-btn s-btn-primary" onclick="saveSettings()">\uD83D\uDCBE \uC124\uC815 \uC800\uC7A5</button>' +
        '<button class="s-btn s-btn-secondary" onclick="resetSettings()">\u21A9\uFE0F \uCD08\uAE30\uD654</button>' +
        '</div>' +
        '</div>' +
        '<div id="toast" class="toast"></div>';

    window.PageModules['settings'] = {
        getHTML: function () {
            return '<div class="page-settings">' +
                '<style data-spa-style="settings">' + CSS + '<\/style>' +
                HTML +
                '<\/div>';
        },

        init: function () {
            try {
                var safeStorage = window.SafeStorage || localStorage;
                // 관리자 확인 헬퍼
                function isAdmin() {
                    const savedUser = safeStorage.getItem('user');
                    if (!savedUser) return false;
                    try {
                        const user = JSON.parse(savedUser);
                        return user.role === 'admin' || user.role === 'administrator';
                    } catch (e) { return false; }
                }

                async function loadModels() {
                    const modelSelect = document.getElementById('modelSelect');

                    // 🔒 관리자가 아니면 모델 이름 숨김
                    if (!isAdmin()) {
                        modelSelect.innerHTML = '<option value="openmake_llm_auto">OpenMake LLM Auto</option>';
                        modelSelect.disabled = true;
                        modelSelect.style.cursor = 'default';
                        return;
                    }

                    try {
                        const response = await fetch('/api/models', {
                            credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                        });
                        if (response.ok) {
                            const rawData = await response.json();
                            var data = rawData.data || rawData;
                            if (data.models && data.models.length > 0) {
                                var savedModel = safeStorage.getItem('selectedModel');
                                var defaultModel = data.defaultModel || 'openmake_llm_auto';

                                modelSelect.innerHTML = data.models.map(function (model) {
                                    var modelId = model.modelId || model.name;
                                    var displayName = model.name;
                                    var desc = model.description || '';
                                    var isSelected = savedModel ? modelId === savedModel : modelId === defaultModel;
                                    return '<option value="' + esc(modelId) + '" ' + (isSelected ? 'selected' : '') + '>' + esc(displayName) + (desc ? ' — ' + esc(desc) : '') + '</option>';
                                }).join('');
                            }
                        }
                    } catch (e) {
                        console.error('모델 로드 실패:', e);
                        var savedModel = safeStorage.getItem('selectedModel');
                        if (savedModel) modelSelect.innerHTML = '<option value="' + savedModel + '">' + savedModel + '</option>';
                    }
                }

                async function loadApiKeyCount() {
                    try {
                        var authToken = safeStorage.getItem('authToken');
                        var headers = authToken ? { 'Authorization': 'Bearer ' + authToken } : {};
                        var res = await fetch('/api/v1/api-keys', { credentials: 'include', headers: headers });
                        if (res.ok) {
                            var data = await res.json();
                            var count = (data.data && data.data.count) || 0;
                            var el = document.getElementById('apiKeyCount');
                            if (el) el.textContent = count + '개 활성';
                        } else {
                            var el = document.getElementById('apiKeyCount');
                            if (el) el.textContent = '로그인 필요';
                        }
                    } catch (e) {
                        var el2 = document.getElementById('apiKeyCount');
                        if (el2) el2.textContent = '로그인 필요';
                    }
                }

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
                    } catch (e) { console.warn('시스템 정보 로드 실패:', e); }
                }

                async function initSettings() { await loadModels(); loadSettings(); loadApiKeyCount(); loadSystemInfo(); }

                function setTheme(theme) { document.documentElement.setAttribute('data-theme', theme); safeStorage.setItem('theme', theme); }

                function saveSettings() {
                    setTheme(document.getElementById('themeSelect').value);
                    safeStorage.setItem('selectedModel', document.getElementById('modelSelect').value);
                    var mcpSettings = JSON.parse(safeStorage.getItem('mcpSettings') || '{}');
                    mcpSettings.thinking = document.getElementById('thinkingToggle').checked;
                    mcpSettings.webSearch = document.getElementById('webSearchToggle').checked;

                    // MCP 도구 토글 상태 수집 — DOM에서 mcpTool_ 프리픽스 체크박스 직접 조회
                    var enabledTools = {};
                    var mcpCheckboxes = document.querySelectorAll('input[id^="mcpTool_"]');
                    mcpCheckboxes.forEach(function (el) {
                        var toolName = el.id.replace('mcpTool_', '');
                        enabledTools[toolName] = el.checked;
                    });
                    mcpSettings.enabledTools = enabledTools;
                    safeStorage.setItem('mcpSettings', JSON.stringify(mcpSettings));

                    // AppState 동기화
                    if (typeof setState === 'function') {
                        setState('thinkingEnabled', mcpSettings.thinking);
                        setState('webSearchEnabled', mcpSettings.webSearch);
                        setState('mcpToolsEnabled', enabledTools);
                    }

                    safeStorage.setItem('generalSettings', JSON.stringify({ lang: document.getElementById('langSelect').value, saveHistory: document.getElementById('saveHistoryToggle').checked }));
                    (typeof showToast === 'function' ? showToast('설정이 저장되었습니다.', 'warning') : console.warn('설정이 저장되었습니다.'));
                }

                function loadSettings() {
                    var theme = safeStorage.getItem('theme') || 'dark';
                    document.getElementById('themeSelect').value = theme;
                    setTheme(theme);
                    var selectedModel = safeStorage.getItem('selectedModel');
                    if (selectedModel) {
                        var opts = document.getElementById('modelSelect').options;
                        for (var i = 0; i < opts.length; i++) {
                            if (opts[i].value === selectedModel) { document.getElementById('modelSelect').value = selectedModel; break; }
                        }
                    }
                    var savedMcp = safeStorage.getItem('mcpSettings');
                    if (savedMcp) { var mcp = JSON.parse(savedMcp); document.getElementById('thinkingToggle').checked = mcp.thinking !== false; document.getElementById('webSearchToggle').checked = mcp.webSearch === true; }
                    var savedGeneral = safeStorage.getItem('generalSettings');
                    if (savedGeneral) { var general = JSON.parse(savedGeneral); document.getElementById('langSelect').value = general.lang || 'ko'; document.getElementById('saveHistoryToggle').checked = general.saveHistory !== false; }
                }

                function resetSettings() { if (confirm('모든 설정을 초기화하시겠습니까?')) { safeStorage.removeItem('theme'); safeStorage.removeItem('selectedModel'); safeStorage.removeItem('mcpSettings'); safeStorage.removeItem('generalSettings'); location.reload(); } }

                async function exportData() {
                    try {
                        var authToken = safeStorage.getItem('authToken');
                        if (!authToken) {
                            (typeof showToast === 'function' ? showToast('로그인이 필요합니다.', 'warning') : console.warn('로그인이 필요합니다.'));
                            return;
                        }
                        var headers = { 'Authorization': 'Bearer ' + authToken };
                        var res = await fetch('/api/chat/sessions?limit=500', { credentials: 'include', headers: headers });
                        if (!res.ok) throw new Error('서버 응답 오류: ' + res.status);
                        var data = await res.json();
                        var payload = data.data || data;
                        var sessions = payload.sessions || [];
                        if (sessions.length === 0) {
                            (typeof showToast === 'function' ? showToast('내보낼 대화 기록이 없습니다.', 'warning') : console.warn('내보낼 대화 기록이 없습니다.'));
                            return;
                        }
                        var blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
                        var url = URL.createObjectURL(blob);
                        var a = document.createElement('a');
                        a.href = url;
                        a.download = 'openmake_chat_export_' + new Date().toISOString().slice(0, 10) + '.json';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        (typeof showToast === 'function' ? showToast(sessions.length + '개 대화가 내보내기되었습니다.', 'success') : console.log('Export complete'));
                    } catch (e) {
                        console.error('데이터 내보내기 실패:', e);
                        (typeof showToast === 'function' ? showToast('데이터 내보내기에 실패했습니다.', 'error') : console.error('데이터 내보내기 실패'));
                    }
                }

                async function clearHistory() {
                    if (!confirm('모든 대화 기록을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
                    try {
                        var res = await window.authFetch('/api/chat/sessions', { method: 'DELETE' });
                        if (!res.ok) throw new Error('서버 응답 오류: ' + res.status);
                        var data = await res.json();
                        var count = (data.data && data.data.count) || 0;
                        (typeof showToast === 'function' ? showToast(count + '개 대화 기록이 삭제되었습니다.', 'success') : console.log('History cleared'));
                    } catch (e) {
                        console.error('대화 기록 삭제 실패:', e);
                        (typeof showToast === 'function' ? showToast('대화 기록 삭제에 실패했습니다.', 'error') : console.error('대화 기록 삭제 실패'));
                    }
                }

                initSettings();

                // 계정 관리 카드 표시 (로그인 시에만)
                (function initAccountCard() {
                    var accountCard = document.getElementById('accountCard');
                    var adminLink = document.getElementById('adminLink');
                    var loggedIn = !!safeStorage.getItem('authToken');
                    if (loggedIn && accountCard) {
                        accountCard.style.display = '';
                        if (isAdmin() && adminLink) adminLink.style.display = '';
                    }
                })();

                // 사용자 등급(tier) 판별 — 백엔드 tool-tiers.ts의 getDefaultTierForRole 동기화
                function getUserTier() {
                    var isGuest = safeStorage.getItem('guestMode') === 'true' ||
                        safeStorage.getItem('isGuest') === 'true' ||
                        !safeStorage.getItem('authToken');
                    if (isGuest) return 'free';
                    var savedUser = safeStorage.getItem('user');
                    if (!savedUser) return 'free';
                    try {
                        var user = JSON.parse(savedUser);
                        if (user.role === 'admin' || user.role === 'administrator') return 'enterprise';
                        return user.tier || 'free';
                    } catch (e) { return 'free'; }
                }

                var TIER_LEVEL = { free: 0, pro: 1, enterprise: 2 };
                var TIER_LABELS = { pro: 'PRO', enterprise: 'ENTERPRISE' };
                function canAccessTier(userTier, requiredTier) {
                    return (TIER_LEVEL[userTier] || 0) >= (TIER_LEVEL[requiredTier] || 0);
                }

                // MCP 도구 토글 UI 렌더링 (등급 기반 접근 제어 포함)
                (function renderMCPToolToggles() {
                    console.log('[Settings] renderMCPToolToggles 실행');
                    var container = document.getElementById('mcpToolToggles');
                    console.log('[Settings] mcpToolToggles container:', container ? 'found' : 'NOT FOUND');
                    if (!container) return;

                    var userTier = getUserTier();
                    console.log('[Settings] 사용자 등급:', userTier);

                    // MCP 도구 카탈로그 — 백엔드 builtInTools + tool-tiers 동기화 (minTier 포함)
                    var toolCatalog = [
                        {
                            category: '비전', emoji: '👁️', tools: [
                                { name: 'vision_ocr', label: '이미지 OCR', description: '이미지에서 텍스트를 추출합니다', minTier: 'free' },
                                { name: 'analyze_image', label: '이미지 분석', description: '이미지 내용을 분석합니다', minTier: 'free' }
                            ]
                        },
                        {
                            category: '웹 검색', emoji: '🌐', tools: [
                                { name: 'web_search', label: '웹 검색', description: '실시간 웹 검색을 수행합니다', minTier: 'free' },
                                { name: 'fact_check', label: '팩트 체크', description: '정보의 사실 여부를 검증합니다', minTier: 'enterprise' },
                                { name: 'extract_webpage', label: '웹페이지 추출', description: '웹페이지 콘텐츠를 추출합니다', minTier: 'enterprise' },
                                { name: 'research_topic', label: '주제 연구', description: '주제에 대한 심층 연구를 수행합니다', minTier: 'enterprise' }
                            ]
                        },
                        {
                            category: '추론', emoji: '🧠', tools: [
                                { name: 'sequential_thinking', label: 'Sequential Thinking', description: '단계별 논리적 추론 체인', minTier: 'pro' }
                            ]
                        },
                        {
                            category: '스크래핑', emoji: '🔥', tools: [
                                { name: 'firecrawl_scrape', label: 'Firecrawl 스크래핑', description: '웹페이지를 스크래핑합니다', minTier: 'pro' },
                                { name: 'firecrawl_search', label: 'Firecrawl 검색', description: '웹을 검색합니다', minTier: 'pro' },
                                { name: 'firecrawl_map', label: 'Firecrawl URL 맵', description: 'URL 구조를 매핑합니다', minTier: 'pro' },
                                { name: 'firecrawl_crawl', label: 'Firecrawl 크롤링', description: '웹사이트를 크롤링합니다', minTier: 'pro' }
                            ]
                        }
                    ];

                    var savedMcp = safeStorage.getItem('mcpSettings');
                    var enabledTools = {};
                    if (savedMcp) {
                        try { enabledTools = JSON.parse(savedMcp).enabledTools || {}; } catch (e) { }
                    }

                    var html = '';
                    toolCatalog.forEach(function (group) {
                        html += '<div style="margin-top:12px;">' +
                            '<div style="font-size:var(--font-size-xs);color:var(--text-muted);font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">' +
                            group.emoji + ' ' + group.category +
                            '</div>';
                        group.tools.forEach(function (tool) {
                            var accessible = canAccessTier(userTier, tool.minTier);
                            var isOn = accessible && enabledTools[tool.name] === true;
                            var lockedClass = accessible ? '' : ' mcp-tool-locked';
                            var badgeHtml = '';
                            if (!accessible && TIER_LABELS[tool.minTier]) {
                                var badgeClass = tool.minTier === 'pro' ? 'tier-badge-pro' : 'tier-badge-enterprise';
                                badgeHtml = ' <span class="tier-badge ' + badgeClass + '">' + TIER_LABELS[tool.minTier] + '</span>';
                            }
                            html += '<div class="setting-row' + lockedClass + '" style="padding:6px 0;">' +
                                '<div class="setting-info" style="min-width:0;">' +
                                '<h4 style="font-size:var(--font-size-sm);margin:0;">' + tool.label + badgeHtml + '</h4>' +
                                '<p style="font-size:var(--font-size-xs);margin:0;opacity:0.7;">' + tool.description + '</p>' +
                                '</div>' +
                                '<label class="toggle"><input type="checkbox" id="mcpTool_' + tool.name + '" ' + (isOn ? 'checked' : '') + (accessible ? '' : ' disabled') + '><span class="toggle-slider"></span></label>' +
                                '</div>';
                        });
                        html += '</div>';
                    });
                    container.innerHTML = html;

                    // 개별 도구 토글 이벤트 바인딩 — 접근 가능한 도구만
                    toolCatalog.forEach(function (group) {
                        group.tools.forEach(function (tool) {
                            if (!canAccessTier(userTier, tool.minTier)) return; // 잠긴 도구는 이벤트 불필요
                            var el = document.getElementById('mcpTool_' + tool.name);
                            if (el) {
                                el.addEventListener('change', function () {
                                    var saved = safeStorage.getItem('mcpSettings');
                                    var settings = saved ? JSON.parse(saved) : {};
                                    if (!settings.enabledTools) settings.enabledTools = {};
                                    settings.enabledTools[tool.name] = el.checked;
                                    safeStorage.setItem('mcpSettings', JSON.stringify(settings));

                                    // app.js 전역 mcpSettings 동기화
                                    if (typeof mcpSettings !== 'undefined') {
                                        if (!mcpSettings.enabledTools) mcpSettings.enabledTools = {};
                                        mcpSettings.enabledTools[tool.name] = el.checked;
                                    }

                                    console.log('[Settings] MCP 도구 토글:', tool.name, el.checked ? '활성화' : '비활성화');
                                });
                            }
                        });
                    });

                    // 전체 활성화/비활성화 버튼 이벤트 — 접근 가능한 도구만 대상
                    function setAllTools(enabled) {
                        var saved = safeStorage.getItem('mcpSettings');
                        var settings = saved ? JSON.parse(saved) : {};
                        if (!settings.enabledTools) settings.enabledTools = {};
                        toolCatalog.forEach(function (group) {
                            group.tools.forEach(function (tool) {
                                if (!canAccessTier(userTier, tool.minTier)) return; // 잠긴 도구 건너뜀
                                settings.enabledTools[tool.name] = enabled;
                                var el = document.getElementById('mcpTool_' + tool.name);
                                if (el) el.checked = enabled;
                            });
                        });
                        safeStorage.setItem('mcpSettings', JSON.stringify(settings));

                        // app.js 전역 mcpSettings 동기화
                        if (typeof mcpSettings !== 'undefined') {
                            mcpSettings.enabledTools = settings.enabledTools;
                        }

                        (typeof showToast === 'function' ? showToast(enabled ? 'MCP 도구 전체 활성화' : 'MCP 도구 전체 비활성화', enabled ? 'success' : 'info') : null);
                    }
                    var enableAllBtn = document.getElementById('mcpEnableAllBtn');
                    var disableAllBtn = document.getElementById('mcpDisableAllBtn');
                    if (enableAllBtn) enableAllBtn.addEventListener('click', function () { setAllTools(true); });
                    if (disableAllBtn) disableAllBtn.addEventListener('click', function () { setAllTools(false); });
                })();

                // Expose onclick-referenced functions globally
                if (typeof exportData === 'function') window.exportData = exportData;
                if (typeof clearHistory === 'function') window.clearHistory = clearHistory;
                if (typeof saveSettings === 'function') window.saveSettings = saveSettings;
                if (typeof resetSettings === 'function') window.resetSettings = resetSettings;
                if (typeof setTheme === 'function') window.setTheme = setTheme;
            } catch (e) {
                console.error('[PageModule:settings] init error:', e);
            }
        },

        cleanup: function () {
            _intervals.forEach(function (id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function (id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
            try { delete window.exportData; } catch (e) { }
            try { delete window.clearHistory; } catch (e) { }
            try { delete window.saveSettings; } catch (e) { }
            try { delete window.resetSettings; } catch (e) { }
            try { delete window.setTheme; } catch (e) { }
        }
    };
})();
