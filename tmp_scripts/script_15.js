let logs = [];
        let actionTypes = [];

        function authFetch(url, options = {}) {
            const headers = { 'Content-Type':'application/json', ...(options.headers || {}) };
            return fetch(url, { ...options, credentials: 'include', headers }).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        function actionBadge(action) {
            const a = (action || '').toLowerCase();
            let cls = 'badge-default';
            if (a.includes('login') || a.includes('auth') || a.includes('logout')) cls = 'badge-auth';
            else if (a.includes('create') || a.includes('add') || a.includes('register')) cls = 'badge-create';
            else if (a.includes('delete') || a.includes('remove')) cls = 'badge-delete';
            else if (a.includes('update') || a.includes('edit') || a.includes('change')) cls = 'badge-update';
            return '<span class="badge ' + cls + '">' + esc(action) + '</span>';
        }

        async function checkAdmin() {
            try {
                const res = await authFetch('/api/auth/me');
                const user = res.data || res;
                if (!user || user.role !== 'admin') {
                    alert('관리자 권한이 필요합니다.');
                    window.location.href = '/';
                    return false;
                }
                return true;
            } catch (e) {
                window.location.href = '/login.html';
                return false;
            }
        }

        function renderApp() {
            document.getElementById('app').innerHTML = `
                <div class="filter-bar">
                    <div class="fg"><label for="filterAction">액션</label><select id="filterAction"><option value="">전체</option></select></div>
                    <div class="fg"><label for="filterUser">사용자 ID</label><input type="text" id="filterUser" placeholder="사용자 ID"></div>
                    <div class="fg"><label for="filterLimit">개수</label>
                        <select id="filterLimit"><option value="50">50개</option><option value="100" selected>100개</option><option value="200">200개</option><option value="500">500개</option></select>
                    </div>
                    <button class="btn-primary" onclick="loadLogs()">조회</button>
                </div>
                <div id="logCount" class="log-count"></div>
                <div class="table-wrapper">
                    <table class="log-table">
                        <thead><tr><th>시간</th><th>액션</th><th>사용자</th><th>세부정보</th><th>IP</th></tr></thead>
                        <tbody id="logBody"><tr><td colspan="5"><div class="loading">불러오는 중...</div></td></tr></tbody>
                    </table>
                </div>`;
        }

        async function loadActions() {
            try {
                const res = await authFetch('/api/audit/actions');
                actionTypes = res.data || res || [];
                const sel = document.getElementById('filterAction');
                if (sel) {
                    actionTypes.forEach(a => {
                        const opt = document.createElement('option');
                        opt.value = a; opt.textContent = a;
                        sel.appendChild(opt);
                    });
                }
            } catch (e) {}
        }

        async function loadLogs() {
            const action = document.getElementById('filterAction').value;
            const userId = document.getElementById('filterUser').value.trim();
            const limit = document.getElementById('filterLimit').value;
            let url = '/api/audit?limit=' + limit;
            if (action) url += '&action=' + encodeURIComponent(action);
            if (userId) url += '&userId=' + encodeURIComponent(userId);
            const body = document.getElementById('logBody');
            body.innerHTML = '<tr><td colspan="5"><div class="loading">불러오는 중...</div></td></tr>';
            try {
                const res = await authFetch(url);
                logs = res.data || res || [];
                document.getElementById('logCount').textContent = '총 ' + logs.length + '건';
                if (!logs.length) {
                    body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><h2>감사 로그가 없습니다</h2></div></td></tr>';
                    return;
                }
                body.innerHTML = logs.map((l, i) => {
                    const details = l.details || l.metadata || '';
                    const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
                    const truncated = detailStr.length > 60 ? detailStr.substring(0, 60) + '...' : detailStr;
                    return `<tr onclick="openDetail(${i})">
                        <td style="white-space:nowrap">${new Date(l.timestamp || l.created_at).toLocaleString('ko')}</td>
                        <td>${actionBadge(l.action)}</td>
                        <td>${esc(l.userId || l.user_id || '-')}</td>
                        <td class="detail-cell">${esc(truncated)}</td>
                        <td>${esc(l.ip_address || l.ip || '-')}</td>
                    </tr>`;
                }).join('');
            } catch (e) { showToast('로드 실패', 'error'); }
        }

        function openDetail(idx) {
            const l = logs[idx];
            if (!l) return;
            const details = l.details || l.metadata || {};
            const detailJson = typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details);
            document.getElementById('detailContent').innerHTML = `
                <div class="detail-row"><div class="detail-label">시간</div><div class="detail-value">${new Date(l.timestamp || l.created_at).toLocaleString('ko')}</div></div>
                <div class="detail-row"><div class="detail-label">액션</div><div class="detail-value">${actionBadge(l.action)}</div></div>
                <div class="detail-row"><div class="detail-label">사용자</div><div class="detail-value">${esc(l.userId || l.user_id || '-')}</div></div>
                <div class="detail-row"><div class="detail-label">IP</div><div class="detail-value">${esc(l.ip_address || l.ip || '-')}</div></div>
                <div class="detail-row"><div class="detail-label">세부정보</div><div class="detail-block"><pre>${esc(detailJson)}</pre></div></div>`;
            document.getElementById('detailModal').classList.add('open');
        }

        function closeDetail() { document.getElementById('detailModal').classList.remove('open'); }

        checkAdmin().then(ok => {
            if (ok) {
                renderApp();
                loadActions();
                loadLogs();
            }
        });