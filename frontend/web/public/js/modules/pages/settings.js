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
'use strict';
    var SK = window.STORAGE_KEYS || {};
    window.PageModules = window.PageModules || {};
    let _intervals = [];
    let _timeouts = [];
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // CSS moved to external file: /css/settings.css (CSP compliance)

    var HTML =
        '<div class="settings-container">' +
        '<div class="settings-hero">' +
        '<span class="settings-hero-icon"><iconify-icon icon=lucide:settings></iconify-icon></span>' +
        '<h1>\uC124\uC815</h1>' +
        '<p>\uC571 \uD658\uACBD \uBC0F AI \uBAA8\uB378 \uC124\uC815</p>' +
        '</div>' +

        // Phase R1: claude.ai-style \uC88C\uCE21 \uD0ED \uC2DC\uC2A4\uD15C \u2014 5\uAC1C \uBD84\uC0B0 \uD398\uC774\uC9C0 \uD1B5\uD569 \uC9C4\uC785\uC810
        '<nav class="settings-tabs" role="tablist" aria-label="Settings sections">' +
        '<button class="settings-tab active" data-settings-tab="preferences" role="tab" aria-selected="true"><iconify-icon icon=lucide:settings></iconify-icon> \uD658\uACBD\uC124\uC815</button>' +
        '<button class="settings-tab" data-settings-tab="account" data-navigate="/password-change.html" role="tab"><iconify-icon icon=lucide:user></iconify-icon> \uACC4\uC815</button>' +
        '<button class="settings-tab" data-settings-tab="api-keys" data-navigate="/api-keys.html" role="tab"><iconify-icon icon=lucide:key></iconify-icon> API \uD0A4</button>' +
        '<button class="settings-tab" data-settings-tab="usage" data-navigate="/usage.html" role="tab"><iconify-icon icon=lucide:bar-chart-2></iconify-icon> \uC0AC\uC6A9\uB7C9</button>' +
        '<button class="settings-tab" data-settings-tab="integrations" data-navigate="/external.html" role="tab"><iconify-icon icon=lucide:link></iconify-icon> \uC678\uBD80\uC5F0\uB3D9</button>' +
        '<button class="settings-tab" data-settings-tab="developer" data-navigate="/developer.html" role="tab"><iconify-icon icon=lucide:book-open></iconify-icon> API \uBB38\uC11C</button>' +
        '<button class="settings-tab" data-settings-tab="projects" data-navigate="/projects.html" role="tab"><iconify-icon icon=lucide:folder></iconify-icon> \uD504\uB85C\uC81D\uD2B8</button>' +
        '</nav>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:palette></iconify-icon></span>' +
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
        '<div class="setting-info"><h4>\uC5B8\uC5B4</h4><p>AI \uC751\uB2F5 \uC5B8\uC5B4\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4. \uC790\uB3D9 \uAC10\uC9C0 \uC2DC \uC0AC\uC6A9\uC790 \uBA54\uC2DC\uC9C0 \uC5B8\uC5B4\uB85C \uC751\uB2F5\uD569\uB2C8\uB2E4.</p></div>' +
