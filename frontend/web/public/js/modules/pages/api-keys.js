(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    // Helper: Escape HTML
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    // Helper: API Fetch
    async function apiFetch(url, options) {
        var authToken = window.SafeStorage
            ? window.SafeStorage.getItem('authToken')
            : (function () {
                try { return localStorage.getItem('authToken'); } catch (e) { return null; }
            })();
        var headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
        var res = await fetch(url, Object.assign({ credentials: 'include', headers: headers }, options || {}));
        if (!res.ok) { var err = await res.json().catch(function() { return {}; }); throw new Error(err.error || err.message || 'API 오류'); }
        return res.json();
    }

    // CSS Styles
    var CSS = '' +
        '.page-api-keys { position: relative; min-height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }' +
        '.page-api-keys::before {' +
            'content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0;' +
            'background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(102,126,234,0.12), transparent),' +
                'radial-gradient(ellipse 60% 30% at 70% 80%, rgba(118,75,162,0.08), transparent),' +
                'radial-gradient(ellipse 40% 40% at 20% 60%, rgba(102,126,234,0.06), transparent);' +
            'pointer-events: none; z-index: 0;' +
        '}' +
        '.page-api-keys > * { position: relative; z-index: 1; }' +
        '.ak-container { max-width: 800px; margin: 0 auto; padding: var(--space-8) var(--space-6); }' +
        
        // Hero Section
        '.ak-hero { text-align: center; margin-bottom: var(--space-10); }' +
        '.ak-hero-icon { font-size: 3rem; margin-bottom: var(--space-4); display: block; filter: drop-shadow(0 0 20px rgba(102,126,234,0.3)); }' +
        '.ak-hero h1 {' +
            'font-size: var(--font-size-3xl); font-weight: var(--font-weight-bold);' +
            'background: var(--gradient-primary); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;' +
            'margin-bottom: var(--space-2); letter-spacing: -0.02em;' +
        '}' +
        '.ak-hero p { color: var(--text-secondary); font-size: var(--font-size-base); }' +

        // Glass Card Styles
        '.s-card {' +
            'background: var(--glass-bg); backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);' +
            'border: 1px solid var(--glass-border); border-radius: var(--radius-xl); padding: 0; margin-bottom: var(--space-6);' +
            'box-shadow: 0 8px 32px rgba(0,0,0,0.2); transition: all 0.3s cubic-bezier(0.4,0,0.2,1); overflow: hidden;' +
            'animation: ak-slideUp 0.5s ease both;' +
        '}' +
        '.s-card-header {' +
            'display: flex; align-items: center; justify-content: space-between; padding: var(--space-5) var(--space-6);' +
            'border-bottom: 1px solid var(--glass-border); position: relative;' +
        '}' +
        '.s-card-header h3 { font-size: var(--font-size-lg); font-weight: var(--font-weight-semibold); color: var(--text-primary); margin: 0; }' +
        '.s-card-body { padding: var(--space-6); }' +

        // Input & Button Styles
        '.ak-input-group { display: flex; gap: var(--space-3); }' +
        '.ak-input {' +
            'flex: 1; background: var(--bg-secondary); border: 1px solid var(--glass-border); border-radius: var(--radius-md);' +
            'padding: var(--space-3) var(--space-4); color: var(--text-primary); font-size: var(--font-size-base);' +
            'transition: all 0.2s ease;' +
        '}' +
        '.ak-input:focus { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 2px rgba(102,126,234,0.2); }' +
        '.ak-btn {' +
            'display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);' +
            'padding: var(--space-3) var(--space-5); border-radius: var(--radius-md); font-weight: var(--font-weight-medium);' +
            'cursor: pointer; transition: all 0.2s ease; border: none; font-size: var(--font-size-sm);' +
        '}' +
        '.ak-btn-primary { background: var(--gradient-primary); color: white; box-shadow: 0 4px 12px rgba(102,126,234,0.3); }' +
        '.ak-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 16px rgba(102,126,234,0.4); }' +
        '.ak-btn-secondary { background: rgba(255,255,255,0.05); color: var(--text-primary); border: 1px solid var(--glass-border); }' +
        '.ak-btn-secondary:hover { background: rgba(255,255,255,0.1); }' +
        '.ak-btn-danger { background: rgba(239,68,68,0.1); color: var(--danger); border: 1px solid rgba(239,68,68,0.2); }' +
        '.ak-btn-danger:hover { background: rgba(239,68,68,0.2); }' +
        '.ak-btn-icon { padding: var(--space-2); width: 32px; height: 32px; border-radius: var(--radius-md); }' +

        // Key List Items
        '.ak-key-item {' +
            'display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5);' +
            'border-bottom: 1px solid var(--glass-border); transition: background 0.2s ease;' +
        '}' +
        '.ak-key-item:last-child { border-bottom: none; }' +
        '.ak-key-item:hover { background: rgba(255,255,255,0.02); }' +
        '.ak-key-header { display: flex; justify-content: space-between; align-items: flex-start; }' +
        '.ak-key-name { font-size: var(--font-size-lg); font-weight: var(--font-weight-bold); color: var(--text-primary); margin-bottom: var(--space-1); }' +
        '.ak-key-meta { display: flex; gap: var(--space-3); font-size: var(--font-size-xs); color: var(--text-secondary); align-items: center; flex-wrap: wrap; }' +
        '.ak-key-value-row { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); background: rgba(0,0,0,0.2); padding: var(--space-3); border-radius: var(--radius-md); }' +
        '.ak-key-value { font-family: monospace; color: var(--text-primary); font-size: var(--font-size-sm); letter-spacing: 0.5px; }' +
        '.ak-badge { padding: 2px 8px; border-radius: 12px; font-size: 10px; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px; }' +
        '.ak-badge-active { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }' +
        '.ak-badge-inactive { background: rgba(107, 114, 128, 0.2); color: #9ca3af; border: 1px solid rgba(107, 114, 128, 0.3); }' +
        '.ak-actions { display: flex; gap: var(--space-2); margin-top: var(--space-4); }' +

        // Empty State
        '.ak-empty { text-align: center; padding: var(--space-8); color: var(--text-muted); }' +
        '.ak-empty-icon { font-size: 3rem; margin-bottom: var(--space-4); opacity: 0.5; }' +

        // Code Block
        '.ak-code-block {' +
            'background: #1e1e1e; padding: var(--space-4); border-radius: var(--radius-md);' +
            'font-family: monospace; color: #d4d4d4; font-size: var(--font-size-xs); overflow-x: auto;' +
            'border: 1px solid var(--glass-border); line-height: 1.5;' +
        '}' +
        '.ak-code-comment { color: #6a9955; }' +
        '.ak-code-keyword { color: #569cd6; }' +
        '.ak-code-string { color: #ce9178; }' +

        // Modal/Banner for New Key
        '.ak-new-key-overlay {' +
            'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 9999;' +
            'background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);' +
            'display: flex; align-items: center; justify-content: center; padding: var(--space-4);' +
            'animation: ak-fadeIn 0.2s ease both;' +
        '}' +
        '.ak-new-key-modal {' +
            'background: #1f2937; border: 1px solid var(--glass-border); border-radius: var(--radius-xl);' +
            'width: 100%; max-width: 500px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.5);' +
            'animation: ak-scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) both;' +
        '}' +
        '.ak-new-key-header { background: var(--gradient-primary); padding: var(--space-5); text-align: center; }' +
        '.ak-new-key-header h2 { color: white; font-size: var(--font-size-xl); margin: 0; font-weight: bold; }' +
        '.ak-new-key-body { padding: var(--space-6); }' +
        '.ak-warning-text { color: #fbbf24; font-size: var(--font-size-sm); margin-bottom: var(--space-4); text-align: center; display: flex; align-items: center; justify-content: center; gap: var(--space-2); }' +
        '.ak-full-key-display {' +
            'background: black; border: 1px solid #374151; padding: var(--space-4); border-radius: var(--radius-md);' +
            'font-family: monospace; color: #4ade80; font-size: var(--font-size-lg); word-break: break-all;' +
            'margin-bottom: var(--space-6); text-align: center; user-select: all;' +
        '}' +

        '@keyframes ak-slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }' +
        '@keyframes ak-fadeIn { from { opacity: 0; } to { opacity: 1; } }' +
        '@keyframes ak-scaleIn { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }' +
        
        '@media (max-width: 600px) {' +
            '.ak-key-header { flex-direction: column; gap: var(--space-2); }' +
            '.ak-actions { width: 100%; }' +
            '.ak-btn { flex: 1; }' +
        '}';

    var HTML =
        '<div class="page-api-keys">' +
            '<div class="ak-container">' +
                // Hero Section
                '<div class="ak-hero">' +
                    '<span class="ak-hero-icon">\uD83D\uDD11</span>' + // 🔑
                    '<h1>API 키 관리</h1>' +
                    '<p>외부 서비스 연동을 위한 API 키를 안전하게 관리하세요.</p>' +
                '</div>' +

                // Create Key Section
                '<div class="s-card">' +
                    '<div class="s-card-header">' +
                        '<h3>새 키 생성</h3>' +
                    '</div>' +
                    '<div class="s-card-body">' +
                        '<div class="ak-input-group">' +
                            '<input type="text" id="newKeyName" class="ak-input" placeholder="키 이름 (예: 개발용, 프로덕션)" onkeyup="if(event.key===\'Enter\') createApiKey()">' +
                            '<button class="ak-btn ak-btn-primary" onclick="createApiKey()">생성하기</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                // Key List Section
                '<div class="s-card">' +
                    '<div class="s-card-header">' +
                        '<h3>내 API 키 목록</h3>' +
                        '<button class="ak-btn ak-btn-secondary ak-btn-icon" onclick="loadApiKeys()" title="새로고침">\u21BB</button>' + // ↻
                    '</div>' +
                    '<div id="apiKeyListWrapper">' +
                        '<div style="padding:var(--space-8); text-align:center;">Loading...</div>' +
                    '</div>' +
                '</div>' +

                // Quick Start
                '<div class="s-card">' +
                    '<div class="s-card-header">' +
                        '<h3>빠른 시작</h3>' +
                    '</div>' +
                    '<div class="s-card-body">' +
                        '<p style="color:var(--text-secondary); margin-bottom:var(--space-4); font-size:var(--font-size-sm);">터미널에서 다음 명령어로 API를 테스트해보세요:</p>' +
                        '<div class="ak-code-block">' +
                            '<span class="ak-code-keyword">curl</span> -X POST ' + window.location.origin + '/api/v1/chat \\<br>' +
                            '&nbsp;&nbsp;-H <span class="ak-code-string">"X-API-Key: YOUR_KEY"</span> \\<br>' +
                            '&nbsp;&nbsp;-H <span class="ak-code-string">"Content-Type: application/json"</span> \\<br>' +
                            '&nbsp;&nbsp;-d <span class="ak-code-string">\'{"message":"Hello!","model":"openmake_llm"}\'</span>' +
                        '</div>' +
                        '<div style="margin-top:var(--space-4); text-align:right;">' +
                            '<a href="/developer.html" style="color:var(--accent-primary); text-decoration:none; font-size:var(--font-size-sm); font-weight:var(--font-weight-medium);">📄 전체 API 문서 보기 &rarr;</a>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +

            // New Key Modal Overlay
            '<div id="newKeyOverlay" class="ak-new-key-overlay" style="display:none;">' +
                '<div class="ak-new-key-modal">' +
                    '<div class="ak-new-key-header">' +
                        '<h2>API 키 생성 완료</h2>' +
                    '</div>' +
                    '<div class="ak-new-key-body">' +
                        '<div class="ak-warning-text">' +
                            '<span>\u26A0\uFE0F</span>' + // ⚠️
                            '이 키는 한 번만 표시됩니다! 지금 복사해주세요.' +
                        '</div>' +
                        '<div id="fullKeyDisplay" class="ak-full-key-display"></div>' +
                        '<div style="display:flex; gap:var(--space-3);">' +
                            '<button class="ak-btn ak-btn-primary" style="flex:1" onclick="copyNewKey()">키 복사하기</button>' +
                            '<button class="ak-btn ak-btn-secondary" style="flex:1" onclick="closeNewKeyModal()">닫기</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';

    // Module Logic
    window.PageModules['api-keys'] = {
        getHTML: function() {
            return '<style data-spa-style="api-keys">' + CSS + '</style>' + HTML;
        },

        init: function() {
            // Expose global functions
            window.loadApiKeys = loadApiKeys;
            window.createApiKey = createApiKey;
            window.deleteApiKey = deleteApiKey;
            window.rotateApiKey = rotateApiKey;
            window.copyToClipboard = copyToClipboard;
            window.closeNewKeyModal = closeNewKeyModal;
            window.copyNewKey = copyNewKey;

            // Initial load
            loadApiKeys();
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];

            // Clean globals
            delete window.loadApiKeys;
            delete window.createApiKey;
            delete window.deleteApiKey;
            delete window.rotateApiKey;
            delete window.copyToClipboard;
            delete window.closeNewKeyModal;
            delete window.copyNewKey;
        }
    };

    // --- Logic Functions ---

    function formatDate(isoString) {
        if (!isoString) return '-';
        var d = new Date(isoString);
        return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }

    async function loadApiKeys() {
        var wrapper = document.getElementById('apiKeyListWrapper');
        wrapper.innerHTML = '<div style="padding:var(--space-8); text-align:center; color:var(--text-secondary);">\u23F3 키 목록을 불러오는 중...</div>';

        try {
            var res = await apiFetch('/api/v1/api-keys');
            var keys = (res.data && res.data.api_keys) || [];

            if (keys.length === 0) {
                wrapper.innerHTML = 
                    '<div class="ak-empty">' +
                        '<div class="ak-empty-icon">\uD83D\uDCC1</div>' +
                        '<h3>아직 생성된 API 키가 없습니다</h3>' +
                        '<p>새 키를 생성하여 API 연동을 시작하세요.</p>' +
                    '</div>';
                return;
            }

            var html = '';
            keys.forEach(function(key) {
                // Backend returns: is_active (bool), key_prefix, last_4, rate_limit_tier
                var isActive = key.is_active !== false;
                var isExpired = key.expires_at && new Date(key.expires_at) < new Date();
                var statusClass = isExpired ? 'ak-badge-inactive' : (isActive ? 'ak-badge-active' : 'ak-badge-inactive');
                var statusText = isExpired ? '만료됨' : (isActive ? '활성' : '비활성');
                var prefix = key.key_prefix || 'omk_live_';
                var last4 = key.last_4 || '****';
                var tier = key.rate_limit_tier || 'free';
                
                html += 
                    '<div class="ak-key-item">' +
                        '<div class="ak-key-header">' +
                            '<div>' +
                                '<div class="ak-key-name">' + esc(key.name) + '</div>' +
                                '<div class="ak-key-meta">' +
                                    '<span class="ak-badge ' + statusClass + '">' + statusText + '</span>' +
                                    '<span class="ak-badge ak-badge-inactive" style="background:rgba(102,126,234,0.1); color:var(--accent-primary); border-color:rgba(102,126,234,0.3);">' + esc(tier) + '</span>' +
                                    '<span>생성: ' + formatDate(key.created_at) + '</span>' +
                                    (key.last_used_at ? '<span>마지막 사용: ' + formatDate(key.last_used_at) + '</span>' : '') +
                                '</div>' +
                            '</div>' +
                            '<div class="ak-actions">' +
                                '<button class="ak-btn ak-btn-secondary ak-btn-sm" onclick="rotateApiKey(\'' + key.id + '\')" title="키 재발급">' +
                                    '\uD83D\uDD04 재발급' +
                                '</button>' +
                                '<button class="ak-btn ak-btn-danger ak-btn-sm" onclick="deleteApiKey(\'' + key.id + '\')" title="삭제">' +
                                    '\uD83D\uDDD1\uFE0F 삭제' +
                                '</button>' +
                            '</div>' +
                        '</div>' +
                        '<div class="ak-key-value-row">' +
                            '<span style="color:var(--text-muted); font-size:12px;">TOKEN</span>' +
                            '<span class="ak-key-value">' + esc(prefix) + '****************' + esc(last4) + '</span>' +
                            '<button class="ak-btn ak-btn-secondary ak-btn-icon" onclick="copyToClipboard(\'' + esc(prefix) + '...' + esc(last4) + '\')" title="복사" style="margin-left:auto;">\uD83D\uDCCB</button>' +
                        '</div>' +
                    '</div>';
            });
            wrapper.innerHTML = html;

        } catch (e) {
            console.warn(e);
            wrapper.innerHTML = '<div style="padding:var(--space-8); text-align:center; color:var(--danger);">\u26A0\uFE0F 키 목록을 불러오지 못했습니다.<br><small>' + esc(e.message) + '</small></div>';
        }
    }

    async function createApiKey() {
        var input = document.getElementById('newKeyName');
        var name = input.value.trim();
        if (!name) {
            if (window.showToast) window.showToast('키 이름을 입력해주세요.', 'error');
            else alert('키 이름을 입력해주세요.');
            return;
        }

        try {
            var btn = document.querySelector('button[onclick="createApiKey()"]');
            var originalText = btn ? btn.textContent : '';
            if (btn) { btn.textContent = '생성 중...'; btn.disabled = true; }

            var res = await apiFetch('/api/v1/api-keys', {
                method: 'POST',
                body: JSON.stringify({ name: name })
            });

            input.value = '';
            
            // Show new key modal
            var fullKey = res.data.key;
            showNewKeyModal(fullKey);
            
            // Reload list
            loadApiKeys();

        } catch (e) {
            if (window.showToast) window.showToast('생성 실패: ' + e.message, 'error');
            else alert('생성 실패: ' + e.message);
        } finally {
            if (btn) {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        }
    }

    async function deleteApiKey(id) {
        if (!confirm('정말로 이 API 키를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며, 이 키를 사용하는 모든 서비스가 중단됩니다.')) return;

        try {
            await apiFetch('/api/v1/api-keys/' + id, { method: 'DELETE' });
            if (window.showToast) window.showToast('API 키가 삭제되었습니다.', 'success');
            loadApiKeys();
        } catch (e) {
            if (window.showToast) window.showToast('삭제 실패: ' + e.message, 'error');
            else alert('삭제 실패: ' + e.message);
        }
    }

    async function rotateApiKey(id) {
        if (!confirm('이 키를 재발급(Rotate) 하시겠습니까?\n기존 키는 즉시 무효화되며, 새로운 키가 발급됩니다.')) return;

        try {
            var res = await apiFetch('/api/v1/api-keys/' + id + '/rotate', { method: 'POST' });
            
            // Show new key modal
            var fullKey = res.data.key;
            showNewKeyModal(fullKey);
            
            loadApiKeys();
        } catch (e) {
            if (window.showToast) window.showToast('재발급 실패: ' + e.message, 'error');
            else alert('재발급 실패: ' + e.message);
        }
    }

    function showNewKeyModal(key) {
        var overlay = document.getElementById('newKeyOverlay');
        var display = document.getElementById('fullKeyDisplay');
        if (overlay && display) {
            display.textContent = key;
            overlay.style.display = 'flex';
        }
    }

    function closeNewKeyModal() {
        var overlay = document.getElementById('newKeyOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            document.getElementById('fullKeyDisplay').textContent = '';
        }
    }

    function copyNewKey() {
        var key = document.getElementById('fullKeyDisplay').textContent;
        copyToClipboard(key);
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                if (window.showToast) window.showToast('복사되었습니다.', 'success');
                else console.log('Copied');
            }).catch(function(err) {
                console.warn('Copy failed', err);
                prompt('복사하기:', text);
            });
        } else {
            var textArea = document.createElement("textarea");
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            try {
                document.execCommand('copy');
                if (window.showToast) window.showToast('복사되었습니다.', 'success');
            } catch (err) {
                prompt('복사하기:', text);
            }
            document.body.removeChild(textArea);
        }
    }

})();
