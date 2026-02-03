/**
 * marketplace - SPA Page Module
 * Auto-generated from marketplace.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['marketplace'] = {
        getHTML: function() {
            return '<div class="page-marketplace">' +
                '<style data-spa-style="marketplace">' +
                ".search-bar { display:flex; gap:var(--space-3); margin-bottom:var(--space-5); flex-wrap:wrap; align-items:center; }\n        .search-bar input { flex:1; min-width:200px; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); box-sizing:border-box; }\n        .search-bar select { padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); }\n        .tabs { display:flex; gap:var(--space-2); margin-bottom:var(--space-5); }\n        .tab { padding:var(--space-2) var(--space-4); background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); cursor:pointer; color:var(--text-secondary); font-weight:var(--font-weight-semibold); }\n        .tab.active { background:var(--accent-primary); color:#fff; border-color:var(--accent-primary); }\n        .agent-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n        .agent-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; display:flex; flex-direction:column; }\n        .agent-card:hover { border-color:var(--accent-primary); }\n        .agent-icon { font-size:2.5rem; margin-bottom:var(--space-3); }\n        .agent-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); }\n        .agent-card .desc { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-3); flex:1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }\n        .agent-footer { display:flex; justify-content:space-between; align-items:center; font-size:var(--font-size-sm); }\n        .stars { color:var(--warning); letter-spacing:1px; }\n        .downloads { color:var(--text-muted); }\n        .badge-cat { background:var(--bg-tertiary); color:var(--text-secondary); padding:2px 8px; border-radius:var(--radius-md); font-size:11px; }\n        .badge-featured { background:var(--warning); color:#000; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:650px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-3); }\n        .modal-desc { color:var(--text-secondary); line-height:1.7; margin-bottom:var(--space-4); }\n        .detail-meta { display:flex; gap:var(--space-4); flex-wrap:wrap; margin-bottom:var(--space-4); font-size:var(--font-size-sm); color:var(--text-muted); }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-primary { background:var(--accent-primary); color:#fff; }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light)!important; }\n        .btn-danger { background:var(--danger); color:#fff; }\n\n        .reviews-section { margin-top:var(--space-5); border-top:1px solid var(--border-light); padding-top:var(--space-4); }\n        .review-item { padding:var(--space-3) 0; border-bottom:1px solid var(--border-light); }\n        .review-item:last-child { border-bottom:none; }\n        .review-header { display:flex; justify-content:space-between; margin-bottom:var(--space-2); }\n        .review-form { margin-top:var(--space-4); background:var(--bg-secondary); padding:var(--space-4); border-radius:var(--radius-md); }\n        .review-form label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); }\n        .review-form input, .review-form textarea { width:100%; padding:var(--space-2); background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); box-sizing:border-box; margin-bottom:var(--space-3); }\n        .star-select { font-size:1.5rem; cursor:pointer; }\n        .star-select span { opacity:.3; transition:opacity .2s; }\n        .star-select span.active { opacity:1; color:var(--warning); }\n\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>에이전트 마켓플레이스</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"tabs\">\n                    <button class=\"tab active\" onclick=\"switchTab('browse',this)\">둘러보기</button>\n                    <button class=\"tab\" onclick=\"switchTab('installed',this)\">내 설치</button>\n                </div>\n                <div class=\"search-bar\" id=\"searchBar\">\n                    <input type=\"text\" id=\"searchInput\" placeholder=\"에이전트 검색...\">\n                    <select id=\"sortBy\"><option value=\"downloads\">다운로드순</option><option value=\"rating\">평점순</option><option value=\"newest\">최신순</option></select>\n                </div>\n                <div id=\"agentList\" class=\"agent-grid\"><div class=\"loading\">불러오는 중...</div></div>\n            </div>\n<div class=\"modal-overlay\" id=\"detailModal\">\n        <div class=\"modal\">\n            <div style=\"font-size:3rem;margin-bottom:var(--space-3)\" id=\"detailIcon\"></div>\n            <h2 id=\"detailTitle\"></h2>\n            <div class=\"detail-meta\" id=\"detailMeta\"></div>\n            <div class=\"modal-desc\" id=\"detailDesc\"></div>\n            <div class=\"modal-actions\" id=\"detailActions\"></div>\n            <div class=\"reviews-section\" id=\"reviewsSection\"></div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                let currentView = 'browse';
        let currentAgentId = null;
        let selectedRating = 0;

        function authFetch(url, options = {}) {
            const token = localStorage.getItem('authToken');
            const headers = { 'Content-Type': 'application/json', ...(token ? { 'Authorization': 'Bearer ' + token } : {}), ...options.headers };
            return fetch(url, { ...options, headers }).then(r => r.json());
        }
        function showToast(msg, type = 'success') { const t = document.getElementById('toast'); t.textContent = msg; t.className = 'toast ' + type + ' show'; setTimeout(() => t.classList.remove('show'), 3000); }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
        function starsHtml(avg) { let s = ''; for (let i = 1; i <= 5; i++) s += i <= Math.round(avg) ? '<span style="color:var(--warning)">&#9733;</span>' : '<span style="opacity:.3">&#9733;</span>'; return s; }
        function numFmt(n) { return (n || 0).toLocaleString(); }

        function switchTab(view, btn) {
            currentView = view;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            if (btn) btn.classList.add('active');
            document.getElementById('searchBar').style.display = view === 'browse' ? '' : 'none';
            load();
        }

        async function load() {
            const el = document.getElementById('agentList');
            el.innerHTML = '<div class="loading">불러오는 중...</div>';
            try {
                let agents;
                if (currentView === 'installed') {
                    const res = await authFetch('/api/marketplace/me/installed');
                    agents = res.data || res || [];
                } else {
                    const q = document.getElementById('searchInput').value.trim();
                    const sort = document.getElementById('sortBy').value;
                    const url = '/api/marketplace?limit=50&sortBy=' + sort + (q ? '&search=' + encodeURIComponent(q) : '');
                    const res = await authFetch(url);
                    agents = res.data || res || [];
                }
                if (!agents.length) { el.innerHTML = '<div class="empty-state"><h2>에이전트가 없습니다</h2></div>'; return; }
                el.innerHTML = agents.map(a => `
                    <div class="agent-card" onclick="openAgent('${a.id}')">
                        <div class="agent-icon">${a.icon || '&#129302;'}</div>
                        <h3>${esc(a.title)}</h3>
                        <div class="desc">${esc(a.description)}</div>
                        <div style="margin-bottom:var(--space-3)">${a.category ? '<span class="badge-cat">' + esc(a.category) + '</span>' : ''} ${a.is_featured ? '<span class="badge-featured">추천</span>' : ''}</div>
                        <div class="agent-footer">
                            <span class="stars">${starsHtml(a.rating_avg)} <small>${(a.rating_avg || 0).toFixed(1)} (${a.rating_count || 0})</small></span>
                            <span class="downloads">${numFmt(a.downloads)} 다운로드</span>
                        </div>
                    </div>`).join('');
            } catch (e) { showToast('로드 실패', 'error'); }
        }

        async function openAgent(id) {
            currentAgentId = id;
            document.getElementById('detailModal').classList.add('open');
            try {
                const res = await authFetch('/api/marketplace/' + id);
                const a = res.data || res;
                document.getElementById('detailIcon').innerHTML = a.icon || '&#129302;';
                document.getElementById('detailTitle').textContent = a.title;
                document.getElementById('detailMeta').innerHTML = `
                    <span>${starsHtml(a.rating_avg)} ${(a.rating_avg||0).toFixed(1)} (${a.rating_count||0})</span>
                    <span>${numFmt(a.downloads)} 다운로드</span>
                    ${a.category ? '<span class="badge-cat">' + esc(a.category) + '</span>' : ''}
                    <span>v${a.version || '1.0.0'}</span>`;
                document.getElementById('detailDesc').innerHTML = esc(a.long_description || a.description || '설명이 없습니다.');
                document.getElementById('detailActions').innerHTML = `
                    <button class="btn-secondary" onclick="closeDetail()">닫기</button>
                    <button class="btn-primary" onclick="installAgent('${a.id}')">설치</button>
                    <button class="btn-danger" onclick="uninstallAgent('${a.id}')">삭제</button>`;
                loadReviews(id);
            } catch (e) { showToast('로드 실패', 'error'); }
        }

        function closeDetail() { document.getElementById('detailModal').classList.remove('open'); }

        async function installAgent(id) {
            try { await authFetch('/api/marketplace/' + id + '/install', { method: 'POST' }); showToast('설치되었습니다'); } catch (e) { showToast('설치 실패', 'error'); }
        }
        async function uninstallAgent(id) {
            try { await authFetch('/api/marketplace/' + id + '/install', { method: 'DELETE' }); showToast('삭제되었습니다'); load(); closeDetail(); } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function loadReviews(id) {
            const sec = document.getElementById('reviewsSection');
            try {
                const res = await authFetch('/api/marketplace/' + id + '/reviews?limit=20');
                const reviews = res.data || res || [];
                let html = '<h3 style="color:var(--text-secondary);margin-bottom:var(--space-3)">리뷰 (' + reviews.length + ')</h3>';
                html += reviews.map(r => `
                    <div class="review-item">
                        <div class="review-header"><span>${starsHtml(r.rating)} <strong>${esc(r.title)}</strong></span><span style="color:var(--text-muted);font-size:var(--font-size-sm)">${new Date(r.created_at).toLocaleDateString('ko')}</span></div>
                        <div style="color:var(--text-secondary)">${esc(r.content)}</div>
                    </div>`).join('');
                html += `<div class="review-form">
                    <label>리뷰 작성</label>
                    <div class="star-select" id="starSelect">${[1,2,3,4,5].map(i => '<span onclick="setRating(' + i + ')" data-v="' + i + '">&#9733;</span>').join('')}</div>
                    <input type="text" id="reviewTitle" placeholder="리뷰 제목">
                    <textarea id="reviewContent" rows="3" placeholder="리뷰 내용"></textarea>
                    <button class="btn-primary" onclick="submitReview()">리뷰 등록</button>
                </div>`;
                sec.innerHTML = html;
            } catch (e) { sec.innerHTML = ''; }
        }

        function setRating(v) {
            selectedRating = v;
            document.querySelectorAll('#starSelect span').forEach(s => { s.classList.toggle('active', parseInt(s.dataset.v) <= v); });
        }

        async function submitReview() {
            if (!selectedRating) { showToast('별점을 선택하세요', 'error'); return; }
            try {
                await authFetch('/api/marketplace/' + currentAgentId + '/reviews', { method: 'POST', body: JSON.stringify({ rating: selectedRating, title: document.getElementById('reviewTitle').value, content: document.getElementById('reviewContent').value }) });
                showToast('리뷰가 등록되었습니다');
                selectedRating = 0;
                loadReviews(currentAgentId);
            } catch (e) { showToast('등록 실패', 'error'); }
        }

        document.getElementById('searchInput').addEventListener('input', debounce(load, 400));
        document.getElementById('sortBy').addEventListener('change', load);
        function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

        load();

            // Expose onclick-referenced functions globally
                if (typeof switchTab === 'function') window.switchTab = switchTab;
                if (typeof openAgent === 'function') window.openAgent = openAgent;
                if (typeof closeDetail === 'function') window.closeDetail = closeDetail;
                if (typeof installAgent === 'function') window.installAgent = installAgent;
                if (typeof uninstallAgent === 'function') window.uninstallAgent = uninstallAgent;
                if (typeof setRating === 'function') window.setRating = setRating;
                if (typeof submitReview === 'function') window.submitReview = submitReview;
            } catch(e) {
                console.error('[PageModule:marketplace] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
            // Remove onclick-exposed globals
                try { delete window.switchTab; } catch(e) {}
                try { delete window.openAgent; } catch(e) {}
                try { delete window.closeDetail; } catch(e) {}
                try { delete window.installAgent; } catch(e) {}
                try { delete window.uninstallAgent; } catch(e) {}
                try { delete window.setRating; } catch(e) {}
                try { delete window.submitReview; } catch(e) {}
        }
    };
})();
