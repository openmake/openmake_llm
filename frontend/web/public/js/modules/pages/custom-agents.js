/**
 * ============================================
 * Custom Agents Page - 커스텀 에이전트 관리
 * ============================================
 * 사용자 정의 AI 에이전트의 생성, 편집, 삭제, 테스트를
 * 관리하는 SPA 페이지 모듈입니다. 시스템 프롬프트,
 * 모델 선택, 도구 설정 등 에이전트 구성을 제공합니다.
 * 스킬 관리 기능 포함 — 에이전트에 스킬을 연결하여
 * 시스템 프롬프트에 자동 주입할 수 있습니다.
 *
 * @module pages/custom-agents
 */
'use strict';
    let _intervals = [];
    let _timeouts = [];

    const pageModule = {
        getHTML: function() {
            return '<div class="page-custom-agents">' +
                '<style data-spa-style="custom-agents">' +
                ".toolbar { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-5); }\n        .toolbar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .agent-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n        .agent-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; display:flex; flex-direction:column; }\n        .agent-card:hover { border-color:var(--accent-primary); }\n        .agent-emoji { font-size:2.5rem; margin-bottom:var(--space-3); }\n        .agent-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); display:flex; align-items:center; gap:var(--space-2); }\n        .agent-card .desc { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-3); flex:1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }\n        .agent-meta { display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; font-size:var(--font-size-sm); }\n        .badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size:11px; font-weight:var(--font-weight-semibold); }\n        .badge-cat { background:var(--bg-tertiary); color:var(--text-secondary); }\n        .badge-on { background:var(--success); color:#fff; }\n        .badge-off { background:var(--danger); color:#fff; }\n        .temp-label { color:var(--text-muted); }\n        .card-actions { display:flex; gap:var(--space-2); margin-top:var(--space-3); }\n        .card-actions button { padding:var(--space-1) var(--space-3); border:1px solid var(--border-light); border-radius:var(--radius-md); background:var(--bg-tertiary); color:var(--text-secondary); cursor:pointer; font-size:var(--font-size-sm); }\n        .card-actions button:hover { border-color:var(--accent-primary); color:var(--text-primary); }\n        .empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); }\n        .empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n\n        .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n        .modal-overlay.open { display:flex; }\n        .modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:700px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n        .modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n        .form-group { margin-bottom:var(--space-4); }\n        .form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n        .form-group input, .form-group select, .form-group textarea { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; box-sizing:border-box; }\n        .form-group textarea { min-height:100px; font-family:'Pretendard',sans-serif; resize:vertical; }\n        .form-group textarea.mono { font-family:'Courier New',monospace; min-height:180px; }\n        .form-row { display:flex; gap:var(--space-4); }\n        .form-row .form-group { flex:1; }\n        .range-row { display:flex; align-items:center; gap:var(--space-3); }\n        .range-row input[type=range] { flex:1; }\n        .range-val { min-width:40px; text-align:center; color:var(--accent-primary); font-weight:var(--font-weight-semibold); }\n        .toggle-row { display:flex; align-items:center; gap:var(--space-3); }\n        .toggle-row input[type=checkbox] { width:20px; height:20px; accent-color:var(--accent-primary); }\n        .emoji-picker { display:flex; flex-wrap:wrap; gap:var(--space-2); margin-top:var(--space-2); }\n        .emoji-opt { font-size:1.5rem; cursor:pointer; padding:var(--space-1); border-radius:var(--radius-md); border:2px solid transparent; transition:border-color .2s; }\n        .emoji-opt:hover, .emoji-opt.selected { border-color:var(--accent-primary); background:var(--bg-tertiary); }\n        .modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); flex-wrap:wrap; }\n        .modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n        .btn-save { background:var(--accent-primary); color:#fff; }\n        .btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n        .btn-danger { background:var(--danger); color:#fff; }\n        .toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n        .toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n        .loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }\n\n        .skills-panel { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); margin-bottom:var(--space-5); }\n        .skills-panel-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:var(--space-4); }\n        .skills-panel-header h2 { margin:0; color:var(--text-primary); }\n        .skill-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:var(--space-3); }\n        .skill-card { background:var(--bg-tertiary); border:1px solid var(--border-light); border-radius:var(--radius-md); padding:var(--space-4); cursor:pointer; transition:border-color .2s; }\n        .skill-card:hover { border-color:var(--accent-primary); }\n        .skill-card h4 { margin:0 0 var(--space-1); color:var(--text-primary); font-size:var(--font-size-sm); }\n        .skill-card .skill-desc { color:var(--text-muted); font-size:12px; margin-bottom:var(--space-2); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }\n        .skill-card .badge { font-size:10px; }\n        .agent-skills-list { display:flex; flex-direction:column; gap:var(--space-2); max-height:200px; overflow-y:auto; border:1px solid var(--border-light); border-radius:var(--radius-md); padding:var(--space-3); background:var(--bg-secondary); }\n        .skill-checkbox-item { display:flex; align-items:center; gap:var(--space-2); }\n        .skill-checkbox-item input[type=checkbox] { width:16px; height:16px; cursor:pointer; accent-color:var(--accent-primary); }\n        .skill-checkbox-item label { cursor:pointer; color:var(--text-primary); font-size:var(--font-size-sm); }\n        .skills-empty { color:var(--text-muted); font-size:var(--font-size-sm); text-align:center; padding:var(--space-3); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n                <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n                <h1>커스텀 에이전트</h1>\n            </header>\n            <div class=\"content-area\">\n                <div class=\"toolbar\">\n                    <button class=\"btn-primary\" onclick=\"openNew()\">+ 새 에이전트</button>\n                    <button class=\"btn-secondary\" id=\"btnOpenSkills\">🎯 스킬 관리</button>\n                </div>\n                <div id=\"skillsPanel\" class=\"skills-panel\" style=\"display:none\">\n                    <div class=\"skills-panel-header\">\n                        <h2>스킬 관리</h2>\n                        <button class=\"btn-primary\" id=\"btnNewSkill\">+ 새 스킬</button>\n                    </div>\n                    <div id=\"skillList\" class=\"skill-grid\"><div class=\"loading\">불러오는 중...</div></div>\n                </div>\n                <div id=\"agentList\" class=\"agent-grid\"><div class=\"loading\">불러오는 중...</div></div>\n            </div>\n<div class=\"modal-overlay\" id=\"editorModal\">\n        <div class=\"modal\">\n            <h2 id=\"editorTitle\">새 에이전트</h2>\n            <div class=\"form-group\">\n                <label>이모지</label>\n                <div class=\"emoji-picker\" id=\"emojiPicker\"></div>\n            </div>\n            <div class=\"form-group\"><label>에이전트 이름</label><input type=\"text\" id=\"agentName\" placeholder=\"에이전트 이름\"></div>\n            <div class=\"form-group\"><label>설명</label><textarea id=\"agentDesc\" rows=\"3\" placeholder=\"에이전트 설명...\"></textarea></div>\n            <div class=\"form-group\"><label>시스템 프롬프트</label><textarea id=\"agentPrompt\" class=\"mono\" placeholder=\"시스템 프롬프트를 입력하세요...\"></textarea></div>\n            <div class=\"form-group\"><label>키워드 (쉼표 구분)</label><input type=\"text\" id=\"agentKeywords\" placeholder=\"키워드1, 키워드2, ...\"></div>\n            <div class=\"form-row\">\n                <div class=\"form-group\"><label>카테고리</label>\n                    <select id=\"agentCategory\">\n                        <option value=\"general\">일반</option><option value=\"coding\">코딩</option><option value=\"writing\">글쓰기</option>\n                        <option value=\"analysis\">분석</option><option value=\"creative\">창작</option><option value=\"education\">교육</option>\n                        <option value=\"business\">비즈니스</option><option value=\"science\">과학</option>\n                    </select>\n                </div>\n                <div class=\"form-group\"><label>최대 토큰</label><input type=\"number\" id=\"agentMaxTokens\" value=\"4096\" min=\"1\" max=\"128000\"></div>\n            </div>\n            <div class=\"form-group\">\n                <label>온도</label>\n                <div class=\"range-row\">\n                    <input type=\"range\" id=\"agentTemp\" min=\"0\" max=\"2\" step=\"0.1\" value=\"0.7\">\n                    <span class=\"range-val\" id=\"tempVal\">0.7</span>\n                </div>\n            </div>\n            <div class=\"form-group\">\n                <div class=\"toggle-row\">\n                    <input type=\"checkbox\" id=\"agentEnabled\" checked>\n                    <label for=\"agentEnabled\" style=\"margin:0;cursor:pointer\">활성화</label>\n                </div>\n            </div>\n            <div class=\"form-group\" id=\"agentSkillsSection\">\n                <label>연결된 스킬 <span style=\"color:var(--text-muted);font-weight:normal;font-size:11px\">(체크된 스킬이 시스템 프롬프트에 자동 주입됩니다)</span></label>\n                <div id=\"agentSkillsList\" class=\"agent-skills-list\"><div class=\"skills-empty\">스킬 로드 중...</div></div>\n            </div>\n            <div class=\"modal-actions\">\n                <button class=\"btn-secondary\" onclick=\"closeEditor()\">취소</button>\n                <button class=\"btn-danger\" id=\"btnDelete\" style=\"display:none\" onclick=\"deleteAgent()\">삭제</button>\n                <button class=\"btn-save\" onclick=\"saveAgent()\">저장</button>\n            </div>\n        </div>\n    </div>\n<div class=\"modal-overlay\" id=\"skillModal\">\n        <div class=\"modal\">\n            <h2 id=\"skillModalTitle\">새 스킬</h2>\n            <div class=\"form-group\"><label>스킬 이름</label><input type=\"text\" id=\"skillName\" placeholder=\"스킬 이름\"></div>\n            <div class=\"form-group\"><label>설명</label><input type=\"text\" id=\"skillDesc\" placeholder=\"스킬 설명\"></div>\n            <div class=\"form-group\"><label>카테고리</label>\n                <select id=\"skillCategory\">\n                    <option value=\"general\">일반</option><option value=\"coding\">코딩</option><option value=\"writing\">글쓰기</option>\n                    <option value=\"analysis\">분석</option><option value=\"creative\">창작</option><option value=\"education\">교육</option>\n                    <option value=\"business\">비즈니스</option><option value=\"science\">과학</option>\n                </select>\n            </div>\n            <div class=\"form-group\"><label>스킬 내용 <span style=\"color:var(--text-muted);font-weight:normal;font-size:11px\">(시스템 프롬프트에 주입됨)</span></label><textarea id=\"skillContent\" class=\"mono\" rows=\"8\" placeholder=\"스킬 내용을 입력하세요...\"></textarea></div>\n            <div class=\"modal-actions\">\n                <button class=\"btn-secondary\" id=\"btnCloseSkillModal\">취소</button>\n                <button class=\"btn-danger\" id=\"btnDeleteSkill\" style=\"display:none\">삭제</button>\n                <button class=\"btn-save\" id=\"btnSaveSkill\">저장</button>\n            </div>\n        </div>\n    </div>\n<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                const EMOJIS = ['🤖','🧠','💡','📝','🎨','🔬','📊','🛠️','💻','🎯','🔍','📚','✨','🌟','🎓','💼','🏗️','⚡','🔮','🧪'];
        const CAT_LABELS = { general:'일반', coding:'코딩', writing:'글쓰기', analysis:'분석', creative:'창작', education:'교육', business:'비즈니스', science:'과학' };
        let agents = [];
        let editingId = null;
        let selectedEmoji = '🤖';

        // Skills state
        let skills = [];
        let editingSkillId = null;

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
                const res = await authFetch(API_ENDPOINTS.AGENTS_CUSTOM);
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
                        <span class="badge badge-cat">${CAT_LABELS[a.category] || esc(a.category) || '일반'}</span>
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
            document.getElementById('agentSkillsList').innerHTML = '<div class="skills-empty">에이전트를 저장한 후 스킬을 연결할 수 있습니다.</div>';
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
                // Load skills for this agent
                await loadSkills();
                const assignedIds = await loadAgentSkills(a.id);
                renderAgentSkillsSection(a.id, assignedIds);
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
                    await authFetch(API_ENDPOINTS.AGENTS_CUSTOM + '/' + editingId, { method:'PUT', body:JSON.stringify(body) });
                    showToast('저장되었습니다');
                } else {
                    await authFetch(API_ENDPOINTS.AGENTS_CUSTOM, { method:'POST', body:JSON.stringify(body) });
                    showToast('에이전트가 생성되었습니다');
                }
                closeEditor(); loadAgents();
            } catch (e) { showToast('저장 실패', 'error'); }
        }

        async function deleteAgent() {
            if (!editingId || !confirm('이 에이전트를 삭제하시겠습니까?')) return;
            try {
                await authFetch(API_ENDPOINTS.AGENTS_CUSTOM + '/' + editingId, { method:'DELETE' });
                showToast('삭제되었습니다'); closeEditor(); loadAgents();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function confirmDelete(id) {
            if (!confirm('이 에이전트를 삭제하시겠습니까?')) return;
            try {
                await authFetch(API_ENDPOINTS.AGENTS_CUSTOM + '/' + id, { method:'DELETE' });
                showToast('삭제되었습니다'); loadAgents();
            } catch (e) { showToast('삭제 실패', 'error'); }
        }

        async function cloneAgent(id) {
            if (!confirm('이 에이전트를 복제하시겠습니까?')) return;
            try {
                await authFetch(API_ENDPOINTS.AGENTS_CUSTOM + '/' + id + '/clone', { method:'POST' });
                showToast('복제되었습니다'); loadAgents();
            } catch (e) { showToast('복제 실패', 'error'); }
        }

        // ─── Skills Management ─────────────────────────────────────────────

        async function loadSkills() {
            try {
                const res = await authFetch(API_ENDPOINTS.AGENTS_SKILLS);
                skills = res.data || [];
                renderSkills();
            } catch (e) {
                skills = [];
                console.error('[custom-agents] loadSkills error:', e);
            }
        }

        function renderSkills() {
            const el = document.getElementById('skillList');
            if (!el) return;
            if (!skills.length) {
                el.innerHTML = '<div class="empty-state"><p>스킬이 없습니다. 새 스킬을 만들어보세요.</p></div>';
                return;
            }
            el.innerHTML = skills.map(s => `
                <div class="skill-card" onclick="openSkill('${esc(s.id)}')">
                    <h4>${esc(s.name)}</h4>
                    <div class="skill-desc">${esc(s.description || '')}</div>
                    <span class="badge badge-cat">${esc(CAT_LABELS[s.category] || s.category || '일반')}</span>
                </div>`).join('');
        }

        function openSkillsPanel() {
            const panel = document.getElementById('skillsPanel');
            const isOpen = panel.style.display !== 'none';
            if (isOpen) {
                panel.style.display = 'none';
            } else {
                panel.style.display = '';
                loadSkills();
            }
        }

        function openNewSkill() {
            editingSkillId = null;
            document.getElementById('skillModalTitle').textContent = '새 스킬';
            document.getElementById('skillName').value = '';
            document.getElementById('skillDesc').value = '';
            document.getElementById('skillCategory').value = 'general';
            document.getElementById('skillContent').value = '';
            document.getElementById('btnDeleteSkill').style.display = 'none';
            document.getElementById('skillModal').classList.add('open');
        }

        function openSkill(id) {
            const s = skills.find(x => x.id === id);
            if (!s) return;
            editingSkillId = s.id;
            document.getElementById('skillModalTitle').textContent = '스킬 편집';
            document.getElementById('skillName').value = s.name || '';
            document.getElementById('skillDesc').value = s.description || '';
            document.getElementById('skillCategory').value = s.category || 'general';
            document.getElementById('skillContent').value = s.content || '';
            document.getElementById('btnDeleteSkill').style.display = '';
            document.getElementById('skillModal').classList.add('open');
        }

        function closeSkillModal() {
            document.getElementById('skillModal').classList.remove('open');
        }

        async function saveSkill() {
            const name = document.getElementById('skillName').value.trim();
            if (!name) { showToast('스킬 이름을 입력하세요', 'error'); return; }
            const body = {
                name,
                description: document.getElementById('skillDesc').value.trim(),
                category: document.getElementById('skillCategory').value,
                content: document.getElementById('skillContent').value.trim()
            };
            try {
                if (editingSkillId) {
                    await authFetch(API_ENDPOINTS.AGENTS_SKILLS + '/' + editingSkillId, { method:'PUT', body:JSON.stringify(body) });
                    showToast('스킬이 저장되었습니다');
                } else {
                    await authFetch(API_ENDPOINTS.AGENTS_SKILLS, { method:'POST', body:JSON.stringify(body) });
                    showToast('스킬이 생성되었습니다');
                }
                closeSkillModal();
                loadSkills();
            } catch (e) { showToast('스킬 저장 실패', 'error'); }
        }

        async function deleteSkill() {
            if (!editingSkillId || !confirm('이 스킬을 삭제하시겠습니까?')) return;
            try {
                await authFetch(API_ENDPOINTS.AGENTS_SKILLS + '/' + editingSkillId, { method:'DELETE' });
                showToast('스킬이 삭제되었습니다');
                closeSkillModal();
                loadSkills();
            } catch (e) { showToast('스킬 삭제 실패', 'error'); }
        }

        async function loadAgentSkills(agentId) {
            try {
                const res = await authFetch(API_ENDPOINTS.AGENTS + '/' + agentId + '/skills');
                const assigned = res.data || [];
                return assigned.map(s => s.id);
            } catch (e) {
                console.error('[custom-agents] loadAgentSkills error:', e);
                return [];
            }
        }

        async function toggleAgentSkill(agentId, skillId, assign) {
            try {
                if (assign) {
                    await authFetch(API_ENDPOINTS.AGENTS + '/' + agentId + '/skills/' + skillId, { method:'POST' });
                } else {
                    await authFetch(API_ENDPOINTS.AGENTS + '/' + agentId + '/skills/' + skillId, { method:'DELETE' });
                }
            } catch (e) {
                showToast('스킬 변경 실패', 'error');
                // Revert checkbox
                const cb = document.getElementById('sk-' + skillId);
                if (cb) cb.checked = !assign;
            }
        }

        function renderAgentSkillsSection(agentId, assignedIds) {
            const el = document.getElementById('agentSkillsList');
            if (!el) return;
            if (!skills.length) {
                el.innerHTML = '<div class="skills-empty">사용 가능한 스킬이 없습니다. 스킬 관리에서 스킬을 먼저 만들어 주세요.</div>';
                return;
            }
            el.innerHTML = skills.map(s => `
                <div class="skill-checkbox-item">
                    <input type="checkbox" id="sk-${esc(s.id)}" data-skill-id="${esc(s.id)}" ${assignedIds.includes(s.id) ? 'checked' : ''}>
                    <label for="sk-${esc(s.id)}">${esc(s.name)} <span style="color:var(--text-muted);font-size:11px">(${esc(CAT_LABELS[s.category] || s.category || '일반')})</span></label>
                </div>`).join('');
            // Bind change events for real-time assignment
            el.querySelectorAll('input[type=checkbox]').forEach(cb => {
                cb.addEventListener('change', function() {
                    toggleAgentSkill(agentId, this.dataset.skillId, this.checked);
                });
            });
        }

        // ─── Event Bindings ────────────────────────────────────────────────

        document.getElementById('btnOpenSkills').addEventListener('click', openSkillsPanel);
        document.getElementById('btnNewSkill').addEventListener('click', openNewSkill);
        document.getElementById('btnSaveSkill').addEventListener('click', saveSkill);
        document.getElementById('btnDeleteSkill').addEventListener('click', deleteSkill);
        document.getElementById('btnCloseSkillModal').addEventListener('click', closeSkillModal);

        loadAgents();

            // Expose onclick-referenced functions globally
                if (typeof openNew === 'function') window.openNew = openNew;
                if (typeof closeEditor === 'function') window.closeEditor = closeEditor;
                if (typeof deleteAgent === 'function') window.deleteAgent = deleteAgent;
                if (typeof saveAgent === 'function') window.saveAgent = saveAgent;
                if (typeof openAgent === 'function') window.openAgent = openAgent;
                if (typeof cloneAgent === 'function') window.cloneAgent = cloneAgent;
                if (typeof confirmDelete === 'function') window.confirmDelete = confirmDelete;
                if (typeof openSkill === 'function') window.openSkill = openSkill;
                if (typeof openSkillsPanel === 'function') window.openSkillsPanel = openSkillsPanel;
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
                try { delete window.cloneAgent; } catch(e) {}
                try { delete window.confirmDelete; } catch(e) {}
                try { delete window.openSkill; } catch(e) {}
                try { delete window.openSkillsPanel; } catch(e) {}
        }
    };

export default pageModule;
