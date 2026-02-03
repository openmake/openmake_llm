/**
 * memory - SPA Page Module
 * Auto-generated from memory.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['memory'] = {
        getHTML: function() {
            return '<div class="page-memory">' +
                '<style data-spa-style="memory">' +
                ".toolbar { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-5); }\n        .toolbar input { flex:1; min-width:200px; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); box-sizing:border-box; }\n        .toolbar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); white-space:nowrap; }\n        .filter-tabs { display:flex; gap:var(--space-2); margin-bottom:var(--space-5); flex-wrap:wrap; }\n        .filter-tab { padding:var(--space-2) var(--space-3); background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); cursor:pointer; color:var(--text-secondary); font-size:var(--font-size-sm); }\n        .filter-tab.active { background:var(--accent-primary); color:#fff; border-color:var(--accent-primary); }\n        .mem-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n        .mem-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; display:flex; flex-direction:column; }\n        .mem-card:hover { border-color:var(--accent-primary); }\n        .mem-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); font-size:15px; }\n        .mem-card .val-preview { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-3); flex:1; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; line-height:1.5; }\n        .mem-meta { display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; font-size:var(--font-size-sm); }\n        .badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .badge-preference { background:var(--accent-primary); color:#fff; }\n        .badge-fact { background:var(--success); color:#fff; }\n        .badge-project { background:var(--warning); color:#000; }\n        .badge-relationship { background:#e879f9; color:#fff; }\n        .badge-skill { background:#38bdf8; color:#fff; }\n        .badge-context { background:var(--bg-tertiary); color:var(--text-secondary); }\n        .importance-bar { height:4px; width:60px; background:var(--bg-tertiary); border-radius:2px; overflow:hidden; display:inline-block; vertical-align:middle; }\n        .importance-fill { height:100%; border-radius:2px; }\n        .tag-pills { display:flex; gap:var(--space-1); flex-wrap:wrap; margin-top:var(--space-2); }\n        .tag-pill { padding:1px 6px; background:var(--bg-tertiary); border-radius:var(--radius-md); font-size:10px; color:var(--text-muted); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:600px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n        .form-group { margin-bottom:var(--space-4); }\n        .form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .form-group input, .form-group select, .form-group textarea { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; box-sizing:border-box; }\n        .form-group textarea { min-height:120px; font-family:'Pretendard',sans-serif; resize:vertical; }\n        .range-row { display:flex; align-items:center; gap:var(--space-3); }\n        .range-row input[type=range] { flex:1; }\n        .range-val { min-width:30px; text-align:center; color:var(--accent-primary); font-weight:var(--font-weight-semibold); }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-save { background:var(--accent-primary); color:#fff; }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n        .btn-danger { background:var(--danger); color:#fff; }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>AI 메모리</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"toolbar\">\n                    <input type=\"text\" id=\"searchInput\" placeholder=\"메모리 검색...\">\n                    <button class=\"btn-primary\" onclick=\"openNew()\">+ 새 메모리</button>\n                </div>\n                <div class=\"filter-tabs\" id=\"filterTabs\">\n                    <button class=\"filter-tab active\" data-cat=\"all\">전체</button>\n                    <button class=\"filter-tab\" data-cat=\"preference\">선호도</button>\n                    <button class=\"filter-tab\" data-cat=\"fact\">사실</button>\n                    <button class=\"filter-tab\" data-cat=\"project\">프로젝트</button>\n                    <button class=\"filter-tab\" data-cat=\"relationship\">관계</button>\n                    <button class=\"filter-tab\" data-cat=\"skill\">기술</button>\n                    <button class=\"filter-tab\" data-cat=\"context\">맥락</button>\n                </div>\n                <div id=\"memList\" class=\"mem-grid\"><div class=\"loading\">불러오는 중...</div></div>\n            </div>\n<div class=\"modal-overlay\" id=\"editorModal\">\n        <div class=\"modal\">\n            <h2 id=\"editorTitle\">새 메모리</h2>\n            <div class=\"form-group\"><label>카테고리</label>\n                <select id=\"memCategory\">\n                    <option value=\"preference\">선호도</option><option value=\"fact\">사실</option><option value=\"project\">프로젝트</option>\n                    <option value=\"relationship\">관계</option><option value=\"skill\">기술</option><option value=\"context\">맥락</option>\n                </select>\n            </div>\n            <div class=\"form-group\"><label>키</label><input type=\"text\" id=\"memKey\" placeholder=\"메모리 제목/키\"></div>\n            <div class=\"form-group\"><label>값</label><textarea id=\"memValue\" placeholder=\"메모리 내용...\"></textarea></div>\n            <div class=\"form-group\">\n                <label>중요도</label>\n                <div class=\"range-row\">\n                    <input type=\"range\" id=\"memImportance\" min=\"1\" max=\"10\" step=\"1\" value=\"5\">\n                    <span class=\"range-val\" id=\"impVal\">5</span>\n                </div>\n            </div>\n            <div class=\"form-group\"><label>태그 (쉼표 구분)</label><input type=\"text\" id=\"memTags\" placeholder=\"태그1, 태그2, ...\"></div>\n            <div class=\"modal-actions\">\n                <button class=\"btn-secondary\" onclick=\"closeEditor()\">취소</button>\n                <button class=\"btn-danger\" id=\"btnDelete\" style=\"display:none\" onclick=\"deleteMem()\">삭제</button>\n                <button class=\"btn-save\" onclick=\"saveMem()\">저장</button>\n            </div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                const CAT_LABELS = { preference:'선호도', fact:'사실', project:'프로젝트', relationship:'관계', skill:'기술', context:'맥락' };
        let allMems = [];
        let currentFilter = 'all';
        let editingId = null;
        let searchMode = false;

        function authFetch(url, options = {}) {
            const token = localStorage.getItem('authToken');
            const headers = { 'Content-Type':'application/json', ...(token ? {'Authorization':'Bearer '+token} : {}), ...options.headers };
            return fetch(url, { ...options, headers }).then(r => r.json());
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

            // Expose onclick-referenced functions globally
                if (typeof openNew === 'function') window.openNew = openNew;
                if (typeof closeEditor === 'function') window.closeEditor = closeEditor;
                if (typeof deleteMem === 'function') window.deleteMem = deleteMem;
                if (typeof saveMem === 'function') window.saveMem = saveMem;
                if (typeof openMem === 'function') window.openMem = openMem;
            } catch(e) {
                console.error('[PageModule:memory] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.openNew; } catch(e) {}
                try { delete window.closeEditor; } catch(e) {}
                try { delete window.deleteMem; } catch(e) {}
                try { delete window.saveMem; } catch(e) {}
                try { delete window.openMem; } catch(e) {}
        }
    };
})();
