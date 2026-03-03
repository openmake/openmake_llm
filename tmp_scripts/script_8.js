function authFetch(url, opts = {}) {
            opts.headers = { ...(opts.headers || {}), 'Content-Type': 'application/json' };
            return fetch(url, { ...opts, credentials: 'include' });
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
        setInterval(loadData, 60000);