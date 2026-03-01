function authFetch(url, opts = {}) {
            opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' };
            opts.credentials = 'include';
            return fetch(url, opts);
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
        setInterval(loadData, 60000);