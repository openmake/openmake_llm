function authFetch(url, opts = {}) {
            opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' };
            return fetch(url, { ...opts, credentials: 'include' });
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = `toast ${type} show`;
            setTimeout(() => t.classList.remove('show'), 2500);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

        // 로그인 확인
        if (!localStorage.getItem('user')) {
            alert('로그인이 필요합니다.');
            window.location.href = '/login.html';
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
                    setTimeout(() => window.location.href = '/settings.html', 2000);
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