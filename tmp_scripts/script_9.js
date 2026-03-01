const API_BASE = window.location.origin;
        let allSessions = [];
        let searchTimeout;

        // 인증 체크
        (function checkAuthAccess() {
            const user = localStorage.getItem('user');
            const isGuest = localStorage.getItem('isGuest') === 'true';
            if (!user || isGuest) {
                alert('이 페이지는 로그인이 필요합니다.');
                window.location.href = '/login.html';
            }
        })();

        async function loadSessions() {
            const list = document.getElementById('sessionsList');
            // 로딩 표시가 없으면 추가
            if (!allSessions.length) {
                list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔄</div><div class="empty-state-title">대화 기록을 불러오는 중...</div></div>';
            }

            try {
                const res = await fetch('/api/chat/sessions?limit=100', { credentials: 'include' });
                const data = await res.json();
                const payload = data.data || data;

                if (data.success) {
                    allSessions = payload.sessions;
                    renderSessions();
                } else {
                    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><div class="empty-state-title">데이터를 불러올 수 없습니다</div></div>';
                }
            } catch (e) {
                console.error('세션 로드 실패:', e);
                list.innerHTML = '<div class="empty-state"><div class="empty-state-title">서버 연결 오류</div></div>';
            }
        }

        function renderSessions() {
            const list = document.getElementById('sessionsList');
            const query = document.getElementById('searchQuery').value.toLowerCase();
            const dateFilter = document.getElementById('filterDate').value;
            const sortOrder = document.getElementById('sortOrder').value; // 'desc' or 'asc'

            let filtered = allSessions.filter(s => {
                // 검색 필터 (제목)
                if (query && !s.title.toLowerCase().includes(query)) return false;
                // 날짜 필터
                if (dateFilter) {
                    const sDate = new Date(s.createdAt).toISOString().split('T')[0];
                    if (sDate !== dateFilter) return false;
                }
                return true;
            });

            // 정렬
            filtered.sort((a, b) => {
                const timeA = new Date(a.updatedAt || a.createdAt).getTime();
                const timeB = new Date(b.updatedAt || b.createdAt).getTime();
                return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
            });

            if (filtered.length === 0) {
                list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-title">대화 기록이 없습니다</div></div>';
                return;
            }

            list.innerHTML = filtered.map(s => `
                <div class="session-card" onclick="goToSession('${s.id}')">
                    <div class="session-header">
                        <span class="session-title">${escapeHtml(s.title || '새 대화')}</span>
                        <span class="session-meta">${formatDate(s.updatedAt || s.createdAt)}</span>
                    </div>
                    <div class="session-meta">
                        <span>💬 ${s.model || 'Unknown Model'}</span>
                    </div>
                    ${s.preview ? `<div class="session-preview">${escapeHtml(s.preview)}</div>` : ''}
                </div>
            `).join('');
        }

        function goToSession(id) {
            // 메인 채팅 화면으로 이동하며 세션 ID 전달
            window.location.href = `/?sessionId=${id}`;
        }

        function formatDate(dateStr) {
            const date = new Date(dateStr);
            return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        }

        function escapeHtml(text) {
            if (!text) return '';
            return text
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function debounceSearch() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(renderSessions, 300); // API 재호출 대신 렌더링만 갱신
        }

        function exportHistory() {
            if (allSessions.length === 0) {
                alert('내보낼 데이터가 없습니다.');
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allSessions, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", "chat_history.json");
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        }

        loadSessions();