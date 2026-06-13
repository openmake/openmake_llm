/**
 * ============================================
 * Audit Page - 시스템 감사 로그
 * ============================================
 * 사용자 활동, API 호출, 인증 이벤트 등 시스템 감사 로그를
 * 필터링(이벤트 유형, 날짜, 사용자)하여 조회하고
 * 페이지네이션으로 탐색하는 SPA 페이지 모듈입니다.
 *
 * @module pages/audit
 */
'use strict';
    var SK = window.STORAGE_KEYS || {};
    window.PageModules = window.PageModules || {};
    let _intervals = [];
    let _timeouts = [];

    window.PageModules['audit'] = {
        getHTML: function () {
            return '<div class="page-audit">' +
                '<style data-spa-style="audit">' +
                ".filter-bar { display:flex; gap:var(--space-3); align-items:flex-end; flex-wrap:wrap; margin-bottom:var(--space-5); background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-4); }\n        .filter-bar .fg { display:flex; flex-direction:column; gap:var(--space-1); }\n        .filter-bar label { color:var(--text-muted); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .filter-bar select, .filter-bar input { padding:var(--space-2) var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; }\n        .filter-bar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); align-self:flex-end; }\n        .table-wrapper { overflow-x:auto; background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); }\n        .log-table { width:100%; border-collapse:collapse; min-width:700px; }\n        .log-table th { text-align:left; padding:var(--space-3); color:var(--text-muted); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); border-bottom:2px solid var(--border-light); position:sticky; top:0; background:var(--bg-secondary); }\n        .log-table td { padding:var(--space-3); border-bottom:1px solid var(--border-light); color:var(--text-secondary); font-size:var(--font-size-sm); vertical-align:top; }\n        .log-table tr:hover { background:var(--bg-tertiary); cursor:pointer; }\n        .badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size: var(--font-size-xs); font-weight:var(--font-weight-semibold); }\n        .badge-auth { background:var(--accent-primary); color:#fff; }\n        .badge-create { background:var(--success); color:#fff; }\n        .badge-delete { background:var(--danger); color:#fff; }\n        .badge-update { background:var(--warning); color:#000; }\n        .badge-default { background:var(--bg-tertiary); color:var(--text-secondary); }\n        .badge-severity-info { background:var(--info,#3b82f6); color:#fff; }\n        .badge-severity-warning { background:var(--warning,#f59e0b); color:#000; }\n        .badge-severity-critical { background:var(--danger,#ef4444); color:#fff; animation: badgePulse 1.5s ease-in-out infinite; }\n        @keyframes badgePulse { 0%,100% { box-shadow:0 0 0 0 rgba(239,68,68,.6); } 50% { box-shadow:0 0 0 4px rgba(239,68,68,0); } }\n        .ack-btn { padding:2px 8px; border:1px solid var(--accent-primary); background:transparent; color:var(--accent-primary); border-radius:var(--radius-md); cursor:pointer; font-size: var(--font-size-xs); font-weight:var(--font-weight-semibold); }\n        .ack-btn:hover { background:var(--accent-primary); color:#fff; }\n        .alert-row-acked { opacity:0.55; }\n        .alert-row-acked td { color:var(--text-muted); }\n        .ack-info { font-size: var(--font-size-xs); color:var(--text-muted); white-space:nowrap; }\n        .stats-row { display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:var(--space-3); margin-bottom:var(--space-4); }\n        .stat-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-4); display:flex; flex-direction:column; gap:var(--space-2); }\n        .stat-card-label { font-size:var(--font-size-sm); color:var(--text-muted); font-weight:var(--font-weight-semibold); }\n        .stat-card-value { font-size:28px; font-weight:var(--font-weight-bold); color:var(--text-primary); line-height:1; }\n        .stat-card-value.danger { color:var(--danger,#ef4444); }\n        .stat-card-value.warning { color:var(--warning,#f59e0b); }\n        .stat-card-value.muted { color:var(--text-muted); }\n        .stat-card-sub { font-size: var(--font-size-xs); color:var(--text-muted); }\n        .stat-bars { display:flex; align-items:flex-end; gap:2px; height:32px; margin-top:4px; }\n        .stat-bars .bar { flex:1; background:var(--accent-primary); border-radius:2px 2px 0 0; min-height:2px; transition:opacity 0.2s; }\n        .stat-bars .bar:hover { opacity:0.7; }\n        .stat-bars .bar.critical { background:var(--danger,#ef4444); }\n        .stat-distribution { display:flex; gap:4px; height:8px; border-radius:4px; overflow:hidden; background:var(--bg-tertiary); }\n        .stat-distribution > div { transition:flex 0.3s; }\n        .detail-cell { max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted); }\n        .log-count { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-3); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { display:block; position:static; height:auto; background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:650px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n        .detail-block { background:var(--bg-secondary); padding:var(--space-4); border-radius:var(--radius-md); overflow-x:auto; }\n        .detail-block pre { margin:0; color:var(--text-primary); font-size:var(--font-size-sm); white-space:pre-wrap; word-break:break-all; font-family: var(--font-mono); }\n        .detail-row { margin-bottom:var(--space-3); }\n        .detail-label { color:var(--text-muted); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); margin-bottom:var(--space-1); }\n        .detail-value { color:var(--text-primary); }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>감사 로그</h1>\n            </header>\n            <div class=\"content-area\" id=\"app\">\n                <div class=\"loading\">권한 확인 중...</div>\n            </div>\n<div class=\"modal-overlay\" id=\"detailModal\">\n        <div class=\"modal\">\n            <h2>로그 상세</h2>\n            <div id=\"detailContent\"></div>\n            <div class=\"modal-actions\"><button class=\"btn-secondary\" onclick=\"closeDetail()\">닫기</button></div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
                '<\/div>';
        },

        init: function () {
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

                function checkAdmin() {
                    try {
                        // SafeStorage 래퍼 — safe-storage.js에서 전역 등록됨
                        var SS = window.SafeStorage;
                        var savedUser = SS.getItem(SK.USER || 'user');
                        if (!savedUser) return false;
                        var user = JSON.parse(savedUser);
                        if (!user || (user.role !== 'admin' && user.role !== 'administrator')) {
                            return false;
                        }
                        return true;
                    } catch (e) {
                        return false;
                    }
                }

                function renderApp() {
                    document.getElementById('app').innerHTML = `
                <!-- Sub-tab nav: audit_logs / alert_history -->
                <div class="filter-bar" style="margin-bottom: 0; border-bottom: 0; border-bottom-left-radius: 0; border-bottom-right-radius: 0; padding-bottom: 8px;">
                    <button class="btn-primary subtab-btn" data-subtab="logs" onclick="switchAuditSubTab('logs')"><iconify-icon icon=lucide:clipboard-list></iconify-icon> 감사 로그</button>
                    <button class="btn-secondary subtab-btn" data-subtab="alerts" onclick="switchAuditSubTab('alerts')" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-light);"><iconify-icon icon=lucide:bell></iconify-icon> 알림 이력</button>
                    <button class="btn-secondary subtab-btn" data-subtab="pool" onclick="switchAuditSubTab('pool')" style="background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-light);"><iconify-icon icon=lucide:cpu></iconify-icon> LLM Pool</button>
                </div>

                <!-- audit_logs panel -->
                <div id="auditLogsPanel">
                    <div class="filter-bar">
                        <div class="fg"><label for="filterAction">액션</label><select id="filterAction"><option value="">전체</option></select></div>
                        <div class="fg"><label for="filterUser">사용자 ID</label><input type="text" id="filterUser" placeholder="사용자 ID"></div>
                        <div class="fg"><label for="filterLimit">페이지 크기</label>
                            <select id="filterLimit"><option value="50" selected>50개</option><option value="100">100개</option><option value="200">200개</option></select>
                        </div>
                        <button class="btn-primary" onclick="loadLogs(1)">조회</button>
                        <button class="btn-secondary" onclick="exportLogsCsv()" title="현재 필터 조건으로 최대 10000건 CSV 다운로드"><iconify-icon icon=lucide:download></iconify-icon> CSV</button>
                    </div>
                    <div id="logCount" class="log-count"></div>
                    <div class="table-wrapper">
                        <table class="log-table">
                            <thead><tr><th>시간</th><th>액션</th><th>사용자</th><th>세부정보</th><th>IP</th></tr></thead>
                            <tbody id="logBody"><tr><td colspan="5"><div class="loading">불러오는 중...</div></td></tr></tbody>
                        </table>
                    </div>
                    <div id="logPagination" style="margin-top: 16px; display: flex; justify-content: center; gap: 8px;"></div>
                </div>

                <!-- alert_history panel -->
                <div id="alertHistoryPanel" style="display: none;">
                    <div id="alertStatsRow" class="stats-row" style="display:none;"></div>
                    <div class="filter-bar">
                        <div class="fg"><label for="filterAlertType">type</label><input type="text" id="filterAlertType" placeholder="예: user_deleted"></div>
                        <div class="fg"><label for="filterAlertSeverity">심각도</label>
                            <select id="filterAlertSeverity">
                                <option value="">전체</option><option value="info">info</option><option value="warning">warning</option><option value="critical">critical</option>
                            </select>
                        </div>
                        <div class="fg"><label for="filterAlertLimit">페이지 크기</label>
                            <select id="filterAlertLimit"><option value="50" selected>50개</option><option value="100">100개</option><option value="200">200개</option></select>
                        </div>
                        <div class="fg"><label for="filterAlertAck">확인 상태</label>
                            <select id="filterAlertAck"><option value="">전체</option><option value="false">미확인만</option><option value="true">확인됨만</option></select>
                        </div>
                        <button class="btn-primary" onclick="loadAlertHistory(1)">조회</button>
                        <button class="btn-secondary" onclick="exportAlertsCsv()" title="현재 필터 조건으로 최대 10000건 CSV 다운로드"><iconify-icon icon=lucide:download></iconify-icon> CSV</button>
                    </div>
                    <div id="alertCount" class="log-count"></div>
                    <div class="table-wrapper">
                        <table class="log-table">
                            <thead><tr><th>시간</th><th>심각도</th><th>type</th><th>제목</th><th>메시지</th><th>확인</th></tr></thead>
                            <tbody id="alertBody"></tbody>
                        </table>
                    </div>
                    <div id="alertPagination" style="margin-top: 16px; display: flex; justify-content: center; gap: 8px;"></div>
                </div>

                <!-- LLM Pool panel (PR #98 follow-up) -->
                <div id="llmPoolPanel" style="display: none;">
                    <div id="llmPoolStatsRow" class="stats-row" style="display:none;"></div>
                    <div class="log-count">지난 7일 LLM Model Pool routing 통계. 1M 비율 30% 초과 시 LLM_POOL_DEFAULT_MARGIN_PCT 조정 검토.</div>
                </div>`;
                }

                function switchAuditSubTab(tab) {
                    document.querySelectorAll('.subtab-btn').forEach(b => {
                        if (b.dataset.subtab === tab) {
                            b.className = 'btn-primary subtab-btn';
                            b.style.cssText = '';
                        } else {
                            b.className = 'btn-secondary subtab-btn';
                            b.style.cssText = 'background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-light);';
                        }
                    });
                    document.getElementById('auditLogsPanel').style.display = tab === 'logs' ? '' : 'none';
                    document.getElementById('alertHistoryPanel').style.display = tab === 'alerts' ? '' : 'none';
                    const poolPanel = document.getElementById('llmPoolPanel');
                    if (poolPanel) poolPanel.style.display = tab === 'pool' ? '' : 'none';
                    if (tab === 'pool') {
                        loadLlmPoolStats();
                    } else if (tab === 'alerts' && !window.__alertHistoryLoaded) {
                        loadAlertHistory(1);
                        loadAlertStats();
                        window.__alertHistoryLoaded = true;
                    } else if (tab === 'alerts') {
                        // 재진입 시 stats 만 새로고침 (저렴, 사용자 인지 시점 반영)
                        loadAlertStats();
                    }
                }

                // 페이지네이션 inline helper (admin.js renderPagination 패턴 차용)
                function renderPaginationInto(containerId, total, currentPage, pageSize, onPageChange) {
                    const el = document.getElementById(containerId);
                    if (!el) return;
                    const totalPages = Math.max(1, Math.ceil(total / pageSize));
                    if (totalPages <= 1) { el.innerHTML = ''; return; }
                    let html = '';
                    const prev = Math.max(1, currentPage - 1);
                    const next = Math.min(totalPages, currentPage + 1);
                    html += `<button class="btn-secondary" data-page="${prev}" ${currentPage === 1 ? 'disabled' : ''} style="padding: 4px 10px;">‹ 이전</button>`;
                    html += `<span style="padding: 4px 12px; color: var(--text-muted);">${currentPage} / ${totalPages}</span>`;
                    html += `<button class="btn-secondary" data-page="${next}" ${currentPage === totalPages ? 'disabled' : ''} style="padding: 4px 10px;">다음 ›</button>`;
                    el.innerHTML = html;
                    el.querySelectorAll('button[data-page]').forEach(btn => {
                        btn.addEventListener('click', () => onPageChange(parseInt(btn.dataset.page, 10)));
                    });
                }

                async function loadActions() {
                    try {
                        const res = await authFetch(API_ENDPOINTS.AUDIT_ACTIONS);
                        var rawActions = res.data || res;
                        actionTypes = Array.isArray(rawActions) ? rawActions : [];
                        const sel = document.getElementById('filterAction');
                        if (sel) {
                            actionTypes.forEach(a => {
                                const opt = document.createElement('option');
                                opt.value = a; opt.textContent = a;
                                sel.appendChild(opt);
                            });
                        }
                    } catch (e) { console.error('[Audit] 액션 목록 로드 실패:', e); }
                }

                async function loadLogs(page = 1) {
                    const action = document.getElementById('filterAction').value;
                    const userId = document.getElementById('filterUser').value.trim();
                    const limit = parseInt(document.getElementById('filterLimit').value, 10);
                    const offset = (page - 1) * limit;
                    let url = API_ENDPOINTS.AUDIT + '?limit=' + limit + '&offset=' + offset;
                    if (action) url += '&action=' + encodeURIComponent(action);
                    if (userId) url += '&userId=' + encodeURIComponent(userId);
                    const body = document.getElementById('logBody');
                    body.innerHTML = '<tr><td colspan="5"><div class="loading">불러오는 중...</div></td></tr>';
                    try {
                        const res = await authFetch(url);
                        // 응답 schema: { logs, total } 또는 raw array (legacy)
                        var payload = res.data || res;
                        logs = Array.isArray(payload) ? payload : (payload.logs || []);
                        var total = payload.total !== undefined ? payload.total : logs.length;
                        document.getElementById('logCount').textContent = '총 ' + total + '건 (현재 ' + logs.length + '건 표시)';
                        renderPaginationInto('logPagination', total, page, limit, (p) => loadLogs(p));
                        if (!logs.length) {
                            body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><h2>감사 로그가 없습니다</h2></div></td></tr>';
                            return;
                        }
                        body.innerHTML = logs.map((l, i) => {
                            const details = l.details || l.metadata || '';
                            const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
                            const truncated = detailStr.length > 60 ? detailStr.substring(0, 60) + '...' : detailStr;
                            return `<tr class="log-row" data-idx="${i}">
                        <td style="white-space:nowrap">${new Date(l.timestamp || l.created_at).toLocaleString('ko')}</td>
                        <td>${actionBadge(l.action)}</td>
                        <td>${esc(l.userId || l.user_id || '-')}</td>
                        <td class="detail-cell">${esc(truncated)}</td>
                        <td>${esc(l.ip_address || l.ip || '-')}</td>
                    </tr>`;
                        }).join('');
                        if (!body.dataset.delegated) {
                            body.addEventListener('click', (e) => {
                                const tr = e.target.closest('tr[data-idx]');
                                if (tr) openDetail(parseInt(tr.dataset.idx, 10));
                            });
                            body.dataset.delegated = '1';
                        }
                    } catch (e) {
                        var countEl = document.getElementById('logCount');
                        if (countEl) countEl.textContent = '';
                        body.innerHTML = '<tr><td colspan="5"><div class="empty-state"><h2>로그를 불러올 수 없습니다</h2></div></td></tr>';
                        showToast('로드 실패', 'error');
                    }
                }

                async function exportLogsCsv() {
                    const action = document.getElementById('filterAction').value;
                    const userId = document.getElementById('filterUser').value.trim();
                    let url = API_ENDPOINTS.AUDIT + '/export';
                    const params = [];
                    if (action) params.push('action=' + encodeURIComponent(action));
                    if (userId) params.push('userId=' + encodeURIComponent(userId));
                    if (params.length) url += '?' + params.join('&');
                    try {
                        // window.authFetch 직접 사용 — 본 module 의 authFetch wrapper 는 항상 JSON.parse 라 binary 부적합
                        const res = await window.authFetch(url);
                        if (!res.ok) { showToast('CSV export 실패: HTTP ' + res.status, 'error'); return; }
                        const blob = await res.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = 'audit_logs_' + new Date().toISOString().slice(0, 10) + '.csv';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(blobUrl);
                        showToast('CSV 다운로드 완료', 'success');
                    } catch (e) {
                        console.error('[Audit] CSV export 실패:', e);
                        showToast('CSV export 실패', 'error');
                    }
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

                // alert_history (PR #83/#84 의 critical event webhook 알림)
                async function loadAlertHistory(page = 1) {
                    const type = document.getElementById('filterAlertType').value.trim();
                    const severity = document.getElementById('filterAlertSeverity').value;
                    const ack = document.getElementById('filterAlertAck').value;
                    const limit = parseInt(document.getElementById('filterAlertLimit').value, 10);
                    const offset = (page - 1) * limit;
                    let url = '/api/admin/alerts/history?limit=' + limit + '&offset=' + offset;
                    if (type) url += '&type=' + encodeURIComponent(type);
                    if (severity) url += '&severity=' + encodeURIComponent(severity);
                    if (ack === 'true' || ack === 'false') url += '&acknowledged=' + ack;
                    const body = document.getElementById('alertBody');
                    body.innerHTML = '<tr><td colspan="6"><div class="loading">불러오는 중...</div></td></tr>';
                    try {
                        const res = await authFetch(url);
                        const payload = res.data || {};
                        const history = payload.history || [];
                        const total = payload.total ?? history.length;
                        document.getElementById('alertCount').textContent = '총 ' + total + '건 (현재 ' + history.length + '건 표시)';
                        renderPaginationInto('alertPagination', total, page, limit, (p) => loadAlertHistory(p));
                        if (!history.length) {
                            body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><h2>알림 이력이 없습니다</h2></div></td></tr>';
                            return;
                        }
                        const severityColor = { info: 'badge-severity-info', warning: 'badge-severity-warning', critical: 'badge-severity-critical' };
                        body.innerHTML = history.map(a => {
                            const ackCell = a.acknowledged
                                ? `<div class="ack-info">✓ by ${esc(a.acknowledged_by || '-')}<br>${a.acknowledged_at ? new Date(a.acknowledged_at).toLocaleString('ko') : ''}</div>`
                                : `<button class="ack-btn" onclick="acknowledgeAlert(${a.id}, this)">✓ 확인</button>`;
                            const rowClass = a.acknowledged ? 'alert-row-acked' : '';
                            return `
                            <tr class="${rowClass}">
                                <td style="white-space:nowrap">${new Date(a.created_at).toLocaleString('ko')}</td>
                                <td><span class="badge ${severityColor[a.severity] || 'badge-default'}">${esc(a.severity)}</span></td>
                                <td>${esc(a.type)}</td>
                                <td>${esc(a.title)}</td>
                                <td class="detail-cell">${esc(a.message)}</td>
                                <td>${ackCell}</td>
                            </tr>`;
                        }).join('');
                    } catch (e) {
                        body.innerHTML = '<tr><td colspan="6"><div class="empty-state"><h2>알림 이력 로드 실패</h2></div></td></tr>';
                        showToast('로드 실패', 'error');
                    }
                }

                async function loadLlmPoolStats() {
                    const row = document.getElementById('llmPoolStatsRow');
                    if (!row) return;
                    try {
                        const res = await authFetch('/api/admin/llm-pool/stats');
                        const s = res.data || res;
                        const trend = s.last7Days || [];
                        const bySource = s.bySource || {};
                        const trendMax = Math.max(1, ...trend.map(d => d.total || 0));
                        const trendBars = trend.map(d => {
                            const h = Math.max(2, Math.round(((d.total || 0) / trendMax) * 32));
                            const cls = (d.large || 0) > (d.default || 0) ? 'bar critical' : 'bar';
                            return `<div class="${cls}" style="height:${h}px" title="${d.date}: total ${d.total} (1m ${d.large}, default ${d.default})"></div>`;
                        }).join('');
                        const ratio = s.largeModelRatioPct || 0;
                        const ratioCls = ratio > 30 ? 'danger' : (ratio > 15 ? 'warning' : 'muted');
                        const total = s.totalCount || 0;
                        const trimmedCount = (bySource.auto_trimmed || 0) + (bySource.auto_trimmed_reduced || 0);
                        row.innerHTML = `
                            <div class="stat-card">
                                <div class="stat-card-label">7일 1M routing 비율</div>
                                <div class="stat-card-value ${ratioCls}">${ratio}%</div>
                                <div class="stat-card-sub">${total} 호출 중 ${total > 0 ? Math.round(ratio * total / 100) : 0}건</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-card-label">7일 truncate 발동</div>
                                <div class="stat-card-value ${trimmedCount > 0 ? 'warning' : 'muted'}">${trimmedCount}</div>
                                <div class="stat-card-sub">input truncate + max_tokens 축소 합계</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-card-label">7일 trend (1m=red)</div>
                                <div class="stat-card-value muted" style="font-size:18px">총 ${total}건</div>
                                <div class="stat-bars">${trendBars}</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-card-label">source 분포</div>
                                <div class="stat-card-sub">auto ${bySource.auto || 0} / trimmed ${bySource.auto_trimmed || 0} / reduced ${bySource.auto_trimmed_reduced || 0} / manual ${bySource.manual || 0}</div>
                            </div>
                            ${(() => {
                                // Phase L (2026-05-26): LLM 자체 관측 — quota + 7일 입력 토큰
                                const q = s.quota || {};
                                const h = q.hourly || { used: 0, limit: 0 };
                                const w = q.weekly || { used: 0, limit: 0 };
                                const hPct = h.limit > 0 ? Math.round((h.used / h.limit) * 100) : 0;
                                const wPct = w.limit > 0 ? Math.round((w.used / w.limit) * 100) : 0;
                                const hCls = hPct >= 80 ? 'danger' : (hPct >= 50 ? 'warning' : 'muted');
                                const wCls = wPct >= 80 ? 'danger' : (wPct >= 50 ? 'warning' : 'muted');
                                const last7Tokens = (s.last7DaysInputTokens || 0).toLocaleString();
                                return `<div class="stat-card">
                                    <div class="stat-card-label">시간당 토큰 (in-mem)</div>
                                    <div class="stat-card-value ${hCls}">${hPct}%</div>
                                    <div class="stat-card-sub">${(h.used || 0).toLocaleString()} / ${(h.limit || 0).toLocaleString()}</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-card-label">주간 토큰 (in-mem)</div>
                                    <div class="stat-card-value ${wCls}">${wPct}%</div>
                                    <div class="stat-card-sub">${(w.used || 0).toLocaleString()} / ${(w.limit || 0).toLocaleString()}</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-card-label">7일 prompt 토큰 (DB)</div>
                                    <div class="stat-card-value muted">${last7Tokens}</div>
                                    <div class="stat-card-sub">model_pool_metrics 추정</div>
                                </div>`;
                            })()}
                        `;
                        row.style.display = 'grid';
                    } catch (e) {
                        console.error('[Audit] llm-pool stats 로드 실패:', e);
                        row.style.display = 'none';
                    }
                }

                async function loadAlertStats() {
                    const row = document.getElementById('alertStatsRow');
                    if (!row) return;
                    try {
                        const res = await authFetch('/api/admin/alerts/stats');
                        const s = res.data || res;
                        const trend = s.last7Days || [];
                        const sev = s.severityTotals || { info: 0, warning: 0, critical: 0 };
                        const totals7d = (sev.info || 0) + (sev.warning || 0) + (sev.critical || 0);
                        // 7일 trend max — bar height 정규화
                        const trendMax = Math.max(1, ...trend.map(d => d.total || 0));
                        const trendBars = trend.map(d => {
                            const h = Math.max(2, Math.round(((d.total || 0) / trendMax) * 32));
                            const cls = (d.critical || 0) > 0 ? 'bar critical' : 'bar';
                            return `<div class="${cls}" style="height:${h}px" title="${d.date}: total ${d.total} (critical ${d.critical}, warning ${d.warning}, info ${d.info})"></div>`;
                        }).join('');
                        // severity 분포 막대 (총합 0 이면 회색 빈 막대)
                        const distSum = totals7d || 1;
                        const distBars = `
                            <div style="background:var(--info,#3b82f6); flex:${sev.info};" title="info ${sev.info}"></div>
                            <div style="background:var(--warning,#f59e0b); flex:${sev.warning};" title="warning ${sev.warning}"></div>
                            <div style="background:var(--danger,#ef4444); flex:${sev.critical};" title="critical ${sev.critical}"></div>
                        `;
                        const critToday = s.todayCriticalCount || 0;
                        const pending = s.pendingAckCount || 0;
                        row.innerHTML = `
                            <div class="stat-card">
                                <div class="stat-card-label">오늘 critical</div>
                                <div class="stat-card-value ${critToday > 0 ? 'danger' : 'muted'}">${critToday}</div>
                                <div class="stat-card-sub">오늘 0시 이후</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-card-label">미확인 알림</div>
                                <div class="stat-card-value ${pending > 0 ? 'warning' : 'muted'}">${pending}</div>
                                <div class="stat-card-sub">전체 severity, ack 대기</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-card-label">지난 7일 추이</div>
                                <div class="stat-card-value muted" style="font-size:18px">총 ${totals7d}건</div>
                                <div class="stat-bars">${trendBars}</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-card-label">severity 분포 (7일)</div>
                                <div class="stat-card-sub">info ${sev.info} / warning ${sev.warning} / critical ${sev.critical}</div>
                                <div class="stat-distribution" style="display:${distSum > 0 ? 'flex' : 'none'}">${distBars}</div>
                                ${distSum === 0 ? '<div class="stat-card-sub" style="margin-top:8px">데이터 없음</div>' : ''}
                            </div>
                        `;
                        row.style.display = 'grid';
                    } catch (e) {
                        console.error('[Audit] stats 로드 실패:', e);
                        // 통계 실패해도 alert_history 자체는 정상 동작 — row 숨김
                        row.style.display = 'none';
                    }
                }

                async function exportAlertsCsv() {
                    const type = document.getElementById('filterAlertType').value.trim();
                    const severity = document.getElementById('filterAlertSeverity').value;
                    const ack = document.getElementById('filterAlertAck').value;
                    let url = '/api/admin/alerts/export';
                    const params = [];
                    if (type) params.push('type=' + encodeURIComponent(type));
                    if (severity) params.push('severity=' + encodeURIComponent(severity));
                    if (ack === 'true' || ack === 'false') params.push('acknowledged=' + ack);
                    if (params.length) url += '?' + params.join('&');
                    try {
                        const res = await window.authFetch(url);
                        if (!res.ok) { showToast('CSV export 실패: HTTP ' + res.status, 'error'); return; }
                        const blob = await res.blob();
                        const blobUrl = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = blobUrl;
                        a.download = 'alert_history_' + new Date().toISOString().slice(0, 10) + '.csv';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(blobUrl);
                        showToast('CSV 다운로드 완료', 'success');
                    } catch (e) {
                        console.error('[Audit] alert CSV export 실패:', e);
                        showToast('CSV export 실패', 'error');
                    }
                }

                async function acknowledgeAlert(id, btn) {
                    if (btn) { btn.disabled = true; btn.textContent = '...'; }
                    try {
                        const res = await authFetch('/api/admin/alerts/' + id + '/acknowledge', { method: 'POST' });
                        if (res && (res.success !== false)) {
                            showToast('확인 처리됨', 'success');
                            // 현재 page 재로딩 — pagination 위치 유지를 위해 1 페이지로 단순 처리
                            loadAlertHistory(1);
                            loadAlertStats();
                        } else {
                            showToast('확인 실패', 'error');
                            if (btn) { btn.disabled = false; btn.textContent = '✓ 확인'; }
                        }
                    } catch (e) {
                        console.error('[Audit] ack 실패:', e);
                        showToast('확인 실패', 'error');
                        if (btn) { btn.disabled = false; btn.textContent = '✓ 확인'; }
                    }
                }

                if (checkAdmin()) {
                    renderApp();
                    loadActions();
                    loadLogs(1);
                } else {
                    showToast('관리자 권한이 필요합니다.', 'warning');
                    if (typeof Router !== 'undefined') Router.navigate('/');
                }

                // Expose onclick-referenced functions globally
                if (typeof closeDetail === 'function') window.closeDetail = closeDetail;
                if (typeof loadLogs === 'function') window.loadLogs = loadLogs;
                if (typeof openDetail === 'function') window.openDetail = openDetail;
                if (typeof switchAuditSubTab === 'function') window.switchAuditSubTab = switchAuditSubTab;
                if (typeof loadAlertHistory === 'function') window.loadAlertHistory = loadAlertHistory;
                if (typeof exportLogsCsv === 'function') window.exportLogsCsv = exportLogsCsv;
                if (typeof acknowledgeAlert === 'function') window.acknowledgeAlert = acknowledgeAlert;
                if (typeof exportAlertsCsv === 'function') window.exportAlertsCsv = exportAlertsCsv;
                if (typeof loadAlertStats === 'function') window.loadAlertStats = loadAlertStats;
                if (typeof loadLlmPoolStats === 'function') window.loadLlmPoolStats = loadLlmPoolStats;
            } catch (e) {
                console.error('[PageModule:audit] init error:', e);
            }
        },

        cleanup: function () {
            _intervals.forEach(function (id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function (id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
            try { delete window.closeDetail; } catch (e) { }
            try { delete window.loadLogs; } catch (e) { }
            try { delete window.openDetail; } catch (e) { }
            try { delete window.switchAuditSubTab; } catch (e) { }
            try { delete window.loadAlertHistory; } catch (e) { }
            try { delete window.exportLogsCsv; } catch (e) { }
            try { delete window.acknowledgeAlert; } catch (e) { }
            try { delete window.exportAlertsCsv; } catch (e) { }
            try { delete window.loadAlertStats; } catch (e) { }
            try { delete window.loadLlmPoolStats; } catch (e) { }
            try { delete window.__alertHistoryLoaded; } catch (e) { }
        }
    };

const { getHTML, init, cleanup } = window.PageModules['audit'];
export default { getHTML, init, cleanup };
