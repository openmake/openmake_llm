/**
 * mcp-tools - SPA Page Module
 * Auto-generated from mcp-tools.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['mcp-tools'] = {
        getHTML: function() {
            return '<div class="page-mcp-tools">' +
                '<style data-spa-style="mcp-tools">' +
                ".tool-card {\n            background: var(--bg-card);\n            border-radius: var(--radius-lg);\n            padding: var(--space-6);\n            border: 1px solid var(--border-light);\n            transition: all 0.3s;\n        }\n\n        .tool-card:hover {\n            border-color: var(--accent-primary);\n        }\n\n        .tool-header {\n            display: flex;\n            justify-content: space-between;\n            align-items: flex-start;\n            margin-bottom: var(--space-3);\n        }\n\n        .tool-name {\n            font-size: var(--font-size-lg);\n            font-weight: var(--font-weight-semibold);\n        }\n\n        .tool-toggle {\n            position: relative;\n            width: 48px;\n            height: 26px;\n        }\n\n        .tool-toggle input {\n            opacity: 0;\n            width: 0;\n            height: 0;\n        }\n\n        .toggle-slider {\n            position: absolute;\n            cursor: pointer;\n            top: 0;\n            left: 0;\n            right: 0;\n            bottom: 0;\n            background: var(--border-default);\n            border-radius: 26px;\n            transition: 0.4s;\n        }\n\n        .toggle-slider:before {\n            position: absolute;\n            content: \"\";\n            height: 20px;\n            width: 20px;\n            left: 3px;\n            bottom: 3px;\n            background: white;\n            border-radius: 50%;\n            transition: 0.4s;\n        }\n\n        .tool-toggle input:checked+.toggle-slider {\n            background: var(--success);\n        }\n\n        .tool-toggle input:checked+.toggle-slider:before {\n            transform: translateX(22px);\n        }\n\n        .tool-desc {\n            color: var(--text-muted);\n            font-size: var(--font-size-sm);\n            line-height: 1.5;\n            margin-bottom: var(--space-4);\n        }\n\n        .tool-meta {\n            display: flex;\n            gap: var(--space-4);\n            font-size: var(--font-size-xs);\n            color: var(--text-muted);\n        }\n\n        .terminal-output {\n            background: #0d0d0d;\n            border-radius: var(--radius-md);\n            padding: var(--space-4);\n            font-family: var(--font-mono);\n            font-size: var(--font-size-sm);\n            color: #0f0;\n            min-height: 200px;\n            max-height: 400px;\n            overflow-y: auto;\n            white-space: pre-wrap;\n        }" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\">🔧 MCP 도구 관리</h1>\n                            <p class=\"page-subtitle\">Model Context Protocol 도구 설정</p>\n                        </div>\n                    </header>\n\n                    <div class=\"grid-auto\" style=\"margin-bottom: var(--space-8);\">\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🧠 Sequential Thinking</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" checked\n                                        onchange=\"toggleMCP('thinking', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">복잡한 문제를 단계별로 분석하여 Chain-of-Thought 추론을 수행합니다.</p>\n                            <div class=\"tool-meta\"><span>⚡ 활성</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🌐 Web Search</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" checked\n                                        onchange=\"toggleMCP('webSearch', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">실시간 웹 검색(Ollama, Google, Wiki 등)을 통해 최신 정보를 조회합니다.</p>\n                            <div class=\"tool-meta\"><span>⚡ 활성</span></div>\n                        </div>\n\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">👁️ Vision Tools</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" checked\n                                        onchange=\"toggleMCP('vision', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">이미지 분석(analyze_image) 및 텍스트 추출(vision_ocr)을 수행합니다.</p>\n                            <div class=\"tool-meta\"><span>⚡ 활성</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">💻 Terminal</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\"\n                                        onchange=\"toggleMCP('terminal', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">안전한 터미널 명령어를 실행합니다. (run_command)</p>\n                            <div class=\"tool-meta\"><span>⚠️ 기본 비활성</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🔥 Firecrawl</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\"\n                                        onchange=\"toggleMCP('firecrawl', this.checked)\"><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">웹 스크래핑, 검색, URL 매핑을 위한 고급 웹 크롤링 도구입니다. (firecrawl_scrape,\n                                firecrawl_search, firecrawl_map)</p>\n                            <div class=\"tool-meta\"><span>⚠️ API 키 필요</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">🔐 등급별 도구 접근</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" checked disabled><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">사용자 등급(Free/Pro/Enterprise)에 따라 사용 가능한 도구를 자동 필터링합니다.</p>\n                            <div class=\"tool-meta\"><span>✅ 자동 활성</span><span id=\"userTierDisplay\">등급: Free</span></div>\n                        </div>\n\n                        <div class=\"tool-card\">\n                            <div class=\"tool-header\">\n                                <span class=\"tool-name\">📁 사용자 데이터 격리</span>\n                                <label class=\"tool-toggle\"><input type=\"checkbox\" checked disabled><span\n                                        class=\"toggle-slider\"></span></label>\n                            </div>\n                            <p class=\"tool-desc\">사용자별 독립된 작업 디렉토리, SQLite DB, 설정 파일을 제공하여 데이터를 안전하게 격리합니다.</p>\n                            <div class=\"tool-meta\"><span>✅ 자동 활성</span><span>🔒 보안 격리</span></div>\n                        </div>\n                    </div>\n\n                    <div class=\"card\">\n                        <div class=\"card-header\">\n                            <span class=\"card-title\">💻 터미널 도구 테스트</span>\n                        </div>\n                        <div class=\"card-body\">\n                            <div style=\"display: flex; gap: var(--space-3); margin-bottom: var(--space-4);\">\n                                <input type=\"text\" id=\"terminalCmd\" class=\"form-input\" style=\"flex: 1;\"\n                                    placeholder=\"명령어 입력 (예: ls -la, git status)\"\n                                    onkeydown=\"if(event.key==='Enter') executeCommand()\">\n                                <button class=\"btn btn-primary\" onclick=\"executeCommand()\">실행</button>\n                            </div>\n                            <div class=\"terminal-output\" id=\"terminalOutput\">$ 터미널 명령어를 입력하세요.\n                                허용된 명령어: ls, pwd, git, npm, node, cat, grep 등</div>\n                        </div>\n                    </div>\n\n                    <!-- Save Settings Button -->\n                    <div style=\"display: flex; gap: var(--space-3); margin-top: var(--space-6);\">\n                        <button class=\"btn btn-primary\" onclick=\"saveMCPToolSettings()\">💾 설정 저장</button>\n                        <button class=\"btn btn-secondary\" onclick=\"resetMCPToolSettings()\">↩️ 초기화</button>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                const API_BASE = window.location.origin;

        // 인증 상태 확인
        function isAuthenticated() {
            const authToken = localStorage.getItem('authToken');
            const isGuest = localStorage.getItem('isGuest') === 'true';
            return authToken || isGuest;
        }

        function isGuestMode() {
            return localStorage.getItem('isGuest') === 'true';
        }

        // 게스트/비로그인 기본값: 모든 도구 OFF
        const guestDefaultSettings = {
            thinking: false,
            webSearch: false,
            vision: false,
            terminal: false,
            firecrawl: false
        };

        // 로그인 사용자 기본값
        const authDefaultSettings = {
            thinking: true,
            webSearch: true,
            vision: true,
            terminal: false,
            firecrawl: false
        };

        // MCP 도구 설정 객체
        let mcpToolSettings = { ...authDefaultSettings };

        // 페이지 로드 시 설정 불러오기
        document.addEventListener('DOMContentLoaded', loadMCPToolSettings);

        function loadMCPToolSettings() {
            // 1. 인증 상태에 따른 기본값 설정
            const isAuth = isAuthenticated();
            const defaultSettings = isAuth ? authDefaultSettings : guestDefaultSettings;
            mcpToolSettings = { ...defaultSettings };

            // 2. localStorage에서 저장된 설정 불러오기 (사용자가 변경한 경우)
            const saved = localStorage.getItem('mcpSettings');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // 기존 설정 마이그레이션 (github, excel 등 제거, 새 항목 추가)
                    const migrated = { ...mcpToolSettings };
                    if (parsed.thinking !== undefined) migrated.thinking = parsed.thinking;
                    if (parsed.webSearch !== undefined) migrated.webSearch = parsed.webSearch;
                    if (parsed.terminal !== undefined) migrated.terminal = parsed.terminal;

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
                    notice.style.cssText = 'margin-top: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--warning); color: #000; border-radius: var(--radius-md); font-size: var(--font-size-sm);';
                    notice.textContent = statusText;
                    header.appendChild(notice);
                }
            }
        }

        async function fetchServerSettings() {
            try {
                 const authToken = localStorage.getItem('authToken');
                 const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};

                 const res = await fetch(`${API_BASE}/api/mcp/settings`, {
                     credentials: 'include',  // 🔒 httpOnly 쿠키 포함
                     headers
                 });
                if (res.ok) {
                    const rawData = await res.json();
                    const data = rawData.data || rawData;
                    if (data.settings) {
                        // 서버 설정을 로컬에 매핑
                        if (data.settings.sequentialThinking !== undefined) mcpToolSettings.thinking = data.settings.sequentialThinking;
                        if (data.settings.webSearch !== undefined) mcpToolSettings.webSearch = data.settings.webSearch;
                        if (data.settings.vision !== undefined) mcpToolSettings.vision = data.settings.vision;
                        if (data.settings.terminal !== undefined) mcpToolSettings.terminal = data.settings.terminal;

                        updateToggleUI();
                        console.log('[MCP] 서버 설정 동기화 완료:', mcpToolSettings);
                    }
                }
            } catch (e) {
                console.log('[MCP] 서버 설정 불러오기 실패 (오프라인 모드):', e.message);
            }
        }

        function updateToggleUI() {
            const toggleMap = {
                'thinking': 'thinking',
                'webSearch': 'webSearch',
                'vision': 'vision',
                'terminal': 'terminal'
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
            console.log(`[MCP] ${module}: ${enabled ? '활성화' : '비활성화'}`);

            // 변경 표시 (저장 전까지 임시)
            showToast(`${enabled ? '✅' : '❌'} ${getModuleName(module)} ${enabled ? '활성화' : '비활성화'} (저장 필요)`, 'info');
        }

        function getModuleName(module) {
            const names = {
                thinking: 'Sequential Thinking',
                webSearch: 'Web Search',
                vision: 'Vision Tools',
                terminal: 'Terminal',
                firecrawl: 'Firecrawl (웹 스크래핑)'
            };
            return names[module] || module;
        }

        async function saveMCPToolSettings() {
            // 1. localStorage에 저장 (모든 사용자)
            localStorage.setItem('mcpSettings', JSON.stringify(mcpToolSettings));

            // 2. 서버에 동기화 (모든 사용자 - 글로벌 설정)
            try {
                const authToken = localStorage.getItem('authToken');
                const headers = {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                };

                 const res = await fetch(`${API_BASE}/api/mcp/settings`, {
                     method: 'PUT',
                     credentials: 'include',  // 🔒 httpOnly 쿠키 포함
                     headers,
                     body: JSON.stringify({
                         sequentialThinking: mcpToolSettings.thinking,
                         webSearch: mcpToolSettings.webSearch,
                         vision: mcpToolSettings.vision,
                         terminal: mcpToolSettings.terminal
                     })
                });

                if (res.ok) {
                    showToast('✅ MCP 설정이 저장되었습니다', 'success');
                    console.log('[MCP] 설정 저장 완료');
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

            localStorage.setItem('mcpSettings', JSON.stringify(mcpToolSettings));
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

        async function executeCommand() {
            const cmd = document.getElementById('terminalCmd').value.trim();
            if (!cmd) return;
            const output = document.getElementById('terminalOutput');
            output.textContent += `\n$ ${cmd}\n실행 중...\n`;
            try {
                 const res = await fetch(`${API_BASE}/api/mcp/terminal`, {
                     method: 'POST',
                     credentials: 'include',  // 🔒 httpOnly 쿠키 포함
                     headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ command: cmd })
                 });
                const rawData = await res.json();
                const data = rawData.data || rawData;
                if (rawData.success) { output.textContent += data.stdout || '(출력 없음)\n'; }
                else { 
                    const errorMsg = (rawData.error && typeof rawData.error === 'object') ? rawData.error.message : (data.error || data.stderr);
                    output.textContent += `오류: ${errorMsg}\n`; 
                }
            } catch (e) { output.textContent += `연결 오류: ${e.message}\n`; }
            output.scrollTop = output.scrollHeight;
            document.getElementById('terminalCmd').value = '';
        }

            // Expose onclick-referenced functions globally
                if (typeof executeCommand === 'function') window.executeCommand = executeCommand;
                if (typeof saveMCPToolSettings === 'function') window.saveMCPToolSettings = saveMCPToolSettings;
                if (typeof resetMCPToolSettings === 'function') window.resetMCPToolSettings = resetMCPToolSettings;
            } catch(e) {
                console.error('[PageModule:mcp-tools] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.executeCommand; } catch(e) {}
                try { delete window.saveMCPToolSettings; } catch(e) {}
                try { delete window.resetMCPToolSettings; } catch(e) {}
        }
    };
})();
