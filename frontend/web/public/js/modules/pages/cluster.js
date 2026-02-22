/**
 * ============================================
 * Cluster Page - 분산 노드 관리
 * ============================================
 * Ollama 클러스터 노드의 상태(온라인/오프라인), 레이턴시,
 * 모델 목록을 모니터링하고 노드 추가/제거를 관리하는
 * SPA 페이지 모듈입니다. 주기적으로 헬스체크를 수행합니다.
 *
 * @module pages/cluster
 */
(function () {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    window.PageModules['cluster'] = {
        getHTML: function () {
            return '<div class="page-cluster">' +
                '<style data-spa-style="cluster">' +
                ".cluster-card {\n            background: var(--bg-card);\n            border-radius: var(--radius-lg);\n            padding: var(--space-6);\n            border: 1px solid var(--border-light);\n        }\n\n        .cluster-header {\n            display: flex;\n            justify-content: space-between;\n            align-items: center;\n            margin-bottom: var(--space-4);\n        }\n\n        .cluster-name {\n            font-size: var(--font-size-lg);\n            font-weight: var(--font-weight-semibold);\n        }\n\n        .cluster-url {\n            color: var(--text-muted);\n            font-size: var(--font-size-sm);\n            margin-bottom: var(--space-4);\n            word-break: break-all;\n        }\n\n        .cluster-stats {\n            display: grid;\n            grid-template-columns: repeat(2, 1fr);\n            gap: var(--space-3);\n            margin-bottom: var(--space-4);\n        }\n\n        .cluster-stat {\n            background: var(--bg-secondary);\n            padding: var(--space-3);\n            border-radius: var(--radius-md);\n        }\n\n        .cluster-stat-value {\n            font-size: var(--font-size-xl);\n            font-weight: var(--font-weight-bold);\n        }\n\n        .cluster-stat-label {\n            font-size: var(--font-size-xs);\n            color: var(--text-muted);\n        }\n\n        .model-tag {\n            font-size: var(--font-size-xs);\n            background: var(--accent-primary-light);\n            color: var(--accent-primary);\n            padding: var(--space-1) var(--space-2);\n            border-radius: var(--radius-full);\n        }" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\">🖥️ 클러스터 대시보드</h1>\n                            <p class=\"page-subtitle\">Ollama 노드 모니터링</p>\n                        </div>\n                        <div class=\"page-actions\">\n                            <button class=\"btn btn-primary\" onclick=\"loadClusterStatus()\">🔄 새로고침</button>\n                        </div>\n                    </header>\n\n                    <!-- Stats Cards -->\n                    <div class=\"dashboard-grid\" style=\"margin-bottom: var(--space-8);\">\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"totalNodes\">0</div>\n                            <div class=\"text-muted text-sm\">총 노드</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"onlineNodes\">0</div>\n                            <div class=\"text-muted text-sm\">온라인 노드</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"totalModels\">0</div>\n                            <div class=\"text-muted text-sm\">사용 가능 모델</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"avgLatency\">-</div>\n                            <div class=\"text-muted text-sm\">평균 지연시간</div>\n                        </div>\n                    </div>\n\n                    <!-- Nodes Grid -->\n                    <div class=\"grid-auto\" id=\"nodesGrid\">\n                        <div class=\"empty-state\">\n                            <div class=\"empty-state-icon\">🔄</div>\n                            <div class=\"empty-state-title\">노드를 로딩하는 중...</div>\n                            <div class=\"empty-state-description\">클러스터 상태를 가져오고 있습니다.</div>\n                        </div>\n                    </div>\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
                '<\/div>';
        },

        init: function () {
            try {
                const API_BASE = window.location.origin;
                // SafeStorage 래퍼 — Safari Private Mode 등에서 localStorage 예외 방지
                const SS = window.SafeStorage || { getItem: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, setItem: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } }, removeItem: function (k) { try { localStorage.removeItem(k); } catch (e) { } } };

                // 인증 체크 (게스트/비로그인 접근 제한)
                (function checkAuthAccess() {
                    const authToken = SS.getItem('authToken');
                    const user = SS.getItem('user');
                    const isGuest = SS.getItem('isGuest') === 'true';
                    if ((!authToken && !user) || isGuest) {
                        (typeof showToast === 'function' ? showToast('이 페이지는 로그인이 필요합니다.', 'warning') : console.warn('이 페이지는 로그인이 필요합니다.'));
                        (typeof Router !== 'undefined' && Router.navigate('/'));
                    }
                })();

                async function loadClusterStatus() {
                    try {
                        const res = await fetch(`${API_BASE}/api/cluster/status`, {
                            credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                        });
                        const json = await res.json();
                        const data = json.data || json;
                        renderStats(data);
                        renderNodes(data.nodes || []);
                    } catch (e) {
                        console.error('클러스터 상태 로드 실패:', e);
                        document.getElementById('nodesGrid').innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">⚠️</div>
                        <div class="empty-state-title">연결 실패</div>
                        <div class="empty-state-description">클러스터 상태를 가져올 수 없습니다.</div>
                    </div>
                `;
                    }
                }

                function renderStats(data) {
                    const nodes = data.nodes || [];
                    const onlineNodes = nodes.filter(n => n.status === 'online');

                    document.getElementById('totalNodes').textContent = nodes.length;
                    document.getElementById('onlineNodes').textContent = onlineNodes.length;
                    document.getElementById('totalModels').textContent = data.stats?.totalModels || 0;

                    const latencies = onlineNodes.map(n => n.latency).filter(l => l > 0);
                    if (latencies.length > 0) {
                        const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
                        document.getElementById('avgLatency').textContent = `${avg}ms`;
                    }
                }

                function renderNodes(nodes) {
                    const grid = document.getElementById('nodesGrid');

                    if (nodes.length === 0) {
                        grid.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🖥️</div>
                        <div class="empty-state-title">등록된 노드가 없습니다</div>
                        <div class="empty-state-description">클러스터에 노드를 추가해주세요.</div>
                    </div>
                `;
                        return;
                    }

                    grid.innerHTML = nodes.map(node => `
                <div class="cluster-card">
                    <div class="cluster-header">
                        <span class="cluster-name">${esc(node.name || node.id)}</span>
                        <span class="status-badge ${node.status === 'online' ? 'online' : 'offline'}">
                            <span class="status-dot ${node.status === 'online' ? 'online' : 'offline'}"></span>
                            ${node.status === 'online' ? '온라인' : '오프라인'}
                        </span>
                    </div>
                    <div class="cluster-url">${esc(node.host ? ('http://' + node.host + ':' + (node.port || 11434)) : (node.id || ''))}</div>
                    <div class="cluster-stats">
                        <div class="cluster-stat">
                            <div class="cluster-stat-value">${node.latency ? node.latency + 'ms' : '-'}</div>
                            <div class="cluster-stat-label">지연시간</div>
                        </div>
                        <div class="cluster-stat">
                            <div class="cluster-stat-value">${node.models?.length || 0}</div>
                            <div class="cluster-stat-label">모델 수</div>
                        </div>
                    </div>
                </div>
            `).join('');
                }

                // Init
                loadClusterStatus();
                (function (fn, ms) { var id = setInterval(fn, ms); _intervals.push(id); return id })(loadClusterStatus, 30000);

                // Expose onclick-referenced functions globally
                if (typeof loadClusterStatus === 'function') window.loadClusterStatus = loadClusterStatus;
            } catch (e) {
                console.error('[PageModule:cluster] init error:', e);
            }
        },

        cleanup: function () {
            _intervals.forEach(function (id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function (id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
            try { delete window.loadClusterStatus; } catch (e) { }
        }
    };
})();
