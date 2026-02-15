/**
 * ============================================
 * Analytics Page - 분석 대시보드
 * ============================================
 * 시스템 건강 상태, 비용 분석, 피드백 통계, 에이전트 성능,
 * 피크 시간대, 인기 쿼리 등 종합 분석 데이터를 표시하는
 * SPA 페이지 모듈입니다. 60초 주기로 자동 갱신됩니다.
 *
 * @module pages/analytics
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['analytics'] = {
        getHTML: function() {
            return '<div class="page-analytics">' +
                '<style data-spa-style="analytics">' +
                ".dash-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); margin-bottom:var(--space-5); }\n        .dash-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); }\n        .dash-card h3 { margin:0 0 var(--space-3); color:var(--text-primary); font-size:1rem; }\n        .health-badge { display:inline-block; padding:var(--space-1) var(--space-3); border-radius:var(--radius-md); font-size:var(--font-size-sm); font-weight:var(--font-weight-bold); }\n        .health-healthy { background:var(--success); color:#fff; }\n        .health-degraded { background:var(--warning); color:#000; }\n        .health-critical { background:var(--danger); color:#fff; }\n        .metric-row { display:flex; justify-content:space-between; padding:var(--space-2) 0; border-bottom:1px solid var(--border-light); font-size:var(--font-size-sm); }\n        .metric-row:last-child { border-bottom:none; }\n        .metric-label { color:var(--text-muted); }\n        .metric-value { color:var(--text-primary); font-weight:var(--font-weight-semibold); }\n        .section-title { font-size:1.1rem; font-weight:var(--font-weight-semibold); color:var(--text-primary); margin:var(--space-5) 0 var(--space-4); }\n        .data-table { width:100%; border-collapse:collapse; background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); overflow:hidden; }\n        .data-table th, .data-table td { padding:var(--space-3) var(--space-4); text-align:left; border-bottom:1px solid var(--border-light); font-size:var(--font-size-sm); }\n        .data-table th { background:var(--bg-tertiary); color:var(--text-secondary); font-weight:var(--font-weight-semibold); }\n        .data-table td { color:var(--text-primary); }\n        .data-table tr:last-child td { border-bottom:none; }\n        .cost-big { font-size:1.8rem; font-weight:var(--font-weight-bold); color:var(--accent-primary); }\n        .cost-label { font-size:var(--font-size-sm); color:var(--text-muted); margin-top:var(--space-1); }\n        .peak-bar { height:8px; background:var(--bg-tertiary); border-radius:4px; overflow:hidden; margin-top:var(--space-1); }\n        .peak-fill { height:100%; background:var(--accent-primary); border-radius:4px; }\n        .refresh-info { font-size:var(--font-size-sm); color:var(--text-muted); text-align:right; margin-bottom:var(--space-3); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>분석 대시보드</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"refresh-info\" id=\"refreshInfo\">마지막 업데이트: -</div>\n\n                <!-- 시스템 건강 + 비용 -->\n                <div class=\"dash-grid\">\n                    <div class=\"dash-card\">\n                        <h3>시스템 상태</h3>\n                        <div id=\"healthSection\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                    <div class=\"dash-card\">\n                        <h3>비용 분석</h3>\n                        <div id=\"costSection\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                    <div class=\"dash-card\">\n                        <h3>피드백 통계</h3>\n                        <div id=\"feedbackSection\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                </div>\n\n                <!-- 에이전트 성능 -->\n                <h3 class=\"section-title\">에이전트 성능</h3>\n                <div id=\"agentTable\"><div class=\"loading\">로딩 중...</div></div>\n\n                <!-- 사용자 행동 -->\n                <h3 class=\"section-title\">사용자 행동 분석</h3>\n                <div class=\"dash-grid\">\n                    <div class=\"dash-card\">\n                        <h3>피크 시간대</h3>\n                        <div id=\"peakHours\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                    <div class=\"dash-card\">\n                        <h3>인기 쿼리</h3>\n                        <div id=\"topQueries\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
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

        function renderHealth(usage) {
            const today = usage.today || {};
            const errorRate = today.totalRequests > 0 ? ((today.totalErrors / today.totalRequests) * 100).toFixed(1) : '0';
            let status = 'healthy', label = '정상';
            if (errorRate > 10) { status = 'critical'; label = '위험'; }
            else if (errorRate > 5 || today.avgResponseTime > 5000) { status = 'degraded'; label = '주의'; }

            document.getElementById('healthSection').innerHTML = `
                <div style="margin-bottom:var(--space-3)"><span class="health-badge health-${status}">${label}</span></div>
                 <div class="metric-row"><span class="metric-label">업타임</span><span class="metric-value">${usage.uptime || 0}초</span></div>
                <div class="metric-row"><span class="metric-label">에러율</span><span class="metric-value">${errorRate}%</span></div>
                <div class="metric-row"><span class="metric-label">평균 응답</span><span class="metric-value">${Math.round(today.avgResponseTime || 0)}ms</span></div>
                <div class="metric-row"><span class="metric-label">오늘 요청</span><span class="metric-value">${fmtNum(today.totalRequests)}</span></div>
            `;
        }

        function renderCost(usage) {
            const weekly = usage.weekly || {};
            const costPerToken = 0.000001;
            const dailyCost = ((usage.today?.totalTokens || 0) * costPerToken).toFixed(4);
            const weeklyCost = ((weekly.totalTokens || 0) * costPerToken).toFixed(4);
            const monthlyCost = ((weeklyCost / 7) * 30).toFixed(3);

            document.getElementById('costSection').innerHTML = `
                <div class="cost-big">$${weeklyCost}</div>
                <div class="cost-label">주간 비용</div>
                <div class="metric-row" style="margin-top:var(--space-3)"><span class="metric-label">일간</span><span class="metric-value">$${dailyCost}</span></div>
                <div class="metric-row"><span class="metric-label">월간 예상</span><span class="metric-value">$${monthlyCost}</span></div>
            `;
        }

        function renderFeedback(data) {
            const el = document.getElementById('feedbackSection');
            if (!data || !data.data) { el.innerHTML = '<div style="color:var(--text-muted)">데이터 없음</div>'; return; }
            const d = data.data;
            el.innerHTML = `
                <div class="metric-row"><span class="metric-label">총 피드백</span><span class="metric-value">${fmtNum(d.totalFeedbacks || d.total || 0)}</span></div>
                <div class="metric-row"><span class="metric-label">평균 평점</span><span class="metric-value">${(d.avgRating || 0).toFixed(1)}/5.0</span></div>
                <div class="metric-row"><span class="metric-label">양호 비율</span><span class="metric-value">${(d.positiveRate || 0).toFixed(0)}%</span></div>
            `;
        }

        function renderAgentTable(data) {
            const el = document.getElementById('agentTable');
            const metrics = data?.data?.metrics || data?.data?.summary || [];
            if (!metrics || (Array.isArray(metrics) && metrics.length === 0)) {
                el.innerHTML = '<div class="empty-state">에이전트 성능 데이터가 없습니다.</div>';
                return;
            }
            const rows = Array.isArray(metrics) ? metrics : Object.entries(metrics).map(([k, v]) => ({ agentId: k, ...v }));
            el.innerHTML = `<table class="data-table">
                <thead><tr><th>에이전트</th><th>요청 수</th><th>평균 응답</th><th>성공률</th></tr></thead>
                <tbody>${rows.map(r => `<tr>
                    <td>${esc(r.agentId || r.name || '-')}</td>
                    <td>${fmtNum(r.totalRequests || r.requests || 0)}</td>
                    <td>${Math.round(r.avgResponseTime || 0)}ms</td>
                    <td>${(r.successRate || 0).toFixed(1)}%</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }

        function renderPeakHours(hours) {
            const el = document.getElementById('peakHours');
            if (!hours || hours.length === 0) { el.innerHTML = '<div style="color:var(--text-muted)">데이터 없음</div>'; return; }
            const max = Math.max(...hours.map(h => h.requests), 1);
            el.innerHTML = hours.slice(0, 6).map(h => `
                <div style="margin-bottom:var(--space-2)">
                    <div class="metric-row"><span class="metric-label">${h.hour}시</span><span class="metric-value">${fmtNum(h.requests)}건</span></div>
                    <div class="peak-bar"><div class="peak-fill" style="width:${(h.requests/max*100)}%"></div></div>
                </div>
            `).join('');
        }

        function renderTopQueries(queries) {
            const el = document.getElementById('topQueries');
            if (!queries || queries.length === 0) { el.innerHTML = '<div style="color:var(--text-muted)">데이터 없음</div>'; return; }
            el.innerHTML = queries.slice(0, 8).map((q, i) => `
                <div class="metric-row"><span class="metric-label">${i+1}. ${esc(q.query.substring(0, 40))}</span><span class="metric-value">${q.count}회</span></div>
            `).join('');
        }

        async function loadData() {
            try {
                const [usageRes, metricsRes, feedbackRes] = await Promise.all([
                    authFetch('/api/usage'),
                    authFetch('/api/agents-monitoring/metrics'),
                    authFetch('/api/agents/feedback/stats')
                ]);
                const usage = await usageRes.json();
                const metrics = await metricsRes.json();
                const feedback = await feedbackRes.json();

                if (usage.success) {
                    renderHealth(usage.data);
                    renderCost(usage.data);
                }
                renderAgentTable(metrics);
                renderFeedback(feedback);

                // 사용자 행동은 별도 API가 없으므로 빈 상태 표시
                renderPeakHours([]);
                renderTopQueries([]);

                document.getElementById('refreshInfo').textContent = `마지막 업데이트: ${new Date().toLocaleTimeString('ko-KR')}`;
            } catch (err) {
                console.error('분석 데이터 로드 실패:', err);
                showToast('데이터 로드 실패', 'error');
            }
        }

        loadData();
        (function(fn,ms){var id=setInterval(fn,ms);_intervals.push(id);return id})(loadData, 60000);

            } catch(e) {
                console.error('[PageModule:analytics] init error:', e);
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
