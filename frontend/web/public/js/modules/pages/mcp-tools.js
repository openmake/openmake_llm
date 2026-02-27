/**
 * ============================================
 * MCP Tools Page - MCP 도구 관리
 * ============================================
 * Model Context Protocol 도구의 목록 조회, 실행,
 * 도구 티어(built-in/external) 분류, 파라미터 설정을
 * 관리하는 SPA 페이지 모듈입니다.
 *
 * @module pages/mcp-tools
 */
(function () {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['mcp-tools'] = {
        getHTML: function () {
            return '<div class="page-mcp-tools">' +
                '<style data-spa-style="mcp-tools">' +
                ".tool-card {\n            background: var(--bg-card);\n            border-radius: var(--radius-lg);\n            padding: var(--space-6);\n            border: 1px solid var(--border-light);\n            transition: all 0.3s;\n        }\n\n        .tool-card:hover {\n            border-color: var(--accent-primary);\n        }\n\n        .tool-header {\n            display: flex;\n            justify-content: space-between;\n            align-items: flex-start;\n            margin-bottom: var(--space-3);\n        }\n\n        .tool-name {\n            font-size: var(--font-size-lg);\n            font-weight: var(--font-weight-semibold);\n        }\n\n        .tool-toggle {\n            position: relative;\n            width: 48px;\n            height: 26px;\n        }\n\n        .tool-toggle input {\n            opacity: 0;\n            width: 0;\n            height: 0;\n        }\n\n        .toggle-slider {\n            position: absolute;\n            cursor: pointer;\n            top: 0;\n            left: 0;\n            right: 0;\n            bottom: 0;\n            background: var(--border-default);\n            border-radius: 26px;\n            transition: 0.4s;\n        }\n\n        .toggle-slider:before {\n            position: absolute;\n            content: \"\";\n            height: 20px;\n            width: 20px;\n            left: 3px;\n            bottom: 3px;\n            background: white;\n            border-radius: 50%;\n            transition: 0.4s;\n        }\n\n        .tool-toggle input:checked+.toggle-slider {\n            background: var(--success);\n        }\n\n        .tool-toggle input:checked+.toggle-slider:before {\n            transform: translateX(22px);\n        }\n\n        .tool-desc {\n            color: var(--text-muted);\n            font-size: var(--font-size-sm);\n            line-height: 1.5;\n            margin-bottom: var(--space-4);\n        }\n\n        .tool-meta {\n            display: flex;\n            gap: var(--space-4);\n            font-size: var(--font-size-xs);\n            color: var(--text-muted);\n        }\n\n" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\">🔧 MCP 도구 관리</h1>\n                            <p class=\"page-subtitle\">Model Context Protocol 도구 설정</p>\n                        </div>\n                    </header>\n\n                    <div class=\"grid-auto\" style=\"margin-bottom: var(--space-8);\">\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🧠 Sequential Thinking</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" id=\"mcpToggleThinking\" name=\"mcpToggleThinking\" checked\n                                        onchange=\"toggleMCP('thinking', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">복잡한 문제를 단계별로 분석하여 Chain-of-Thought 추론을 수행합니다.</p>\n                            <div class=\"tool-meta\"><span>⚡ 활성</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🌐 Web Search</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" id=\"mcpToggleWebSearch\" name=\"mcpToggleWebSearch\" checked\n                                        onchange=\"toggleMCP('webSearch', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">실시간 웹 검색(Ollama, Google, Wiki 등)을 통해 최신 정보를 조회합니다.</p>\n                            <div class=\"tool-meta\"><span>⚡ 활성</span></div>\n                        </div>\n\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">👁️ Vision Tools</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" id=\"mcpToggleVision\" name=\"mcpToggleVision\" checked\n                                        onchange=\"toggleMCP('vision', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">이미지 분석(analyze_image) 및 텍스트 추출(vision_ocr)을 수행합니다.</p>\n                            <div class=\"tool-meta\"><span>⚡ 활성</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🔥 Firecrawl</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" id=\"mcpToggleFirecrawl\" name=\"mcpToggleFirecrawl\"\n                                        onchange=\"toggleMCP('firecrawl', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">웹 스크래핑, 검색, URL 매핑을 위한 고급 웹 크롤링 도구입니다. (firecrawl_scrape,\n                                firecrawl_search, firecrawl_map)</p>\n                            <div class=\"tool-meta\"><span>⚠️ API 키 필요</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🔐 등급별 도구 접근</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" id=\"toolTierAccess\" name=\"toolTierAccess\" checked disabled><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">사용자 등급(Free/Pro/Enterprise)에 따라 사용 가능한 도구를 자동 필터링합니다.</p>\n                            <div class=\"tool-meta\"><span>✅ 자동 활성</span><span id=\"userTierDisplay\">등급: Free</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">📁 사용자 데이터 격리</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" id=\"toolDataIsolation\" name=\"toolDataIsolation\" checked disabled><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">사용자별 독립된 작업 디렉토리, SQLite DB, 설정 파일을 제공하여 데이터를 안전하게 격리합니다.</p>\n                            <div class=\"tool-meta\"><span>✅ 자동 활성</span><span>🔒 보안 격리</span></div>\n                        </div>\n                    </div>\n\n                    \n\n                    <!-- Save Settings Button -->\n                    <div style=\"display: flex; gap: var(--space-3); margin-top: var(--space-6);\">\n                        <button class=\"btn btn-primary\" onclick=\"saveMCPToolSettings()\">💾 설정 저장</button>\n                        <button class=\"btn btn-secondary\" onclick=\"resetMCPToolSettings()\">↩️ 초기화</button>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
                '<\/div>';
        },

        init: function () {
            try {

                // SafeStorage 래퍼 — Safari Private Mode 등에서 localStorage 예외 방지
                const SS = window.SafeStorage || { getItem: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, setItem: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } }, removeItem: function (k) { try { localStorage.removeItem(k); } catch (e) { } } };

                // 인증 상태 확인 (OAuth 쿠키 세션 포함)
                function isAuthenticated() {
                    const user = SS.getItem('user');
                    const isGuest = SS.getItem('guestMode') === 'true';
                    return !!user || isGuest;
                }

                function isGuestMode() {
                    return SS.getItem('isGuest') === 'true';
                }

                // 게스트/비로그인 기본값: 모든 도구 OFF
                const guestDefaultSettings = {
                    thinking: false,
                    webSearch: false,
                    vision: false,
                    firecrawl: false
                };

                // 로그인 사용자 기본값
                const authDefaultSettings = {
                    thinking: true,
                    webSearch: true,
                    vision: true,
                    firecrawl: false
                };

                // MCP 도구 설정 객체
                let mcpToolSettings = { ...authDefaultSettings };

                // 페이지 로드 시 설정 불러오기 (init() is called after DOM is ready)
                loadMCPToolSettings();

                function loadMCPToolSettings() {
                    // 1. 인증 상태에 따른 기본값 설정
                    const isAuth = isAuthenticated();
                    const defaultSettings = isAuth ? authDefaultSettings : guestDefaultSettings;
                    mcpToolSettings = { ...defaultSettings };

                    // 2. localStorage에서 저장된 설정 불러오기 (사용자가 변경한 경우)
                    const saved = SS.getItem('mcpSettings');
                    if (saved) {
                        try {
                            const parsed = JSON.parse(saved);
                            // 기존 설정 마이그레이션 (github, excel 등 제거, 새 항목 추가)
                            const migrated = { ...mcpToolSettings };
                            if (parsed.thinking !== undefined) migrated.thinking = parsed.thinking;
                            if (parsed.webSearch !== undefined) migrated.webSearch = parsed.webSearch;
                            // 새 항목은 기본값 유지 또는 기존값 매핑
                            if (parsed.fileOps !== undefined) migrated.fileOps = parsed.fileOps;
                            if (parsed.codeSearch !== undefined) migrated.codeSearch = parsed.codeSearch;
                            if (parsed.vision !== undefined) migrated.vision = parsed.vision;
                            if (parsed.firecrawl !== undefined) migrated.firecrawl = parsed.firecrawl;

                            mcpToolSettings = migrated;
                        } catch (e) {
                            console.error('MCP 설정 파싱 실패:', e);
                        }
                    }

                    // 3. 서버에서 설정 동기화 (로그인 사용자만)
                    if (isAuth && !isGuestMode()) {
                        fetchServerSettings();
                    }

                    // 4. UI 업데이트
                    updateToggleUI();

                    // 5. 인증 상태 표시
                    showAuthStatus();
                }

                function showAuthStatus() {
                    const isAuth = isAuthenticated();
                    const isGuest = isGuestMode();

                    let statusText = '';
                    if (!isAuth) {
                        statusText = '⚠️ 비로그인 상태: 모든 MCP 도구가 기본 비활성화됩니다. 필요한 도구를 활성화 후 저장하세요.';
                    } else if (isGuest) {
                        statusText = '👤 게스트 모드: 설정은 이 브라우저에만 저장됩니다.';
                    }

                    if (statusText) {
                        const header = document.querySelector('.page-header');
                        if (header && !document.getElementById('authStatus')) {
                            const notice = document.createElement('div');
                            notice.id = 'authStatus';
                            notice.style.cssText = 'margin-top: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--warning); color: var(--text-inverse); border-radius: var(--radius-md); font-size: var(--font-size-sm);';
                            notice.textContent = statusText;
                            header.appendChild(notice);
                        }
                    }
                }

                async function fetchServerSettings() {
                    try {
                        // 인증은 credentials: 'include' 쿠키로 처리 — localStorage authToken Bearer 헤더 불필요
                        const res = await fetch(API_ENDPOINTS.MCP_SETTINGS, {
                            credentials: 'include'  // httpOnly 쿠키 포함
                        });
                        if (res.ok) {
                            const rawData = await res.json();
                            const data = rawData.data || rawData;
                            if (data.settings) {
                                // localStorage에 저장된 사용자 설정이 있으면 그것이 source of truth
                                // 서버는 동기화 대상이지, 덮어쓰기 대상이 아님
                                const saved = SS.getItem('mcpSettings');
                                if (saved) {
                                    // localStorage에 사용자 설정이 있으면 서버에 PUSH 동기화
                                    syncSettingsToServer();
                                } else {
                                    // localStorage에 설정이 없을 때만 서버 값 사용 (최초 접속)
                                    if (data.settings.sequentialThinking !== undefined) mcpToolSettings.thinking = data.settings.sequentialThinking;
                                    if (data.settings.webSearch !== undefined) mcpToolSettings.webSearch = data.settings.webSearch;
                                    if (data.settings.vision !== undefined) mcpToolSettings.vision = data.settings.vision;
                                }
                            }
                        }
                    } catch (e) {
                        showToast('MCP 설정을 불러올 수 없습니다 (오프라인 모드)', 'warning');
                    }
                }

                // localStorage 설정을 서버에 동기화 (클라이언트 → 서버 방향)
                async function syncSettingsToServer() {
                    try {
                        await fetch(API_ENDPOINTS.MCP_SETTINGS, {
                            method: 'PUT',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sequentialThinking: mcpToolSettings.thinking,
                                webSearch: mcpToolSettings.webSearch,
                                vision: mcpToolSettings.vision
                            })
                        });
                    } catch (e) {
                        // 동기화 실패는 무시 (로컨이 source of truth)
                    }
                }

                function updateToggleUI() {
                    const toggleMap = {
                        'thinking': 'thinking',
                        'webSearch': 'webSearch',
                        'vision': 'vision'
                    };

                    document.querySelectorAll('.tool-toggle input[type="checkbox"]').forEach(input => {
                        const onchange = input.getAttribute('onchange');
                        if (onchange) {
                            const match = onchange.match(/toggleMCP\('(\w+)'/);
                            if (match && match[1]) {
                                const key = match[1];
                                if (mcpToolSettings[key] !== undefined) {
                                    input.checked = mcpToolSettings[key];
                                }
                            }
                        }
                    });
                }

                function toggleMCP(module, enabled) {
                    mcpToolSettings[module] = enabled;

                    // 변경 표시 (저장 전까지 임시)
                    showToast(`${enabled ? '✅' : '❌'} ${getModuleName(module)} ${enabled ? '활성화' : '비활성화'} (저장 필요)`, 'info');
                }

                function getModuleName(module) {
                    const names = {
                        thinking: 'Sequential Thinking',
                        webSearch: 'Web Search',
                        vision: 'Vision Tools',
                        firecrawl: 'Firecrawl (웹 스크래핑)'
                    };
                    return names[module] || module;
                }

                async function saveMCPToolSettings() {
                    // 1. SafeStorage에 저장 (모든 사용자)
                    SS.setItem('mcpSettings', JSON.stringify(mcpToolSettings));

                    // 2. 서버에 동기화 (모든 사용자 - 글로벌 설정)
                    try {
                        const headers = {
                            'Content-Type': 'application/json'
                        };

                        const res = await fetch(API_ENDPOINTS.MCP_SETTINGS, {
                            method: 'PUT',
                            credentials: 'include',  // 🔒 httpOnly 쿠키 포함
                            headers,
                            body: JSON.stringify({
                                sequentialThinking: mcpToolSettings.thinking,
                                webSearch: mcpToolSettings.webSearch,
                                vision: mcpToolSettings.vision
                            })
                        });

                        if (res.ok) {
                            showToast('✅ MCP 설정이 저장되었습니다', 'success');
                        } else {
                            showToast('⚠️ 서버 저장 실패, 로컬에만 저장됨', 'warning');
                        }
                    } catch (e) {
                        showToast('⚠️ 서버 연결 실패, 로컬에만 저장됨', 'warning');
                        console.error('[MCP] 서버 저장 실패:', e);
                    }
                }

                function resetMCPToolSettings() {
                    if (!confirm('모든 MCP 도구 설정을 초기화하시겠습니까?')) return;

                    // 인증 상태에 따른 기본값으로 초기화
                    const isAuth = isAuthenticated();
                    mcpToolSettings = isAuth ? { ...authDefaultSettings } : { ...guestDefaultSettings };

                    SS.setItem('mcpSettings', JSON.stringify(mcpToolSettings));
                    updateToggleUI();
                    showToast('↩️ MCP 도구 설정이 초기화되었습니다', 'info');
                }

                function showToast(message, type = 'info') {
                    const container = document.getElementById('toastContainer');
                    const toast = document.createElement('div');
                    toast.style.cssText = `
                padding: 12px 20px;
                margin-bottom: 10px;
                border-radius: 8px;
                color: white;
                font-size: 14px;
                animation: slideIn 0.3s ease;
                background: ${type === 'success' ? 'var(--success)' : type === 'warning' ? 'var(--warning)' : 'var(--accent-primary)'};
            `;
                    toast.textContent = message;
                    container.appendChild(toast);
                    setTimeout(() => toast.remove(), 3000);
                }


                // ============================================
                // 🔌 외부 MCP 서버 관리
                // ============================================

                // 외부 서버 섹션 HTML 삽입
                const pageContent = document.querySelector('.page-mcp-tools .page-content .container');
                if (pageContent) {
                    const serversSection = document.createElement('div');
                    serversSection.innerHTML = `
                <section style="margin-top: var(--space-8);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-6);">
                        <div>
                            <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold);">🔌 외부 MCP 서버</h2>
                            <p style="color: var(--text-muted); font-size: var(--font-size-sm); margin-top: var(--space-1);">외부 MCP 서버를 등록하여 추가 도구를 사용할 수 있습니다 (Pro 이상)</p>
                        </div>
                        <button id="btnAddServer" onclick="showAddServerForm()" style="padding: var(--space-2) var(--space-4); background: var(--accent-primary); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: var(--font-size-sm);">+ 서버 추가</button>
                    </div>

                    <!-- 서버 추가 폼 (숨김) -->
                    <div id="addServerForm" style="display: none; background: var(--bg-card); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: var(--space-6); margin-bottom: var(--space-6);">
                        <h3 style="margin-bottom: var(--space-4); font-size: var(--font-size-lg);">새 서버 등록</h3>
                        <div style="display: grid; gap: var(--space-4);">
                            <div>
                                <label for="serverName" style="display: block; margin-bottom: var(--space-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">서버 이름 *</label>
                                <input id="serverName" type="text" placeholder="예: filesystem, postgres" style="width: 100%; padding: var(--space-2) var(--space-3); background: var(--bg-primary); border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-primary); font-size: var(--font-size-sm);" />
                            </div>
                            <div>
                                <label for="serverTransport" style="display: block; margin-bottom: var(--space-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">전송 방식 *</label>
                                <select id="serverTransport" onchange="toggleTransportFields()" style="width: 100%; padding: var(--space-2) var(--space-3); background: var(--bg-primary); border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-primary); font-size: var(--font-size-sm);">
                                    <option value="stdio">stdio (로컬 프로세스)</option>
                                    <option value="sse">SSE (Server-Sent Events)</option>
                                    <option value="streamable-http">Streamable HTTP</option>
                                </select>
                            </div>
                            <div id="stdioFields">
                                <label for="serverCommand" style="display: block; margin-bottom: var(--space-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">명령어 *</label>
                                <input id="serverCommand" type="text" placeholder="예: npx" style="width: 100%; padding: var(--space-2) var(--space-3); background: var(--bg-primary); border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-primary); font-size: var(--font-size-sm); margin-bottom: var(--space-2);" />
                                <label for="serverArgs" style="display: block; margin-bottom: var(--space-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">인자 (쉼표 구분)</label>
                                <input id="serverArgs" type="text" placeholder="예: @modelcontextprotocol/server-filesystem, /tmp" style="width: 100%; padding: var(--space-2) var(--space-3); background: var(--bg-primary); border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-primary); font-size: var(--font-size-sm);" />
                            </div>
                            <div id="urlFields" style="display: none;">
                                <label for="serverUrl" style="display: block; margin-bottom: var(--space-1); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);">서버 URL *</label>
                                <input id="serverUrl" type="text" placeholder="예: http://localhost:3001/sse" style="width: 100%; padding: var(--space-2) var(--space-3); background: var(--bg-primary); border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-primary); font-size: var(--font-size-sm);" />
                            </div>
                            <div style="display: flex; gap: var(--space-3); justify-content: flex-end;">
                                <button onclick="hideAddServerForm()" style="padding: var(--space-2) var(--space-4); background: transparent; border: 1px solid var(--border-light); border-radius: var(--radius-md); color: var(--text-muted); cursor: pointer; font-size: var(--font-size-sm);">취소</button>
                                <button onclick="submitAddServer()" style="padding: var(--space-2) var(--space-4); background: var(--accent-primary); color: white; border: none; border-radius: var(--radius-md); cursor: pointer; font-size: var(--font-size-sm);">등록</button>
                            </div>
                        </div>
                    </div>

                    <!-- 서버 목록 -->
                    <div id="serverList" style="display: grid; gap: var(--space-4);"></div>
                    <div id="noServers" style="text-align: center; color: var(--text-muted); padding: var(--space-8); font-size: var(--font-size-sm);">
                        등록된 외부 서버가 없습니다. 위 버튼으로 서버를 추가하세요.
                    </div>
                </section>
            `;
                    pageContent.appendChild(serversSection);
                }

                // 서버 목록 로드
                async function loadExternalServers() {
                    try {
                        const res = await fetch(API_ENDPOINTS.MCP_SERVERS, {
                            credentials: 'include'
                        });
                        if (!res.ok) { showToast('도구 목록 로드 실패', 'error'); return; }
                        const raw = await res.json();
                        const data = raw.data || raw;
                        const servers = data.servers || [];

                        const listEl = document.getElementById('serverList');
                        const noEl = document.getElementById('noServers');
                        if (!listEl) return;

                        if (servers.length === 0) {
                            listEl.innerHTML = '';
                            if (noEl) noEl.style.display = 'block';
                            return;
                        }
                        if (noEl) noEl.style.display = 'none';

                        listEl.innerHTML = servers.map(function (s) {
                            var statusColor = s.connectionStatus === 'connected' ? 'var(--success)' : s.connectionStatus === 'error' ? 'var(--danger, #ff4444)' : 'var(--text-muted)';
                            var statusLabel = s.connectionStatus === 'connected' ? '🟢 연결됨' : s.connectionStatus === 'error' ? '🔴 오류' : '⚪ 미연결';
                            return '<div class="tool-card">' +
                                '<div class="tool-header">' +
                                '<div>' +
                                '<span class="tool-name">🔌 ' + escapeForHTML(s.name) + '</span>' +
                                '<span style="margin-left: var(--space-2); font-size: var(--font-size-xs); color: ' + statusColor + ';">' + statusLabel + '</span>' +
                                '</div>' +
                                '<div style="display: flex; gap: var(--space-2);">' +
                                (s.connectionStatus === 'connected'
                                    ? '<button onclick="disconnectServer(\'' + s.id + '\')" style="padding: 4px 10px; background: transparent; border: 1px solid var(--border-light); border-radius: var(--radius-sm); color: var(--text-muted); cursor: pointer; font-size: 12px;">연결 해제</button>'
                                    : '<button onclick="connectServer(\'' + s.id + '\')" style="padding: 4px 10px; background: var(--accent-primary); border: none; border-radius: var(--radius-sm); color: white; cursor: pointer; font-size: 12px;">연결</button>') +
                                '<button onclick="deleteServer(\'' + s.id + '\')" style="padding: 4px 10px; background: transparent; border: 1px solid var(--danger, #ff4444); border-radius: var(--radius-sm); color: var(--danger, #ff4444); cursor: pointer; font-size: 12px;">삭제</button>' +
                                '</div>' +
                                '</div>' +
                                '<p class="tool-desc">' + escapeForHTML(s.transport_type) + (s.command ? ' — ' + escapeForHTML(s.command) : '') + (s.url ? ' — ' + escapeForHTML(s.url) : '') + '</p>' +
                                '<div class="tool-meta">' +
                                '<span>도구: ' + (s.toolCount || 0) + '개</span>' +
                                (s.connectionError ? '<span style="color: var(--danger, #ff4444);">오류: ' + escapeForHTML(s.connectionError) + '</span>' : '') +
                                '</div>' +
                                '</div>';
                        }).join('');
                    } catch (e) {
                        console.error('[MCP] 외부 서버 목록 로드 실패:', e);
                        showToast('외부 서버 목록을 불러올 수 없습니다', 'error');
                    }
                }

                function escapeForHTML(str) {
                    if (!str) return '';
                    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                }

                function showAddServerForm() {
                    var form = document.getElementById('addServerForm');
                    if (form) form.style.display = 'block';
                }

                function hideAddServerForm() {
                    var form = document.getElementById('addServerForm');
                    if (form) form.style.display = 'none';
                }

                function toggleTransportFields() {
                    var transport = document.getElementById('serverTransport').value;
                    var stdioFields = document.getElementById('stdioFields');
                    var urlFields = document.getElementById('urlFields');
                    if (stdioFields) stdioFields.style.display = transport === 'stdio' ? 'block' : 'none';
                    if (urlFields) urlFields.style.display = transport !== 'stdio' ? 'block' : 'none';
                }

                async function submitAddServer() {
                    var name = (document.getElementById('serverName').value || '').trim();
                    var transport = document.getElementById('serverTransport').value;
                    if (!name) { showToast('서버 이름을 입력하세요', 'warning'); return; }

                    var body = { name: name, transport_type: transport, enabled: true };

                    if (transport === 'stdio') {
                        var cmd = (document.getElementById('serverCommand').value || '').trim();
                        if (!cmd) { showToast('명령어를 입력하세요', 'warning'); return; }
                        body.command = cmd;
                        var argsStr = (document.getElementById('serverArgs').value || '').trim();
                        if (argsStr) body.args = argsStr.split(',').map(function (a) { return a.trim(); });
                    } else {
                        var url = (document.getElementById('serverUrl').value || '').trim();
                        if (!url) { showToast('서버 URL을 입력하세요', 'warning'); return; }
                        body.url = url;
                    }

                    try {
                        var headers = { 'Content-Type': 'application/json' };

                        var res = await fetch(API_ENDPOINTS.MCP_SERVERS, {
                            method: 'POST',
                            credentials: 'include',
                            headers: headers,
                            body: JSON.stringify(body)
                        });
                        var raw = await res.json();
                        if (res.ok && raw.success) {
                            showToast('✅ 서버가 등록되었습니다', 'success');
                            hideAddServerForm();
                            loadExternalServers();
                        } else {
                            var errMsg = (raw.error && raw.error.message) || '서버 등록 실패';
                            showToast('❌ ' + errMsg, 'warning');
                        }
                    } catch (e) {
                        showToast('❌ 서버 등록 중 오류: ' + e.message, 'warning');
                    }
                }

                async function connectServer(serverId) {
                    try {
                        var res = await fetch(API_ENDPOINTS.MCP_SERVERS + '/' + serverId + '/connect', {
                            method: 'POST',
                            credentials: 'include'
                        });
                        if (res.ok) {
                            showToast('✅ 서버에 연결되었습니다', 'success');
                            loadExternalServers();
                        } else {
                            var raw = await res.json();
                            showToast('❌ 연결 실패: ' + ((raw.error && raw.error.message) || '알 수 없는 오류'), 'warning');
                        }
                    } catch (e) {
                        showToast('❌ 연결 오류: ' + e.message, 'warning');
                    }
                }

                async function disconnectServer(serverId) {
                    try {
                        var res = await fetch(API_ENDPOINTS.MCP_SERVERS + '/' + serverId + '/disconnect', {
                            method: 'POST',
                            credentials: 'include'
                        });
                        if (res.ok) {
                            showToast('✅ 서버 연결이 해제되었습니다', 'success');
                            loadExternalServers();
                        } else {
                            showToast('❌ 연결 해제 실패', 'warning');
                        }
                    } catch (e) {
                        showToast('❌ 연결 해제 오류: ' + e.message, 'warning');
                    }
                }

                async function deleteServer(serverId) {
                    if (!confirm('이 서버를 삭제하시겠습니까?')) return;
                    try {
                        var res = await fetch(API_ENDPOINTS.MCP_SERVERS + '/' + serverId, {
                            method: 'DELETE',
                            credentials: 'include'
                        });
                        if (res.ok) {
                            showToast('✅ 서버가 삭제되었습니다', 'success');
                            loadExternalServers();
                        } else {
                            showToast('❌ 삭제 실패', 'warning');
                        }
                    } catch (e) {
                        showToast('❌ 삭제 오류: ' + e.message, 'warning');
                    }
                }

                // 초기 로드
                loadExternalServers();

                // Expose onclick-referenced functions globally
                if (typeof toggleMCP === 'function') window.toggleMCP = toggleMCP;
                if (typeof saveMCPToolSettings === 'function') window.saveMCPToolSettings = saveMCPToolSettings;
                if (typeof resetMCPToolSettings === 'function') window.resetMCPToolSettings = resetMCPToolSettings;
                if (typeof showAddServerForm === 'function') window.showAddServerForm = showAddServerForm;
                if (typeof hideAddServerForm === 'function') window.hideAddServerForm = hideAddServerForm;
                if (typeof toggleTransportFields === 'function') window.toggleTransportFields = toggleTransportFields;
                if (typeof submitAddServer === 'function') window.submitAddServer = submitAddServer;
                if (typeof connectServer === 'function') window.connectServer = connectServer;
                if (typeof disconnectServer === 'function') window.disconnectServer = disconnectServer;
                if (typeof deleteServer === 'function') window.deleteServer = deleteServer;
            } catch (e) {
                console.error('[PageModule:mcp-tools] init error:', e);
            }
        },

        cleanup: function () {
            _intervals.forEach(function (id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function (id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
            try { delete window.toggleMCP; } catch (e) { }
            try { delete window.saveMCPToolSettings; } catch (e) { }
            try { delete window.resetMCPToolSettings; } catch (e) { }
            try { delete window.showAddServerForm; } catch (e) { }
            try { delete window.hideAddServerForm; } catch (e) { }
            try { delete window.toggleTransportFields; } catch (e) { }
            try { delete window.submitAddServer; } catch (e) { }
            try { delete window.connectServer; } catch (e) { }
            try { delete window.disconnectServer; } catch (e) { }
            try { delete window.deleteServer; } catch (e) { }
        }
    };
})();
