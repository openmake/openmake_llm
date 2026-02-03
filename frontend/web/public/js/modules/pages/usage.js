/**
 * usage - SPA Page Module
 * Auto-generated from usage.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['usage'] = {
        getHTML: function() {
            return '<div class="page-usage">' +
                '<style data-spa-style="usage">' +
                ".stat-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:var(--space-4); margin-bottom:var(--space-5); }\n        .stat-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); text-align:center; }\n        .stat-card .stat-value { font-size:2rem; font-weight:var(--font-weight-bold); color:var(--accent-primary); margin:var(--space-2) 0; }\n        .stat-card .stat-label { font-size:var(--font-size-sm); color:var(--text-muted); }\n        .stat-card .stat-icon { font-size:1.5rem; margin-bottom:var(--space-2); }\n        .period-tabs { display:flex; gap:var(--space-2); margin-bottom:var(--space-5); }\n        .period-tab { padding:var(--space-2) var(--space-4); background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); cursor:pointer; color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .period-tab.active { background:var(--accent-primary); color:#fff; border-color:var(--accent-primary); }\n        .data-table { width:100%; border-collapse:collapse; background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); overflow:hidden; }\n        .data-table th, .data-table td { padding:var(--space-3) var(--space-4); text-align:left; border-bottom:1px solid var(--border-light); }\n        .data-table th { background:var(--bg-tertiary); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .data-table td { color:var(--text-primary); font-size:var(--font-size-sm); }\n        .data-table tr:last-child td { border-bottom:none; }\n        .data-table tr:hover td { background:var(--bg-secondary); }\n        .section-title { font-size:1.1rem; font-weight:var(--font-weight-semibold); color:var(--text-primary); margin-bottom:var(--space-4); }\n        .refresh-info { font-size:var(--font-size-sm); color:var(--text-muted); text-align:right; margin-bottom:var(--space-3); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>API 사용량</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"refresh-info\" id=\"refreshInfo\">마지막 업데이트: -</div>\n                <div class=\"stat-cards\" id=\"statCards\">\n                    <div class=\"stat-card\"><div class=\"stat-icon\">📊</div><div class=\"stat-value\" id=\"totalReqs\">-</div><div class=\"stat-label\">총 요청</div></div>\n                    <div class=\"stat-card\"><div class=\"stat-icon\">🔤</div><div class=\"stat-value\" id=\"totalTokens\">-</div><div class=\"stat-label\">총 토큰</div></div>\n                    <div class=\"stat-card\"><div class=\"stat-icon\">❌</div><div class=\"stat-value\" id=\"totalErrors\">-</div><div class=\"stat-label\">총 에러</div></div>\n                    <div class=\"stat-card\"><div class=\"stat-icon\">⏱️</div><div class=\"stat-value\" id=\"avgResponse\">-</div><div class=\"stat-label\">평균 응답시간</div></div>\n                </div>\n                <div class=\"period-tabs\" id=\"periodTabs\">\n                    <button class=\"period-tab active\" data-period=\"today\">오늘</button>\n                    <button class=\"period-tab\" data-period=\"weekly\">주간</button>\n                    <button class=\"period-tab\" data-period=\"allTime\">전체</button>\n                </div>\n                <h3 class=\"section-title\">일간 통계</h3>\n                <div id=\"dailyContainer\"><div class=\"loading\">로딩 중...</div></div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
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
        function fmtNum(n) { return n != null ? Number(n).toLocaleString('ko-KR') : '-'; }
        function fmtMs(n) { return n != null ? `${Math.round(n)}ms` : '-'; }

        let usageData = null;
        let currentPeriod = 'today';

        // 기간 탭
        document.getElementById('periodTabs').addEventListener('click', e => {
            const tab = e.target.closest('.period-tab');
            if (!tab) return;
            document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentPeriod = tab.dataset.period;
            renderStats();
        });

        function renderStats() {
            if (!usageData) return;
            const d = usageData[currentPeriod] || usageData.today || {};
            document.getElementById('totalReqs').textContent = fmtNum(d.totalRequests);
            document.getElementById('totalTokens').textContent = fmtNum(d.totalTokens);
            document.getElementById('totalErrors').textContent = fmtNum(d.totalErrors);
            document.getElementById('avgResponse').textContent = fmtMs(d.avgResponseTime);
        }

        function renderDaily(daily) {
            const c = document.getElementById('dailyContainer');
            if (!daily || daily.length === 0) {
                c.innerHTML = '<div class="empty-state"><h2>데이터 없음</h2><p>아직 일간 통계 데이터가 없습니다.</p></div>';
                return;
            }
            c.innerHTML = `<table class="data-table">
                <thead><tr><th>날짜</th><th>요청</th><th>토큰</th><th>에러</th><th>평균 응답시간</th></tr></thead>
                <tbody>${daily.map(r => `<tr>
                    <td>${esc(r.date || '-')}</td>
                    <td>${fmtNum(r.totalRequests || r.requests)}</td>
                    <td>${fmtNum(r.totalTokens || r.tokens)}</td>
                    <td>${fmtNum(r.totalErrors || r.errors)}</td>
                    <td>${fmtMs(r.avgResponseTime)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }

        async function loadData() {
            try {
                const [usageRes, dailyRes] = await Promise.all([
                    authFetch('/api/usage'),
                    authFetch('/api/usage/daily?days=14')
                ]);
                const usage = await usageRes.json();
                const daily = await dailyRes.json();
                if (usage.success) { usageData = usage.data; renderStats(); }
                if (daily.success) { renderDaily(daily.data.daily || daily.data); }
                document.getElementById('refreshInfo').textContent = `마지막 업데이트: ${new Date().toLocaleTimeString('ko-KR')}`;
            } catch (err) {
                console.error('사용량 로드 실패:', err);
                showToast('데이터 로드 실패', 'error');
            }
        }

        loadData();
        (function(fn,ms){var id=setInterval(fn,ms);_intervals.push(id);return id})(loadData, 30000);

            } catch(e) {
                console.error('[PageModule:usage] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
        }
    };
})();
