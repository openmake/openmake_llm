function authFetch(url, opts = {}) {
            const headers = { 'Content-Type':'application/json', ...opts.headers };
            return fetch(url, { ...opts, headers, credentials: 'include' }).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
        function fmtDate(s) { return s ? new Date(s).toLocaleDateString('ko-KR') : '-'; }

        let keys = [];

        async function loadKeys() {
            try {
                const res = await authFetch('/api/api-keys');
                keys = res.data || [];
                renderKeys();
            } catch(e) {
                document.getElementById('keyList').innerHTML = '<div class="empty-state"><h2>로드 실패</h2></div>';
            }
        }

        function renderKeys() {
            const el = document.getElementById('keyList');
            if (!keys.length) {
                el.innerHTML = '<div class="empty-state"><h2>API 키가 없습니다</h2><p>새 API 키를 생성하여 외부 서비스에서 OpenMake.AI를 사용하세요.</p></div>';
                return;
            }
            el.innerHTML = keys.map(k => `
                <div class="key-card">
                    <div class="key-header">
                        <span class="key-name">${esc(k.name)}</span>
                        <span class="key-prefix">${esc(k.key_prefix || 'omk_live_')}****${esc(k.last_4 || '')}</span>
                    </div>
                    <div class="key-meta">
                        <span class="${k.is_active ? 'badge-active' : 'badge-inactive'}">${k.is_active ? '활성' : '비활성'}</span>
                        <span class="badge-tier">${esc(k.rate_limit_tier || 'free')}</span>
                        <span>요청: ${(k.total_requests || 0).toLocaleString()}</span>
                        <span>토큰: ${(k.total_tokens || 0).toLocaleString()}</span>
                        <span>생성: ${fmtDate(k.created_at)}</span>
                        <span>마지막 사용: ${fmtDate(k.last_used_at)}</span>
                    </div>
                    <div class="key-actions">
                        <button onclick="rotateKey('${k.id}')">🔄 회전</button>
                        <button class="btn-danger" onclick="deleteKey('${k.id}', '${esc(k.name)}')">🗑️ 삭제</button>
                    </div>
                </div>
            `).join('');
        }

        function openCreateKey() {
            document.getElementById('keyName').value = '';
            document.getElementById('keyDesc').value = '';
            document.getElementById('keyTier').value = 'free';
            document.getElementById('newKeyDisplay').style.display = 'none';
            document.getElementById('btnCreate').style.display = '';
            document.getElementById('createModal').classList.add('open');
        }
        function closeCreateKey() { document.getElementById('createModal').classList.remove('open'); }

        async function createKey() {
            const name = document.getElementById('keyName').value.trim();
            if (!name) { showToast('키 이름을 입력하세요', 'error'); return; }
            try {
                const res = await authFetch('/api/api-keys', {
                    method: 'POST',
                    body: JSON.stringify({
                        name,
                        description: document.getElementById('keyDesc').value.trim(),
                        rateLimitTier: document.getElementById('keyTier').value
                    })
                });
                if (res.data && res.data.rawKey) {
                    document.getElementById('newKeyValue').textContent = res.data.rawKey;
                    document.getElementById('newKeyDisplay').style.display = '';
                    document.getElementById('btnCreate').style.display = 'none';
                    showToast('API 키가 생성되었습니다.');
                    loadKeys();
                } else {
                    showToast('키 생성됨 (표시 불가)');
                    closeCreateKey();
                    loadKeys();
                }
            } catch(e) { showToast('생성 실패', 'error'); }
        }

        async function rotateKey(id) {
            if (!confirm('이 키를 회전하시겠습니까? 기존 키는 즉시 무효화됩니다.')) return;
            try {
                await authFetch('/api/api-keys/' + id + '/rotate', { method: 'POST' });
                showToast('키가 회전되었습니다.');
                loadKeys();
            } catch(e) { showToast('회전 실패', 'error'); }
        }

        async function deleteKey(id, name) {
            if (!confirm('"' + name + '" 키를 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/api-keys/' + id, { method: 'DELETE' });
                showToast('키가 삭제되었습니다.');
                loadKeys();
            } catch(e) { showToast('삭제 실패', 'error'); }
        }

        loadKeys();