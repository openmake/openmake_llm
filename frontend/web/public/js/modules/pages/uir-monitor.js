/**
 * ============================================
 * UIR Monitor Page - UIR 라우터 모니터링
 * ============================================
 * Unified Intent Router의 shadow log, 일치율, 롤아웃 설정을
 * 실시간으로 모니터링하는 SPA 페이지 모듈입니다.
 *
 * @module pages/uir-monitor
 */
'use strict';
    window.PageModules = window.PageModules || {};

    function getHTML() {
        return '<div class="page-uir-monitor">' +
            '<style data-spa-style="uir-monitor">' +
            ".uir-stats-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:var(--space-4); margin-bottom:var(--space-5); }\n" +
            ".uir-stat-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); text-align:center; }\n" +
            ".uir-stat-card .stat-label { font-size:var(--font-size-sm); color:var(--text-muted); margin-bottom:var(--space-2); }\n" +
            ".uir-stat-card .stat-value { font-size:1.8rem; font-weight:var(--font-weight-bold); color:var(--accent-primary); }\n" +
            ".uir-stat-card .stat-unit { font-size:var(--font-size-sm); color:var(--text-secondary); margin-left:2px; }\n" +
            ".uir-section { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); margin-bottom:var(--space-5); }\n" +
            ".uir-section h3 { margin:0 0 var(--space-4); color:var(--text-primary); font-size:1rem; font-weight:var(--font-weight-semibold); }\n" +
            ".rollout-row { display:flex; align-items:center; gap:var(--space-4); flex-wrap:wrap; }\n" +
            ".rollout-info { display:flex; align-items:center; gap:var(--space-3); flex:1; min-width:200px; }\n" +
            ".rollout-info .big-pct { font-size:2rem; font-weight:var(--font-weight-bold); color:var(--accent-primary); }\n" +
            ".rollout-info .big-pct-label { font-size:var(--font-size-sm); color:var(--text-muted); }\n" +
            ".badge-on { display:inline-block; padding:2px 10px; border-radius:var(--radius-md); font-size:var(--font-size-sm); font-weight:var(--font-weight-bold); background:var(--success); color:#fff; }\n" +
            ".badge-off { display:inline-block; padding:2px 10px; border-radius:var(--radius-md); font-size:var(--font-size-sm); font-weight:var(--font-weight-bold); background:var(--text-muted); color:#fff; }\n" +
            ".rollout-edit { display:flex; align-items:center; gap:var(--space-3); }\n" +
            ".rollout-edit label { font-size:var(--font-size-sm); color:var(--text-secondary); white-space:nowrap; }\n" +
            ".rollout-edit input[type=number] { width:80px; padding:var(--space-2) var(--space-3); border:1px solid var(--border-light); border-radius:var(--radius-md); background:var(--bg-secondary); color:var(--text-primary); font-size:var(--font-size-sm); }\n" +
            ".uir-data-table { width:100%; border-collapse:collapse; font-size:var(--font-size-sm); }\n" +
            ".uir-data-table th, .uir-data-table td { padding:var(--space-2) var(--space-3); text-align:left; border-bottom:1px solid var(--border-light); white-space:nowrap; }\n" +
            ".uir-data-table th { background:var(--bg-tertiary); color:var(--text-secondary); font-weight:var(--font-weight-semibold); }\n" +
            ".uir-data-table td { color:var(--text-primary); }\n" +
            ".uir-data-table tr:last-child td { border-bottom:none; }\n" +
            ".uir-data-table .match-yes { color:var(--success); font-size:1rem; }\n" +
            ".uir-data-table .match-no { color:var(--danger); font-size:1rem; }\n" +
            ".uir-table-wrap { overflow-x:auto; }\n" +
            ".uir-toolbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:var(--space-4); flex-wrap:wrap; gap:var(--space-3); }\n" +
            ".uir-toolbar h3 { margin:0; color:var(--text-primary); font-size:1rem; font-weight:var(--font-weight-semibold); }\n" +
            ".loading-state { text-align:center; padding:var(--space-6); color:var(--text-muted); font-size:var(--font-size-sm); }\n" +
            ".empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); font-size:var(--font-size-sm); }\n" +
            ".toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; pointer-events:none; }\n" +
            ".toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }" +
            '<\/style>' +
            '<header class="page-header">' +
                '<button class="mobile-menu-btn" onclick="toggleMobileSidebar(event)">&#9776;</button>' +
                '<h1>UIR 라우터 모니터</h1>' +
            '<\/header>' +
            '<div class="content-area">' +

                '<p style="color:var(--text-muted);font-size:var(--font-size-sm);margin-bottom:var(--space-5)">Unified Intent Router shadow 비교 결과 및 롤아웃 현황을 확인합니다.</p>' +

                '<!-- 상태 카드 -->' +
                '<div class="uir-stats-grid" id="uirStatsGrid">' +
                    '<div class="uir-stat-card"><div class="stat-label">총 비교 횟수</div><div class="stat-value" id="statTotal">-</div></div>' +
                    '<div class="uir-stat-card"><div class="stat-label">에이전트 일치율</div><div class="stat-value" id="statAgentMatch">-</div><span class="stat-unit">%</span></div>' +
                    '<div class="uir-stat-card"><div class="stat-label">쿼리타입 일치율</div><div class="stat-value" id="statQtypeMatch">-</div><span class="stat-unit">%</span></div>' +
                    '<div class="uir-stat-card"><div class="stat-label">평균 UIR 레이턴시</div><div class="stat-value" id="statLatency">-</div><span class="stat-unit">ms</span></div>' +
                '<\/div>' +

                '<!-- 롤아웃 설정 -->' +
                '<div class="uir-section" id="uirRolloutSection">' +
                    '<h3>롤아웃 설정</h3>' +
                    '<div class="loading-state">로딩 중...</div>' +
                '<\/div>' +

                '<!-- Shadow Log 테이블 -->' +
                '<div style="background:var(--bg-card);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:var(--space-5);">' +
                    '<div class="uir-toolbar">' +
                        '<h3>최근 Shadow Log</h3>' +
                        '<button class="btn btn-secondary" id="uirRefreshBtn" onclick="window._uirRefresh && window._uirRefresh()">새로고침</button>' +
                    '<\/div>' +
                    '<div class="uir-table-wrap">' +
                        '<div id="uirLogTable"><div class="loading-state">로딩 중...</div><\/div>' +
                    '<\/div>' +
                '<\/div>' +

            '<\/div>' +
            '<div id="uirToast" class="toast"><\/div>' +
        '<\/div>';
    }

    function init() {
        try {
            function authFetch(url, opts) {
                return window.authFetch(url, opts || {});
            }

            function showToast(msg, type) {
                var t = document.getElementById('uirToast');
                if (!t) return;
                t.textContent = msg;
                t.className = 'toast ' + (type || 'success') + ' show';
                setTimeout(function() { t.classList.remove('show'); }, 2500);
            }

            function esc(s) {
                var d = document.createElement('div');
                d.textContent = (s == null ? '' : String(s));
                return d.innerHTML;
            }

            function fmtTime(iso) {
                if (!iso) return '-';
                try {
                    var d = new Date(iso);
                    return d.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
                } catch (e) {
                    return String(iso).substring(0, 19);
                }
            }

            // 상태 카드 렌더링
            function renderStats(data) {
                var total = data.total_count != null ? data.total_count : (data.totalCount != null ? data.totalCount : '-');
                var agentMatch = data.agent_match_rate != null ? data.agent_match_rate : (data.agentMatchRate != null ? data.agentMatchRate : null);
                var qtypeMatch = data.qtype_match_rate != null ? data.qtype_match_rate : (data.qtypeMatchRate != null ? data.qtypeMatchRate : null);
                var latency = data.avg_uir_latency_ms != null ? data.avg_uir_latency_ms : (data.avgLatencyMs != null ? data.avgLatencyMs : null);

                var elTotal = document.getElementById('statTotal');
                var elAgent = document.getElementById('statAgentMatch');
                var elQtype = document.getElementById('statQtypeMatch');
                var elLat = document.getElementById('statLatency');

                if (elTotal) elTotal.textContent = total != null ? Number(total).toLocaleString('ko-KR') : '-';
                if (elAgent) elAgent.textContent = agentMatch != null ? Number(agentMatch).toFixed(1) : '-';
                if (elQtype) elQtype.textContent = qtypeMatch != null ? Number(qtypeMatch).toFixed(1) : '-';
                if (elLat) elLat.textContent = latency != null ? Math.round(Number(latency)) : '-';
            }

            // 롤아웃 설정 렌더링
            function renderRollout(data) {
                var section = document.getElementById('uirRolloutSection');
                if (!section) return;

                var pct = data.rollout_percent != null ? data.rollout_percent : (data.rolloutPercent != null ? data.rolloutPercent : 0);
                var enabled = data.enabled != null ? data.enabled : false;
                var badgeHtml = enabled
                    ? '<span class="badge-on">ON</span>'
                    : '<span class="badge-off">OFF</span>';

                section.innerHTML =
                    '<h3>롤아웃 설정<\/h3>' +
                    '<div class="rollout-row">' +
                        '<div class="rollout-info">' +
                            '<div><div class="big-pct" id="rolloutPctDisplay">' + esc(String(pct)) + '%<\/div><div class="big-pct-label">현재 롤아웃 비율<\/div><\/div>' +
                            '<div>' + badgeHtml + '<\/div>' +
                        '<\/div>' +
                        '<div class="rollout-edit">' +
                            '<label for="rolloutInput">롤아웃 %<\/label>' +
                            '<input type="number" id="rolloutInput" min="0" max="100" value="' + esc(String(pct)) + '" />' +
                            '<button class="btn btn-primary" id="rolloutSaveBtn">저장<\/button>' +
                        '<\/div>' +
                    '<\/div>';

                var saveBtn = document.getElementById('rolloutSaveBtn');
                if (saveBtn) {
                    saveBtn.addEventListener('click', function() {
                        saveRollout();
                    });
                }
            }

            // Shadow Log 테이블 렌더링
            function renderLogTable(rows) {
                var el = document.getElementById('uirLogTable');
                if (!el) return;

                if (!rows || rows.length === 0) {
                    el.innerHTML = '<div class="empty-state">Shadow log 데이터가 없습니다.</div>';
                    return;
                }

                var tbody = rows.map(function(r) {
                    var agentMatch = r.agent_match != null ? r.agent_match : r.agentMatch;
                    var qtypeMatch = r.qtype_match != null ? r.qtype_match : r.qtypeMatch;
                    var uirAgent = r.uir_agent_id != null ? r.uir_agent_id : (r.uirAgentId != null ? r.uirAgentId : '-');
                    var legacyAgent = r.legacy_agent_id != null ? r.legacy_agent_id : (r.legacyAgentId != null ? r.legacyAgentId : '-');
                    var uirQtype = r.uir_query_type != null ? r.uir_query_type : (r.uirQueryType != null ? r.uirQueryType : '-');
                    var legacyQtype = r.legacy_query_type != null ? r.legacy_query_type : (r.legacyQueryType != null ? r.legacyQueryType : '-');
                    var latMs = r.uir_latency_ms != null ? r.uir_latency_ms : (r.uirLatencyMs != null ? r.uirLatencyMs : null);
                    var ts = r.created_at || r.createdAt || r.timestamp || '';

                    var agentMatchIcon = agentMatch ? '<span class="match-yes">&#x2705;<\/span>' : '<span class="match-no">&#x274C;<\/span>';
                    var qtypeMatchIcon = qtypeMatch ? '<span class="match-yes">&#x2705;<\/span>' : '<span class="match-no">&#x274C;<\/span>';

                    return '<tr>' +
                        '<td>' + esc(fmtTime(ts)) + '<\/td>' +
                        '<td>' + esc(uirAgent) + '<\/td>' +
                        '<td>' + esc(legacyAgent) + '<\/td>' +
                        '<td style="text-align:center">' + agentMatchIcon + '<\/td>' +
                        '<td>' + esc(uirQtype) + '<\/td>' +
                        '<td>' + esc(legacyQtype) + '<\/td>' +
                        '<td style="text-align:center">' + qtypeMatchIcon + '<\/td>' +
                        '<td>' + (latMs != null ? esc(Math.round(Number(latMs)) + 'ms') : '-') + '<\/td>' +
                    '<\/tr>';
                }).join('');

                el.innerHTML =
                    '<table class="uir-data-table">' +
                        '<thead><tr>' +
                            '<th>시각<\/th>' +
                            '<th>UIR agentId<\/th>' +
                            '<th>Legacy agentId<\/th>' +
                            '<th>에이전트 일치<\/th>' +
                            '<th>UIR queryType<\/th>' +
                            '<th>Legacy queryType<\/th>' +
                            '<th>qType 일치<\/th>' +
                            '<th>UIR 레이턴시<\/th>' +
                        '<\/tr><\/thead>' +
                        '<tbody>' + tbody + '<\/tbody>' +
                    '<\/table>';
            }

            // 롤아웃 저장
            async function saveRollout() {
                var input = document.getElementById('rolloutInput');
                if (!input) return;
                var val = parseInt(input.value, 10);
                if (isNaN(val) || val < 0 || val > 100) {
                    showToast('0~100 사이 값을 입력하세요.', 'error');
                    return;
                }
                try {
                    var res = await authFetch('/api/uir/rollout', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rollout_percent: val })
                    });
                    var data = await res.json();
                    if (res.ok) {
                        showToast('롤아웃 설정이 저장되었습니다.', 'success');
                        var display = document.getElementById('rolloutPctDisplay');
                        if (display) display.textContent = val + '%';
                    } else {
                        var errMsg = (data && data.error && data.error.message) ? data.error.message : '저장 실패';
                        showToast(errMsg, 'error');
                    }
                } catch (e) {
                    console.error('[uir-monitor] saveRollout error:', e);
                    showToast('네트워크 오류가 발생했습니다.', 'error');
                }
            }

            // 전체 데이터 로드
            async function loadAll() {
                try {
                    var statsRes = await authFetch('/api/uir/stats');
                    if (statsRes.ok) {
                        var statsData = await statsRes.json();
                        renderStats(statsData.data || statsData);
                    }
                } catch (e) {
                    console.error('[uir-monitor] stats load error:', e);
                }

                try {
                    var rolloutRes = await authFetch('/api/uir/rollout');
                    if (rolloutRes.ok) {
                        var rolloutData = await rolloutRes.json();
                        renderRollout(rolloutData.data || rolloutData);
                    } else {
                        var section = document.getElementById('uirRolloutSection');
                        if (section) {
                            section.innerHTML = '<h3>롤아웃 설정<\/h3><div class="empty-state">롤아웃 정보를 불러올 수 없습니다.<\/div>';
                        }
                    }
                } catch (e) {
                    console.error('[uir-monitor] rollout load error:', e);
                }

                try {
                    var logRes = await authFetch('/api/uir/log?limit=50');
                    if (logRes.ok) {
                        var logData = await logRes.json();
                        var rows = Array.isArray(logData) ? logData : (logData.data || logData.rows || []);
                        renderLogTable(rows);
                    } else {
                        var el = document.getElementById('uirLogTable');
                        if (el) el.innerHTML = '<div class="empty-state">로그 데이터를 불러올 수 없습니다.<\/div>';
                    }
                } catch (e) {
                    console.error('[uir-monitor] log load error:', e);
                    var el = document.getElementById('uirLogTable');
                    if (el) el.innerHTML = '<div class="empty-state">로그 로드 중 오류가 발생했습니다.<\/div>';
                }
            }

            // 새로고침 핸들러 전역 등록 (HTML onclick에서 참조)
            window._uirRefresh = loadAll;

            loadAll();

        } catch (e) {
            console.error('[PageModule:uir-monitor] init error:', e);
        }
    }

    function cleanup() {
        window._uirRefresh = null;
    }

    var pageModule = { getHTML: getHTML, init: init, cleanup: cleanup };
    window.PageModules['uir-monitor'] = pageModule;
    export default pageModule;
