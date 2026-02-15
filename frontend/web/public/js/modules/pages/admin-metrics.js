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
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    var _intervals = [];
    /** @type {number[]} setTimeout ID 배열 (cleanup용) */
    var _timeouts = [];
    /**
     * HTML 이스케이프 헬퍼
     * @param {string} s - 이스케이프할 문자열
     * @returns {string} 이스케이프된 문자열
     */
    function esc(s) { var d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    window.PageModules['admin-metrics'] = {
        /**
         * 페이지 HTML 문자열 반환
         * @returns {string} 시스템 대시보드 HTML (스타일 + 차트 컨테이너 포함)
         */
        getHTML: function() {
            return '<div class="page-admin-metrics">' +
                '<style data-spa-style="admin-metrics">' +
                "/* 토큰 모니터링 전용 스타일 추가 */\n        .cost-display {\n            font-size: 1.8rem;\n            font-weight: 700;\n            color: var(--accent-primary);\n            text-align: center;\n            margin: 10px 0;\n        }\n\n        .cost-currency {\n            font-size: 1rem;\n            opacity: 0.7;\n        }\n\n        .progress-bar {\n            height: 8px;\n            background: var(--bg-tertiary);\n            border-radius: 4px;\n            overflow: hidden;\n            margin-top: 5px;\n        }\n\n        .progress-fill {\n            height: 100%;\n            border-radius: 4px;\n            transition: width 0.5s ease;\n        }\n\n        .progress-fill.safe {\n            background: var(--success);\n        }\n\n        .progress-fill.warning {\n            background: var(--warning);\n        }\n\n        .progress-fill.critical {\n            background: var(--danger);\n        }\n\n        .chart-container-custom {\n            position: relative;\n            height: 250px;\n            width: 100%;\n        }\n\n        .key-item {\n            padding: 12px;\n            border-radius: 8px;\n            background: var(--bg-secondary);\n            border: 1px solid var(--border-light);\n            margin-bottom: 8px;\n            display: flex;\n            justify-content: space-between;\n            align-items: center;\n        }\n\n        .key-item.active {\n            border-color: var(--success);\n            background: rgba(var(--success-rgb), 0.05);\n            /* 근사치 */\n        }\n\n        .key-item.warning {\n            border-color: var(--warning);\n        }\n\n        .monitoring-section {\n            margin-top: var(--space-8);\n        }\n\n        .card-icon {\n            font-size: 1.2rem;\n            margin-left: auto;\n        }" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\">📊 통합 시스템 대시보드</h1>\n                            <p class=\"page-subtitle\" id=\"lastUpdated\">시스템 상태 및 API 토큰 모니터링</p>\n                        </div>\n                        <div class=\"page-actions\">\n                            <button class=\"btn btn-primary\" onclick=\"loadAllData()\">\n                                🔄 새로고침\n                            </button>\n                        </div>\n                    </header>\n\n                    <!-- 1. System Metrics (기존) -->\n                    <div class=\"dashboard-grid\">\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">시스템 업타임</span>\n                                <span class=\"status-dot online\"></span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"uptime\">0시간</div>\n                        </div>\n\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">메모리 사용량</span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"memoryUsage\">0 MB</div>\n                            <div class=\"metric-card-change\" id=\"memoryBadgeSpan\"><span class=\"badge badge-success\"\n                                    id=\"memoryBadge\">정상</span></div>\n                        </div>\n\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">활성 연결</span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"activeConnections\">0</div>\n                        </div>\n\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-header\">\n                                <span class=\"metric-card-title\">오늘 요청</span>\n                            </div>\n                            <div class=\"metric-card-value\" id=\"todayRequests\">0</div>\n                            <div class=\"metric-card-change\" id=\"todayTokens\">0 토큰</div>\n                        </div>\n                    </div>\n\n                    <!-- 2. API Key Monitoring (신규) -->\n                    <div class=\"monitoring-section\">\n                        <div class=\"section-header\">\n                            <span class=\"section-icon\">🔐</span>\n                            <span class=\"section-title\">API 키 상태 및 모니터링</span>\n                        </div>\n\n                        <div class=\"dashboard-grid\">\n                            <!-- API Keys Status -->\n                            <div class=\"card\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">API 키 로테이션</span>\n                                    <span class=\"card-icon\">🔑</span>\n                                </div>\n                                <div id=\"keyStatusContainer\" style=\"padding: 10px;\">\n                                    <div class=\"text-muted\">로딩 중...</div>\n                                </div>\n                                <div class=\"card-footer\"\n                                    style=\"padding: 10px; border-top: 1px solid var(--border-light);\">\n                                    <button class=\"btn btn-sm btn-outline\" onclick=\"resetKeys()\" style=\"width: 100%;\">키\n                                        상태 리셋</button>\n                                </div>\n                            </div>\n\n                            <!-- Cost Tracker -->\n                            <div class=\"card\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">오늘 예상 비용</span>\n                                    <span class=\"card-icon\">💰</span>\n                                </div>\n                                <div class=\"card-body\"\n                                    style=\"display: flex; flex-direction: column; justify-content: center; height: 150px;\">\n                                    <div class=\"cost-display\">\n                                        <span class=\"cost-currency\">$</span>\n                                        <span id=\"todayCost\">0.0000</span>\n                                    </div>\n                                    <div class=\"text-center text-muted text-sm\" id=\"costDetails\">\n                                        데이터 집계 중...\n                                    </div>\n                                </div>\n                            </div>\n\n                            <!-- Quota Status -->\n                            <div class=\"card\" style=\"grid-column: span 2;\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">할당량 현황</span>\n                                    <span class=\"badge\" id=\"quotaWarningBadge\">정상</span>\n                                </div>\n                                <div id=\"quotaSection\" class=\"card-body\"\n                                    style=\"display: flex; flex-direction: column; gap: 15px;\">\n                                    <!-- 로딩 중 -->\n                                </div>\n                            </div>\n                        </div>\n                    </div>\n\n                    <!-- 3. Usage Charts (신규 - Chart.js) -->\n                    <div class=\"monitoring-section\">\n                        <div class=\"grid-2\">\n                            <!-- Hourly Chart -->\n                            <div class=\"card\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">시간별 요청 (오늘)</span>\n                                </div>\n                                <div class=\"card-body\">\n                                    <div class=\"chart-container-custom\">\n                                        <canvas id=\"hourlyChart\"></canvas>\n                                    </div>\n                                </div>\n                            </div>\n\n                            <!-- Daily Chart -->\n                            <div class=\"card\">\n                                <div class=\"card-header\">\n                                    <span class=\"card-title\">일간 트래픽 (최근 7일)</span>\n                                </div>\n                                <div class=\"card-body\">\n                                    <div class=\"chart-container-custom\">\n                                        <canvas id=\"dailyChart\"></canvas>\n                                    </div>\n                                </div>\n                            </div>\n                        </div>\n                    </div>\n\n                    <!-- 4. Cluster Nodes (기존) -->\n                    <div class=\"monitoring-section\" style=\"margin-bottom: 50px;\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\">클러스터 노드 정보</span>\n                            </div>\n                            <div class=\"node-grid\" id=\"nodesContainer\" style=\"padding: var(--space-4);\">\n                                <div class=\"text-muted text-center\">노드 정보 로딩 중...</div>\n                            </div>\n                        </div>\n                    </div>\n\n                </div>\n            </div>\n\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        /**
         * 페이지 초기화 - 시스템 메트릭 및 토큰 모니터링 데이터 로드, 30초 자동 갱신 시작
         * @returns {void}
         */
        init: function() {
            try {
                // 전역 차트 인스턴스
        let hourlyChart = null;
        let dailyChart = null;

        // 1. 초기 로드
        loadAllData();

        // 2. 주기적 갱신 (interval tracked in _intervals for cleanup)
        (function(fn,ms){var id=setInterval(fn,ms);_intervals.push(id);return id})(loadAllData, 30000); // 30초

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
                 const response = await fetch('/api/metrics', {
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
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
                                    <span class="text-muted">${node.latency ? node.latency + 'ms' : '-'}</span>
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
        async function loadMonitoringData() {
            await Promise.all([
                loadKeyStatus(),
                loadQuotaStatus(),
                loadSummary(),
                loadCosts(),
                loadHourlyChart(),
                loadDailyChart()
            ]);
        }

        // API 키 상태
         async function loadKeyStatus() {
             try {
                 const res = await fetch('/api/monitoring/keys', {
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
                 const rawData = await res.json();
                const data = rawData.data || rawData;

                const container = document.getElementById('keyStatusContainer');
                container.innerHTML = data.keys.map(key => `
                    <div class="key-item ${key.isActive ? 'active' : ''} ${key.failCount > 0 ? 'warning' : ''}">
                        <div>
                            <div style="font-weight: 600; font-size: 0.9rem;">Key ${key.index}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted);">${esc(key.keyId)}</div>
                        </div>
                        <div style="text-align: right;">
                             <span class="badge ${key.isActive ? 'badge-success' : (key.failCount > 0 ? 'badge-warning' : 'badge')}">
                                ${key.isActive ? '활성' : (key.failCount > 0 ? `실패 ${key.failCount}` : '대기')}
                             </span>
                        </div>
                    </div>
                `).join('');
            } catch (e) { console.error(e); }
        }

         // 할당량 상태
         async function loadQuotaStatus() {
             try {
                 const res = await fetch('/api/monitoring/quota', {
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
                 const rawData = await res.json();
                const data = rawData.data || rawData;

                const container = document.getElementById('quotaSection');

                // 시간, 주간, 일간 (순서대로)
                const items = [
                    { label: '시간당', data: data.hourly },
                    { label: '일간 (추정)', data: data.daily },
                    { label: '주간', data: data.weekly }
                ];

                container.innerHTML = items.map(item => `
                    <div>
                        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                            <span class="text-sm font-medium">${item.label} (${item.data.used}/${item.data.limit})</span>
                            <span class="text-sm font-bold">${item.data.percentage}%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill ${getProgressClass(item.data.percentage)}" 
                                 style="width: ${Math.min(item.data.percentage, 100)}%"></div>
                        </div>
                    </div>
                `).join('');

                // 경고 배지
                const badge = document.getElementById('quotaWarningBadge');
                badge.className = `badge ${data.warningLevel === 'safe' ? 'badge-success' : data.warningLevel === 'warning' ? 'badge-warning' : 'badge-danger'}`;
                badge.textContent = data.warningLevel === 'safe' ? '정상' : (data.warningLevel === 'warning' ? '주의' : '위험');

            } catch (e) { console.error(e); }
        }

         // 통계 요약 (오늘)
         async function loadSummary() {
             try {
                 const res = await fetch('/api/monitoring/summary', {
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
                 const rawData = await res.json();
                const data = rawData.data || rawData;

                document.getElementById('todayRequests').textContent = data.today.totalRequests.toLocaleString();
                document.getElementById('todayTokens').textContent = `${formatTokens(data.today.totalTokens)} 토큰`;
            } catch (e) { console.error(e); }
        }

         // 비용
         async function loadCosts() {
             try {
                 const res = await fetch('/api/monitoring/costs', {
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
                const rawData = await res.json();
                const data = rawData.data || rawData;

                document.getElementById('todayCost').textContent = data.today.totalCost.toFixed(4);
                document.getElementById('costDetails').textContent =
                    `요청: ${data.today.totalRequests}회 | 토큰: ${formatTokens(data.today.totalTokens)}`;
            } catch (e) { console.error(e); }
        }

         // 시간별 차트
         async function loadHourlyChart() {
             try {
                 const res = await fetch('/api/monitoring/usage/hourly', {
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
                 const rawData = await res.json();
                const data = rawData.data || rawData;
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
                 const res = await fetch('/api/monitoring/usage/daily?days=7', {
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
                 const rawData = await res.json();
                const data = rawData.data || rawData;
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

        // 키 리셋
         async function resetKeys() {
             if (!confirm('모든 API 키 상태를 초기화하시겠습니까?')) return;
             try {
                 await fetch('/api/monitoring/keys/reset', {
                     method: 'POST',
                     credentials: 'include'  // 🔒 httpOnly 쿠키 포함
                 });
                (typeof showToast === 'function' ? showToast('초기화되었습니다.', 'warning') : console.warn('초기화되었습니다.'));
                loadKeyStatus();
            } catch (e) { (typeof showToast === 'function' ? showToast('실패: ' + e.message, 'warning') : console.warn('실패: ' + e.message)); }
        }

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
                if (typeof resetKeys === 'function') window.resetKeys = resetKeys;
            } catch(e) {
                console.error('[PageModule:admin-metrics] init error:', e);
            }
        },

        /**
         * 페이지 정리 - 인터벌/타임아웃 해제 및 전역 함수 제거
         * @returns {void}
         */
        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.loadAllData; } catch(e) {}
                try { delete window.resetKeys; } catch(e) {}
        }
    };
})();
