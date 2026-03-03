// 전역 차트 인스턴스
        let hourlyChart = null;
        let dailyChart = null;

        document.addEventListener('DOMContentLoaded', () => {
            // 1. 초기 로드
            loadAllData();

            // 2. 주기적 갱신
            const interval = setInterval(loadAllData, 30000); // 30초

            window.addEventListener('beforeunload', () => {
                clearInterval(interval);
            });
        });

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
                const response = await fetch('/api/metrics');
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
                                    <span class="node-name">${node.name || node.id}</span>
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
                const res = await fetch('/api/monitoring/keys');
                const rawData = await res.json();
                const data = rawData.data || rawData;

                const container = document.getElementById('keyStatusContainer');
                container.innerHTML = data.keys.map(key => `
                    <div class="key-item ${key.isActive ? 'active' : ''} ${key.failCount > 0 ? 'warning' : ''}">
                        <div>
                            <div style="font-weight: 600; font-size: 0.9rem;">Key ${key.index}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted);">${key.keyId}</div>
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
                const res = await fetch('/api/monitoring/quota');
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
                const res = await fetch('/api/monitoring/summary');
                const rawData = await res.json();
                const data = rawData.data || rawData;

                document.getElementById('todayRequests').textContent = data.today.totalRequests.toLocaleString();
                document.getElementById('todayTokens').textContent = `${formatTokens(data.today.totalTokens)} 토큰`;
            } catch (e) { console.error(e); }
        }

        // 비용
        async function loadCosts() {
            try {
                const res = await fetch('/api/monitoring/costs');
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
                const res = await fetch('/api/monitoring/usage/hourly');
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
                const res = await fetch('/api/monitoring/usage/daily?days=7');
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
                await fetch('/api/monitoring/keys/reset', { method: 'POST' });
                alert('초기화되었습니다.');
                loadKeyStatus();
            } catch (e) { alert('실패: ' + e.message); }
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