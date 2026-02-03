/**
 * settings - SPA Page Module
 * Premium Glassmorphism Redesign v2
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    var CSS = '' +
        '.page-settings { position: relative; min-height: 100%; }' +
        '.page-settings::before {' +
            'content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0;' +
            'background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(102,126,234,0.12), transparent),' +
                'radial-gradient(ellipse 60% 30% at 70% 80%, rgba(118,75,162,0.08), transparent),' +
                'radial-gradient(ellipse 40% 40% at 20% 60%, rgba(102,126,234,0.06), transparent);' +
            'pointer-events: none; z-index: 0;' +
        '}' +
        '.page-settings > * { position: relative; z-index: 1; }' +
        '.settings-container { max-width: 680px; margin: 0 auto; padding: var(--space-8) var(--space-6); }' +
        '.settings-hero { text-align: center; margin-bottom: var(--space-10); }' +
        '.settings-hero-icon { font-size: 3rem; margin-bottom: var(--space-4); display: block; filter: drop-shadow(0 0 20px rgba(102,126,234,0.3)); }' +
        '.settings-hero h1 {' +
            'font-size: var(--font-size-3xl); font-weight: var(--font-weight-bold);' +
            'background: var(--gradient-primary); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;' +
            'margin-bottom: var(--space-2); letter-spacing: -0.02em;' +
        '}' +
        '.settings-hero p { color: var(--text-secondary); font-size: var(--font-size-base); }' +
        '.s-card {' +
            'background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);' +
            'border: 1px solid var(--glass-border); border-radius: var(--radius-xl); padding: 0; margin-bottom: var(--space-6);' +
            'box-shadow: 0 8px 32px rgba(0,0,0,0.2); transition: all 0.3s cubic-bezier(0.4,0,0.2,1); overflow: hidden;' +
            'animation: s-slideUp 0.5s ease both;' +
        '}' +
        '.s-card:nth-child(2) { animation-delay: 0.05s; }' +
        '.s-card:nth-child(3) { animation-delay: 0.1s; }' +
        '.s-card:nth-child(4) { animation-delay: 0.15s; }' +
        '.s-card:nth-child(5) { animation-delay: 0.2s; }' +
        '.s-card:hover { border-color: rgba(255,255,255,0.12); box-shadow: 0 12px 40px rgba(0,0,0,0.3); transform: translateY(-2px); }' +
        '.s-card-header {' +
            'display: flex; align-items: center; gap: var(--space-3); padding: var(--space-5) var(--space-6);' +
            'border-bottom: 1px solid var(--glass-border); position: relative;' +
        '}' +
        '.s-card-header::after {' +
            'content: ""; position: absolute; bottom: -1px; left: var(--space-6); right: var(--space-6); height: 1px;' +
            'background: linear-gradient(90deg, transparent, rgba(102,126,234,0.3), transparent);' +
        '}' +
        '.s-card-icon { font-size: 1.3rem; }' +
        '.s-card-title { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-primary); }' +
        '.s-card-body { padding: var(--space-4) var(--space-6) var(--space-6); }' +
        '.setting-row {' +
            'display: flex; justify-content: space-between; align-items: center;' +
            'padding: var(--space-4) 0; border-bottom: 1px solid rgba(255,255,255,0.04); gap: var(--space-4);' +
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
        '.s-select:focus { outline: none; border-color: rgba(102,126,234,0.5); box-shadow: var(--glow-input-focus); }' +
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
        '.toggle input:checked + .toggle-slider { background: var(--accent-primary); box-shadow: 0 0 12px rgba(102,126,234,0.4); }' +
        '.toggle input:checked + .toggle-slider:before { transform: translateX(22px); }' +
        '.info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-3); }' +
        '.info-item {' +
            'background: var(--glass-bg); border: 1px solid var(--glass-border); padding: var(--space-4);' +
            'border-radius: var(--radius-lg); transition: all var(--transition-normal);' +
        '}' +
        '.info-item:hover { background: var(--glass-bg-hover); border-color: rgba(255,255,255,0.12); transform: translateY(-2px); }' +
        '.info-label { font-size: var(--font-size-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-2); }' +
        '.info-value { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-primary); }' +
        '.s-btn-row { display: flex; gap: var(--space-3); margin-top: var(--space-4); }' +
        '.s-btn {' +
            'display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-3) var(--space-5);' +
            'border-radius: var(--radius-md); font-size: var(--font-size-sm); font-weight: var(--font-weight-medium);' +
            'font-family: inherit; cursor: pointer; transition: all 0.3s cubic-bezier(0.4,0,0.2,1); border: none; position: relative; overflow: hidden;' +
        '}' +
        '.s-btn-primary { background: var(--gradient-primary); color: #ffffff; }' +
        '.s-btn-primary:hover { transform: translateY(-2px); box-shadow: 0 0 30px rgba(102,126,234,0.3); }' +
        '.s-btn-primary:active { transform: translateY(0); }' +
        '.s-btn-secondary { background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary); }' +
        '.s-btn-secondary:hover { background: var(--glass-bg-hover); color: var(--text-primary); border-color: var(--border-medium); }' +
        '.s-btn-danger { background: var(--glass-bg); border: 1px solid rgba(239,68,68,0.2); color: var(--danger); }' +
        '.s-btn-danger:hover { background: var(--danger-light); border-color: rgba(239,68,68,0.4); }' +
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
            'background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);' +
            'border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: var(--space-3) var(--space-5);' +
            'color: var(--text-primary); font-size: var(--font-size-sm); z-index: 9999; opacity: 0;' +
            'transition: all 0.3s ease; pointer-events: none; box-shadow: 0 8px 32px rgba(0,0,0,0.3);' +
        '}' +
        '.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }';

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
                        '<div class="setting-info"><h4>\uC5B8\uC5B4</h4><p>\uC778\uD130\uD398\uC774\uC2A4 \uC5B8\uC5B4\uB97C \uC120\uD0DD\uD569\uB2C8\uB2E4</p></div>' +
                        '<select id="langSelect" class="s-select">' +
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
                        '<div class="setting-info"><h4>\uAE30\uBCF8 \uBAA8\uB378</h4><p>\uCC44\uD305\uC5D0 \uC0AC\uC6A9\uD560 \uAE30\uBCF8 LLM \uBAA8\uB378</p></div>' +
                        '<select id="modelSelect" class="s-select">' +
                            '<option value="default">\uAE30\uBCF8 \uBAA8\uB378</option>' +
                            '<option value="fast">\uBE60\uB978 \uC751\uB2F5 \uBAA8\uB378</option>' +
                            '<option value="advanced">\uACE0\uAE09 \uBAA8\uB378</option>' +
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
                    '<span class="s-card-icon">\u2139\uFE0F</span>' +
                    '<span class="s-card-title">\uC2DC\uC2A4\uD15C \uC815\uBCF4</span>' +
                '</div>' +
                '<div class="s-card-body">' +
                    '<div class="info-grid">' +
                        '<div class="info-item"><div class="info-label">\uBC84\uC804</div><div class="info-value">v1.5.0</div></div>' +
                        '<div class="info-item"><div class="info-label">\uC11C\uBC84 \uC0C1\uD0DC</div><div class="info-value" style="color:var(--success)">\u25CF \uC628\uB77C\uC778</div></div>' +
                        '<div class="info-item"><div class="info-label">\uD65C\uC131 \uB178\uB4DC</div><div class="info-value" id="activeNodes">-</div></div>' +
                        '<div class="info-item"><div class="info-label">\uB9C8\uC9C0\uB9C9 \uC5C5\uB370\uC774\uD2B8</div><div class="info-value">2026-01-01</div></div>' +
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
        getHTML: function() {
            return '<div class="page-settings">' +
                '<style data-spa-style="settings">' + CSS + '<\/style>' +
                HTML +
            '<\/div>';
        },

        init: function() {
            try {
                // 관리자 확인 헬퍼
        function isAdmin() {
            const savedUser = localStorage.getItem('user');
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
                modelSelect.innerHTML = '<option value="default">AI Assistant (Premium)</option>';
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
                    const data = rawData.data || rawData;
                    if (data.models && data.models.length > 0) {
                        const savedModel = localStorage.getItem('selectedModel');
                        const defaultModel = data.defaultModel || 'gemini-3-flash-preview:cloud';

                        modelSelect.innerHTML = data.models.map(model => {
                            const isSelected = savedModel ? model.name === savedModel : model.name === defaultModel;
                            return '<option value="' + model.name + '" ' + (isSelected ? 'selected' : '') + '>' + model.name + ' (' + (model.size ? (model.size / 1024 / 1024 / 1024).toFixed(1) + 'GB' : 'Unknown') + ')</option>';
                        }).join('');
                    }
                }
            } catch (e) {
                console.error('모델 로드 실패:', e);
                const savedModel = localStorage.getItem('selectedModel');
                if (savedModel) modelSelect.innerHTML = '<option value="' + savedModel + '">' + savedModel + '</option>';
            }
        }

        async function initSettings() { await loadModels(); loadSettings(); }

        function setTheme(theme) { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); }

        function saveSettings() {
            setTheme(document.getElementById('themeSelect').value);
            localStorage.setItem('selectedModel', document.getElementById('modelSelect').value);
            var mcpSettings = JSON.parse(localStorage.getItem('mcpSettings') || '{}');
            mcpSettings.thinking = document.getElementById('thinkingToggle').checked;
            mcpSettings.webSearch = document.getElementById('webSearchToggle').checked;
            localStorage.setItem('mcpSettings', JSON.stringify(mcpSettings));
            localStorage.setItem('generalSettings', JSON.stringify({ lang: document.getElementById('langSelect').value, saveHistory: document.getElementById('saveHistoryToggle').checked }));
            (typeof showToast === 'function' ? showToast('설정이 저장되었습니다.', 'warning') : console.warn('설정이 저장되었습니다.'));
        }

        function loadSettings() {
            var theme = localStorage.getItem('theme') || 'dark';
            document.getElementById('themeSelect').value = theme;
            setTheme(theme);
            var selectedModel = localStorage.getItem('selectedModel');
            if (selectedModel) {
                var opts = document.getElementById('modelSelect').options;
                for (var i = 0; i < opts.length; i++) {
                    if (opts[i].value === selectedModel) { document.getElementById('modelSelect').value = selectedModel; break; }
                }
            }
            var savedMcp = localStorage.getItem('mcpSettings');
            if (savedMcp) { var mcp = JSON.parse(savedMcp); document.getElementById('thinkingToggle').checked = mcp.thinking !== false; document.getElementById('webSearchToggle').checked = mcp.webSearch === true; }
            var savedGeneral = localStorage.getItem('generalSettings');
            if (savedGeneral) { var general = JSON.parse(savedGeneral); document.getElementById('langSelect').value = general.lang || 'ko'; document.getElementById('saveHistoryToggle').checked = general.saveHistory !== false; }
        }

        function resetSettings() { if (confirm('모든 설정을 초기화하시겠습니까?')) { localStorage.removeItem('theme'); localStorage.removeItem('selectedModel'); localStorage.removeItem('mcpSettings'); localStorage.removeItem('generalSettings'); location.reload(); } }
        function exportData() { (typeof showToast === 'function' ? showToast('데이터 내보내기 기능은 준비 중입니다.', 'warning') : console.warn('데이터 내보내기 기능은 준비 중입니다.')); }
        function clearHistory() { if (confirm('모든 대화 기록을 삭제하시겠습니까?')) (typeof showToast === 'function' ? showToast('대화 기록이 삭제되었습니다.', 'warning') : console.warn('대화 기록이 삭제되었습니다.')); }

        initSettings();

            // Expose onclick-referenced functions globally
                if (typeof exportData === 'function') window.exportData = exportData;
                if (typeof clearHistory === 'function') window.clearHistory = clearHistory;
                if (typeof saveSettings === 'function') window.saveSettings = saveSettings;
                if (typeof resetSettings === 'function') window.resetSettings = resetSettings;
                if (typeof setTheme === 'function') window.setTheme = setTheme;
            } catch(e) {
                console.error('[PageModule:settings] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.exportData; } catch(e) {}
                try { delete window.clearHistory; } catch(e) {}
                try { delete window.saveSettings; } catch(e) {}
                try { delete window.resetSettings; } catch(e) {}
                try { delete window.setTheme; } catch(e) {}
        }
    };
})();
