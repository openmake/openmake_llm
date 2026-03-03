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
        function fmtMs(n) { return n != null ? `${Math.round(n)}ms` : '-'; }

        let usageData = null;
        let currentPeriod = 'today';

        // 기간 탭
        document.getElementById('periodTabs').addEventListener('click', e => {
            const tab = e.target.closest('.period-tab');
            if (!tab) return;
            document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentPeriod = tab.dataset.period;
            renderStats();
        });

        function renderStats() {
            if (!usageData) return;
            const d = usageData[currentPeriod] || usageData.today || {};
            document.getElementById('totalReqs').textContent = fmtNum(d.totalRequests);
            document.getElementById('totalTokens').textContent = fmtNum(d.totalTokens);
            document.getElementById('totalErrors').textContent = fmtNum(d.totalErrors);
            document.getElementById('avgResponse').textContent = fmtMs(d.avgResponseTime);
        }

        function renderDaily(daily) {
            const c = document.getElementById('dailyContainer');
            if (!daily || daily.length === 0) {
                c.innerHTML = '<div class="empty-state"><h2>데이터 없음</h2><p>아직 일간 통계 데이터가 없습니다.</p></div>';
                return;
            }
            c.innerHTML = `<table class="data-table">
                <thead><tr><th>날짜</th><th>요청</th><th>토큰</th><th>에러</th><th>평균 응답시간</th></tr></thead>
                <tbody>${daily.map(r => `<tr>
                    <td>${esc(r.date || '-')}</td>
                    <td>${fmtNum(r.totalRequests || r.requests)}</td>
                    <td>${fmtNum(r.totalTokens || r.tokens)}</td>
                    <td>${fmtNum(r.totalErrors || r.errors)}</td>
                    <td>${fmtMs(r.avgResponseTime)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }

        async function loadData() {
            try {
                const [usageRes, dailyRes] = await Promise.all([
                    authFetch('/api/usage'),
                    authFetch('/api/usage/daily?days=14')
                ]);
                const usage = await usageRes.json();
                const daily = await dailyRes.json();
                if (usage.success) { usageData = usage.data; renderStats(); }
                if (daily.success) { renderDaily(daily.data.daily || daily.data); }
                document.getElementById('refreshInfo').textContent = `마지막 업데이트: ${new Date().toLocaleTimeString('ko-KR')}`;
            } catch (err) {
                console.error('사용량 로드 실패:', err);
                showToast('데이터 로드 실패', 'error');
            }
        }

        loadData();
        setInterval(loadData, 30000);