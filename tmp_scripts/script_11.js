const CAT_LABELS = { preference:'선호도', fact:'사실', project:'프로젝트', relationship:'관계', skill:'기술', context:'맥락' };
        let allMems = [];
        let currentFilter = 'all';
        let editingId = null;
        let searchMode = false;

        function authFetch(url, options = {}) {
            const headers = { 'Content-Type':'application/json', ...options.headers };
            return fetch(url, { ...options, headers, credentials: 'include' }).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        function impColor(v) {
            if (v >= 8) return 'var(--danger)';
            if (v >= 5) return 'var(--warning)';
            return 'var(--success)';
        }

        document.getElementById('memImportance').addEventListener('input', function() {
            document.getElementById('impVal').textContent = this.value;
        });

        document.getElementById('filterTabs').addEventListener('click', e => {
            if (!e.target.classList.contains('filter-tab')) return;
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.cat;
            renderMems();
        });

        async function loadMems() {
            try {
                const res = await authFetch('/api/memory');
                allMems = res.data || res || [];
                searchMode = false;
                renderMems();
            } catch (e) { showToast('메모리 로드 실패', 'error'); }
        }

        async function searchMems(q) {
            if (!q) { loadMems(); return; }
            try {
                const res = await authFetch('/api/memory/search?q=' + encodeURIComponent(q));
                allMems = res.data || res || [];
                searchMode = true;
                renderMems();
            } catch (e) { showToast('검색 실패', 'error'); }
        }

        function renderMems() {
            const filtered = currentFilter === 'all' ? allMems : allMems.filter(m => m.category === currentFilter);
            const el = document.getElementById('memList');
            if (!filtered.length) {
                el.innerHTML = '<div class="empty-state"><h2>저장된 메모리가 없습니다</h2><p>AI 메모리를 추가하여 더 나은 대화를 경험하세요.</p></div>';
                return;
            }
            el.innerHTML = filtered.map(m => {
                const imp = m.importance || 5;
                const tags = m.tags || [];
                return `
                <div class="mem-card" onclick="openMem('${m.id}')">
                    <h3>${esc(m.key)}</h3>
                    <div class="val-preview">${esc(m.value)}</div>
                    <div class="mem-meta">
                        <span class="badge badge-${m.category}">${CAT_LABELS[m.category] || m.category}</span>
                        <span class="importance-bar"><span class="importance-fill" style="width:${imp*10}%;background:${impColor(imp)}"></span></span>
                        <span style="color:var(--text-muted)">${imp}/10</span>
                    </div>
                    ${tags.length ? '<div class="tag-pills">' + tags.map(t => '<span class="tag-pill">' + esc(t) + '</span>').join('') + '</div>' : ''}
                </div>`;
            }).join('');
        }

        function openNew() {
            editingId = null;
            document.getElementById('editorTitle').textContent = '새 메모리';
            document.getElementById('memCategory').value = 'preference';
            document.getElementById('memKey').value = '';
            document.getElementById('memValue').value = '';
            document.getElementById('memImportance').value = '5';
            document.getElementById('impVal').textContent = '5';
            document.getElementById('memTags').value = '';
            document.getElementById('btnDelete').style.display = 'none';
            document.getElementById('editorModal').classList.add('open');
        }

        function openMem(id) {
            const m = allMems.find(x => x.id === id) || allMems.find(x => String(x.id) === String(id));
            if (!m) return;
            editingId = m.id;
            document.getElementById('editorTitle').textContent = '메모리 편집';
            document.getElementById('memCategory').value = m.category || 'preference';
            document.getElementById('memKey').value = m.key || '';
            document.getElementById('memValue').value = m.value || '';
            document.getElementById('memImportance').value = m.importance || 5;
            document.getElementById('impVal').textContent = m.importance || 5;
            document.getElementById('memTags').value = (m.tags || []).join(', ');
            document.getElementById('btnDelete').style.display = '';
            document.getElementById('editorModal').classList.add('open');
        }

        function closeEditor() { document.getElementById('editorModal').classList.remove('open'); }

        async function saveMem() {
            const key = document.getElementById('memKey').value.trim();
            if (!key) { showToast('키를 입력하세요', 'error'); return; }
            try {
                if (editingId) {
                    await authFetch('/api/memory/' + editingId, { method:'PUT', body:JSON.stringify({
                        value: document.getElementById('memValue').value,
                        importance: parseInt(document.getElementById('memImportance').value)
                    })});
                    showToast('저장되었습니다');
                } else {
                    await authFetch('/api/memory', { method:'POST', body:JSON.stringify({
                        category: document.getElementById('memCategory').value,
                        key,
                        value: document.getElementById('memValue').value,
                        importance: parseInt(document.getElementById('memImportance').value),
                        tags: document.getElementById('memTags').value.split(',').map(s => s.trim()).filter(Boolean)
                    })});
                    showToast('메모리가 생성되었습니다');
                }
                closeEditor(); loadMems();
            } catch (e) { showToast('저장 실패', 'error'); }
        }

        async function deleteMem() {
            if (!editingId || !confirm('이 메모리를 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/memory/' + editingId, { method:'DELETE' });
                showToast('삭제되었습니다'); closeEditor(); loadMems();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
        document.getElementById('searchInput').addEventListener('input', debounce(function() {
            searchMems(this.value.trim());
        }, 400));

        loadMems();