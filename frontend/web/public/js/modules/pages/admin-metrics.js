/**
 * ============================================
 * Admin Metrics Page - 통합 시스템 대시보드
 * ============================================
 * 시스템 메트릭(업타임, 메모리, 연결), API 토큰 모니터링,
 * 할당량 상태, 비용 추적, 시간별/일별 사용량 차트를
 * Chart.js로 시각화하는 관리자 전용 페이지입니다.
 *
 * @module pages/admin-metrics
 */
'use strict';
    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    let _intervals = [];
    /** @type {number[]} setTimeout ID 배열 (cleanup용) */
    let _timeouts = [];
    /**
     * HTML 이스케이프 헬퍼
     * @param {string} s - 이스케이프할 문자열
     * @returns {string} 이스케이프된 문자열
     */
    function esc(s) { var d = document.createElement('div'); d.textContent = s != null ? String(s) : ''; return d.innerHTML; }

    window.PageModules['admin-metrics'] = {
        /**
         * 페이지 HTML 문자열 반환
         * @returns {string} 시스템 대시보드 HTML (스타일 + 차트 컨테이너 포함)
         */
        getHTML: function () {
            return '<div class="page-admin-metrics">' +
                '<style data-spa-style="admin-metrics">' +
                "/* 토큰 모니터링 전용 스타일 추가 */\n        .cost-display {\n            font-size: var(--font-size-3xl);\n            font-weight: 700;\n            color: var(--accent-primary);\n            text-align: center;\n            margin: 10px 0;\n        }\n\n        .cost-currency {\n            font-size: var(--font-size-base);\n            opacity: 0.7;\n        }\n\n        .progress-bar {\n            height: 8px;\n            background: var(--bg-tertiary);\n            border-radius: 4px;\n            overflow: hidden;\n            margin-top: 5px;\n        }\n\n        .progress-fill {\n            height: 100%;\n            border-radius: 4px;\n            transition: width 0.5s ease;\n        }\n\n        .progress-fill.safe {\n            background: var(--success);\n        }\n\n        .progress-fill.warning {\n            background: var(--warning);\n        }\n\n        .progress-fill.critical {\n            background: var(--danger);\n        }\n\n        .chart-container-custom {\n            position: relative;\n            height: 250px;\n            width: 100%;\n        }\n\n        .key-item {\n            padding: 12px;\n            border-radius: 8px;\n            background: var(--bg-secondary);\n            border: 1px solid var(--border-light);\n            margin-bottom: 8px;\n            display: flex;\n            justify-content: space-between;\n            align-items: center;\n        }\n\n        .key-item.active {\n            border-color: var(--success);\n            background: rgba(var(--success-rgb), 0.05);\n            /* 근사치 */\n        }\n\n        .key-item.warning {\n            border-color: var(--warning);\n        }\n\n        .monitoring-section {\n            margin-top: var(--space-8);\n        }\n\n        .card-icon {\n            font-size: var(--font-size-xl);\n            margin-left: auto;\n        }" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\"><iconify-icon icon=lucide:gauge></iconify-icon> 통합 시스템 대시보드</h1>\n                            <p class=\"page-subtitle\" id=\"lastUpdated\">시스템 상태 및 API 토큰 모니터링</p>\n                        </div>\n                        <div class=\"page-actions\">\n                            <button class=\"btn btn-primary\" onclick=\"loadAllData()\">\n                                <iconify-icon icon=lucide:refresh-cw></iconify-icon> 새로고침\n                            </button>\n                        </div>\n                    </header>\n\n                    <!-- 1. System Metrics (기존) -->\n                    <div class=\"scope-label\" style=\"display:inline-flex;align-items:center;gap:6px;font-size:var(--font-size-sm);color:var(--text-muted);background:var(--bg-tertiary);border:1px solid var(--border-light);border-radius:var(--radius-md);padding:4px 10px;margin-bottom:var(--space-3);\"><iconify-icon icon=lucide:globe></iconify-icon> 시스템 전체 · 모든 사용자 기준</div>\n                    <div class=\"dashboard-grid\">\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">시스템 업타임</span>\n                                <span class=\"status-dot online\"></span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"uptime\">0시간</div>\n                        </div>\n\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">메모리 사용량</span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"memoryUsage\">0 MB</div>\n                            <div class=\"metric-card-change\" id=\"memoryBadgeSpan\"><span class=\"badge badge-success\"\n                                    id=\"memoryBadge\">정상</span></div>\n                        </div>\n\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">활성 연결</span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"activeConnections\">0</div>\n                        </div>\n\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">오늘 요청</span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"todayRequests\">0</div>\n                            <div class=\"metric-card-change\" id=\"todayTokens\">0 토큰</div>\n                        </div>\n                    </div>\n\n                    <!-- 2. 비용 및 할당량 모니터링 (API 키 로테이션 카드는 2026-05-19 제거 — LiteLLM 마이그레이션 후 dead) -->\n                    <div class=\"monitoring-section\">\n                        <div class=\"section-header\">\n                            <span class=\"section-icon\"><iconify-icon icon=lucide:coins></iconify-icon></span>\n                            <span class=\"section-title\">비용 및 할당량 모니터링</span>\n                        </div>\n\n                        <div class=\"dashboard-grid\">\n                            <!-- Cost Tracker -->\n                            <div class=\"card\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">오늘 예상 비용</span>\n                                    <span class=\"card-icon\"><iconify-icon icon=lucide:coins></iconify-icon></span>\n                                </div>\n                                <div class=\"card-body\"\n                                    style=\"display: flex; flex-direction: column; justify-content: center; height: 150px;\">\n                                    <div class=\"cost-display\">\n                                        <span class=\"cost-currency\">$</span>\n                                        <span id=\"todayCost\">0.0000</span>\n                                    </div>\n                                    <div class=\"text-center text-muted text-sm\" id=\"costDetails\">\n                                        데이터 집계 중...\n                                    </div>\n                                </div>\n                            </div>\n\n                            <!-- Quota Status -->\n                            <div class=\"card\" style=\"grid-column: span 2;\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">할당량 현황</span>\n                                    <span class=\"badge\" id=\"quotaWarningBadge\">정상</span>\n                                </div>\n                                <div id=\"quotaSection\" class=\"card-body\"\n                                    style=\"display: flex; flex-direction: column; gap: 15px;\">\n                                    <!-- 로딩 중 -->\n                                </div>\n                            </div>\n                        </div>\n                    </div>\n\n                    <!-- 3. Usage Charts (신규 - Chart.js) -->\n                    <div class=\"monitoring-section\">\n                        <div class=\"grid-2\">\n                            <!-- Hourly Chart -->\n                            <div class=\"card\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">시간별 요청 (오늘)</span>\n                                </div>\n                                <div class=\"card-body\">\n                                    <div class=\"chart-container-custom\">\n                                        <canvas id=\"hourlyChart\"></canvas>\n                                    </div>\n                                </div>\n                            </div>\n\n                            <!-- Daily Chart -->\n                            <div class=\"card\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">일간 트래픽 (최근 7일)</span>\n                                </div>\n                                <div class=\"card-body\">\n                                    <div class=\"chart-container-custom\">\n                                        <canvas id=\"dailyChart\"></canvas>\n                                    </div>\n                                </div>\n                            </div>\n                        </div>\n                    </div>\n\n                    <!-- 4. Cluster Nodes (기존) -->\n                    <div class=\"monitoring-section\" style=\"margin-bottom: 50px;\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\">클러스터 노드 정보</span>\n                            </div>\n                            <div class=\"node-grid\" id=\"nodesContainer\" style=\"padding: var(--space-4);\">\n                                <div class=\"text-muted text-center\">노드 정보 로딩 중...</div>\n                            </div>\n                        </div>\n                    </div>\n\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
                '<\/div>';
        },

        /**
         * 페이지 초기화 - 시스템 메트릭 및 토큰 모니터링 데이터 로드, 30초 자동 갱신 시작
         * @returns {void}
         */
        init: function () {
            try {
                // 전역 차트 인스턴스
                let hourlyChart = null;
                let dailyChart = null;

                function loadChartJs() {
                    return new Promise(function (resolve, reject) {
                        if (typeof Chart === 'undefined') {
                            const script = document.createElement('script');
                            script.src = '/js/vendor/chart.umd.min.js';
                            script.onload = function () { /* renderCharts(); */ resolve(); }; // renderCharts()는 정의되지 않았으므로 주석 처리
                            script.onerror = function () { console.warn('Chart.js 로컬 로드 실패'); resolve(); };
                            document.head.appendChild(script);
                        } else {
                            resolve();
                        }
                    });
                }

                // 1. 초기 로드
                loadAllData();

                // 2. 주기적 갱신 (interval tracked in _intervals for cleanup)
                (function (fn, ms) { var id = setInterval(fn, ms); _intervals.push(id); return id })(loadAllData, 30000); // 30초

                // 통합 데이터 로드
                async function loadAllData() {
                    updateTime();
                    await Promise.all([
                        loadSystemMetrics(),    // 시스템 메트릭 (기존)
                        loadMonitoringData()    // 토큰 모니터링 + 차트 + 비용 (신규)
                    ]);
                }

                function updateTime() {
                    document.getElementById('lastUpdated').textContent =
                        `마지막 업데이트: ${new Date().toLocaleTimeString()}`;
                }

                // --- System Metrics Logic ---
                async function loadSystemMetrics() {
                    try {
                        const response = await window.authFetch(API_ENDPOINTS.METRICS);
                        const rawData = await response.json();
                        // api-response 표준 형식: rawData.data 안에 실제 데이터
                        const data = rawData.data || rawData;

                        if (data.system) {
                            const uptime = Math.floor(data.system.uptime);
                            const hours = Math.floor(uptime / 3600);
                            const minutes = Math.floor((uptime % 3600) / 60);
                            document.getElementById('uptime').textContent = `${hours}시간 ${minutes}분`;

                            const memoryMB = Math.round(data.system.memoryUsage.heapUsed / 1024 / 1024);
                            document.getElementById('memoryUsage').textContent = `${memoryMB} MB`;

                            const badge = document.querySelector('#memoryBadge');
                            if (badge) {
                                badge.className = memoryMB > 500 ? 'badge badge-warning' : 'badge badge-success';
                                badge.textContent = memoryMB > 500 ? '주의' : '정상';
                            }

                            document.getElementById('activeConnections').textContent = data.system.activeConnections || 0;
                        }

                        if (data.cluster && data.cluster.nodes) {
                            const nodesContainer = document.getElementById('nodesContainer');
                            const nodes = data.cluster.nodes;
                            if (nodes.length === 0) {
                                nodesContainer.innerHTML = `<p class="text-muted text-center">등록된 노드가 없습니다</p>`;
                            } else {
                                nodesContainer.innerHTML = nodes.map(node => `
                            <div class="node-card">
                                <div class="node-header">
                                    <span class="node-name">${esc(node.name || node.id)}</span>
                                    <span class="status-dot ${node.status === 'online' ? 'online' : 'offline'}"></span>
                                </div>
                                <div class="node-stats">
                                    <span class="text-muted">${node.latency ? esc(node.latency + 'ms') : '-'}</span>
                                </div>
                            </div>
                        `).join('');
                            }
                        }
                    } catch (error) {
                        console.error('시스템 메트릭 로드 실패:', error);
                    }
                }

                // --- Token Monitoring Logic ---
                // 변경 이력 (2026-05-19): loadKeyStatus() 제거 — Ollama 시절 API key 풀 회전이
                // LiteLLM 마이그레이션 후 dead. 비용/할당량/사용량 차트만 유지.
                async function loadMonitoringData() {
                    await loadChartJs();
                    await Promise.all([
                        loadQuotaStatus(),
                        loadSummary(),
                        loadCosts(),
                        loadHourlyChart(),
                        loadDailyChart()
                    ]);
                }

                // loadKeyStatus() 제거됨 (2026-05-19): LiteLLM 마이그레이션 후 API key 풀 회전 dead.

                // 할당량 상태
                async function loadQuotaStatus() {
                    try {
                        const res = await window.authFetch(API_ENDPOINTS.MONITORING_QUOTA);
                        const rawData = await res.json();
                        const data = rawData.data || rawData;
                        if (!data || !data.hourly) { return; }

                        const container = document.getElementById('quotaSection');

                        // backend 응답 형식: { hourly, weekly } — daily 는 없음
                        // percentage 는 백엔드에 없으므로 used/limit 으로 계산
                        const items = [
                            { label: '시간당', data: data.hourly },
                            { label: '주간', data: data.weekly }
                        ].filter(it => it.data && typeof it.data.used === 'number');

                        container.innerHTML = items.map(item => {
                            const used = item.data.used;
                            const limit = item.data.limit || 0;
                            const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
                            return `
                    <div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span class="text-sm font-medium">${esc(item.label)} (${esc(used)}/${esc(limit)})</span>
                            <span class="text-sm font-bold">${pct}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill ${getProgressClass(pct)}"
                                 data-width="${Math.min(pct, 100)}"></div>
                        </div>
                    </div>
                `;
                        }).join('');
                        container.querySelectorAll('.progress-fill[data-width]').forEach(node => {
                            node.style.width = node.dataset.width + '%';
                        });

                        // 경고 배지 — 백엔드에 warningLevel 이 없으므로 hourly 사용률로 계산
                        const badge = document.getElementById('quotaWarningBadge');
                        if (badge) {
                            const hUsed = data.hourly?.used || 0;
                            const hLimit = data.hourly?.limit || 0;
                            const hPct = hLimit > 0 ? (hUsed / hLimit) * 100 : 0;
                            const level = hPct >= 90 ? 'danger' : hPct >= 70 ? 'warning' : 'safe';
                            badge.className = `badge ${level === 'safe' ? 'badge-success' : level === 'warning' ? 'badge-warning' : 'badge-danger'}`;
                            badge.textContent = level === 'safe' ? '정상' : (level === 'warning' ? '주의' : '위험');
                        }

                    } catch (e) { console.error(e); }
                }

                // 통계 요약 (오늘)
                async function loadSummary() {
                    try {
                        const res = await window.authFetch(API_ENDPOINTS.MONITORING_SUMMARY);
                        const rawData = await res.json();
                        const data = rawData.data || rawData;
                        if (!data || !data.today) { return; }

                        document.getElementById('todayRequests').textContent = data.today.totalRequests.toLocaleString();
                        document.getElementById('todayTokens').textContent = `${formatTokens(data.today.totalTokens)} 토큰`;
                    } catch (e) { console.error(e); }
                }

                // 비용
                async function loadCosts() {
                    try {
                        const res = await window.authFetch(API_ENDPOINTS.MONITORING_COSTS);
                        const rawData = await res.json();
                        const data = rawData.data || rawData;
                        if (!data || !data.today) { return; }

                        document.getElementById('todayCost').textContent = data.today.totalCost.toFixed(4);
                        document.getElementById('costDetails').textContent =
                            `요청: ${data.today.totalRequests}회 | 토큰: ${formatTokens(data.today.totalTokens)}`;
                    } catch (e) { console.error(e); }
                }

                // 시간별 차트
                async function loadHourlyChart() {
                    try {
                        const res = await window.authFetch(API_ENDPOINTS.MONITORING_USAGE_HOURLY);
                        const rawData = await res.json();
                        const data = rawData.data || rawData;
                        if (typeof Chart === 'undefined' || !data || !data.labels) { return; }
                        const ctx = document.getElementById('hourlyChart').getContext('2d');

                        if (hourlyChart) hourlyChart.destroy();

                        hourlyChart = new Chart(ctx, {
                            type: 'bar',
                            data: {
                                labels: data.labels,
                                datasets: [{
                                    label: '요청 수',
                                    data: data.datasets.requests,
                                    backgroundColor: 'rgba(137, 180, 250, 0.6)',
                                    borderColor: 'rgba(137, 180, 250, 1)',
                                    borderWidth: 1,
                                    borderRadius: 4
                                }]
                            },
                            options: getChartOptions()
                        });
                    } catch (e) { console.error(e); }
                }

                // 일간 차트
                async function loadDailyChart() {
                    try {
                        const res = await window.authFetch(API_ENDPOINTS.MONITORING_USAGE_DAILY + '?days=7');
                        const rawData = await res.json();
                        const data = rawData.data || rawData;
                        if (typeof Chart === 'undefined' || !data || !data.labels) { return; }
                        const ctx = document.getElementById('dailyChart').getContext('2d');

                        if (dailyChart) dailyChart.destroy();

                        dailyChart = new Chart(ctx, {
                            type: 'line',
                            data: {
                                labels: data.labels,
                                datasets: [
                                    {
                                        label: '요청 수',
                                        data: data.datasets.requests,
                                        borderColor: 'rgba(137, 180, 250, 1)',
                                        backgroundColor: 'rgba(137, 180, 250, 0.2)',
                                        fill: true,
                                        tension: 0.4
                                    },
                                    {
                                        label: '에러',
                                        data: data.datasets.errors,
                                        borderColor: 'rgba(243, 139, 168, 1)',
                                        backgroundColor: 'rgba(243, 139, 168, 0.2)',
                                        fill: true,
                                        tension: 0.4
                                    }
                                ]
                            },
                            options: getChartOptions()
                        });
                    } catch (e) { console.error(e); }
                }

                // 차트 옵션 공통
                function getChartOptions() {
                    return {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false } // 깔끔하게 레전드 숨김
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: { color: 'rgba(255,255,255,0.05)' },
                                ticks: { color: '#a6adc8' }
                            },
                            x: {
                                grid: { display: false },
                                ticks: { color: '#a6adc8' }
                            }
                        }
                    };
                }

                // resetKeys() 제거됨 (2026-05-19): LiteLLM 마이그레이션 후 dead.

                // 유틸리티
                function getProgressClass(percentage) {
                    if (percentage >= 90) return 'critical';
                    if (percentage >= 70) return 'warning';
                    return 'safe';
                }

                function formatTokens(tokens) {
                    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
                    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
                    return tokens.toString();
                }

                // Expose onclick-referenced functions globally
                if (typeof loadAllData === 'function') window.loadAllData = loadAllData;
            } catch (e) {
                console.error('[PageModule:admin-metrics] init error:', e);
            }
        },

        /**
         * 페이지 정리 - 인터벌/타임아웃 해제 및 전역 함수 제거
         * @returns {void}
         */
        cleanup: function () {
            _intervals.forEach(function (id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function (id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
            try { delete window.loadAllData; } catch (e) { }
        }
    };

const { getHTML, init, cleanup } = window.PageModules['admin-metrics'];
export default { getHTML, init, cleanup };
