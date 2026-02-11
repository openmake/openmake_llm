/**
 * agent-learning - SPA Page Module
 * Auto-generated from agent-learning.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['agent-learning'] = {
        getHTML: function() {
            return '<div class="page-agent-learning">' +
                '<style data-spa-style="agent-learning">' +
                ".overview-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:var(--space-4); margin-bottom:var(--space-5); }\n        .overview-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); text-align:center; }\n        .overview-card .ov-value { font-size:1.8rem; font-weight:var(--font-weight-bold); color:var(--accent-primary); margin:var(--space-2) 0; }\n        .overview-card .ov-label { font-size:var(--font-size-sm); color:var(--text-muted); }\n        .selector-bar { display:flex; gap:var(--space-3); align-items:center; margin-bottom:var(--space-5); flex-wrap:wrap; }\n        .selector-bar label { color:var(--text-secondary); font-weight:var(--font-weight-semibold); font-size:var(--font-size-sm); }\n        .selector-bar select { padding:var(--space-2) var(--space-4); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; min-width:200px; }\n        .detail-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:var(--space-4); margin-bottom:var(--space-5); }\n        .detail-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); }\n        .detail-card h3 { margin:0 0 var(--space-3); color:var(--text-primary); font-size:1rem; }\n        .metric-row { display:flex; justify-content:space-between; padding:var(--space-2) 0; border-bottom:1px solid var(--border-light); font-size:var(--font-size-sm); }\n        .metric-row:last-child { border-bottom:none; }\n        .metric-label { color:var(--text-muted); }\n        .metric-value { color:var(--text-primary); font-weight:var(--font-weight-semibold); }\n        .score-big { font-size:2.5rem; font-weight:var(--font-weight-bold); text-align:center; margin:var(--space-3) 0; }\n        .score-good { color:var(--success); }\n        .score-mid { color:var(--warning); }\n        .score-bad { color:var(--danger); }\n        .improvement-item { padding:var(--space-3); margin-bottom:var(--space-2); background:var(--bg-secondary); border-radius:var(--radius-md); font-size:var(--font-size-sm); color:var(--text-secondary); line-height:1.5; }\n        .failure-item { padding:var(--space-3); margin-bottom:var(--space-2); background:var(--bg-secondary); border:1px solid var(--danger); border-radius:var(--radius-md); font-size:var(--font-size-sm); color:var(--text-secondary); }\n        .section-title { font-size:1.1rem; font-weight:var(--font-weight-semibold); color:var(--text-primary); margin:var(--space-5) 0 var(--space-4); }\n        .abtest-list { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n        .abtest-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); }\n        .abtest-card h4 { margin:0 0 var(--space-2); color:var(--text-primary); font-size:var(--font-size-sm); }\n        .vs-badge { display:inline-block; padding:2px 8px; background:var(--accent-primary); color:#fff; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-bold); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>에이전트 학습</h1>\n            </header>\n            <div class=\"content-area\">\n                <!-- 피드백 개요 -->\n                <div class=\"overview-cards\" id=\"overviewCards\">\n                    <div class=\"overview-card\"><div class=\"ov-value\" id=\"ovTotal\">-</div><div class=\"ov-label\">총 피드백</div></div>\n                    <div class=\"overview-card\"><div class=\"ov-value\" id=\"ovAvgRating\">-</div><div class=\"ov-label\">평균 평점</div></div>\n                    <div class=\"overview-card\"><div class=\"ov-value\" id=\"ovPositive\">-</div><div class=\"ov-label\">양호 비율</div></div>\n                    <div class=\"overview-card\"><div class=\"ov-value\" id=\"ovAgents\">-</div><div class=\"ov-label\">활성 에이전트</div></div>\n                </div>\n\n                <!-- 에이전트 선택 -->\n                <div class=\"selector-bar\">\n                    <label>에이전트 선택:</label>\n                    <select id=\"agentSelect\"><option value=\"\">에이전트를 선택하세요</option></select>\n                </div>\n\n                <!-- 상세 분석 -->\n                <div class=\"detail-grid\" id=\"detailSection\" style=\"display:none\">\n                    <div class=\"detail-card\">\n                        <h3>품질 점수</h3>\n                        <div id=\"qualityScore\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                    <div class=\"detail-card\">\n                        <h3>실패 패턴</h3>\n                        <div id=\"failurePatterns\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                    <div class=\"detail-card\">\n                        <h3>개선 제안</h3>\n                        <div id=\"improvements\"><div class=\"loading\">로딩 중...</div></div>\n                    </div>\n                </div>\n\n                <!-- A/B 테스트 -->\n                <h3 class=\"section-title\">A/B 테스트</h3>\n                <div class=\"abtest-list\" id=\"abtestList\">\n                    <div class=\"loading\">로딩 중...</div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
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

        const agentSelect = document.getElementById('agentSelect');

        // 에이전트 선택 시
        agentSelect.addEventListener('change', () => {
            const id = agentSelect.value;
            if (id) {
                document.getElementById('detailSection').style.display = 'grid';
                loadAgentDetail(id);
            } else {
                document.getElementById('detailSection').style.display = 'none';
            }
        });

        function getScoreClass(score) {
            if (score >= 70) return 'score-good';
            if (score >= 40) return 'score-mid';
            return 'score-bad';
        }

        async function loadAgentDetail(agentId) {
            const qs = document.getElementById('qualityScore');
            const fp = document.getElementById('failurePatterns');
            const imp = document.getElementById('improvements');
            qs.innerHTML = fp.innerHTML = imp.innerHTML = '<div class="loading">로딩 중...</div>';

            try {
                const [qualityRes, failureRes, improvRes] = await Promise.all([
                    authFetch(`/api/agents/${agentId}/quality`),
                    authFetch(`/api/agents/${agentId}/failures`),
                    authFetch(`/api/agents/${agentId}/improvements`)
                ]);
                const quality = await qualityRes.json();
                const failures = await failureRes.json();
                const improv = await improvRes.json();

                // 품질 점수
                if (quality.success) {
                    const d = quality.data;
                    const score = d.overallScore || d.score || 0;
                    qs.innerHTML = `
                        <div class="score-big ${getScoreClass(score)}">${Math.round(score)}</div>
                        <div class="metric-row"><span class="metric-label">정확도</span><span class="metric-value">${(d.accuracy || 0).toFixed(1)}%</span></div>
                        <div class="metric-row"><span class="metric-label">만족도</span><span class="metric-value">${(d.satisfaction || 0).toFixed(1)}%</span></div>
                        <div class="metric-row"><span class="metric-label">응답 품질</span><span class="metric-value">${(d.responseQuality || 0).toFixed(1)}%</span></div>
                    `;
                } else { qs.innerHTML = '<div style="color:var(--text-muted)">데이터 없음</div>'; }

                // 실패 패턴
                if (failures.success) {
                    const patterns = failures.data?.patterns || failures.data || [];
                    if (Array.isArray(patterns) && patterns.length > 0) {
                        fp.innerHTML = patterns.slice(0, 5).map(p => `
                            <div class="failure-item"><strong>${esc(p.type || p.pattern || '알 수 없음')}</strong>: ${esc(p.message || p.description || '')} (${p.count || 0}회)</div>
                        `).join('');
                    } else { fp.innerHTML = '<div style="color:var(--text-muted)">실패 패턴 없음</div>'; }
                } else { fp.innerHTML = '<div style="color:var(--text-muted)">데이터 없음</div>'; }

                // 개선 제안
                if (improv.success) {
                    const suggestions = improv.data?.suggestions || improv.data || [];
                    if (Array.isArray(suggestions) && suggestions.length > 0) {
                        imp.innerHTML = suggestions.slice(0, 5).map(s => `
                            <div class="improvement-item">${esc(typeof s === 'string' ? s : s.suggestion || s.description || JSON.stringify(s))}</div>
                        `).join('');
                    } else { imp.innerHTML = '<div style="color:var(--text-muted)">개선 제안 없음</div>'; }
                } else { imp.innerHTML = '<div style="color:var(--text-muted)">데이터 없음</div>'; }
            } catch (err) {
                console.error('에이전트 상세 로드 실패:', err);
                showToast('에이전트 데이터 로드 실패', 'error');
            }
        }

        function renderABTests(tests) {
            const el = document.getElementById('abtestList');
            if (!tests || tests.length === 0) {
                el.innerHTML = '<div class="empty-state"><h2>A/B 테스트 없음</h2><p>진행 중인 A/B 테스트가 없습니다.</p></div>';
                return;
            }
            el.innerHTML = tests.map(t => `
                <div class="abtest-card">
                    <h4>${esc(t.id || t.testId || '테스트')}</h4>
                    <div class="metric-row"><span class="metric-label">Agent A</span><span class="metric-value">${esc(t.agentA || '-')}</span></div>
                    <div class="metric-row"><span class="metric-label"><span class="vs-badge">VS</span></span><span></span></div>
                    <div class="metric-row"><span class="metric-label">Agent B</span><span class="metric-value">${esc(t.agentB || '-')}</span></div>
                    <div class="metric-row"><span class="metric-label">상태</span><span class="metric-value">${esc(t.status || '진행중')}</span></div>
                </div>
            `).join('');
        }

        async function loadData() {
            try {
                const [agentsRes, statsRes, abtestRes] = await Promise.all([
                    authFetch('/api/agents'),
                    authFetch('/api/agents/feedback/stats'),
                    authFetch('/api/agents/abtest')
                ]);
                const agents = await agentsRes.json();
                const stats = await statsRes.json();
                const abtests = await abtestRes.json();

                // 에이전트 목록
                if (agents.success) {
                    const list = agents.data?.agents || agents.data || [];
                    agentSelect.innerHTML = '<option value="">에이전트를 선택하세요</option>' +
                        list.map(a => `<option value="${esc(a.id || a.agentId)}">${esc(a.name || a.agentName || a.id)}</option>`).join('');
                    document.getElementById('ovAgents').textContent = list.length;
                }

                // 피드백 통계
                if (stats.success) {
                    const d = stats.data;
                    document.getElementById('ovTotal').textContent = fmtNum(d.totalFeedbacks || d.total || 0);
                    document.getElementById('ovAvgRating').textContent = (d.avgRating || 0).toFixed(1);
                    document.getElementById('ovPositive').textContent = `${(d.positiveRate || 0).toFixed(0)}%`;
                }

                // A/B 테스트
                if (abtests.success) {
                    renderABTests(abtests.data || []);
                } else {
                    renderABTests([]);
                }
            } catch (err) {
                console.error('데이터 로드 실패:', err);
                showToast('데이터 로드 실패', 'error');
            }
        }

        loadData();
        (function(fn,ms){var id=setInterval(fn,ms);_intervals.push(id);return id})(loadData, 60000);

            } catch(e) {
                console.error('[PageModule:agent-learning] init error:', e);
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
