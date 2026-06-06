/**
 * ============================================
 * My Agents Page — 사용자별 Custom Agent CRUD
 * ============================================
 * claude.ai Projects / ChatGPT Custom GPTs 동등.
 * /api/users/me/agents 백엔드 호출 + 본인 전용 agent 목록·생성·편집·삭제.
 * 채팅 입력 영역의 user agent dropdown 과 함께 작동.
 *
 * 운영자 정의 시스템 agent (custom-agents.html) 와 별개 — DB 테이블
 * (user_agents) + 권한 (소유자만 접근) + UI 모두 분리.
 *
 * @module pages/my-agents
 * @see backend/api/src/controllers/user-agents.controller.ts
 */
'use strict';
    window.PageModules = window.PageModules || {};
    let _intervals = [];
    let _timeouts = [];

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    const EMOJIS = ['bot','brain','lightbulb','file-text','palette','flask-conical','bar-chart-3','wrench','code','target','search','book','sparkles','star','graduation-cap','briefcase','building-2','zap','wand-2','test-tube'];
    function maIcon(v){ v = v || 'bot'; if (/^[a-z][a-z0-9-]+$/.test(v)) return '<iconify-icon icon=lucide:'+v+'></iconify-icon>'; var d=document.createElement('div'); d.textContent=v; return d.innerHTML; }

    window.PageModules['my-agents'] = {
        getSectionHTML: function() {
            return '<style data-spa-style="my-agents">' +
                ".ma-toolbar { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-5); }\n" +
                ".ma-toolbar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n" +
                ".ma-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n" +
                ".ma-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); display:flex; flex-direction:column; gap:var(--space-2); }\n" +
                ".ma-card-icon { font-size:2.5rem; }\n" +
                ".ma-card h3 { margin:0; color:var(--text-primary); font-size:var(--font-size-md); }\n" +
                ".ma-card .desc { color:var(--text-muted); font-size:var(--font-size-sm); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:32px; }\n" +
                ".ma-card .meta { color:var(--text-muted); font-size:11px; }\n" +
                ".ma-card-actions { display:flex; gap:var(--space-2); margin-top:auto; }\n" +
                ".ma-card-actions button { padding:var(--space-1) var(--space-3); border:1px solid var(--border-light); border-radius:var(--radius-md); background:var(--bg-tertiary); color:var(--text-secondary); cursor:pointer; font-size:var(--font-size-sm); }\n" +
                ".ma-empty { text-align:center; padding:var(--space-8); color:var(--text-muted); grid-column:1/-1; }\n" +
                ".ma-guide { grid-column:1/-1; max-width:600px; margin:var(--space-6) auto; padding:var(--space-6); background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); text-align:left; }\n" +
                ".ma-guide h2 { text-align:center; color:var(--text-primary); margin:0 0 var(--space-2); font-size:var(--font-size-lg); }\n" +
                ".ma-guide .sub { text-align:center; color:var(--text-muted); margin:0 0 var(--space-5); font-size:var(--font-size-sm); }\n" +
                ".ma-guide section { margin-bottom:var(--space-4); }\n" +
                ".ma-guide section h3 { margin:0 0 var(--space-2); color:var(--text-secondary); font-size:11px; font-weight:var(--font-weight-semibold); text-transform:uppercase; letter-spacing:.5px; }\n" +
                ".ma-guide ol, .ma-guide ul { margin:0; padding-left:var(--space-5); color:var(--text-primary); }\n" +
                ".ma-guide li { margin-bottom:var(--space-1); font-size:var(--font-size-sm); line-height:1.6; }\n" +
                ".ma-guide .examples { display:flex; flex-direction:column; gap:var(--space-2); }\n" +
                ".ma-guide .ex-item { padding:var(--space-2) var(--space-3); background:var(--bg-tertiary); border-radius:var(--radius-md); font-size:var(--font-size-sm); color:var(--text-primary); }\n" +
                ".ma-guide .cta { display:block; margin:var(--space-5) auto 0; padding:var(--space-3) var(--space-5); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); font-weight:var(--font-weight-semibold); cursor:pointer; font-size:var(--font-size-md); }\n" +
                ".ma-guide .cta:hover { opacity:.9; }\n" +
                ".ma-modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n" +
                ".ma-modal-overlay.open { display:flex; }\n" +
                ".ma-modal { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:680px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n" +
                ".ma-form-group { margin-bottom:var(--space-4); }\n" +
                ".ma-form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n" +
                ".ma-form-group input, .ma-form-group textarea { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:14px; box-sizing:border-box; }\n" +
                ".ma-form-group textarea { min-height:140px; font-family:inherit; resize:vertical; }\n" +
                ".ma-emoji-picker { display:flex; flex-wrap:wrap; gap:var(--space-2); }\n" +
                ".ma-emoji-opt { font-size:1.5rem; cursor:pointer; padding:var(--space-1); border-radius:var(--radius-md); border:2px solid transparent; }\n" +
                ".ma-emoji-opt.selected { border-color:var(--accent-primary); background:var(--bg-tertiary); }\n" +
                ".ma-modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); }\n" +
                ".ma-modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n" +
                ".ma-btn-save { background:var(--accent-primary); color:#fff; }\n" +
                ".ma-btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n" +
                ".ma-btn-danger { background:var(--danger); color:#fff; }\n" +
                '</style>' +
                '<div class="ma-toolbar">' +
                '<button class="btn-primary" id="maNewBtn">+ 새 Agent</button>' +
                '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">claude.ai Projects / ChatGPT Custom GPTs 동등 — 본인 전용 페르소나</span>' +
                '</div>' +
                '<div id="maList" class="ma-grid"><div class="ma-empty">불러오는 중...</div></div>' +
                '<div class="ma-modal-overlay" id="maEditorModal">' +
                '<div class="ma-modal">' +
                '<h2 id="maEditorTitle">새 Agent</h2>' +
                '<div class="ma-form-group"><label>아이콘</label><div class="ma-emoji-picker" id="maEmojiPicker"></div></div>' +
                '<div class="ma-form-group"><label>이름 (1~80자)</label><input type="text" id="maName" maxlength="80" placeholder="예: 마케팅 카피라이터"></div>' +
                '<div class="ma-form-group"><label>설명 (선택, ~500자)</label><input type="text" id="maDesc" maxlength="500" placeholder="짧은 설명"></div>' +
                '<div class="ma-form-group"><label>System Prompt (1~8000자) — 매 대화 시 prepend</label><textarea id="maSystemPrompt" maxlength="8000" placeholder="당신은 ...입니다. 다음 원칙을 따릅니다: ..."></textarea></div>' +
                '<div class="ma-form-group">' +
                '<label>연결할 스킬 <span style="color:var(--text-muted);font-weight:normal;font-size:11px">(선택. 체크된 스킬의 prompt_md 가 채팅 시 자동 주입됨)</span></label>' +
                '<div id="maSkillList" style="max-height:200px;overflow-y:auto;border:1px solid var(--border-light);border-radius:6px;padding:8px;background:var(--bg-secondary);"><div style="color:var(--text-muted);font-size:var(--font-size-sm);text-align:center;padding:8px;">스킬 로드 중...</div></div>' +
                '</div>' +
                '<div class="ma-modal-actions">' +
                '<button class="ma-btn-secondary" id="maCancelBtn">취소</button>' +
                '<button class="ma-btn-danger" id="maDeleteBtn" style="display:none">삭제</button>' +
                '<button class="ma-btn-save" id="maSaveBtn">저장</button>' +
                '</div>' +
                '</div>' +
                '</div>';
        },

        getHTML: function() {
            return '<div class="page-my-agents">' +
                '<header class="page-header">' +
                '<button class="mobile-menu-btn" onclick="toggleMobileSidebar(event)">&#9776;</button>' +
                '<h1>내 Agent</h1>' +
                '</header>' +
                '<div class="content-area">' +
                window.PageModules['my-agents'].getSectionHTML() +
                '</div>' +
                '</div>';
        },

        init: function() {
            const authFetch = window.authFetch;
            const showToast = window.showToast || function(m){ console.log(m); };

            let editingId = null;
            let selectedEmoji = 'bot';
            let agents = [];
            let availableSkills = [];  // public + 본인 소유 skill 목록 (캐시)

            /**
             * 사용자 가용 skill 목록 조회 + 모달 multi-select 렌더링.
             * GET /api/agents/skills 는 userId 자동 전달 (RBAC) — public OR created_by=me 만.
             */
            async function loadAvailableSkills() {
                try {
                    const res = await authFetch('/api/agents/skills?limit=200');
                    const data = await res.json();
                    const result = data && data.data;
                    availableSkills = (result && (result.items || result.skills || result)) || [];
                    if (!Array.isArray(availableSkills)) availableSkills = [];
                } catch (e) {
                    console.warn('[my-agents] skill 목록 로드 실패:', e);
                    availableSkills = [];
                }
            }

            function renderSkillList(selectedIds) {
                const listEl = document.getElementById('maSkillList');
                if (!listEl) return;
                if (availableSkills.length === 0) {
                    listEl.innerHTML = '<div style="color:var(--text-muted);font-size:var(--font-size-sm);text-align:center;padding:8px;">사용 가능한 스킬이 없습니다. /skill-library.html 에서 추가하세요.</div>';
                    return;
                }
                const ids = new Set(Array.isArray(selectedIds) ? selectedIds : []);
                listEl.innerHTML = availableSkills.map(function(s) {
                    const checked = ids.has(s.id) ? 'checked' : '';
                    const catBadge = s.category ? ' <span style="background:var(--bg-tertiary);color:var(--text-muted);font-size:10px;padding:1px 5px;border-radius:3px;margin-left:4px;">' + esc(s.category) + '</span>' : '';
                    const pubMark = s.is_public ? ' <iconify-icon icon=lucide:globe></iconify-icon>' : '';
                    return '<label style="display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:4px;cursor:pointer;hover:background:var(--bg-tertiary);">' +
                        '<input type="checkbox" class="ma-skill-cb" data-skill-id="' + esc(s.id) + '" ' + checked + ' style="margin-top:3px;flex-shrink:0;">' +
                        '<div style="flex:1;min-width:0;">' +
                        '<div style="font-size:var(--font-size-sm);font-weight:600;color:var(--text-primary);">' + esc(s.name) + pubMark + catBadge + '</div>' +
                        (s.description ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + esc(s.description) + '</div>' : '') +
                        '</div></label>';
                }).join('');
            }

            function getSelectedSkillIds() {
                return Array.from(document.querySelectorAll('.ma-skill-cb:checked')).map(function(c){ return c.getAttribute('data-skill-id'); });
            }

            function initEmojiPicker() {
                const picker = document.getElementById('maEmojiPicker');
                if (!picker) return;
                picker.innerHTML = EMOJIS.map(function(e){ return '<span class="ma-emoji-opt" data-emoji="' + esc(e) + '"><iconify-icon icon=lucide:' + esc(e) + '></iconify-icon></span>'; }).join('');
                picker.querySelectorAll('.ma-emoji-opt').forEach(function(el){
                    el.addEventListener('click', function(){
                        selectedEmoji = el.getAttribute('data-emoji');
                        picker.querySelectorAll('.ma-emoji-opt').forEach(function(o){ o.classList.remove('selected'); });
                        el.classList.add('selected');
                    });
                });
                picker.querySelector('[data-emoji="' + selectedEmoji + '"]').classList.add('selected');
            }

            async function loadAgents() {
                const listEl = document.getElementById('maList');
                if (!listEl) return;
                try {
                    const res = await authFetch('/api/users/me/agents');
                    const data = await res.json();
                    agents = (data && data.data && data.data.agents) || [];
                    if (!agents.length) {
                        listEl.innerHTML = '<div class="ma-guide">' +
                            '<h2><iconify-icon icon=lucide:bot></iconify-icon> 아직 Agent 가 없어요</h2>' +
                            '<p class="sub">Custom Agent 로 본인 전용 페르소나를 만들고 채팅 입력창 우측 dropdown 에서 선택해 사용할 수 있습니다.</p>' +
                            '<section><h3>할 수 있는 것</h3><ul>' +
                                '<li>시스템 프롬프트로 페르소나·말투·역할 고정</li>' +
                                '<li>산업 agent 자동 라우팅 우회 — 본인 페르소나가 우선</li>' +
                                '<li>스킬 다중 선택으로 도메인 지식 자동 주입</li>' +
                            '</ul></section>' +
                            '<section><h3>생성 단계</h3><ol>' +
                                '<li>위의 <strong>+ 새 Agent</strong> 또는 아래 버튼 클릭</li>' +
                                '<li>아이콘·이름·짧은 설명 입력</li>' +
                                '<li><strong>System Prompt</strong> 작성 (페르소나 정의·원칙·말투 등)</li>' +
                                '<li>(선택) 활용할 스킬 다중 선택 — prompt_md 가 자동 주입됨</li>' +
                                '<li>저장 → 채팅 입력창 우측 dropdown 에서 즉시 사용</li>' +
                            '</ol></section>' +
                            '<section><h3>예시 페르소나</h3><div class="examples">' +
                                '<div class="ex-item"><iconify-icon icon=lucide:users></iconify-icon> <strong>한국 노동시장 분석가</strong> — labor-economist 스킬 연결, 1차/2차 시장 관점 강조</div>' +
                                '<div class="ex-item"><iconify-icon icon=lucide:code></iconify-icon> <strong>Python TDD 코치</strong> — 테스트 먼저, 함수 작성 시 docstring·타입 힌트 필수</div>' +
                                '<div class="ex-item"><iconify-icon icon=lucide:palette></iconify-icon> <strong>UX 카피라이터</strong> — 간결한 한국어, 명령형보다 권유형 어투</div>' +
                            '</div></section>' +
                            '<button class="cta" id="maGuideCta">+ 새 Agent 만들기</button>' +
                            '</div>';
                        const cta = document.getElementById('maGuideCta');
                        if (cta) cta.addEventListener('click', function(){
                            const newBtn = document.getElementById('maNewBtn');
                            if (newBtn) newBtn.click();
                        });
                        return;
                    }
                    listEl.innerHTML = agents.map(function(a){
                        return '<div class="ma-card" data-id="' + esc(a.id) + '">' +
                            '<div class="ma-card-icon">' + maIcon(a.icon) + '</div>' +
                            '<h3>' + esc(a.name) + '</h3>' +
                            '<div class="desc">' + esc(a.description || '') + '</div>' +
                            '<div class="meta">사용 ' + (a.usage_count || 0) + '회</div>' +
                            '<div class="ma-card-actions"><button data-action="edit">편집</button><button data-action="delete">삭제</button></div>' +
                            '</div>';
                    }).join('');
                    listEl.querySelectorAll('.ma-card').forEach(function(card){
                        const id = card.getAttribute('data-id');
                        card.querySelector('[data-action="edit"]').addEventListener('click', function(){ openEditor(id); });
                        card.querySelector('[data-action="delete"]').addEventListener('click', function(){ deleteAgent(id); });
                    });
                } catch (e) {
                    console.error('[my-agents] load 실패:', e);
                    listEl.innerHTML = '<div class="ma-empty">로드 실패</div>';
                }
            }

            function openEditor(id) {
                editingId = id || null;
                const modal = document.getElementById('maEditorModal');
                document.getElementById('maEditorTitle').textContent = id ? 'Agent 편집' : '새 Agent';
                document.getElementById('maDeleteBtn').style.display = id ? '' : 'none';
                let preselectedSkills = [];
                if (id) {
                    const a = agents.find(function(x){ return x.id === id; });
                    if (!a) return;
                    selectedEmoji = a.icon || 'bot';
                    document.getElementById('maName').value = a.name || '';
                    document.getElementById('maDesc').value = a.description || '';
                    document.getElementById('maSystemPrompt').value = a.system_prompt || '';
                    preselectedSkills = Array.isArray(a.allowed_skills) ? a.allowed_skills : [];
                } else {
                    selectedEmoji = 'bot';
                    document.getElementById('maName').value = '';
                    document.getElementById('maDesc').value = '';
                    document.getElementById('maSystemPrompt').value = '';
                }
                initEmojiPicker();
                renderSkillList(preselectedSkills);
                modal.classList.add('open');
            }
            function closeEditor() { document.getElementById('maEditorModal').classList.remove('open'); }

            async function saveAgent() {
                const name = document.getElementById('maName').value.trim();
                const description = document.getElementById('maDesc').value.trim();
                const systemPrompt = document.getElementById('maSystemPrompt').value.trim();
                if (!name) { showToast('이름을 입력하세요', 'error'); return; }
                if (!systemPrompt) { showToast('System Prompt 를 입력하세요', 'error'); return; }
                const allowedSkills = getSelectedSkillIds();
                const body = { name: name, description: description || null, systemPrompt: systemPrompt, icon: selectedEmoji, allowedSkills: allowedSkills };
                try {
                    const url = editingId ? '/api/users/me/agents/' + encodeURIComponent(editingId) : '/api/users/me/agents';
                    const method = editingId ? 'PUT' : 'POST';
                    const res = await authFetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                    if (!res.ok) {
                        const err = await res.json().catch(function(){ return {}; });
                        showToast((err && err.error && err.error.message) || '저장 실패', 'error');
                        return;
                    }
                    closeEditor();
                    showToast(editingId ? 'Agent 갱신됨' : 'Agent 생성됨', 'success');
                    loadAgents();
                } catch (e) {
                    console.error('[my-agents] save 실패:', e);
                    showToast('저장 실패', 'error');
                }
            }

            async function deleteAgent(id) {
                if (!confirm('이 Agent 를 삭제하시겠습니까? (soft delete)')) return;
                try {
                    const res = await authFetch('/api/users/me/agents/' + encodeURIComponent(id), { method: 'DELETE' });
                    if (!res.ok) { showToast('삭제 실패', 'error'); return; }
                    showToast('Agent 삭제됨', 'success');
                    loadAgents();
                } catch (e) {
                    console.error('[my-agents] delete 실패:', e);
                    showToast('삭제 실패', 'error');
                }
            }

            // 이벤트 바인딩
            document.getElementById('maNewBtn').addEventListener('click', function(){ openEditor(null); });
            document.getElementById('maCancelBtn').addEventListener('click', closeEditor);
            document.getElementById('maSaveBtn').addEventListener('click', saveAgent);
            document.getElementById('maDeleteBtn').addEventListener('click', function(){
                if (editingId) deleteAgent(editingId);
                closeEditor();
            });
            loadAgents();
            loadAvailableSkills();  // 모달 열 때 즉시 렌더링되도록 사전 캐시
        },

        cleanup: function() {
            _intervals.forEach(function(i){ clearInterval(i); }); _intervals = [];
            _timeouts.forEach(function(t){ clearTimeout(t); }); _timeouts = [];
        }
    };

const { getHTML, init, cleanup, getSectionHTML } = window.PageModules['my-agents'];
export default { getHTML, init, cleanup, getSectionHTML };
