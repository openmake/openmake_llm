function authFetch(url, opts = {}) {
            const headers = { 'Content-Type':'application/json', ...opts.headers };
            return fetch(url, { ...opts, headers, credentials: 'include' }).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        let skills = [];
        let categories = [];
        let currentFilter = '';

        async function loadCategories() {
            try {
                const res = await authFetch('/api/agents/skills/categories');
                categories = res.data || [];
                const tabs = document.getElementById('filterTabs');
                tabs.innerHTML = '<button class="filter-tab active" data-cat="">전체</button>' +
                    categories.map(c => '<button class="filter-tab" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('');
            } catch(e) { /* ignore */ }
        }

        async function loadSkills() {
            const params = new URLSearchParams();
            const search = document.getElementById('searchInput').value.trim();
            if (search) params.set('q', search);
            if (currentFilter) params.set('category', currentFilter);
            try {
                const res = await authFetch('/api/agents/skills?' + params.toString());
                skills = res.data || [];
                renderSkills();
            } catch(e) {
                document.getElementById('skillGrid').innerHTML = '<div class="empty-state"><h2>로드 실패</h2></div>';
            }
        }

        function renderSkills() {
            const el = document.getElementById('skillGrid');
            if (!skills.length) {
                el.innerHTML = '<div class="empty-state"><h2>스킬이 없습니다</h2><p>새 스킬을 추가하거나 검색어를 변경해보세요.</p></div>';
                return;
            }
            el.innerHTML = skills.map(s => `
                <div class="skill-card">
                    <h3>${esc(s.name)}</h3>
                    <div class="skill-desc">${esc(s.description || '')}</div>
                    <div class="skill-meta">
                        <span class="badge badge-cat">${esc(s.category || 'general')}</span>
                        <span class="badge ${s.is_public ? 'badge-public' : 'badge-private'}">${s.is_public ? '공개' : '비공개'}</span>
                    </div>
                    <div class="skill-actions">
                        <button onclick="exportSkill('${s.id}')">📤 내보내기</button>
                    </div>
                </div>
            `).join('');
        }

        async function exportSkill(id) {
            try {
                const res = await authFetch('/api/agents/skills/' + id + '/export');
                const data = res.data || res;
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = 'skill-' + id + '.json'; a.click();
                URL.revokeObjectURL(url);
                showToast('스킬이 내보내기되었습니다.');
            } catch(e) { showToast('내보내기 실패', 'error'); }
        }

        function openCreateModal() { showToast('스킬 생성은 SPA 뷰에서 지원됩니다.'); }

        document.getElementById('filterTabs').addEventListener('click', e => {
            if (!e.target.classList.contains('filter-tab')) return;
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.cat;
            loadSkills();
        });

        function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
        document.getElementById('searchInput').addEventListener('input', debounce(function() { loadSkills(); }, 400));

        loadCategories();
        loadSkills();