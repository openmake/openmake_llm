/**
 * custom-agents - SPA Page Module
 * Auto-generated from custom-agents.html
 */
(function() {
    'use strict';
    window.PageModules = window.PageModules || {};
    var _intervals = [];
    var _timeouts = [];

    window.PageModules['custom-agents'] = {
        getHTML: function() {
            return '<div class="page-custom-agents">' +
                '<style data-spa-style="custom-agents">' +
                ".toolbar { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-5); }\n        .toolbar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .agent-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n        .agent-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; display:flex; flex-direction:column; }\n        .agent-card:hover { border-color:var(--accent-primary); }\n        .agent-emoji { font-size:2.5rem; margin-bottom:var(--space-3); }\n        .agent-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); display:flex; align-items:center; gap:var(--space-2); }\n        .agent-card .desc { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-3); flex:1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }\n        .agent-meta { display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; font-size:var(--font-size-sm); }\n        .badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .badge-cat { background:var(--bg-tertiary); color:var(--text-secondary); }\n        .badge-on { background:var(--success); color:#fff; }\n        .badge-off { background:var(--danger); color:#fff; }\n        .temp-label { color:var(--text-muted); }\n        .card-actions { display:flex; gap:var(--space-2); margin-top:var(--space-3); }\n        .card-actions button { padding:var(--space-1) var(--space-3); border:1px solid var(--border-light); border-radius:var(--radius-md); background:var(--bg-tertiary); color:var(--text-secondary); cursor:pointer; font-size:var(--font-size-sm); }\n        .card-actions button:hover { border-color:var(--accent-primary); color:var(--text-primary); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:700px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n        .form-group { margin-bottom:var(--space-4); }\n        .form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .form-group input, .form-group select, .form-group textarea { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; box-sizing:border-box; }\n        .form-group textarea { min-height:100px; font-family:'Pretendard',sans-serif; resize:vertical; }\n        .form-group textarea.mono { font-family:'Courier New',monospace; min-height:180px; }\n        .form-row { display:flex; gap:var(--space-4); }\n        .form-row .form-group { flex:1; }\n        .range-row { display:flex; align-items:center; gap:var(--space-3); }\n        .range-row input[type=range] { flex:1; }\n        .range-val { min-width:40px; text-align:center; color:var(--accent-primary); font-weight:var(--font-weight-semibold); }\n        .toggle-row { display:flex; align-items:center; gap:var(--space-3); }\n        .toggle-row input[type=checkbox] { width:20px; height:20px; accent-color:var(--accent-primary); }\n        .emoji-picker { display:flex; flex-wrap:wrap; gap:var(--space-2); margin-top:var(--space-2); }\n        .emoji-opt { font-size:1.5rem; cursor:pointer; padding:var(--space-1); border-radius:var(--radius-md); border:2px solid transparent; transition:border-color .2s; }\n        .emoji-opt:hover, .emoji-opt.selected { border-color:var(--accent-primary); background:var(--bg-tertiary); }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); flex-wrap:wrap; }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-save { background:var(--accent-primary); color:#fff; }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n        .btn-danger { background:var(--danger); color:#fff; }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>커스텀 에이전트</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"toolbar\">\n                    <button class=\"btn-primary\" onclick=\"openNew()\">+ 새 에이전트</button>\n                </div>\n                <div id=\"agentList\" class=\"agent-grid\"><div class=\"loading\">불러오는 중...</div></div>\n            </div>\n<div class=\"modal-overlay\" id=\"editorModal\">\n        <div class=\"modal\">\n            <h2 id=\"editorTitle\">새 에이전트</h2>\n            <div class=\"form-group\">\n                <label>이모지</label>\n                <div class=\"emoji-picker\" id=\"emojiPicker\"></div>\n            </div>\n            <div class=\"form-group\"><label>에이전트 이름</label><input type=\"text\" id=\"agentName\" placeholder=\"에이전트 이름\"></div>\n            <div class=\"form-group\"><label>설명</label><textarea id=\"agentDesc\" rows=\"3\" placeholder=\"에이전트 설명...\"></textarea></div>\n            <div class=\"form-group\"><label>시스템 프롬프트</label><textarea id=\"agentPrompt\" class=\"mono\" placeholder=\"시스템 프롬프트를 입력하세요...\"></textarea></div>\n            <div class=\"form-group\"><label>키워드 (쉼표 구분)</label><input type=\"text\" id=\"agentKeywords\" placeholder=\"키워드1, 키워드2, ...\"></div>\n            <div class=\"form-row\">\n                <div class=\"form-group\"><label>카테고리</label>\n                    <select id=\"agentCategory\">\n                        <option value=\"general\">일반</option><option value=\"coding\">코딩</option><option value=\"writing\">글쓰기</option>\n                        <option value=\"analysis\">분석</option><option value=\"creative\">창작</option><option value=\"education\">교육</option>\n                        <option value=\"business\">비즈니스</option><option value=\"science\">과학</option>\n                    </select>\n                </div>\n                <div class=\"form-group\"><label>최대 토큰</label><input type=\"number\" id=\"agentMaxTokens\" value=\"4096\" min=\"1\" max=\"128000\"></div>\n            </div>\n            <div class=\"form-group\">\n                <label>온도</label>\n                <div class=\"range-row\">\n                    <input type=\"range\" id=\"agentTemp\" min=\"0\" max=\"2\" step=\"0.1\" value=\"0.7\">\n                    <span class=\"range-val\" id=\"tempVal\">0.7</span>\n                </div>\n            </div>\n            <div class=\"form-group\">\n                <div class=\"toggle-row\">\n                    <input type=\"checkbox\" id=\"agentEnabled\" checked>\n                    <label for=\"agentEnabled\" style=\"margin:0;cursor:pointer\">활성화</label>\n                </div>\n            </div>\n            <div class=\"modal-actions\">\n                <button class=\"btn-secondary\" onclick=\"closeEditor()\">취소</button>\n                <button class=\"btn-danger\" id=\"btnDelete\" style=\"display:none\" onclick=\"deleteAgent()\">삭제</button>\n                <button class=\"btn-save\" onclick=\"saveAgent()\">저장</button>\n            </div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                const EMOJIS = ['🤖','🧠','💡','📝','🎨','🔬','📊','🛠️','💻','🎯','🔍','📚','✨','🌟','🎓','💼','🏗️','⚡','🔮','🧪'];
        const CAT_LABELS = { general:'일반', coding:'코딩', writing:'글쓰기', analysis:'분석', creative:'창작', education:'교육', business:'비즈니스', science:'과학' };
        let agents = [];
        let editingId = null;
        let selectedEmoji = '🤖';

        function authFetch(url, options = {}) {
            return window.authFetch(url, options).then(r => r.json());
        }
        function showToast(msg, type = 'success') {
            const t = document.getElementById('toast');
            t.textContent = msg; t.className = 'toast ' + type + ' show';
            setTimeout(() => t.classList.remove('show'), 3000);
        }
        function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

        function initEmojiPicker() {
            document.getElementById('emojiPicker').innerHTML = EMOJIS.map(e =>
                '<span class="emoji-opt' + (e === selectedEmoji ? ' selected' : '') + '" data-e="' + e + '">' + e + '</span>'
            ).join('');
        }
        document.getElementById('emojiPicker').addEventListener('click', e => {
            const t = e.target.closest('.emoji-opt');
            if (!t) return;
            selectedEmoji = t.dataset.e;
            document.querySelectorAll('.emoji-opt').forEach(el => el.classList.remove('selected'));
            t.classList.add('selected');
        });

        document.getElementById('agentTemp').addEventListener('input', function() {
            document.getElementById('tempVal').textContent = this.value;
        });

        async function loadAgents() {
            try {
                const res = await authFetch('/api/agents/custom');
                agents = res.data || res || [];
                renderAgents();
            } catch (e) { showToast('에이전트 로드 실패', 'error'); }
        }

        function renderAgents() {
            const el = document.getElementById('agentList');
            if (!agents.length) {
                el.innerHTML = '<div class="empty-state"><h2>커스텀 에이전트가 없습니다</h2><p>새 에이전트를 만들어 시작하세요.</p></div>';
                return;
            }
            el.innerHTML = agents.map(a => `
                <div class="agent-card" onclick="openAgent('${a.id}')">
                    <div class="agent-emoji">${a.emoji || '🤖'}</div>
                    <h3>${esc(a.name)}</h3>
                    <div class="desc">${esc(a.description)}</div>
                    <div class="agent-meta">
                        <span class="badge badge-cat">${CAT_LABELS[a.category] || a.category || '일반'}</span>
                        <span class="badge ${a.enabled !== false ? 'badge-on' : 'badge-off'}">${a.enabled !== false ? '활성' : '비활성'}</span>
                        <span class="temp-label">온도 ${a.temperature != null ? a.temperature : '0.7'}</span>
                    </div>
                    <div class="card-actions">
                        <button onclick="event.stopPropagation();cloneAgent('${a.id}')">복제</button>
                        <button onclick="event.stopPropagation();confirmDelete('${a.id}')">삭제</button>
                    </div>
                </div>`).join('');
        }

        function openNew() {
            editingId = null; selectedEmoji = '🤖';
            document.getElementById('editorTitle').textContent = '새 에이전트';
            document.getElementById('agentName').value = '';
            document.getElementById('agentDesc').value = '';
            document.getElementById('agentPrompt').value = '';
            document.getElementById('agentKeywords').value = '';
            document.getElementById('agentCategory').value = 'general';
            document.getElementById('agentMaxTokens').value = '4096';
            document.getElementById('agentTemp').value = '0.7';
            document.getElementById('tempVal').textContent = '0.7';
            document.getElementById('agentEnabled').checked = true;
            document.getElementById('btnDelete').style.display = 'none';
            initEmojiPicker();
            document.getElementById('editorModal').classList.add('open');
        }

        async function openAgent(id) {
            try {
                const a = agents.find(x => x.id === id) || agents.find(x => String(x.id) === String(id));
                if (!a) return;
                editingId = a.id;
                selectedEmoji = a.emoji || '🤖';
                document.getElementById('editorTitle').textContent = '에이전트 편집';
                document.getElementById('agentName').value = a.name || '';
                document.getElementById('agentDesc').value = a.description || '';
                document.getElementById('agentPrompt').value = a.systemPrompt || '';
                document.getElementById('agentKeywords').value = (a.keywords || []).join(', ');
                document.getElementById('agentCategory').value = a.category || 'general';
                document.getElementById('agentMaxTokens').value = a.maxTokens || 4096;
                document.getElementById('agentTemp').value = a.temperature != null ? a.temperature : 0.7;
                document.getElementById('tempVal').textContent = a.temperature != null ? a.temperature : '0.7';
                document.getElementById('agentEnabled').checked = a.enabled !== false;
                document.getElementById('btnDelete').style.display = '';
                initEmojiPicker();
                document.getElementById('editorModal').classList.add('open');
            } catch (e) { showToast('로드 실패', 'error'); }
        }

        function closeEditor() { document.getElementById('editorModal').classList.remove('open'); }

        async function saveAgent() {
            const name = document.getElementById('agentName').value.trim();
            if (!name) { showToast('이름을 입력하세요', 'error'); return; }
            const body = {
                name,
                description: document.getElementById('agentDesc').value,
                systemPrompt: document.getElementById('agentPrompt').value,
                keywords: document.getElementById('agentKeywords').value.split(',').map(s => s.trim()).filter(Boolean),
                category: document.getElementById('agentCategory').value,
                emoji: selectedEmoji,
                temperature: parseFloat(document.getElementById('agentTemp').value),
                maxTokens: parseInt(document.getElementById('agentMaxTokens').value) || 4096,
                enabled: document.getElementById('agentEnabled').checked
            };
            try {
                if (editingId) {
                    await authFetch('/api/agents/custom/' + editingId, { method:'PUT', body:JSON.stringify(body) });
                    showToast('저장되었습니다');
                } else {
                    await authFetch('/api/agents/custom', { method:'POST', body:JSON.stringify(body) });
                    showToast('에이전트가 생성되었습니다');
                }
                closeEditor(); loadAgents();
            } catch (e) { showToast('저장 실패', 'error'); }
        }

        async function deleteAgent() {
            if (!editingId || !confirm('이 에이전트를 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/agents/custom/' + editingId, { method:'DELETE' });
                showToast('삭제되었습니다'); closeEditor(); loadAgents();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function confirmDelete(id) {
            if (!confirm('이 에이전트를 삭제하시겠습니까?')) return;
            try {
                await authFetch('/api/agents/custom/' + id, { method:'DELETE' });
                showToast('삭제되었습니다'); loadAgents();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function cloneAgent(id) {
            try {
                await authFetch('/api/agents/custom/' + id + '/clone', { method:'POST' });
                showToast('복제되었습니다'); loadAgents();
            } catch (e) { showToast('복제 실패', 'error'); }
        }

        loadAgents();

            // Expose onclick-referenced functions globally
                if (typeof openNew === 'function') window.openNew = openNew;
                if (typeof closeEditor === 'function') window.closeEditor = closeEditor;
                if (typeof deleteAgent === 'function') window.deleteAgent = deleteAgent;
                if (typeof saveAgent === 'function') window.saveAgent = saveAgent;
                if (typeof openAgent === 'function') window.openAgent = openAgent;
            } catch(e) {
                console.error('[PageModule:custom-agents] init error:', e);
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
                try { delete window.deleteAgent; } catch(e) {}
                try { delete window.saveAgent; } catch(e) {}
                try { delete window.openAgent; } catch(e) {}
        }
    };
})();
