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

        // 알림 히스토리는 현재 전용 API가 없으므로 데모 데이터 표시
        // 향후 GET /api/alerts/history 구현 시 연동
        allAlerts = [];
        document.getElementById('totalAlerts').textContent = allAlerts.length;
        renderAlerts();