/**
 * ============================================
 * Alerts Page - 시스템 알림 관리
 * ============================================
 * 할당량 경고, API 오류, 시스템 과부하 등 시스템 이벤트
 * 알림을 심각도(info/warning/critical) 필터링과 함께
 * 표시하는 SPA 페이지 모듈입니다.
 *
 * @module pages/alerts
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['alerts'] = {
        getHTML: function() {
            return '<div class="page-alerts">' +
                '<style data-spa-style="alerts">' +
                ".dash-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:var(--space-4); margin-bottom:var(--space-5); }\n        .dash-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); }\n        .dash-card h3 { margin:0 0 var(--space-3); color:var(--text-primary); font-size:1rem; }\n        .metric-row { display:flex; justify-content:space-between; padding:var(--space-2) 0; border-bottom:1px solid var(--border-light); font-size:var(--font-size-sm); }\n        .metric-row:last-child { border-bottom:none; }\n        .metric-label { color:var(--text-muted); }\n        .metric-value { color:var(--text-primary); font-weight:var(--font-weight-semibold); }\n        .status-on { color:var(--success); font-weight:var(--font-weight-bold); }\n        .status-off { color:var(--danger); font-weight:var(--font-weight-bold); }\n        .channel-tag { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); background:var(--bg-tertiary); color:var(--text-secondary); margin-right:var(--space-1); }\n        .section-title { font-size:1.1rem; font-weight:var(--font-weight-semibold); color:var(--text-primary); margin:var(--space-5) 0 var(--space-4); }\n        .filter-tabs { display:flex; gap:var(--space-2); margin-bottom:var(--space-4); }\n        .filter-tab { padding:var(--space-2) var(--space-3); background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); cursor:pointer; color:var(--text-secondary); font-size:var(--font-size-sm); }\n        .filter-tab.active { background:var(--accent-primary); color:#fff; border-color:var(--accent-primary); }\n        .alert-list { display:flex; flex-direction:column; gap:var(--space-3); }\n        .alert-item { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-4); display:flex; gap:var(--space-3); align-items:flex-start; }\n        .alert-item:hover { border-color:var(--accent-primary); }\n        .alert-icon { font-size:1.5rem; flex-shrink:0; }\n        .alert-body { flex:1; min-width:0; }\n        .alert-header { display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-1); }\n        .alert-title { font-weight:var(--font-weight-semibold); color:var(--text-primary); font-size:var(--font-size-sm); }\n        .alert-time { font-size:12px; color:var(--text-muted); }\n        .alert-msg { font-size:var(--font-size-sm); color:var(--text-muted); line-height:1.5; }\n        .badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .badge-info { background:var(--accent-primary); color:#fff; }\n        .badge-warning { background:var(--warning); color:#000; }\n        .badge-critical { background:var(--danger); color:#fff; }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>알림 관리</h1>\n            </header>\n            <div class=\"content-area\">\n                <!-- 시스템 상태 + 임계값 -->\n                <div class=\"dash-grid\">\n                    <div class=\"dash-card\">\n                        <h3>알림 시스템</h3>\n                        <div id=\"systemStatus\">\n                            <div class=\"metric-row\"><span class=\"metric-label\">상태</span><span class=\"metric-value status-on\">활성화</span></div>\n                            <div class=\"metric-row\"><span class=\"metric-label\">채널</span><span class=\"metric-value\"><span class=\"channel-tag\">console</span></span></div>\n                            <div class=\"metric-row\"><span class=\"metric-label\">총 알림</span><span class=\"metric-value\" id=\"totalAlerts\">0</span></div>\n                        </div>\n                    </div>\n                    <div class=\"dash-card\">\n                        <h3>임계값 설정</h3>\n                        <div class=\"metric-row\"><span class=\"metric-label\">할당량 경고</span><span class=\"metric-value\">70%</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">할당량 위험</span><span class=\"metric-value\">90%</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">응답시간 임계</span><span class=\"metric-value\">5,000ms</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">에러율 임계</span><span class=\"metric-value\">10%</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">쿨다운</span><span class=\"metric-value\">15분</span></div>\n                    </div>\n                    <div class=\"dash-card\">\n                        <h3>알림 유형</h3>\n                        <div class=\"metric-row\"><span class=\"metric-label\">할당량 경고</span><span class=\"metric-value badge badge-warning\">warning</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">할당량 위험</span><span class=\"metric-value badge badge-critical\">critical</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">키 소진</span><span class=\"metric-value badge badge-critical\">critical</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">응답시간 급증</span><span class=\"metric-value badge badge-warning\">warning</span></div>\n                        <div class=\"metric-row\"><span class=\"metric-label\">에러율 급증</span><span class=\"metric-value badge badge-critical\">critical</span></div>\n                    </div>\n                </div>\n\n                <!-- 알림 히스토리 -->\n                <h3 class=\"section-title\">알림 히스토리</h3>\n                <div class=\"filter-tabs\" id=\"filterTabs\">\n                    <button class=\"filter-tab active\" data-sev=\"all\">전체</button>\n                    <button class=\"filter-tab\" data-sev=\"info\">정보</button>\n                    <button class=\"filter-tab\" data-sev=\"warning\">경고</button>\n                    <button class=\"filter-tab\" data-sev=\"critical\">위험</button>\n                </div>\n                <div class=\"alert-list\" id=\"alertList\">\n                    <div class=\"empty-state\">\n                        <h2>알림 없음</h2>\n                        <p>아직 발생한 알림이 없습니다. 시스템이 정상 운영 중입니다.</p>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
            '<div id="toast" class="toast"></div>' +
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

        const SEVERITY_ICONS = { info: 'ℹ️', warning: '⚠️', critical: '🚨' };
        const SEVERITY_BADGE = { info: 'badge-info', warning: 'badge-warning', critical: 'badge-critical' };
        const TYPE_LABELS = {
            quota_warning: '할당량 경고', quota_critical: '할당량 위험', api_error: 'API 오류',
            system_overload: '시스템 과부하', key_exhausted: '키 소진',
            response_time_spike: '응답시간 급증', error_rate_spike: '에러율 급증'
        };

        let allAlerts = [];
        let currentFilter = 'all';

        // 필터 탭
        document.getElementById('filterTabs').addEventListener('click', e => {
            const tab = e.target.closest('.filter-tab');
            if (!tab) return;
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.sev;
            renderAlerts();
        });

        function renderAlerts() {
            const filtered = currentFilter === 'all' ? allAlerts : allAlerts.filter(a => a.severity === currentFilter);
            const el = document.getElementById('alertList');
            if (filtered.length === 0) {
                el.innerHTML = '<div class="empty-state"><h2>알림 없음</h2><p>해당 필터에 맞는 알림이 없습니다.</p></div>';
                return;
            }
            el.innerHTML = filtered.map(a => `
                <div class="alert-item">
                    <div class="alert-icon">${SEVERITY_ICONS[a.severity] || 'ℹ️'}</div>
                    <div class="alert-body">
                        <div class="alert-header">
                            <span class="badge ${SEVERITY_BADGE[a.severity] || 'badge-info'}">${a.severity}</span>
                            <span class="alert-title">${esc(a.title || TYPE_LABELS[a.type] || a.type)}</span>
                            <span class="alert-time">${new Date(a.timestamp).toLocaleString('ko-KR')}</span>
                        </div>
                        <div class="alert-msg">${esc(a.message)}</div>
                    </div>
                </div>
            `).join('');
        }

        // 알림 히스토리 로드 (admin 전용 — /api/metrics/alerts)
        async function loadAlerts() {
            try {
                var res = await authFetch(API_ENDPOINTS.METRICS_ALERTS + '?limit=100');
                var rawData = await res.json();
                var data = rawData.data || rawData;
                allAlerts = Array.isArray(data.history) ? data.history : [];
                document.getElementById('totalAlerts').textContent = allAlerts.length;
                renderAlerts();
            } catch (e) {
                // 권한 없거나 오류 시 빈 목록 유지 (graceful degradation)
                allAlerts = [];
                document.getElementById('totalAlerts').textContent = '0';
                renderAlerts();
            }
        }
        loadAlerts();

            } catch(e) {
                console.error('[PageModule:alerts] init error:', e);
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
