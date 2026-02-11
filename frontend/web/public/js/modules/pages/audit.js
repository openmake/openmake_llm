/**
 * audit - SPA Page Module
 * Auto-generated from audit.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['audit'] = {
        getHTML: function() {
            return '<div class="page-audit">' +
                '<style data-spa-style="audit">' +
                ".filter-bar { display:flex; gap:var(--space-3); align-items:flex-end; flex-wrap:wrap; margin-bottom:var(--space-5); background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-4); }\n        .filter-bar .fg { display:flex; flex-direction:column; gap:var(--space-1); }\n        .filter-bar label { color:var(--text-muted); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .filter-bar select, .filter-bar input { padding:var(--space-2) var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; }\n        .filter-bar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); align-self:flex-end; }\n        .table-wrapper { overflow-x:auto; background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); }\n        .log-table { width:100%; border-collapse:collapse; min-width:700px; }\n        .log-table th { text-align:left; padding:var(--space-3); color:var(--text-muted); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); border-bottom:2px solid var(--border-light); position:sticky; top:0; background:var(--bg-secondary); }\n        .log-table td { padding:var(--space-3); border-bottom:1px solid var(--border-light); color:var(--text-secondary); font-size:var(--font-size-sm); vertical-align:top; }\n        .log-table tr:hover { background:var(--bg-tertiary); cursor:pointer; }\n        .badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .badge-auth { background:var(--accent-primary); color:#fff; }\n        .badge-create { background:var(--success); color:#fff; }\n        .badge-delete { background:var(--danger); color:#fff; }\n        .badge-update { background:var(--warning); color:#000; }\n        .badge-default { background:var(--bg-tertiary); color:var(--text-secondary); }\n        .detail-cell { max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted); }\n        .log-count { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-3); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:650px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n        .detail-block { background:var(--bg-secondary); padding:var(--space-4); border-radius:var(--radius-md); overflow-x:auto; }\n        .detail-block pre { margin:0; color:var(--text-primary); font-size:var(--font-size-sm); white-space:pre-wrap; word-break:break-all; font-family:'Courier New',monospace; }\n        .detail-row { margin-bottom:var(--space-3); }\n        .detail-label { color:var(--text-muted); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); margin-bottom:var(--space-1); }\n        .detail-value { color:var(--text-primary); }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>감사 로그</h1>\n            </header>\n            <div class=\"content-area\" id=\"app\">\n                <div class=\"loading\">권한 확인 중...</div>\n            </div>\n<div class=\"modal-overlay\" id=\"detailModal\">\n        <div class=\"modal\">\n            <h2>로그 상세</h2>\n            <div id=\"detailContent\"></div>\n            <div class=\"modal-actions\"><button class=\"btn-secondary\" onclick=\"closeDetail()\">닫기</button></div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                let logs = [];
        let actionTypes = [];

        function authFetch(url, options = {}) {
            return window.authFetch(url, options).then(r => r.json());
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
                    (typeof showToast === 'function' ? showToast('관리자 권한이 필요합니다.', 'warning') : console.warn('관리자 권한이 필요합니다.'));
                    (typeof Router !== 'undefined' && Router.navigate('/'));
                    return false;
                }
                return true;
            } catch (e) {
                (typeof Router !== 'undefined' && Router.navigate('/'));
                return false;
            }
        }

        function renderApp() {
            document.getElementById('app').innerHTML = `
                <div class="filter-bar">
                    <div class="fg"><label>액션</label><select id="filterAction"><option value="">전체</option></select></div>
                    <div class="fg"><label>사용자 ID</label><input type="text" id="filterUser" placeholder="사용자 ID"></div>
                    <div class="fg"><label>개수</label>
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

            // Expose onclick-referenced functions globally
                if (typeof closeDetail === 'function') window.closeDetail = closeDetail;
                if (typeof loadLogs === 'function') window.loadLogs = loadLogs;
                if (typeof openDetail === 'function') window.openDetail = openDetail;
            } catch(e) {
                console.error('[PageModule:audit] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.closeDetail; } catch(e) {}
                try { delete window.loadLogs; } catch(e) {}
                try { delete window.openDetail; } catch(e) {}
        }
    };
})();
