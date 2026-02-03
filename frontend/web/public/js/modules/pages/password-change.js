/**
 * password-change - SPA Page Module
 * Auto-generated from password-change.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['password-change'] = {
        getHTML: function() {
            return '<div class="page-password-change">' +
                '<style data-spa-style="password-change">' +
                ".form-wrapper { max-width:480px; margin:0 auto; }\n        .form-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-6); }\n        .form-card h2 { margin:0 0 var(--space-5); color:var(--text-primary); text-align:center; font-size:1.3rem; }\n        .form-group { margin-bottom:var(--space-4); }\n        .form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .input-wrap { position:relative; }\n        .input-wrap input { width:100%; padding:var(--space-3); padding-right:44px; background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; box-sizing:border-box; }\n        .input-wrap input:focus { outline:none; border-color:var(--accent-primary); }\n        .toggle-pw { position:absolute; right:12px; top:50%; transform:translateY(-50%); background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px; padding:0; }\n        .strength-bar { height:4px; background:var(--bg-tertiary); border-radius:2px; margin-top:var(--space-2); overflow:hidden; }\n        .strength-fill { height:100%; border-radius:2px; transition:width .3s, background .3s; }\n        .strength-label { font-size:12px; margin-top:var(--space-1); }\n        .strength-weak { color:var(--danger); }\n        .strength-medium { color:var(--warning); }\n        .strength-strong { color:var(--success); }\n        .rules-list { margin-top:var(--space-2); list-style:none; padding:0; }\n        .rules-list li { font-size:12px; color:var(--text-muted); padding:2px 0; display:flex; align-items:center; gap:var(--space-2); }\n        .rules-list li.pass { color:var(--success); }\n        .rules-list li.fail { color:var(--text-muted); }\n        .rule-icon { width:14px; text-align:center; }\n        .btn-submit { width:100%; padding:var(--space-3); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-size:15px; font-weight:var(--font-weight-bold); margin-top:var(--space-4); transition:opacity .2s; }\n        .btn-submit:disabled { opacity:0.5; cursor:not-allowed; }\n        .btn-submit:not(:disabled):hover { opacity:0.9; }\n        .back-link { display:block; text-align:center; margin-top:var(--space-4); color:var(--text-muted); font-size:var(--font-size-sm); text-decoration:none; }\n        .back-link:hover { color:var(--accent-primary); }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>비밀번호 변경</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"form-wrapper\">\n                    <div class=\"form-card\">\n                        <h2>🔒 비밀번호 변경</h2>\n                        <form id=\"pwForm\" autocomplete=\"off\">\n                            <div class=\"form-group\">\n                                <label>현재 비밀번호</label>\n                                <div class=\"input-wrap\">\n                                    <input type=\"password\" id=\"currentPw\" required placeholder=\"현재 비밀번호 입력\">\n                                    <button type=\"button\" class=\"toggle-pw\" onclick=\"toggleVis('currentPw', this)\">👁️</button>\n                                </div>\n                            </div>\n                            <div class=\"form-group\">\n                                <label>새 비밀번호</label>\n                                <div class=\"input-wrap\">\n                                    <input type=\"password\" id=\"newPw\" required placeholder=\"새 비밀번호 입력\" oninput=\"checkStrength()\">\n                                    <button type=\"button\" class=\"toggle-pw\" onclick=\"toggleVis('newPw', this)\">👁️</button>\n                                </div>\n                                <div class=\"strength-bar\"><div class=\"strength-fill\" id=\"strengthFill\" style=\"width:0\"></div></div>\n                                <div class=\"strength-label\" id=\"strengthLabel\"></div>\n                                <ul class=\"rules-list\" id=\"rulesList\">\n                                    <li class=\"fail\" id=\"rule-len\"><span class=\"rule-icon\">✗</span> 최소 8자 이상</li>\n                                    <li class=\"fail\" id=\"rule-case\"><span class=\"rule-icon\">✗</span> 대소문자 포함</li>\n                                    <li class=\"fail\" id=\"rule-num\"><span class=\"rule-icon\">✗</span> 숫자 포함</li>\n                                    <li class=\"fail\" id=\"rule-special\"><span class=\"rule-icon\">✗</span> 특수문자 포함</li>\n                                </ul>\n                            </div>\n                            <div class=\"form-group\">\n                                <label>새 비밀번호 확인</label>\n                                <div class=\"input-wrap\">\n                                    <input type=\"password\" id=\"confirmPw\" required placeholder=\"새 비밀번호 다시 입력\" oninput=\"checkMatch()\">\n                                    <button type=\"button\" class=\"toggle-pw\" onclick=\"toggleVis('confirmPw', this)\">👁️</button>\n                                </div>\n                                <div class=\"strength-label\" id=\"matchLabel\"></div>\n                            </div>\n                            <button type=\"submit\" class=\"btn-submit\" id=\"submitBtn\" disabled>비밀번호 변경</button>\n                        </form>\n                        <a href=\"/settings.html\" class=\"back-link\">← 설정으로 돌아가기</a>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                function authFetch(url, opts = {}) {
            const token = localStorage.getItem('authToken');
            opts.headers = { ...(opts.headers || {}), 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
            return fetch(url, opts);
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = `toast ${type} show`;
            setTimeout(() => t.classList.remove('show'), 2500);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

        // 로그인 확인
        if (!localStorage.getItem('authToken')) {
            (typeof showToast === 'function' ? showToast('로그인이 필요합니다.', 'warning') : console.warn('로그인이 필요합니다.'));
            (typeof Router !== 'undefined' && Router.navigate('/'));
        }

        function toggleVis(id, btn) {
            const inp = document.getElementById(id);
            if (inp.type === 'password') { inp.type = 'text'; btn.textContent = '🙈'; }
            else { inp.type = 'password'; btn.textContent = '👁️'; }
        }

        const rules = {
            len: pw => pw.length >= 8,
            case: pw => /[a-z]/.test(pw) && /[A-Z]/.test(pw),
            num: pw => /\d/.test(pw),
            special: pw => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pw)
        };

        function checkStrength() {
            const pw = document.getElementById('newPw').value;
            let score = 0;
            for (const [key, fn] of Object.entries(rules)) {
                const pass = fn(pw);
                const el = document.getElementById('rule-' + key);
                el.className = pass ? 'pass' : 'fail';
                el.querySelector('.rule-icon').textContent = pass ? '✓' : '✗';
                if (pass) score++;
            }

            const fill = document.getElementById('strengthFill');
            const label = document.getElementById('strengthLabel');
            if (pw.length === 0) {
                fill.style.width = '0';
                label.textContent = '';
                label.className = 'strength-label';
            } else if (score <= 1) {
                fill.style.width = '25%'; fill.style.background = 'var(--danger)';
                label.textContent = '약함'; label.className = 'strength-label strength-weak';
            } else if (score <= 3) {
                fill.style.width = '60%'; fill.style.background = 'var(--warning)';
                label.textContent = '보통'; label.className = 'strength-label strength-medium';
            } else {
                fill.style.width = '100%'; fill.style.background = 'var(--success)';
                label.textContent = '강함'; label.className = 'strength-label strength-strong';
            }
            checkMatch();
        }

        function checkMatch() {
            const pw = document.getElementById('newPw').value;
            const confirm = document.getElementById('confirmPw').value;
            const label = document.getElementById('matchLabel');
            const allRulesPass = Object.values(rules).every(fn => fn(pw));
            const match = pw === confirm && confirm.length > 0;

            if (confirm.length === 0) { label.textContent = ''; }
            else if (match) { label.textContent = '✓ 일치합니다'; label.className = 'strength-label strength-strong'; }
            else { label.textContent = '✗ 일치하지 않습니다'; label.className = 'strength-label strength-weak'; }

            document.getElementById('submitBtn').disabled = !(allRulesPass && match && document.getElementById('currentPw').value.length > 0);
        }

        document.getElementById('currentPw').addEventListener('input', checkMatch);

        document.getElementById('pwForm').addEventListener('submit', async e => {
            e.preventDefault();
            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.textContent = '변경 중...';

            try {
                const res = await authFetch('/api/auth/password', {
                    method: 'PUT',
                    body: JSON.stringify({
                        currentPassword: document.getElementById('currentPw').value,
                        newPassword: document.getElementById('newPw').value
                    })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('비밀번호가 변경되었습니다!', 'success');
                    setTimeout(() => (typeof Router !== 'undefined' && Router.navigate('/settings.html')), 2000);
                } else {
                    showToast(data.error || '비밀번호 변경 실패', 'error');
                    btn.disabled = false;
                    btn.textContent = '비밀번호 변경';
                }
            } catch (err) {
                console.error('비밀번호 변경 오류:', err);
                showToast('서버 오류가 발생했습니다', 'error');
                btn.disabled = false;
                btn.textContent = '비밀번호 변경';
            }
        });

            // Expose onclick-referenced functions globally
                if (typeof toggleVis === 'function') window.toggleVis = toggleVis;
            } catch(e) {
                console.error('[PageModule:password-change] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.toggleVis; } catch(e) {}
        }
    };
})();
