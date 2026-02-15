/**
 * ============================================
 * Canvas Page - 문서 캔버스
 * ============================================
 * 공유 가능한 문서 캔버스 기능을 제공합니다.
 * 문서 생성/편집/삭제, 버전 관리, 공유 토큰 기반 협업,
 * AI 지원 컨텐츠 생성을 처리하는 SPA 페이지 모듈입니다.
 *
 * @module pages/canvas
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['canvas'] = {
        getHTML: function() {
            return '<div class="page-canvas">' +
                '<style data-spa-style="canvas">' +
                ".toolbar { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-5); }\n        .toolbar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .filter-tabs { display:flex; gap:var(--space-2); }\n        .filter-tab { padding:var(--space-2) var(--space-3); background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); cursor:pointer; color:var(--text-secondary); font-size:var(--font-size-sm); }\n        .filter-tab.active { background:var(--accent-primary); color:#fff; border-color:var(--accent-primary); }\n        .doc-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n        .doc-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; }\n        .doc-card:hover { border-color:var(--accent-primary); }\n        .doc-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); }\n        .doc-card .meta { font-size:var(--font-size-sm); color:var(--text-muted); display:flex; gap:var(--space-3); align-items:center; }\n        .badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .badge-doc { background:var(--accent-primary); color:#fff; }\n        .badge-code { background:var(--success); color:#fff; }\n        .badge-diagram { background:var(--warning); color:#000; }\n        .badge-table { background:var(--danger); color:#fff; }\n        .badge-shared { background:var(--success); color:#fff; margin-left:var(--space-2); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:800px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n        .form-group { margin-bottom:var(--space-4); }\n        .form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .form-group input, .form-group select, .form-group textarea { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; box-sizing:border-box; }\n        .form-group textarea { min-height:300px; font-family:'Pretendard',monospace; resize:vertical; }\n        .form-group textarea.code { font-family:'Courier New',monospace; }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); flex-wrap:wrap; }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-save { background:var(--accent-primary); color:#fff; }\n        .btn-share { background:var(--success); color:#fff; }\n        .btn-danger { background:var(--danger); color:#fff; }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n\n        .version-list { max-height:300px; overflow-y:auto; }\n        .version-item { padding:var(--space-3); border-bottom:1px solid var(--border-light); }\n        .version-item:last-child { border-bottom:none; }\n        .version-num { font-weight:var(--font-weight-semibold); color:var(--accent-primary); }\n\n        .share-info { background:var(--bg-secondary); padding:var(--space-4); border-radius:var(--radius-md); margin-top:var(--space-3); display:flex; align-items:center; gap:var(--space-3); }\n        .share-info input { flex:1; }\n        .share-info button { white-space:nowrap; }\n\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; }\n        .toast.success { background:var(--success); }\n        .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>캔버스 문서 편집기</h1>\n            </header>\n            <div class=\"content-area\" id=\"app\">\n                <div class=\"toolbar\">\n                    <button class=\"btn-primary\" onclick=\"openNewDoc()\">+ 새 문서</button>\n                    <div class=\"filter-tabs\" id=\"filterTabs\">\n                        <button class=\"filter-tab active\" data-type=\"all\">전체</button>\n                        <button class=\"filter-tab\" data-type=\"document\">문서</button>\n                        <button class=\"filter-tab\" data-type=\"code\">코드</button>\n                        <button class=\"filter-tab\" data-type=\"diagram\">다이어그램</button>\n                        <button class=\"filter-tab\" data-type=\"table\">표</button>\n                    </div>\n                </div>\n                <div id=\"docList\" class=\"doc-grid\"><div class=\"loading\">불러오는 중...</div></div>\n            </div>\n<div class=\"modal-overlay\" id=\"editorModal\">\n        <div class=\"modal\">\n            <h2 id=\"editorTitle\">새 문서</h2>\n            <div class=\"form-group\"><label>제목</label><input type=\"text\" id=\"docTitle\" placeholder=\"문서 제목\"></div>\n            <div class=\"form-group\"><label>유형</label>\n                <select id=\"docType\"><option value=\"document\">문서</option><option value=\"code\">코드</option><option value=\"diagram\">다이어그램</option><option value=\"table\">표</option></select>\n            </div>\n            <div class=\"form-group\" id=\"langGroup\" style=\"display:none\"><label>언어</label>\n                <select id=\"docLang\"><option value=\"\">선택</option><option>javascript</option><option>typescript</option><option>python</option><option>java</option><option>go</option><option>rust</option><option>html</option><option>css</option><option>sql</option><option>bash</option></select>\n            </div>\n            <div class=\"form-group\"><label>내용</label><textarea id=\"docContent\" placeholder=\"내용을 입력하세요...\"></textarea></div>\n            <div id=\"shareSection\" style=\"display:none\"></div>\n            <div class=\"modal-actions\">\n                <button class=\"btn-secondary\" onclick=\"closeEditor()\">취소</button>\n                <button class=\"btn-secondary\" id=\"btnVersions\" style=\"display:none\" onclick=\"loadVersions()\">버전 이력</button>\n                <button class=\"btn-share\" id=\"btnShare\" style=\"display:none\" onclick=\"toggleShare()\">공유</button>\n                <button class=\"btn-danger\" id=\"btnDelete\" style=\"display:none\" onclick=\"deleteDoc()\">삭제</button>\n                <button class=\"btn-save\" onclick=\"saveDoc()\">저장</button>\n            </div>\n        </div>\n    </div>\n<div class=\"modal-overlay\" id=\"versionModal\">\n        <div class=\"modal\" style=\"max-width:500px\">\n            <h2>버전 이력</h2>\n            <div id=\"versionList\" class=\"version-list\"><div class=\"loading\">불러오는 중...</div></div>\n            <div class=\"modal-actions\"><button class=\"btn-secondary\" onclick=\"document.getElementById('versionModal').classList.remove('open')\">닫기</button></div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<div id="toast" class="toast"></div>' +
            '<\/div>';
        },

        init: function() {
            try {
                let allDocs = [];
        let currentFilter = 'all';
        let editingDocId = null;

        function authFetch(url, options = {}) {
            return window.authFetch(url, options).then(r => r.json());
        }

        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }

        const typeLabels = { document: '문서', code: '코드', diagram: '다이어그램', table: '표' };
        const typeBadge = t => `<span class="badge badge-${t}">${typeLabels[t] || t}</span>`;

        async function loadDocs() {
            try {
                const res = await authFetch('/api/canvas');
                allDocs = res.data || res || [];
                renderDocs();
            } catch (e) { showToast('문서 로드 실패', 'error'); }
        }

        function renderDocs() {
            const filtered = currentFilter === 'all' ? allDocs : allDocs.filter(d => d.doc_type === currentFilter);
            const el = document.getElementById('docList');
            if (!filtered.length) {
                el.innerHTML = '<div class="empty-state"><h2>문서가 없습니다</h2><p>새 문서를 만들어 시작하세요.</p></div>';
                return;
            }
            el.innerHTML = filtered.map(d => `
                <div class="doc-card" onclick="openDoc('${d.id}')">
                    <h3>${esc(d.title)}</h3>
                    <div class="meta">
                        ${typeBadge(d.doc_type)}
                        ${d.is_shared ? '<span class="badge badge-shared">공유중</span>' : ''}
                        <span>${timeAgo(d.updated_at)}</span>
                    </div>
                </div>`).join('');
        }

        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
        function timeAgo(d) {
            if (!d) return '';
            const diff = Date.now() - new Date(d).getTime();
            const m = Math.floor(diff/60000);
            if (m < 60) return m + '분 전';
            const h = Math.floor(m/60);
            if (h < 24) return h + '시간 전';
            return Math.floor(h/24) + '일 전';
        }

        // Filter tabs
        document.getElementById('filterTabs').addEventListener('click', e => {
            if (!e.target.classList.contains('filter-tab')) return;
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currentFilter = e.target.dataset.type;
            renderDocs();
        });

        // Editor
        function openNewDoc() {
            editingDocId = null;
            document.getElementById('editorTitle').textContent = '새 문서';
            document.getElementById('docTitle').value = '';
            document.getElementById('docType').value = 'document';
            document.getElementById('docLang').value = '';
            document.getElementById('docContent').value = '';
            document.getElementById('docContent').className = '';
            document.getElementById('btnDelete').style.display = 'none';
            document.getElementById('btnShare').style.display = 'none';
            document.getElementById('btnVersions').style.display = 'none';
            document.getElementById('shareSection').style.display = 'none';
            document.getElementById('langGroup').style.display = 'none';
            document.getElementById('editorModal').classList.add('open');
        }

        async function openDoc(id) {
            try {
                const res = await authFetch('/api/canvas/' + id);
                const doc = res.data || res;
                editingDocId = doc.id;
                document.getElementById('editorTitle').textContent = '문서 편집';
                document.getElementById('docTitle').value = doc.title || '';
                document.getElementById('docType').value = doc.doc_type || 'document';
                document.getElementById('docLang').value = doc.language || '';
                document.getElementById('docContent').value = doc.content || '';
                document.getElementById('docContent').className = doc.doc_type === 'code' ? 'code' : '';
                document.getElementById('langGroup').style.display = doc.doc_type === 'code' ? '' : 'none';
                document.getElementById('btnDelete').style.display = '';
                document.getElementById('btnShare').style.display = '';
                document.getElementById('btnVersions').style.display = '';
                updateShareSection(doc);
                document.getElementById('editorModal').classList.add('open');
            } catch (e) { showToast('문서 로드 실패', 'error'); }
        }

        function updateShareSection(doc) {
            const sec = document.getElementById('shareSection');
            if (doc.is_shared && doc.share_token) {
                const url = location.origin + '/api/canvas/shared/' + doc.share_token;
                sec.style.display = '';
                sec.innerHTML = '<div class="share-info"><input type="text" readonly value="' + url + '" id="shareUrl"><button class="btn-secondary" onclick="copyShare()">복사</button><button class="btn-danger" onclick="unshareDoc()">해제</button></div>';
            } else {
                sec.style.display = 'none';
                sec.innerHTML = '';
            }
        }

        function copyShare() {
            const u = document.getElementById('shareUrl');
            u.select(); navigator.clipboard.writeText(u.value);
            showToast('링크가 복사되었습니다');
        }

        function closeEditor() { document.getElementById('editorModal').classList.remove('open'); }

        document.getElementById('docType').addEventListener('change', function() {
            document.getElementById('langGroup').style.display = this.value === 'code' ? '' : 'none';
            document.getElementById('docContent').className = this.value === 'code' ? 'code' : '';
        });

        async function saveDoc() {
            const title = document.getElementById('docTitle').value.trim();
            if (!title) { showToast('제목을 입력하세요', 'error'); return; }
            const body = {
                title,
                content: document.getElementById('docContent').value,
                docType: document.getElementById('docType').value,
                language: document.getElementById('docLang').value || undefined,
                changeSummary: editingDocId ? '사용자 편집' : undefined
            };
            try {
                if (editingDocId) {
                    await authFetch('/api/canvas/' + editingDocId, { method: 'PUT', body: JSON.stringify(body) });
                    showToast('문서가 저장되었습니다');
                } else {
                    await authFetch('/api/canvas', { method: 'POST', body: JSON.stringify(body) });
                    showToast('문서가 생성되었습니다');
                }
                closeEditor(); loadDocs();
            } catch (e) { showToast('저장 실패', 'error'); }
        }

        async function deleteDoc() {
            if (!editingDocId || !confirm('이 문서를 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/canvas/' + editingDocId, { method: 'DELETE' });
                showToast('문서가 삭제되었습니다'); closeEditor(); loadDocs();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function toggleShare() {
            if (!editingDocId) return;
            try {
                const res = await authFetch('/api/canvas/' + editingDocId + '/share', { method: 'POST' });
                const doc = res.data || res;
                updateShareSection(doc);
                showToast('공유가 시작되었습니다');
                loadDocs();
            } catch (e) { showToast('공유 실패', 'error'); }
        }

        async function unshareDoc() {
            if (!editingDocId) return;
            try {
                await authFetch('/api/canvas/' + editingDocId + '/share', { method: 'DELETE' });
                document.getElementById('shareSection').style.display = 'none';
                showToast('공유가 해제되었습니다');
                loadDocs();
            } catch (e) { showToast('공유 해제 실패', 'error'); }
        }

        async function loadVersions() {
            if (!editingDocId) return;
            document.getElementById('versionModal').classList.add('open');
            document.getElementById('versionList').innerHTML = '<div class="loading">불러오는 중...</div>';
            try {
                const res = await authFetch('/api/canvas/' + editingDocId + '/versions');
                const versions = res.data || res || [];
                if (!versions.length) {
                    document.getElementById('versionList').innerHTML = '<div class="empty-state"><p>버전 이력이 없습니다.</p></div>';
                    return;
                }
                document.getElementById('versionList').innerHTML = versions.map(v => `
                    <div class="version-item">
                        <span class="version-num">v${v.version}</span> &mdash;
                        <span style="color:var(--text-muted)">${v.change_summary || '변경 사항 없음'}</span>
                        <br><small style="color:var(--text-muted)">${new Date(v.created_at).toLocaleString('ko')}</small>
                    </div>`).join('');
            } catch (e) { document.getElementById('versionList').innerHTML = '<div class="empty-state"><p>로드 실패</p></div>'; }
        }

        loadDocs();

            // Expose onclick-referenced functions globally
                if (typeof openNewDoc === 'function') window.openNewDoc = openNewDoc;
                if (typeof closeEditor === 'function') window.closeEditor = closeEditor;
                if (typeof loadVersions === 'function') window.loadVersions = loadVersions;
                if (typeof toggleShare === 'function') window.toggleShare = toggleShare;
                if (typeof deleteDoc === 'function') window.deleteDoc = deleteDoc;
                if (typeof saveDoc === 'function') window.saveDoc = saveDoc;
                if (typeof openDoc === 'function') window.openDoc = openDoc;
                if (typeof copyShare === 'function') window.copyShare = copyShare;
                if (typeof unshareDoc === 'function') window.unshareDoc = unshareDoc;
            } catch(e) {
                console.error('[PageModule:canvas] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.openNewDoc; } catch(e) {}
                try { delete window.closeEditor; } catch(e) {}
                try { delete window.loadVersions; } catch(e) {}
                try { delete window.toggleShare; } catch(e) {}
                try { delete window.deleteDoc; } catch(e) {}
                try { delete window.saveDoc; } catch(e) {}
                try { delete window.openDoc; } catch(e) {}
                try { delete window.copyShare; } catch(e) {}
                try { delete window.unshareDoc; } catch(e) {}
        }
    };
})();
