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
    var AUTO_MODEL = window.DEFAULT_AUTO_MODEL || 'openmake_llm_auto';
    var SK = window.STORAGE_KEYS || {};
    let _intervals = [];
    let _timeouts = [];
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // CSS moved to external file: /css/settings.css (CSP compliance)

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
        '<div class="setting-info"><h4>\uC5B8\uC5B4</h4><p>AI \uC751\uB2F5 \uC5B8\uC5B4\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4. \uC790\uB3D9 \uAC10\uC9C0 \uC2DC \uC0AC\uC6A9\uC790 \uBA54\uC2DC\uC9C0 \uC5B8\uC5B4\uB85C \uC751\uB2F5\uD569\uB2C8\uB2E4.</p></div>' +
'<select id="langSelect" class="s-select">' +
'<option value="">\uD83C\uDF10 \uC790\uB3D9 \uAC10\uC9C0 (Auto-detect)</option>' +
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
        '<span class="s-card-icon">\uD83E\uDD16</span>' +
        '<span class="s-card-title">AI \uBAA8\uB378</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div class="setting-row">' +
        '<div class="setting-info"><h4>\uAE30\uBCF8 \uBAA8\uB378</h4><p>\uCC44\uD305\uC5D0 \uC0AC\uC6A9\uD560 AI \uBAA8\uB378\uC744 \uC120\uD0DD\uD569\uB2C8\uB2E4</p></div>' +
        '<select id="modelSelect" class="s-select">' +
        '<option value="' + AUTO_MODEL + '">OpenMake LLM Auto</option>' +
        '<option value="openmake_llm">OpenMake LLM</option>' +
        '<option value="openmake_llm_pro">OpenMake LLM Pro</option>' +
        '<option value="openmake_llm_fast">OpenMake LLM Fast</option>' +
        '<option value="openmake_llm_think">OpenMake LLM Think</option>' +
        '<option value="openmake_llm_code">OpenMake LLM Code</option>' +
        '<option value="openmake_llm_vision">OpenMake LLM Vision</option>' +
        '</select>' +
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
        '<span class="s-card-icon">\u2B50</span>' +
        '<span class="s-card-title">\uAD6C\uB3C5 \uD50C\uB79C</span>' +
        '</div>' +
        '<div class="s-card-body">' +
        '<div id="tierPlanCards" class="tier-plan-container"></div>' +
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

    const pageModule = {
        getHTML: function () {
            return '<div class="page-settings">' +
                HTML +
                '</div>';
        },

        init: function () {
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

                async function loadModels() {
                    const modelSelect = document.getElementById('modelSelect');

                    // 🔒 관리자가 아니면 모델 이름 숨김
                    if (!isAdmin()) {
                        modelSelect.innerHTML = '<option value="' + AUTO_MODEL + '">OpenMake LLM Auto</option>';
                        modelSelect.disabled = true;
                        modelSelect.style.cursor = 'default';
                        return;
                    }

                    try {
                        const response = await fetch(API_ENDPOINTS.MODELS, {
                            credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                        });
                        if (response.ok) {
                            const rawData = await response.json();
                            var data = rawData.data || rawData;
                            if (data.models && data.models.length > 0) {
                                var savedModel = safeStorage.getItem(SK.SELECTED_MODEL || 'selectedModel');
                                var defaultModel = data.defaultModel || AUTO_MODEL;

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
                        modelSelect.innerHTML = '<option value="' + AUTO_MODEL + '">OpenMake LLM Auto (로드 실패)</option>';
                        var savedModel = safeStorage.getItem(SK.SELECTED_MODEL || 'selectedModel');
                        if (savedModel) modelSelect.innerHTML = '<option value="' + savedModel + '">' + savedModel + ' (오프라인)</option>';
                    }
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
                    try {
                        var res = await fetch(API_ENDPOINTS.API_KEYS, { credentials: 'include' });
                        if (res.ok) {
                            var data = await res.json();
                            var count = (data.data && data.data.count) || 0;
                            el.textContent = count + '\uAC1C \uD65C\uC131';
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

                async function initSettings() { await loadModels(); loadSettings(); loadApiKeyCount(); loadSystemInfo(); }

                function setTheme(theme) { document.documentElement.setAttribute('data-theme', theme); safeStorage.setItem('theme', theme); }

                function saveSettings() {
                    setTheme(document.getElementById('themeSelect').value);
                    safeStorage.setItem(SK.SELECTED_MODEL || 'selectedModel', document.getElementById('modelSelect').value);

                    // MCP 도구 설정은 toggleMCPTool/setAllMCPTools에서 이미 실시간 저장됨
                    // 명시적 저장 호출
                    if (typeof window.saveMCPSettings === 'function') window.saveMCPSettings();

                    safeStorage.setItem(SK.GENERAL_SETTINGS || 'generalSettings', JSON.stringify({ lang: document.getElementById('langSelect').value, saveHistory: document.getElementById('saveHistoryToggle').checked }));
                    (typeof showToast === 'function' ? showToast('설정이 저장되었습니다.', 'warning') : console.warn('설정이 저장되었습니다.'));
                }

                function loadSettings() {
                    var theme = safeStorage.getItem(SK.THEME || 'theme') || 'dark';
                    document.getElementById('themeSelect').value = theme;
                    setTheme(theme);
                    var selectedModel = safeStorage.getItem(SK.SELECTED_MODEL || 'selectedModel');
                    if (selectedModel) {
                        var opts = document.getElementById('modelSelect').options;
                        for (var i = 0; i < opts.length; i++) {
                            if (opts[i].value === selectedModel) { document.getElementById('modelSelect').value = selectedModel; break; }
                        }
                    }
                    // MCP 설정은 loadMCPSettings()에서 통합 관리
                    if (typeof window.loadMCPSettings === 'function') window.loadMCPSettings();

                    var savedGeneral = safeStorage.getItem(SK.GENERAL_SETTINGS || 'generalSettings');
                    if (savedGeneral) { var general = JSON.parse(savedGeneral); document.getElementById('langSelect').value = general.lang || ''; document.getElementById('saveHistoryToggle').checked = general.saveHistory !== false; }
                }

                function resetSettings() { if (confirm('모든 설정을 초기화하시겠습니까?')) { safeStorage.removeItem(SK.THEME || 'theme'); safeStorage.removeItem(SK.SELECTED_MODEL || 'selectedModel'); safeStorage.removeItem(SK.MCP_SETTINGS || 'mcpSettings'); safeStorage.removeItem(SK.GENERAL_SETTINGS || 'generalSettings'); location.reload(); } }

                async function exportData() {
                    try {
                        var res = await fetch(API_ENDPOINTS.CHAT_SESSIONS + '?limit=500', { credentials: 'include' });
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
                    }
                })();

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
                            tier: 'free', name: 'Free', price: '무료', icon: '🆓',
                            features: ['기본 AI 채팅', '웹 검색', '이미지 분석/OCR']
                        },
                        {
                            tier: 'pro', name: 'Pro', price: 'PRO', icon: '⚡',
                            features: ['Free 전체 기능', '웹 스크래핑 (3종)', '외부 MCP 도구 연동']
                        },
                        {
                            tier: 'enterprise', name: 'Enterprise', price: 'ENTERPRISE', icon: '🏢',
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
                            var btnText = isUpgrade ? '\u2B06 \uC5C5\uADF8\uB808\uC774\uB4DC' : '\u2B07 \uB2E4\uC6B4\uADF8\uB808\uC774\uB4DC';
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
            // Remove onclick-exposed globals
            try { delete window.exportData; } catch (e) { }
            try { delete window.clearHistory; } catch (e) { }
            try { delete window.saveSettings; } catch (e) { }
            try { delete window.resetSettings; } catch (e) { }
            try { delete window.setTheme; } catch (e) { }
            try { delete window.refreshTierUI; } catch (e) { }
        }
    };

export default pageModule;
