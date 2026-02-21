/**
 * ============================================
 * Admin Page - 관리자 대시보드
 * ============================================
 * 사용자 관리(CRUD), 대화 기록 조회/내보내기, 사용 통계 등
 * 관리자 전용 기능을 제공하는 SPA 페이지 모듈입니다.
 * 관리자 인증 검증 후 탭 기반 UI로 각 기능에 접근합니다.
 *
 * @module pages/admin
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    /** @type {number[]} setInterval ID 배열 (cleanup용) */
    var _intervals = [];
    /** @type {number[]} setTimeout ID 배열 (cleanup용) */
    var _timeouts = [];

    window.PageModules['admin'] = {
        /**
         * 페이지 HTML 문자열 반환
         * @returns {string} 관리자 대시보드 HTML (스타일 포함)
         */
        getHTML: function() {
            return '<div class="page-admin">' +
                '<style data-spa-style="admin">' +
                "/* Admin-specific styles */\n        .badge-admin {\n            background: var(--bg-tertiary);\n            color: #f87171;\n            border: 2px solid #ef4444;\n        }\n\n        .badge-user {\n            background: var(--bg-tertiary);\n            color: #4ade80;\n            border: 2px solid #22c55e;\n        }\n\n        .badge-guest {\n            background: var(--bg-tertiary);\n            color: #9ca3af;\n            border: 2px solid #9ca3af;\n        }\n\n        .badge-active {\n            background: var(--success-light);\n            color: var(--success);\n        }\n\n        .badge-inactive {\n            background: var(--danger-light);\n            color: var(--danger);\n        }\n\n        .toast {\n            position: fixed;\n            bottom: 20px;\n            right: 20px;\n            padding: 12px 20px;\n            border-radius: var(--radius-md);\n            color: white;\n            font-size: var(--font-size-sm);\n            z-index: 1001;\n            animation: slideIn 0.3s ease;\n        }\n\n        .toast.success {\n            background: var(--success);\n        }\n\n        .toast.error {\n            background: var(--danger);\n        }\n\n        @keyframes slideIn {\n            from {\n                transform: translateX(100%);\n                opacity: 0;\n            }\n\n            to {\n                transform: translateX(0);\n                opacity: 1;\n            }\n        }" +
                '<\/style>' +
                "<div class=\"page-content\">\n                <div class=\"container container-xl\">\n                    <header class=\"page-header\">\n                        <div>\n                            <h1 class=\"page-title page-title-gradient\">👥 관리자 대시보드</h1>\n                            <p class=\"page-subtitle\">사용자 및 대화 관리</p>\n                        </div>\n                        <div class=\"page-actions\">\n                            <a href=\"/\" class=\"btn btn-secondary\">← 채팅으로 돌아가기</a>\n                        </div>\n                    </header>\n\n                    <div class=\"tabs\" style=\"margin-bottom: var(--space-6); width: fit-content;\">\n                        <button class=\"tab active\" onclick=\"switchTab('users')\">👥 사용자 관리</button>\n                        <button class=\"tab\" onclick=\"switchTab('conversations')\">💬 대화 기록</button>\n                        <button class=\"tab\" onclick=\"switchTab('stats')\">📊 통계</button>\n                    </div>\n\n                    <!-- Stats Cards -->\n                    <div class=\"dashboard-grid\" style=\"margin-bottom: var(--space-8);\">\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statTotalUsers\">0</div>\n                            <div class=\"text-muted text-sm\">총 사용자</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statActiveUsers\">0</div>\n                            <div class=\"text-muted text-sm\">활성 사용자</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statAdmins\">0</div>\n                            <div class=\"text-muted text-sm\">관리자</div>\n                        </div>\n                        <div class=\"metric-card card\">\n                            <div class=\"metric-card-value\" id=\"statTodayQueries\">0</div>\n                            <div class=\"text-muted text-sm\">오늘 질문</div>\n                        </div>\n                    </div>\n\n                    <!-- Users Panel -->\n                    <div id=\"usersPanel\" class=\"panel active\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\">사용자 목록</span>\n                                <button class=\"btn btn-primary btn-sm\" onclick=\"showAddUserModal()\">+ 사용자 추가</button>\n                            </div>\n                            <div class=\"search-bar\" style=\"margin-bottom: var(--space-4);\">\n                                <select id=\"filterRole\" class=\"form-select\" style=\"width: auto;\" onchange=\"loadUsers()\">\n                                    <option value=\"\">모든 역할</option>\n                                    <option value=\"admin\">관리자</option>\n                                    <option value=\"user\">일반 사용자</option>\n                                    <option value=\"guest\">게스트</option>\n                                </select>\n                                <input type=\"text\" id=\"filterSearch\" class=\"form-input\" style=\"max-width: 300px;\"\n                                    placeholder=\"이메일 검색...\" onkeyup=\"debounceSearch()\">\n                            </div>\n                            <div class=\"table-container\" style=\"border: none;\">\n                                <table class=\"data-table\">\n                                    <thead>\n                                        <tr>\n                                            <th>ID</th>\n                                            <th>이메일</th>\n                                            <th>역할</th>\n                                            <th>상태</th>\n                                            <th>가입일</th>\n                                            <th>마지막 로그인</th>\n                                            <th>작업</th>\n                                        </tr>\n                                    </thead>\n                                    <tbody id=\"usersList\"></tbody>\n                                </table>\n                            </div>\n                            <div class=\"pagination flex justify-center gap-2 mt-4\" id=\"usersPagination\"></div>\n                        </div>\n                    </div>\n\n                    <!-- Conversations Panel -->\n                    <div id=\"conversationsPanel\" class=\"panel\" style=\"display: none;\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\">대화 기록</span>\n                                <button class=\"btn btn-secondary btn-sm\" onclick=\"exportCSV()\">📥 CSV 내보내기</button>\n                            </div>\n                            <div class=\"search-bar\" style=\"margin-bottom: var(--space-4);\">\n                                <input type=\"date\" id=\"filterDate\" class=\"form-input\" style=\"width: auto;\"\n                                    onchange=\"loadConversations()\">\n                                <select id=\"filterConvRole\" class=\"form-select\" style=\"width: auto;\"\n                                    onchange=\"loadConversations()\">\n                                    <option value=\"\">모든 역할</option>\n                                    <option value=\"user\">사용자만</option>\n                                    <option value=\"assistant\">AI 응답만</option>\n                                </select>\n                                <input type=\"text\" id=\"filterConvSearch\" class=\"form-input\" style=\"max-width: 300px;\"\n                                    placeholder=\"검색어...\" onkeyup=\"debounceConvSearch()\">\n                            </div>\n                            <div class=\"table-container\" style=\"border: none;\">\n                                <table class=\"data-table\">\n                                    <thead>\n                                        <tr>\n                                            <th>시간</th>\n                                            <th>역할</th>\n                                            <th>내용</th>\n                                            <th>모델</th>\n                                        </tr>\n                                    </thead>\n                                    <tbody id=\"conversationsList\"></tbody>\n                                </table>\n                            </div>\n                            <div class=\"pagination flex justify-center gap-2 mt-4\" id=\"convPagination\"></div>\n                        </div>\n                    </div>\n\n                    <!-- Stats Panel -->\n                    <div id=\"statsPanel\" class=\"panel\" style=\"display: none;\">\n                        <div class=\"card\">\n                            <div class=\"card-header\">\n                                <span class=\"card-title\">시스템 통계</span>\n                            </div>\n                            <div class=\"card-body\">\n                                <p class=\"text-muted\">상세 통계 기능은 추후 추가 예정입니다.</p>\n                            </div>\n                        </div>\n                    </div>\n                </div>\n            </div>\n<div class=\"modal-overlay\" id=\"editUserModal\">\n        <div class=\"modal-content\">\n            <div class=\"modal-header\">\n                <h3 class=\"modal-title\" id=\"editModalTitle\">사용자 편집</h3>\n                <button class=\"modal-close\" onclick=\"closeModal()\">×</button>\n            </div>\n            <div class=\"modal-body\">\n                <input type=\"hidden\" id=\"editUserId\">\n                <div class=\"form-group\">\n                    <label class=\"form-label\">이메일</label>\n                    <input type=\"email\" id=\"editEmail\" class=\"form-input\">\n                </div>\n                <div class=\"form-group\">\n                    <label class=\"form-label\">비밀번호 (변경 시에만 입력)</label>\n                    <input type=\"password\" id=\"editPassword\" class=\"form-input\" placeholder=\"새 비밀번호\">\n                </div>\n                <div class=\"form-group\">\n                    <label class=\"form-label\">역할</label>\n                    <select id=\"editRole\" class=\"form-select\">\n                        <option value=\"user\">일반 사용자</option>\n                        <option value=\"admin\">관리자</option>\n                        <option value=\"guest\">게스트</option>\n                    </select>\n                </div>\n                <div class=\"form-group\">\n                    <label class=\"form-label\">상태</label>\n                    <select id=\"editActive\" class=\"form-select\">\n                        <option value=\"1\">활성</option>\n                        <option value=\"0\">비활성</option>\n                    </select>\n                </div>\n            </div>\n            <div class=\"modal-footer\">\n                <button class=\"btn btn-secondary\" onclick=\"closeModal()\">취소</button>\n                <button class=\"btn btn-primary\" onclick=\"saveUser()\">저장</button>\n            </div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        /**
         * 페이지 초기화 - 인증 확인 후 사용자/대화/통계 데이터 로드
         * @returns {void}
         */
        init: function() {
            try {
        let authToken = localStorage.getItem('authToken');
        const _userStr = localStorage.getItem('user');
        let currentUser = null;
        let usersPage = 1;
        let convPage = 1;
        const pageSize = 20;
        let userSearchTimeout;
        let convSearchTimeout;

        async function checkAuth() {
             if (!authToken && !_userStr) { (typeof Router !== 'undefined' && Router.navigate('/')); return false; }
             try {
                 const res = await authFetch('/api/auth/me');
                 const data = await res.json();
                 const payload = data.data || data;
                 if (!res.ok || !payload.user) throw new Error('인증 실패');
                 currentUser = payload.user;
                if (currentUser.role !== 'admin') {
                    showToast('관리자 권한이 필요합니다', 'error');
                    setTimeout(() => (typeof Router !== 'undefined' && Router.navigate('/')), 1500);
                    return false;
                }
                return true;
            } catch (e) {
                (typeof Router !== 'undefined' && Router.navigate('/'));
                return false;
            }
        }

        async function authFetch(url, options = {}) {
            return fetch(url, {
                ...options,
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}), ...(options.headers || {}) }
            });
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
            document.querySelector(`[onclick="switchTab('${tab}')"]`).classList.add('active');
            document.getElementById(`${tab}Panel`).style.display = 'block';
        }

        async function loadUsers() {
             const role = document.getElementById('filterRole').value;
             const search = document.getElementById('filterSearch').value;
             try {
                 const params = new URLSearchParams({ page: usersPage, limit: pageSize, ...(role && { role }), ...(search && { search }) });
                 const res = await authFetch(`/api/admin/users?${params}`);
                 const data = await res.json();
                 const payload = data.data || data;
                 renderUsers(payload.users || []);
                 renderPagination('usersPagination', payload.total || 0, usersPage, (p) => { usersPage = p; loadUsers(); });
             } catch (e) { showToast('사용자 목록 로드 실패', 'error'); }
         }

        function renderUsers(users) {
            const tbody = document.getElementById('usersList');
            if (users.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-4">사용자가 없습니다</td></tr>'; return; }
            tbody.innerHTML = users.map(u => `
                <tr>
                    <td>${u.id}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td><span class="badge badge-${u.role}">${getRoleName(u.role)}</span></td>
                    <td><span class="badge ${u.is_active ? 'badge-active' : 'badge-inactive'}">${u.is_active ? '활성' : '비활성'}</span></td>
                    <td>${formatDate(u.created_at)}</td>
                    <td>${u.last_login ? formatDate(u.last_login) : '-'}</td>
                    <td class="flex gap-2">
                        <button class="btn btn-secondary btn-sm" onclick="editUser('${u.id}')">편집</button>
                        ${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')">삭제</button>` : ''}
                    </td>
                </tr>
            `).join('');
        }

        function getRoleName(role) { return { admin: '관리자', user: '사용자', guest: '게스트' }[role] || role; }

        async function loadUserStats() {
             try {
                 const res = await authFetch('/api/admin/users/stats');
                 const stats = await res.json();
                 const payload = stats.data || stats;
                 document.getElementById('statTotalUsers').textContent = payload.total_users || 0;
                 document.getElementById('statActiveUsers').textContent = payload.active_users || 0;
                 document.getElementById('statAdmins').textContent = payload.admins || 0;
             } catch (e) { console.error('[Admin] 사용자 통계 로드 실패:', e); }
             try {
                 const res = await authFetch('/api/admin/stats');
                 if (res.ok) { const data = await res.json(); const payload2 = data.data || data; document.getElementById('statTodayQueries').textContent = payload2.today_queries || 0; }
             } catch (e) { console.error('[Admin] 관리 통계 로드 실패:', e); }
         }

        function showAddUserModal() {
            document.getElementById('editModalTitle').textContent = '새 사용자 추가';
            document.getElementById('editUserId').value = '';
            document.getElementById('editEmail').value = '';
            document.getElementById('editPassword').value = '';
            document.getElementById('editRole').value = 'user';
            document.getElementById('editActive').value = '1';
            document.getElementById('editUserModal').classList.add('active');
        }

         async function editUser(id) {
             try {
                 const res = await authFetch(`/api/admin/users?search=`);
                 const data = await res.json();
                 const payload = data.data || data;
                 const user = (payload.users || []).find(u => u.id === id);
                 if (!user) { showToast('사용자를 찾을 수 없습니다', 'error'); return; }
                document.getElementById('editModalTitle').textContent = '사용자 편집';
                document.getElementById('editUserId').value = user.id;
                document.getElementById('editEmail').value = user.email;
                document.getElementById('editPassword').value = '';
                document.getElementById('editRole').value = user.role;
                document.getElementById('editActive').value = user.is_active ? '1' : '0';
                document.getElementById('editUserModal').classList.add('active');
            } catch (e) { showToast('사용자 정보 로드 실패', 'error'); }
        }

        async function saveUser() {
            const id = document.getElementById('editUserId').value;
            const email = document.getElementById('editEmail').value;
            const password = document.getElementById('editPassword').value;
            const role = document.getElementById('editRole').value;
            const is_active = document.getElementById('editActive').value === '1';
            if (!email) { showToast('이메일을 입력하세요', 'error'); return; }
            try {
                if (id) {
                    await authFetch(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ email, role, is_active }) });
                    showToast('사용자 정보가 수정되었습니다', 'success');
                } else {
                    if (!password || password.length < 6) { showToast('비밀번호는 6자 이상이어야 합니다', 'error'); return; }
                    await authFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
                    showToast('사용자가 추가되었습니다', 'success');
                }
                closeModal(); loadUsers(); loadUserStats();
            } catch (e) { showToast('저장 실패: ' + e.message, 'error'); }
        }

         async function deleteUser(id) {
             if (!confirm('정말 이 사용자를 삭제하시겠습니까?')) return;
             try {
                 const res = await authFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
                 const data = await res.json();
                 if (res.ok) { showToast('사용자가 삭제되었습니다', 'success'); loadUsers(); loadUserStats(); }
                 else { 
                     const errorMsg = (data.error && typeof data.error === 'object') ? data.error.message : data.error;
                     showToast(errorMsg || '삭제 실패', 'error');
                 }
             } catch (e) { showToast('삭제 실패', 'error'); }
         }

        function closeModal() { document.getElementById('editUserModal').classList.remove('active'); }

        function debounceSearch() { clearTimeout(userSearchTimeout); userSearchTimeout = setTimeout(() => { usersPage = 1; loadUsers(); }, 300); }

         async function loadConversations() {
             const date = document.getElementById('filterDate').value;
             const role = document.getElementById('filterConvRole').value;
             const search = document.getElementById('filterConvSearch').value;
             try {
                 const params = new URLSearchParams({ page: convPage, limit: pageSize, ...(date && { date }), ...(role && { role }), ...(search && { search }) });
                 const res = await authFetch(`/api/admin/conversations?${params}`);
                 const data = await res.json();
                 const payload = data.data || data;
                 renderConversations(payload.conversations || []);
                 renderPagination('convPagination', payload.total || 0, convPage, (p) => { convPage = p; loadConversations(); });
             } catch (e) { showToast('대화 기록 로드 실패', 'error'); }
         }

        function renderConversations(conversations) {
            const tbody = document.getElementById('conversationsList');
            if (conversations.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted p-4">대화 기록이 없습니다</td></tr>'; return; }
            tbody.innerHTML = conversations.map(c => `
                <tr>
                    <td>${formatDateTime(c.created_at)}</td>
                    <td><span class="badge ${c.role === 'user' ? 'badge-user' : 'badge-info'}">${c.role}</span></td>
                    <td style="max-width:400px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(c.content?.substring(0, 100) || '')}</td>
                    <td class="text-muted text-sm">${c.model || '-'}</td>
                </tr>
            `).join('');
        }

        function debounceConvSearch() { clearTimeout(convSearchTimeout); convSearchTimeout = setTimeout(() => { convPage = 1; loadConversations(); }, 300); }
        function exportCSV() { window.open('/api/admin/conversations/export?format=csv', '_blank'); }

        function renderPagination(containerId, total, currentPage, onPageChange) {
            const totalPages = Math.ceil(total / pageSize);
            const container = document.getElementById(containerId);
            if (totalPages <= 1) { container.innerHTML = ''; return; }
            let html = '';
            for (let i = 1; i <= totalPages; i++) {
                html += `<button class="btn ${i === currentPage ? 'btn-primary' : 'btn-secondary'} btn-sm" data-page="${i}">${i}</button>`;
            }
            container.innerHTML = html;
            container.onclick = function(e) {
                var btn = e.target.closest('[data-page]');
                if (btn) onPageChange(parseInt(btn.dataset.page));
            };
        }

        function formatDate(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }

        function formatDateTime(dateStr) {
            if (!dateStr) return '-';
            const d = new Date(dateStr);
            return `${formatDate(dateStr)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function showToast(message, type = 'info') {
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }

            // Expose onclick-referenced functions globally
                if (typeof switchTab === 'function') window.switchTab = switchTab;
                if (typeof showAddUserModal === 'function') window.showAddUserModal = showAddUserModal;
                if (typeof exportCSV === 'function') window['exportCSV'] = exportCSV;
                if (typeof closeModal === 'function') window.closeModal = closeModal;
                if (typeof saveUser === 'function') window.saveUser = saveUser;
                if (typeof editUser === 'function') window.editUser = editUser;
                if (typeof deleteUser === 'function') window.deleteUser = deleteUser;
                if (typeof debounceSearch === 'function') window.debounceSearch = debounceSearch;
                if (typeof debounceConvSearch === 'function') window.debounceConvSearch = debounceConvSearch;

        // Init
        (async () => {
            if (await checkAuth()) { loadUsers(); loadUserStats(); loadConversations(); }
        })();
            } catch(e) {
                console.error('[PageModule:admin] init error:', e);
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
                try { delete window.switchTab; } catch(e) {}
                try { delete window.showAddUserModal; } catch(e) {}
                try { delete window['exportCSV']; } catch(e) {}
                try { delete window.closeModal; } catch(e) {}
                try { delete window.saveUser; } catch(e) {}
                try { delete window.editUser; } catch(e) {}
                try { delete window.deleteUser; } catch(e) {}
                try { delete window.debounceSearch; } catch(e) {}
                try { delete window.debounceConvSearch; } catch(e) {}
        }
    };
})();
