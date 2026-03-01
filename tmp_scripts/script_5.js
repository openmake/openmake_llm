const API_BASE = window.location.origin;

        // 인증 체크 (게스트/비로그인 접근 제한)
        (function checkAuthAccess() {
            const user = localStorage.getItem('user');
            const isGuest = localStorage.getItem('isGuest') === 'true';
            if (!user || isGuest) {
                alert('이 페이지는 로그인이 필요합니다.');
                window.location.href = '/login.html';
            }
        })();

        async function loadClusterStatus() {
            try {
                const res = await fetch(`${API_BASE}/api/cluster/status`);
                const data = await res.json();
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
                        <span class="cluster-name">${node.name || node.id}</span>
                        <span class="status-badge ${node.status === 'online' ? 'online' : 'offline'}">
                            <span class="status-dot ${node.status === 'online' ? 'online' : 'offline'}"></span>
                            ${node.status === 'online' ? '온라인' : '오프라인'}
                        </span>
                    </div>
                    <div class="cluster-url">${node.url}</div>
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
        let clusterRefreshInterval = setInterval(loadClusterStatus, 30000);
        window.addEventListener('beforeunload', () => { if (clusterRefreshInterval) clearInterval(clusterRefreshInterval); });