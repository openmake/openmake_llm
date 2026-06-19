/**
 * ============================================
 * Usage Page - API 사용량 통계
 * ============================================
 * API 요청 수, 토큰 사용량, 에러율, 일별/주별 추이 등
 * API 사용량 통계를 차트와 테이블로 시각화하는
 * SPA 페이지 모듈입니다.
 *
 * @module pages/usage
 */
'use strict';
    window.PageModules = window.PageModules || {};
    let _intervals = [];
    let _timeouts = [];

    function getHTML() {
            return '<div class="page-usage">' +
                '<style data-spa-style="usage">' +
                "/* Usage — Graphite & Ember II, Archetype A */\n        .stat-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:var(--space-4); margin-bottom:var(--space-5); }\n        .stat-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--r-lg,var(--radius-lg)); padding:var(--space-4); }\n        .stat-card .stat-icon { font-size:1.2rem; color:var(--text-muted); margin-bottom:var(--space-2); }\n        .stat-card .stat-value { font-family:var(--font-serif); font-size:var(--font-size-4xl); font-weight:var(--font-weight-semibold); letter-spacing:-.02em; color:var(--text-primary); margin:var(--space-2) 0; line-height:1; }\n        .stat-card .stat-label { font-family:var(--font-mono); font-size:10px; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted); }\n        .period-tabs { display:inline-flex; background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-full,999px); padding:3px; gap:0; margin-bottom:var(--space-5); }\n        .period-tab { font-size:12px; font-weight:var(--font-weight-medium); color:var(--text-muted); background:transparent; border:none; padding:6px 14px; border-radius:var(--radius-full,999px); cursor:pointer; }\n        .period-tab.active { background:var(--bg-card); color:var(--text-primary); box-shadow:0 1px 3px rgba(0,0,0,.15); }\n        .data-table { width:100%; border-collapse:collapse; background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--r-lg,var(--radius-lg)); overflow:hidden; }\n        .data-table th, .data-table td { padding:var(--space-3) var(--space-4); text-align:left; border-bottom:1px solid var(--border-light); }\n        .data-table th { font-family:var(--font-mono); font-size:10px; letter-spacing:.07em; text-transform:uppercase; color:var(--text-muted); font-weight:var(--font-weight-medium); background:var(--bg-tertiary); }\n        .data-table td { color:var(--text-primary); font-size:var(--font-size-sm); }\n        .data-table tr:last-child td { border-bottom:none; }\n        .data-table tr:hover td { background:var(--bg-tertiary); }\n        .section-title { font-family:var(--font-serif); font-size:var(--font-size-xl); font-weight:var(--font-weight-medium); letter-spacing:-.02em; color:var(--text-primary); margin-bottom:var(--space-4); }\n        .refresh-info { font-size:var(--font-size-sm); color:var(--text-muted); text-align:right; margin-bottom:var(--space-3); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1><iconify-icon icon=lucide:bar-chart-2></iconify-icon> API 사용량</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"refresh-info\" id=\"refreshInfo\">마지막 업데이트: -</div>\n                <div class=\"scope-label\" style=\"display:inline-flex;align-items:center;gap:6px;font-size:var(--font-size-sm);color:var(--text-muted);background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:4px 10px;margin-bottom:var(--space-3);\"><iconify-icon icon=lucide:user></iconify-icon> 내 계정 기준 · 개인 사용량</div>\n                <div class=\"stat-cards\" id=\"statCards\">\n                    <div class=\"stat-card\"><div class=\"stat-icon\"><iconify-icon icon=lucide:bar-chart-3></iconify-icon></div><div class=\"stat-value\" id=\"totalReqs\">-</div><div class=\"stat-label\">총 요청</div></div>\n                    <div class=\"stat-card\"><div class=\"stat-icon\"><iconify-icon icon=lucide:type></iconify-icon></div><div class=\"stat-value\" id=\"totalTokens\">-</div><div class=\"stat-label\">총 토큰</div></div>\n                    <div class=\"stat-card\"><div class=\"stat-icon\"><iconify-icon icon=lucide:circle-x></iconify-icon></div><div class=\"stat-value\" id=\"totalErrors\">-</div><div class=\"stat-label\">총 에러</div></div>\n                    <div class=\"stat-card\"><div class=\"stat-icon\"><iconify-icon icon=lucide:timer></iconify-icon></div><div class=\"stat-value\" id=\"avgResponse\">-</div><div class=\"stat-label\">평균 응답시간</div></div>\n                </div>\n                <div class=\"period-tabs\" id=\"periodTabs\">\n                    <button class=\"period-tab active\" data-period=\"today\">오늘</button>\n                    <button class=\"period-tab\" data-period=\"weekly\">주간</button>\n                    <button class=\"period-tab\" data-period=\"allTime\">전체</button>\n                </div>\n                <h3 class=\"section-title\">일간 통계</h3>\n                <div id=\"dailyContainer\"><div class=\"loading\">로딩 중...</div></div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
    }

    function init() {
            try {
                function authFetch(url, opts = {}) {
            return window.authFetch(url, opts);
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
                    authFetch(API_ENDPOINTS.USAGE),
                    authFetch(API_ENDPOINTS.USAGE_DAILY + '?days=14')
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
    }

    function cleanup() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
    }

    const pageModule = { getHTML, init, cleanup };
    window.PageModules['usage'] = pageModule;
    export default pageModule;
