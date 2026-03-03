function authFetch(url, options = {}) {
            const headers = { 'Content-Type': 'application/json', ...options.headers };
            return fetch(url, { ...options, headers, credentials: 'include' }).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        const statusLabels = { pending:'대기중', running:'진행중', completed:'완료', failed:'실패', cancelled:'취소됨' };
        const depthLabels = { quick:'빠른 검색', standard:'표준', deep:'심층' };
        let currentSessionId = null;

        async function loadSessions() {
            try {
                const res = await authFetch('/api/research/sessions');
                const sessions = res.data || res || [];
                const el = document.getElementById('sessionList');
                if (!sessions.length) {
                    el.innerHTML = '<div class="empty-state"><h2>연구 세션이 없습니다</h2><p>위에서 주제를 입력하고 연구를 시작하세요.</p></div>';
                    return;
                }
                el.innerHTML = sessions.map(s => `
                    <div class="session-card" onclick="openSession('${s.id}')">
                        <h3>${esc(s.topic)}</h3>
                        <div class="session-meta">
                            <span class="badge badge-${s.status}">${statusLabels[s.status] || s.status}</span>
                            <span>${depthLabels[s.depth] || s.depth}</span>
                            <span>${new Date(s.created_at).toLocaleDateString('ko')}</span>
                        </div>
                        ${s.progress > 0 ? `<div class="progress-bar"><div class="progress-fill" style="width:${s.progress}%"></div></div>` : ''}
                    </div>`).join('');
            } catch (e) { showToast('세션 로드 실패', 'error'); }
        }

        async function createSession() {
            const topic = document.getElementById('topic').value.trim();
            if (!topic) { showToast('주제를 입력하세요', 'error'); return; }
            try {
                await authFetch('/api/research/sessions', { method: 'POST', body: JSON.stringify({ topic, depth: document.getElementById('depth').value }) });
                document.getElementById('topic').value = '';
                showToast('연구가 시작되었습니다');
                loadSessions();
            } catch (e) { showToast('생성 실패', 'error'); }
        }

        async function openSession(id) {
            currentSessionId = id;
            document.getElementById('detailModal').classList.add('open');
            document.getElementById('detailContent').innerHTML = '<div class="loading">불러오는 중...</div>';
            try {
                const res = await authFetch('/api/research/sessions/' + id);
                const s = res.data || res;
                const stepsRes = await authFetch('/api/research/sessions/' + id + '/steps');
                const steps = stepsRes.data || stepsRes || [];

                document.getElementById('detailTitle').textContent = s.topic;
                let html = `
                    <div class="session-meta" style="margin-bottom:var(--space-4)">
                        <span class="badge badge-${s.status}">${statusLabels[s.status] || s.status}</span>
                        <span>${depthLabels[s.depth] || s.depth}</span>
                        <span>진행률: ${s.progress || 0}%</span>
                    </div>`;
                if (s.summary) html += `<div class="detail-section"><h3>요약</h3><p>${esc(s.summary)}</p></div>`;
                const findings = s.key_findings || [];
                if (findings.length) html += `<div class="detail-section"><h3>주요 발견</h3><ul>${findings.map(f => '<li>' + esc(f) + '</li>').join('')}</ul></div>`;
                const sources = s.sources || [];
                if (sources.length) html += `<div class="detail-section"><h3>출처</h3><ul>${sources.map(src => '<li>' + esc(typeof src === 'string' ? src : JSON.stringify(src)) + '</li>').join('')}</ul></div>`;
                if (steps.length) {
                    html += `<div class="detail-section"><h3>연구 단계</h3><div class="steps-timeline">`;
                    html += steps.map(st => `
                        <div class="step-item">
                            <span class="step-num">#${st.step_number}</span> <span class="step-type">${esc(st.step_type)}</span>
                            ${st.query ? `<div style="color:var(--text-secondary);margin-top:var(--space-1)">${esc(st.query)}</div>` : ''}
                            ${st.result ? `<div class="step-result">${esc(st.result)}</div>` : ''}
                        </div>`).join('');
                    html += '</div></div>';
                }
                document.getElementById('detailContent').innerHTML = html;
            } catch (e) { document.getElementById('detailContent').innerHTML = '<div class="empty-state"><p>로드 실패</p></div>'; }
        }

        function closeDetail() { document.getElementById('detailModal').classList.remove('open'); }

        async function deleteSession() {
            if (!currentSessionId || !confirm('이 연구 세션을 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/research/sessions/' + currentSessionId, { method: 'DELETE' });
                showToast('세션이 삭제되었습니다'); closeDetail(); loadSessions();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        document.getElementById('topic').addEventListener('keydown', e => { if (e.key === 'Enter') createSession(); });
        loadSessions();