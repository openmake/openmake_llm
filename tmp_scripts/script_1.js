const API_BASE = window.location.origin;
        // authToken은 httpOnly 쿠키로 관리 — localStorage 의존 제거
        let currentUser = null;
        let usersPage = 1;
        let convPage = 1;
        const pageSize = 20;
        let searchTimeout;

        async function checkAuth() {
             const user = localStorage.getItem('user');
             if (!user) { window.location.href = '/login.html'; return false; }
             try {
                 const res = await authFetch('/api/auth/me');
                 const data = await res.json();
                 const payload = data.data || data;
                 if (!res.ok || !payload.user) throw new Error('인증 실패');
                 currentUser = payload.user;
                if (currentUser.role !== 'admin') {
                    showToast('관리자 권한이 필요합니다', 'error');
                    setTimeout(() => window.location.href = '/', 1500);
                    return false;
                }
                return true;
            } catch (e) {
                window.location.href = '/login.html';
                return false;
            }
        }

        async function authFetch(url, options = {}) {
            return fetch(url, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                credentials: 'include'
            });
        }

        function switchTab(tab) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            document.querySelector(`[onclick="switchTab('${tab}')"]`).classList.add('active');
            document.getElementById(`${tab}Panel`).classList.add('active');
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
                        <button class="btn btn-secondary btn-sm" onclick="setTimeout(function(){editUser('${u.id}')},0)">편집</button>
                        ${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" onclick="setTimeout(function(){deleteUser('${u.id}')},0)">삭제</button>` : ''}
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
             } catch (e) { }
             try {
                 const res = await authFetch('/api/admin/stats');
                 if (res.ok) { const data = await res.json(); const payload2 = data.data || data; document.getElementById('statTodayQueries').textContent = payload2.today_queries || 0; }
             } catch (e) { }
         }

        function showAddUserModal() {
            document.getElementById('editModalTitle').textContent = '새 사용자 추가';
            document.getElementById('editUserId').value = '';
            document.getElementById('editUsername').value = '';
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
                document.getElementById('editUsername').value = user.username || '';
                document.getElementById('editEmail').value = user.email;
                document.getElementById('editPassword').value = '';
                document.getElementById('editRole').value = user.role;
                document.getElementById('editActive').value = user.is_active ? '1' : '0';
                document.getElementById('editUserModal').classList.add('active');
            } catch (e) { showToast('사용자 정보 로드 실패', 'error'); }
        }

        async function saveUser() {
            const id = document.getElementById('editUserId').value;
            const username = document.getElementById('editUsername').value.trim();
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
                    if (!username || username.length < 3) { showToast('사용자명은 3자 이상이어야 합니다', 'error'); return; }
                    if (!password || password.length < 8) { showToast('비밀번호는 8자 이상이어야 합니다', 'error'); return; }
                    await authFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password, role }) });
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

        function debounceSearch() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { usersPage = 1; loadUsers(); }, 300); }

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
                    <td class="conv-content-cell">${escapeHtml(c.content?.substring(0, 100) || '')}</td>
                    <td class="text-muted text-sm">${c.model || '-'}</td>
                </tr>
            `).join('');
        }

        function debounceConvSearch() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { convPage = 1; loadConversations(); }, 300); }
        function exportCSV() { window.open('/api/admin/conversations/export?format=csv', '_blank'); }

        // --- pagination callback registry (avoids function.toString() hack) ---
        const _pgCb = {};

        function renderPagination(containerId, total, currentPage, onPageChange) {
            const totalPages = Math.ceil(total / pageSize);
            const container = document.getElementById(containerId);
            if (!container) return;
            if (totalPages <= 1) { container.innerHTML = ''; return; }
            _pgCb[containerId] = onPageChange;

            const delta = 2;
            const start = Math.max(1, currentPage - delta);
            const end   = Math.min(totalPages, currentPage + delta);
            let html = '';

            // 이전
            html += '<button class="btn btn-secondary btn-sm"' +
                (currentPage === 1 ? ' disabled' : '') +
                ' onclick="_pg(' + JSON.stringify(containerId) + ',' + (currentPage - 1) + ')">‹</button>';

            // 첫 페이지 + 앞 줄임표
            if (start > 1) {
                html += '<button class="btn btn-secondary btn-sm" onclick="_pg(' + JSON.stringify(containerId) + ',1)">1</button>';
                if (start > 2) html += '<span class="admin-pg-ellipsis">…</span>';
            }

            // 윈도우 페이지 번호
            for (let i = start; i <= end; i++) {
                html += '<button class="btn ' + (i === currentPage ? 'btn-primary' : 'btn-secondary') +
                    ' btn-sm" onclick="_pg(' + JSON.stringify(containerId) + ',' + i + ')">' + i + '</button>';
            }

            // 끝 페이지 + 뒤 줄임표
            if (end < totalPages) {
                if (end < totalPages - 1) html += '<span class="admin-pg-ellipsis">…</span>';
                html += '<button class="btn btn-secondary btn-sm" onclick="_pg(' + JSON.stringify(containerId) + ',' + totalPages + ')">' + totalPages + '</button>';
            }

            // 다음
            html += '<button class="btn btn-secondary btn-sm"' +
                (currentPage === totalPages ? ' disabled' : '') +
                ' onclick="_pg(' + JSON.stringify(containerId) + ',' + (currentPage + 1) + ')">›</button>';

            // 페이지 정보
            html += '<span class="admin-pg-info">' + currentPage + ' / ' + totalPages + '</span>';

            container.innerHTML = html;
        }

        function _pg(containerId, page) {
            if (_pgCb[containerId]) _pgCb[containerId](page);
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

        // Init
        (async () => {
            if (await checkAuth()) { loadUsers(); loadUserStats(); loadConversations(); }
        })();