'<select id="langSelect" class="s-select">' +
'<option value=""><iconify-icon icon=lucide:globe></iconify-icon> \uC790\uB3D9 \uAC10\uC9C0 (Auto-detect)</option>' +
'<option value="ko">\uD55C\uAD6D\uC5B4</option>' +
        '<option value="en">English</option>' +
        '<option value="ja">\u65E5\u672C\u8A9E</option>' +
        '<option value="zh">\u4E2D\u6587(\u7B80\u4F53)</option>' +
        '<option value="es">Espa\u00F1ol</option>' +
        '<option value="fr">Fran\u00E7ais</option>' +
        '<option value="de">Deutsch</option>' +
        '<option value="pt">Portugu\u00EAs</option>' +
        '<option value="ru">\u0420\u0443\u0441\u0441\u043A\u0438\u0439</option>' +
        '<option value="ar">\u0627\u0644\u0639\u0631\u0628\u064A\u0629</option>' +
        '<option value="hi">\u0939\u093F\u0928\u094D\u0926\u0940</option>' +
        '<option value="it">Italiano</option>' +
        '<option value="nl">Nederlands</option>' +
        '<option value="sv">Svenska</option>' +
        '<option value="da">Dansk</option>' +
        '<option value="no">Norsk</option>' +
        '<option value="fi">Suomi</option>' +
        '<option value="th">\u0E44\u0E17\u0E22</option>' +
        '<option value="vi">Ti\u1EBFng Vi\u1EC7t</option>' +
        '<option value="tr">T\u00FCrk\u00E7e</option>' +
        '</select>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:bot></iconify-icon></span>' +
        '<span class="s-card-title">AI \uBAA8\uB378</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uAE30\uBCF8 \uBAA8\uB378</h4><p>\uCC44\uD305\uC5D0 \uC0AC\uC6A9\uD560 AI \uBAA8\uB378\uC744 \uC120\uD0DD\uD569\uB2C8\uB2E4. OpenRouter \uD0A4\uB97C \uB4F1\uB85D\uD558\uBA74 367+ \uBAA8\uB378\uC774 \uB178\uCD9C\uB429\uB2C8\uB2E4.</p></div>' +
        '<div id="modelSelectorMount" class="settings-model-selector-mount"></div>' +
        '</div>' +
        '</div>' +
        '</div>' +

        // Custom Instructions card (2026-05-26) \u2014 \uC0AC\uC6A9\uC790\uBCC4 \uC601\uAD6C system prompt \uC9C0\uC2DC\uBB38
        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:file-text></iconify-icon></span>' +
        '<span class="s-card-title">\uC0AC\uC6A9\uC790 \uC9C0\uC2DC\uBB38</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row" style="flex-direction:column;align-items:stretch;gap:8px;">' +
        '<div class="setting-info"><h4>Custom Instructions</h4><p>\uBAA8\uB4E0 \uCC44\uD305\uC5D0 \uC601\uAD6C \uC801\uC6A9\uB418\uB294 system prompt \uCD94\uAC00 \uC9C0\uC2DC\uBB38. \uC608: "\uD55C\uAD6D\uC5B4\uB85C \uC751\uB2F5", "\uD55C \uC904\uB85C \uB2F5\uB2F5\uD560 \uC218 \uC788\uB294 \uACBD\uC6B0 \uD55C \uC904\uB85C \uC885\uB8CC". (claude.ai / ChatGPT \uB3D9\uB4F1)</p></div>' +
        '<textarea id="customInstructionsInput" class="s-textarea" rows="6" maxlength="4000" placeholder="\uC608: \uC0AC\uC6A9\uC790\uAC00 \uBA85\uC2DC\uC801\uC73C\uB85C \uC694\uCCAD\uD558\uC9C0 \uC54A\uC740 \uBD80\uAC00 \uC815\uBCF4\uB294 \uCD9C\uB825\uD558\uC9C0 \uC54A\uB294\uB2E4." style="width:100%;font-family:inherit;padding:8px;border:1px solid var(--border-light);border-radius:6px;background:var(--bg-tertiary);color:var(--text-primary);resize:vertical;"></textarea>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:var(--font-size-xs);color:var(--text-muted);">' +
        '<span><span id="customInstructionsCount">0</span> / 4000 \uC790</span>' +
        '<button id="customInstructionsSaveBtn" class="s-btn s-btn-primary" style="font-size:var(--font-size-xs);padding:6px 14px;">\uC800\uC7A5</button>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '</div>' +

        // \uB0B4 Agent card (Custom Agents \uC784\uBCA0\uB4DC, 2026-06-01) \u2014 \uC0AC\uC6A9\uC790 \uC9C0\uC2DC\uBB38 \uC544\uB798 \uBC30\uCE58. my-agents \uBAA8\uB4C8 \uC7AC\uC0AC\uC6A9.
        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:bot></iconify-icon></span>' +
        '<span class="s-card-title">\uB0B4 Agent</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div id="settingsMyAgentsMount"><div style="color:var(--text-muted);text-align:center;padding:16px;">\uBD88\uB7EC\uC624\uB294 \uC911...</div></div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:wrench></iconify-icon></span>' +
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
        '<span class="s-card-icon"><iconify-icon icon=lucide:star></iconify-icon></span>' +
        '<span class="s-card-title">\uAD6C\uB3C5 \uD50C\uB79C</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div id="tierPlanCards" class="tier-plan-container"></div>' +
        '</div>' +
        '</div>' +

        // 2026-05-26 Phase 1.D \u2014 Capabilities (Anthropic Settings > Capabilities \uB3D9\uB4F1)
        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:sparkles></iconify-icon></span>' +
        '<span class="s-card-title">Capabilities</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>Artifacts</h4><p>\uBCF5\uD569 \uC0B0\uCD9C\uBB3C (\uCF54\uB4DC\u00B7HTML\u00B7\uB2E4\uC774\uC5B4\uADF8\uB7A8\u00B7\uBB38\uC11C \uB4F1) \uC744 \uCC44\uD305 \uC6B0\uCE21 \uD328\uB110\uC5D0 \uD45C\uC2DC\uD558\uC5EC \uBBF8\uB9AC\uBCF4\uAE30\u00B7\uBCF5\uC0AC\u00B7\uB2E4\uC6B4\uB85C\uB4DC\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uB044\uBA74 \uC591\uC2DD \uADF8\uB300\uB85C \uBCF8\uBB38\uC5D0 inline \uD45C\uC2DC.</p></div>' +
        '<label class="toggle"><input type="checkbox" checked id="artifactsEnabledToggle"><span class="toggle-slider"></span></label>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:hard-drive></iconify-icon></span>' +
        '<span class="s-card-title">\uB370\uC774\uD130</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uB300\uD654 \uBCF8\uBB38 \uC800\uC7A5</h4><p>\uB300\uD654 \uBCF8\uBB38\uC744 \uC11C\uBC84 DB\uC5D0 \uC800\uC7A5\uD569\uB2C8\uB2E4. \uB044\uBA74 \uBCF8\uBB38\uC740 \uC800\uC7A5\uB418\uC9C0 \uC54A\uC73C\uBA70, \uC0AC\uC6A9\uB7C9 \uBA54\uD0C0\uB9CC \uC775\uBA85 \uD1B5\uACC4\uC6A9\uC73C\uB85C \uAE30\uB85D\uB429\uB2C8\uB2E4.</p></div>' +
        '<label class="toggle"><input type="checkbox" checked id="saveHistoryToggle"><span class="toggle-slider"></span></label>' +
        '</div>' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uC7A5\uAE30 \uAE30\uC5B5 \uD559\uC2B5</h4><p>\uB300\uD654\uC5D0\uC11C \uC774\uB984\u00B7\uC9C1\uC5C5\u00B7\uC120\uD638 \uAC19\uC740 \uC0AC\uC2E4\uC744 \uCD94\uCD9C\uD558\uC5EC \uC800\uC7A5\uD569\uB2C8\uB2E4. \uC704 \uC124\uC815\uACFC \uB3C5\uB9BD\uC785\uB2C8\uB2E4.</p></div>' +
        '<label class="toggle"><input type="checkbox" checked id="memoryLearningToggle"><span class="toggle-slider"></span></label>' +
        '</div>' +
        '<div class="s-btn-row">' +
        '<button class="s-btn s-btn-secondary" onclick="exportData()"><iconify-icon icon=lucide:download></iconify-icon> \uB370\uC774\uD130 \uB0B4\uBCF4\uB0B4\uAE30</button>' +
        '<button class="s-btn s-btn-danger" onclick="clearHistory()"><iconify-icon icon=lucide:trash-2></iconify-icon>\uFE0F \uAE30\uB85D \uC0AD\uC81C</button>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:lock></iconify-icon></span>' +
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
        '<a href="/api-keys.html" class="s-btn s-btn-primary" style="text-decoration:none;"><iconify-icon icon=lucide:key></iconify-icon> API \uD0A4 \uAD00\uB9AC</a>' +
        '<a href="/developer.html" class="s-btn s-btn-secondary" style="text-decoration:none;"><iconify-icon icon=lucide:clipboard-list></iconify-icon> API \uBB38\uC11C</a>' +
        '</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card" id="accountCard" style="display:none;">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:user></iconify-icon></span>' +
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
        '<a href="/password-change.html" class="s-btn s-btn-primary" style="text-decoration:none;"><iconify-icon icon=lucide:key></iconify-icon> \uBE44\uBC00\uBC88\uD638 \uBCC0\uACBD</a>' +
        '<a href="/admin.html" class="s-btn s-btn-secondary" id="adminLink" style="text-decoration:none;display:none;"><iconify-icon icon=lucide:users></iconify-icon> \uC0AC\uC6A9\uC790 \uAD00\uB9AC</a>' +
        '</div>' +
        // GDPR Phase B Fix 6 (B7) \u2014 \uB3D9\uC758 \uAD00\uB9AC \uC139\uC158
        '<div class="setting-row" style="margin-top: 16px; border-top: 1px solid var(--border, #e5e5e5); padding-top: 16px;">' +
        '<div class="setting-info">' +
        '<h4>\uB3D9\uC758 \uAD00\uB9AC <span style="font-size: 0.85em; color: var(--text-muted, #888);">(GDPR Article 7)</span></h4>' +
        '<p>\uAC1C\uC778\uC815\uBCF4 \uCC98\uB9AC\uBC29\uCE68 / \uC774\uC6A9\uC57D\uAD00 \uB3D9\uC758 \uC0C1\uD0DC \uBC0F \uCCA0\uD68C</p>' +
        '</div>' +
        '</div>' +
        '<div id="consentList" style="margin-top: 8px;">\uB85C\uB529 \uC911...</div>' +
        '</div>' +
        '</div>' +

        '<div class="s-card">' +
        '<div class="s-card-header">' +
        '<span class="s-card-icon"><iconify-icon icon=lucide:info></iconify-icon></span>' +
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
        '<button class="s-btn s-btn-primary" onclick="saveSettings()"><iconify-icon icon=lucide:hard-drive></iconify-icon> \uC124\uC815 \uC800\uC7A5</button>' +
        '<button class="s-btn s-btn-secondary" onclick="resetSettings()"><iconify-icon icon=lucide:undo-2></iconify-icon> \uCD08\uAE30\uD654</button>' +
        '</div>' +
        '</div>' +
        '<div id="toast" class="toast"></div>';

    window.PageModules['settings'] = {
        getHTML: function () {
            return '<div class="page-settings">' +
                HTML +
                '</div>';
        },

        init: async function () {
            try {
                var safeStorage = window.SafeStorage;
                // 관리자 확인 헬퍼
                function isAdmin() {
                    const savedUser = safeStorage.getItem(SK.USER || 'user');
                    if (!savedUser) return false;
                    try {
                        const user = JSON.parse(savedUser);
                        return user.role === 'admin' || user.role === 'administrator';
                    } catch (e) { return false; }
                }

                async function loadApiKeyCount() {
                    var el = document.getElementById('apiKeyCount');
                    if (!el) return;
                    // 미인증 상태에서는 401 fetch를 방지
                    var savedUser = safeStorage.getItem(SK.USER || 'user');
                    if (!savedUser || savedUser === '{}' || savedUser === 'null') {
                        el.textContent = '';
                        return;
                    }
                    // 5분 sessionStorage 캐시 — settings 페이지 빠른 재진입 시 rate limit
                    // (RL_API_KEY_MGMT.readLimit) 충돌 방지.
                    var CACHE_KEY = '__apiKeyCountCache';
                    var TTL_MS = 5 * 60 * 1000;
                    try {
                        var cachedRaw = sessionStorage.getItem(CACHE_KEY);
                        if (cachedRaw) {
                            var cached = JSON.parse(cachedRaw);
                            if (cached && (Date.now() - cached.t) < TTL_MS && typeof cached.count === 'number') {
                                el.textContent = cached.count + '개 활성';
                                return;
                            }
                        }
                    } catch (e) { /* sessionStorage 미사용 — fetch fallback */ }
                    try {
                        var res = await fetch(API_ENDPOINTS.API_KEYS, { credentials: 'include' });
                        if (res.ok) {
                            var data = await res.json();
                            var count = (data.data && data.data.count) || 0;
                            el.textContent = count + '\uAC1C \uD65C\uC131';
                            try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), count: count })); } catch (e) {}
                        } else if (res.status === 429) {
                            el.textContent = '';
                        } else {
                            el.textContent = '\uB85C\uADF8\uC778 \uD544\uC694';
                        }
                    } catch (e) {
                        el.textContent = '\uB85C\uADF8\uC778 \uD544\uC694';
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
                    } catch (e) {
                        console.warn('시스템 정보 로드 실패:', e);
                        var statusEl = document.getElementById('sysStatus');
                        if (statusEl) { statusEl.textContent = '● 연결 실패'; statusEl.style.color = 'var(--danger)'; }
                    }
                }

                // Phase R1: settings 탭 클릭 핸들러 — claude.ai-style nav 통합
                (function initSettingsTabs() {
                    document.querySelectorAll('.settings-tab[data-navigate]').forEach(function (btn) {
                        btn.addEventListener('click', function (ev) {
                            ev.preventDefault();
                            var target = btn.getAttribute('data-navigate');
                            if (!target) return;
                            if (window.Router && typeof window.Router.navigate === 'function') {
                                window.Router.navigate(target);
                            } else {
                                window.location.href = target;
                            }
                        });
                    });
                })();

                async function initSettings() {
                    // Mount unified ModelSelector — single entry point for model selection + key registration.
                    // ModelSelector 가 호출하는 3개 sibling 모달 (AddKeyModal / UsageModal / ModelActionMenu)
                    // 도 함께 사전 로드해야 함 — 각 모듈은 self-import 시 window.* 글로벌로 자체 노출.
                    // 미로드 시 "+ OpenRouter" / ⋮ 메뉴 클릭이 silent fail (window.AddKeyModal 미정의).
                    try {
                        await Promise.all([
                            import('../components/add-key-modal.js'),
                            import('../components/usage-modal.js'),
                            import('../components/model-action-menu.js'),
                            import('../components/model-list-modal.js'),
                        ]);
                        const mod = await import('../components/model-selector.js');
                        window.ModelSelector = mod.default;
                        const mountEl = document.getElementById('modelSelectorMount');
                        if (mountEl) {
                            await mod.mount(mountEl);
                        }
                    } catch (e) {
                        console.error('[settings] ModelSelector mount 실패:', e);
                    }
                    loadSettings();
                    loadApiKeyCount();
                    loadSystemInfo();
                    initCustomInstructions();
                    initMyAgentsSection();
                    initArtifactsToggle();
                }

                /**
                 * Artifacts on/off 토글 (2026-05-26 Phase 1.D).
                 * 토글 변경 즉시 PUT — 별도 저장 버튼 없음 (claude.ai Settings > Capabilities 패턴).
                 */
                async function initArtifactsToggle() {
                    var toggle = document.getElementById('artifactsEnabledToggle');
                    if (!toggle) return;
                    try {
                        var res = await window.authFetch('/api/users/me/artifacts-enabled');
                        var data = (res && res.data) || res || {};
                        toggle.checked = data.artifactsEnabled !== false; // 기본 true
                    } catch (e) {
                        console.warn('[settings] artifacts_enabled 로드 실패:', e);
                    }
                    toggle.addEventListener('change', async function() {
                        var enabled = toggle.checked;
                        try {
                            await window.authFetch('/api/users/me/artifacts-enabled', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ artifactsEnabled: enabled }),
                            });
                            if (typeof showToast === 'function') {
                                showToast('Artifacts ' + (enabled ? '활성' : '비활성') + '됨', 'success');
                            }
                        } catch (e) {
                            console.error('[settings] artifacts_enabled 저장 실패:', e);
                            toggle.checked = !enabled; // 롤백
                            if (typeof showToast === 'function') {
                                showToast('설정 저장 실패', 'error');
                            }
                        }
                    });
                }

                /**
                 * Custom Instructions card 초기화 — 서버에서 현재 값 로드 + 저장 핸들러 바인딩.
                 * 인증 실패 / 비로그인 시 silent 비활성화.
                 */
                async function initCustomInstructions() {
                    var input = document.getElementById('customInstructionsInput');
                    var count = document.getElementById('customInstructionsCount');
                    var saveBtn = document.getElementById('customInstructionsSaveBtn');
                    if (!input || !count || !saveBtn) return;

                    function updateCount() {
                        count.textContent = String(input.value.length);
                    }
                    input.addEventListener('input', updateCount);

                    // 현재 값 로드
                    try {
                        var res = await window.authFetch('/api/users/me/custom-instructions');
                        var data = res.data || res;
                        if (data && typeof data.customInstructions === 'string') {
                            input.value = data.customInstructions;
                        }
                        updateCount();
                    } catch (e) {
                        console.warn('[settings] custom_instructions 로드 실패:', e);
                    }

                    saveBtn.addEventListener('click', async function() {
                        saveBtn.disabled = true;
                        var original = saveBtn.textContent;
                        saveBtn.textContent = '저장 중...';
                        try {
                            var trimmed = input.value.trim();
                            await window.authFetch('/api/users/me/custom-instructions', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ customInstructions: trimmed.length > 0 ? trimmed : null }),
                            });
                            (typeof showToast === 'function')
                                ? showToast('사용자 지시문이 저장되었습니다.', 'success')
                                : alert('저장되었습니다.');
                        } catch (e) {
                            console.error('[settings] custom_instructions 저장 실패:', e);
                            (typeof showToast === 'function')
                                ? showToast('저장 실패: ' + (e && e.message ? e.message : '서버 오류'), 'error')
                                : alert('저장 실패');
                        } finally {
                            saveBtn.disabled = false;
                            saveBtn.textContent = original;
                        }
                    });
                }

                /**
                 * 내 Agent (Custom Agents) 섹션 임베드 — my-agents 페이지 모듈을 재사용.
                 * .s-card 의 backdrop-filter 가 position:fixed 모달의 containing block 이
                 * 되어 클리핑되는 문제를 피하려 에디터 모달을 document.body 로 이동.
                 */
                async function initMyAgentsSection() {
                    var mount = document.getElementById('settingsMyAgentsMount');
                    if (!mount) return;
                    // 재진입 시 body 에 남은 이전 모달 제거 (cleanup 누락 대비)
                    var staleModal = document.getElementById('maEditorModal');
                    if (staleModal && staleModal.parentNode === document.body) staleModal.remove();
                    try {
                        var m = await import('/js/modules/pages/my-agents.js');
                        var mod = (m && m.default) || (window.PageModules && window.PageModules['my-agents']);
                        if (!mod || typeof mod.getSectionHTML !== 'function') return;
                        mount.innerHTML = mod.getSectionHTML();
                        var modal = mount.querySelector('#maEditorModal');
                        if (modal) document.body.appendChild(modal);
                        mod.init();
                    } catch (e) {
                        console.warn('[settings] 내 Agent 섹션 임베드 실패:', e);
                        mount.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:16px;">내 Agent 섹션을 불러오지 못했습니다.</div>';
                    }
                }

                function setTheme(theme) { document.documentElement.setAttribute('data-theme', theme); safeStorage.setItem('theme', theme); }

                function saveSettings() {
                    setTheme(document.getElementById('themeSelect').value);
                    // 모델 선택은 ModelSelector 컴포넌트가 자체 관리/영속화

                    // MCP 도구 설정은 toggleMCPTool/setAllMCPTools에서 이미 실시간 저장됨
                    // 명시적 저장 호출
                    if (typeof window.saveMCPSettings === 'function') window.saveMCPSettings();

                    safeStorage.setItem(SK.GENERAL_SETTINGS || 'generalSettings', JSON.stringify({
                        lang: document.getElementById('langSelect').value,
                        saveHistory: document.getElementById('saveHistoryToggle').checked,
                        memoryLearning: (document.getElementById('memoryLearningToggle') || { checked: true }).checked
                    }));
                    (typeof showToast === 'function' ? showToast('설정이 저장되었습니다.', 'warning') : console.warn('설정이 저장되었습니다.'));
                }

                function loadSettings() {
                    var theme = safeStorage.getItem(SK.THEME || 'theme') || 'dark';
                    document.getElementById('themeSelect').value = theme;
                    setTheme(theme);
                    // 모델 선택은 ModelSelector 컴포넌트가 자체 복원
                    // MCP 설정은 loadMCPSettings()에서 통합 관리
                    if (typeof window.loadMCPSettings === 'function') window.loadMCPSettings();

                    var savedGeneral = safeStorage.getItem(SK.GENERAL_SETTINGS || 'generalSettings');
                    if (savedGeneral) {
                        var general = JSON.parse(savedGeneral);
                        document.getElementById('langSelect').value = general.lang || '';
                        document.getElementById('saveHistoryToggle').checked = general.saveHistory !== false;
                        var memEl = document.getElementById('memoryLearningToggle');
                        if (memEl) memEl.checked = general.memoryLearning !== false;
                    }
                }

                function resetSettings() { if (confirm('모든 설정을 초기화하시겠습니까?')) { safeStorage.removeItem(SK.THEME || 'theme'); safeStorage.removeItem(SK.SELECTED_MODEL || 'selectedModel'); safeStorage.removeItem(SK.MCP_SETTINGS || 'mcpSettings'); safeStorage.removeItem(SK.GENERAL_SETTINGS || 'generalSettings'); location.reload(); } }

                async function exportData() {
                    // GDPR Phase B Fix 6 (B6) — Article 20 right to data portability.
                    // 전체 사용자 데이터 (conversations + manifests + agents + memories) JSON export.
                    // 백엔드가 Content-Disposition attachment 로 즉시 다운로드 응답.
                    try {
                        var res = await fetch(API_ENDPOINTS.USER_EXPORT, { credentials: 'include' });
                        if (res.status === 429) {
                            var rateData = await res.json().catch(function () { return null; });
                            var rateMsg = (rateData && rateData.error && rateData.error.message) || '데이터 export 시간당 한도를 초과했습니다.';
                            (typeof showToast === 'function' ? showToast(rateMsg, 'warning') : console.warn(rateMsg));
                            return;
                        }
                        if (!res.ok) throw new Error('서버 응답 오류: ' + res.status);
                        // Content-Disposition 헤더로 다운로드 처리 — blob 받아서 anchor 클릭
                        var blob = await res.blob();
                        var url = URL.createObjectURL(blob);
                        var a = document.createElement('a');
                        a.href = url;
                        // 백엔드가 filename 헤더 명시했지만 anchor download 속성도 fallback 으로 설정
                        a.download = 'openmake_full_export_' + new Date().toISOString().slice(0, 10) + '.json';
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                        (typeof showToast === 'function' ? showToast('전체 데이터를 내보냈습니다.', 'success') : console.log('Export complete'));
                    } catch (e) {
                        console.error('데이터 내보내기 실패:', e);
                        (typeof showToast === 'function' ? showToast('데이터 내보내기에 실패했습니다.', 'error') : console.error('데이터 내보내기 실패'));
                    }
                }

                async function clearHistory() {
                    if (!confirm('모든 대화 기록을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
                    try {
                        var res = await window.authFetch(API_ENDPOINTS.CHAT_SESSIONS, { method: 'DELETE' });
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
                    var loggedIn = !!(safeStorage.getItem(SK.USER || 'user') || (typeof getState === 'function' && getState('auth.user')));
                    if (loggedIn && accountCard) {
                        accountCard.style.display = '';
                        if (isAdmin() && adminLink) adminLink.style.display = '';
                        loadConsents();
                    }
                })();

                // GDPR Phase B Fix 6 (B7) — 동의 상태 조회 + 철회 UI
                async function loadConsents() {
                    var listEl = document.getElementById('consentList');
                    if (!listEl) return;
                    try {
                        var res = await window.authFetch(window.API_ENDPOINTS.USER_CONSENT);
                        var data = await res.json();
                        if (!res.ok || !data.success) {
                            listEl.innerHTML = '<p style="color: var(--danger, #d00); font-size: 0.9em;">동의 상태 조회 실패</p>';
                            return;
                        }
                        var consents = data.data.consents || [];
                        listEl.innerHTML = consents.map(function (c) {
                            var typeLabel = c.type === 'privacy_policy' ? '개인정보 처리방침' : '이용약관';
                            var statusBadge = c.granted
                                ? '<span style="color: var(--success, #2a8); font-weight: 600;">✓ 동의됨</span>'
                                : '<span style="color: var(--text-muted, #888);">철회됨</span>';
                            var versionInfo = c.version ? ' v' + esc(c.version) : '';
                            var dateInfo = c.granted_at ? ' (' + new Date(c.granted_at).toLocaleString() + ')' : '';
                            var withdrawBtn = c.granted
                                ? '<button class="s-btn s-btn-secondary" style="margin-left: 8px; font-size: 0.85em; padding: 4px 10px;" data-consent-withdraw="' + esc(c.type) + '">철회</button>'
                                : '';
                            return '<div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--border-subtle, #f0f0f0);">'
                                + '<div><strong>' + typeLabel + '</strong>' + versionInfo + ' &nbsp;' + statusBadge + '<div style="font-size: 0.85em; color: var(--text-muted, #888);">' + dateInfo + '</div></div>'
                                + '<div>' + withdrawBtn + '</div>'
                                + '</div>';
                        }).join('');
                        // 철회 button event delegation
                        listEl.querySelectorAll('[data-consent-withdraw]').forEach(function (btn) {
                            btn.addEventListener('click', function () {
                                withdrawConsent(btn.dataset.consentWithdraw);
                            });
                        });
                    } catch (e) {
                        listEl.innerHTML = '<p style="color: var(--danger, #d00); font-size: 0.9em;">동의 상태 조회 실패: ' + esc(String(e.message || e)) + '</p>';
                    }
                }

                async function withdrawConsent(type) {
                    var label = type === 'privacy_policy' ? '개인정보 처리방침' : '이용약관';
                    if (!confirm(label + ' 동의를 철회하시겠습니까?\n\n다음 로그인 시 재동의가 필요할 수 있습니다.')) return;
                    try {
                        var res = await window.authFetch(window.API_ENDPOINTS.USER_CONSENT_WITHDRAW, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ type: type }),
                        });
                        var data = await res.json();
                        if (res.ok && data.success) {
                            if (window.showToast) window.showToast(label + ' 동의가 철회되었습니다', 'success');
                            loadConsents();  // refresh
                        } else {
                            var msg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                            if (window.showToast) window.showToast(msg || '철회 실패', 'error');
                        }
                    } catch (e) {
                        if (window.showToast) window.showToast('철회 실패: ' + (e.message || e), 'error');
                    }
                }

                // 사용자 등급(tier) 판별 — 백엔드 tool-tiers.ts의 getDefaultTierForRole 동기화
                function getUserTier() {
                    var isGuest = safeStorage.getItem(SK.GUEST_MODE || 'guestMode') === 'true' ||
                        safeStorage.getItem(SK.IS_GUEST || 'isGuest') === 'true' ||
                        !safeStorage.getItem(SK.USER || 'user');
                    if (isGuest) return 'free';
                    var savedUser = safeStorage.getItem(SK.USER || 'user');
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
                function renderMCPToolToggles() {
                    var container = document.getElementById('mcpToolToggles');
                    if (!container) return;

                    var userTier = getUserTier();

                    // MCP 도구 카탈로그 — settings.js 통합 카탈로그 사용
                    var toolCatalog = window.MCP_TOOL_CATALOG;

                    var savedMcp = safeStorage.getItem(SK.MCP_SETTINGS || 'mcpSettings');
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
                                    var currentTools = window.getEnabledTools();
                                    if ((currentTools[tool.name] === true) !== el.checked) {
                                        window.toggleMCPTool(tool.name);
                                    }
                                });
                            }
                        });
                    });

                    // 전체 활성화/비활성화 버튼 이벤트 — 접근 가능한 도구만 대상
                    function setAllTools(enabled) {
                        window.setAllMCPTools(enabled);
                        // Re-render to reflect changes
                        renderMCPToolToggles();
                    }
                    var enableAllBtn = document.getElementById('mcpEnableAllBtn');
                    var disableAllBtn = document.getElementById('mcpDisableAllBtn');
                    if (enableAllBtn) enableAllBtn.addEventListener('click', function () { setAllTools(true); });
                    if (disableAllBtn) disableAllBtn.addEventListener('click', function () { setAllTools(false); });
                }

                function renderTierPlanCards() {
                    var container = document.getElementById('tierPlanCards');
                    if (!container) return;

                    var userTier = getUserTier();
                    var plans = [
                        {
                            tier: 'free', name: 'Free', price: '무료', icon: '<iconify-icon icon=lucide:gift></iconify-icon>',
                            features: ['기본 AI 채팅', '웹 검색', '이미지 분석/OCR']
                        },
                        {
                            tier: 'pro', name: 'Pro', price: 'PRO', icon: '<iconify-icon icon=lucide:zap></iconify-icon>',
                            features: ['Free 전체 기능', '웹 스크래핑 (3종)', '외부 MCP 도구 연동']
                        },
                        {
                            tier: 'enterprise', name: 'Enterprise', price: 'ENTERPRISE', icon: '<iconify-icon icon=lucide:building-2></iconify-icon>',
                            features: ['Pro 전체 기능', '팩트 체크 / 웹페이지 추출', '주제 연구 / 모든 도구 접근']
                        }
                    ];

                    var html = '';
                    plans.forEach(function(plan) {
                        var isCurrent = userTier === plan.tier;
                        var cardClass = isCurrent ? 'tier-plan-card tier-plan-current' : 'tier-plan-card';

                        var buttonHtml = '';
                        if (isCurrent) {
                            buttonHtml = '<button class="tier-plan-btn tier-plan-btn-current">\u2713 \uD604\uC7AC \uD50C\uB79C</button>';
                        } else {
                            var isUpgrade = TIER_LEVEL[plan.tier] > TIER_LEVEL[userTier];
                            var btnClass = isUpgrade ? 'tier-plan-btn tier-plan-btn-upgrade' : 'tier-plan-btn tier-plan-btn-downgrade';
                            var btnText = isUpgrade ? '<iconify-icon icon=lucide:arrow-up></iconify-icon> \uC5C5\uADF8\uB808\uC774\uB4DC' : '<iconify-icon icon=lucide:arrow-down></iconify-icon> \uB2E4\uC6B4\uADF8\uB808\uC774\uB4DC';
                            buttonHtml = '<button class="' + btnClass + '" onclick="window.changeTier(\'' + plan.tier + '\')">' + btnText + '</button>';
                        }

                        var featuresHtml = '<ul class="tier-plan-features">';
                        plan.features.forEach(function(f) {
                            featuresHtml += '<li>' + esc(f) + '</li>';
                        });
                        featuresHtml += '</ul>';

                        html += '<div class="' + cardClass + '">' +
                            '<div class="tier-plan-icon">' + plan.icon + '</div>' +
                            '<div class="tier-plan-name">' + esc(plan.name) + '</div>' +
                            '<div class="tier-plan-price">' + esc(plan.price) + '</div>' +
                            featuresHtml +
                            buttonHtml +
                            '</div>';
                    });

                    container.innerHTML = html;
                }

                renderMCPToolToggles();
                renderTierPlanCards();

                window.refreshTierUI = function() {
                    renderTierPlanCards();
                    renderMCPToolToggles();
                };

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
            try {
                if (window.ModelSelector && typeof window.ModelSelector.unmount === 'function') {
                    window.ModelSelector.unmount();
                }
            } catch (e) {
                console.warn('[settings] ModelSelector unmount 실패:', e);
            }
            // 내 Agent 섹션이 body 로 이동시킨 에디터 모달 제거 (orphan 방지)
            try {
                var maModal = document.getElementById('maEditorModal');
                if (maModal && maModal.parentNode === document.body) maModal.remove();
            } catch (e) { }
            // Remove onclick-exposed globals
            try { delete window.exportData; } catch (e) { }
            try { delete window.clearHistory; } catch (e) { }
            try { delete window.saveSettings; } catch (e) { }
            try { delete window.resetSettings; } catch (e) { }
            try { delete window.setTheme; } catch (e) { }
            try { delete window.refreshTierUI; } catch (e) { }
        }
    };

const { getHTML, init, cleanup } = window.PageModules['settings'];
export default { getHTML, init, cleanup };
