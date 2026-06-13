/**
 * ============================================
 * Agent Draft 페이지 — Phase 3 Git URL Ingest 검토 전용
 * ============================================
 * 2026-05-26 재포지셔닝: 기존 'Custom Agent' CRUD 페이지 → my-agents 도입으로 dead 가
 * 된 부분 (CustomAgentBuilder + 수동 페르소나 생성/편집/스킬 관리) 을 모두 제거하고,
 * Phase 3 Git URL Ingest (MCP agent-ingest tool 진입점) 의 draft 검토 전용으로
 * 단순화. 사용자 본인 페르소나는 /my-agents (DB user_agents) 에서 관리.
 *
 * 흐름:
 *   1. 채팅 중 LLM 이 MCP `agent-ingest` 도구 호출 → AgentIngestService
 *      → CustomAgentRepository.insertDraft → status='draft' 저장
 *   2. 본 페이지 진입 → GET /api/agents/custom 으로 draft 목록 조회
 *   3. 사용자가 검토 → 보관 (status=archived) 또는 그대로 둠
 *
 * @module pages/custom-agents
 */
'use strict';
    window.PageModules = window.PageModules || {};
    let _intervals = [];
    let _timeouts = [];

    window.PageModules['custom-agents'] = {
        getHTML: function() {
            return '<div class="page-custom-agents">' +
                '<style data-spa-style="custom-agents">' +
                ".toolbar { display:flex; gap:var(--space-3); align-items:center; flex-wrap:wrap; margin-bottom:var(--space-5); }\n" +
                ".toolbar .btn-primary { padding:var(--space-2) var(--space-4); background:var(--accent-primary); color:#fff; border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n" +
                ".info-banner { background:var(--bg-card); border:1px solid var(--border-light); border-left:3px solid var(--accent-primary); border-radius:var(--radius-md); padding:var(--space-3) var(--space-4); margin-bottom:var(--space-4); color:var(--text-secondary); font-size:var(--font-size-sm); }\n" +
                ".info-banner a { color:var(--accent-primary); text-decoration:none; font-weight:var(--font-weight-semibold); }\n" +
                ".info-banner a:hover { text-decoration:underline; }\n" +
                ".agent-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:var(--space-4); }\n" +
                ".agent-card { background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); padding:var(--space-5); cursor:pointer; transition:border-color .2s; display:flex; flex-direction:column; }\n" +
                ".agent-card:hover { border-color:var(--accent-primary); }\n" +
                ".agent-emoji { font-size:2.5rem; margin-bottom:var(--space-3); }\n" +
                ".agent-card h3 { margin:0 0 var(--space-2); color:var(--text-primary); display:flex; align-items:center; gap:var(--space-2); }\n" +
                ".agent-card .desc { color:var(--text-muted); font-size:var(--font-size-sm); margin-bottom:var(--space-3); flex:1; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }\n" +
                ".agent-meta { display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; font-size:var(--font-size-sm); }\n" +
                ".badge { display:inline-block; padding:2px 8px; border-radius:var(--radius-md); font-size: var(--font-size-xs); font-weight:var(--font-weight-semibold); }\n" +
                ".badge-cat { background:var(--bg-tertiary); color:var(--text-secondary); }\n" +
                ".badge-draft { background:var(--warning-light); color:var(--warning); }\n" +
                ".card-actions { display:flex; gap:var(--space-2); margin-top:var(--space-3); }\n" +
                ".card-actions button { padding:var(--space-1) var(--space-3); border:1px solid var(--border-light); border-radius:var(--radius-md); background:var(--bg-tertiary); color:var(--text-secondary); cursor:pointer; font-size:var(--font-size-sm); }\n" +
                ".card-actions button:hover { border-color:var(--accent-primary); color:var(--text-primary); }\n" +
                ".empty-state { text-align:center; padding:var(--space-8); color:var(--text-muted); grid-column:1/-1; }\n" +
                ".empty-state h2 { color:var(--text-secondary); margin-bottom:var(--space-3); }\n" +
                ".modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:1000; justify-content:center; align-items:center; }\n" +
                ".modal-overlay.open { display:flex; }\n" +
                ".modal { display:block; position:static; height:auto; background:var(--bg-card); border:1px solid var(--border-light); border-radius:var(--radius-lg); width:90%; max-width:700px; max-height:90vh; overflow-y:auto; padding:var(--space-6); }\n" +
                ".modal h2 { margin:0 0 var(--space-4); color:var(--text-primary); }\n" +
                ".form-group { margin-bottom:var(--space-4); }\n" +
                ".form-group label { display:block; margin-bottom:var(--space-2); color:var(--text-secondary); font-size:var(--font-size-sm); font-weight:var(--font-weight-semibold); }\n" +
                ".form-group input, .form-group textarea { width:100%; padding:var(--space-3); background:var(--bg-secondary); border:1px solid var(--border-light); border-radius:var(--radius-md); color:var(--text-primary); font-size:var(--font-size-sm); box-sizing:border-box; }\n" +
                ".form-group textarea { min-height:160px; font-family: var(--font-mono); resize:vertical; }\n" +
                ".form-group textarea[readonly], .form-group input[readonly] { background:var(--bg-tertiary); color:var(--text-secondary); cursor:default; }\n" +
                ".modal-actions { display:flex; gap:var(--space-3); justify-content:flex-end; margin-top:var(--space-5); flex-wrap:wrap; }\n" +
                ".modal-actions button { padding:var(--space-2) var(--space-4); border:none; border-radius:var(--radius-md); cursor:pointer; font-weight:var(--font-weight-semibold); }\n" +
                ".btn-secondary { background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-light) !important; }\n" +
                ".btn-save { background:var(--accent-primary); color:#fff; }\n" +
                ".btn-danger { background:var(--danger); color:#fff; }\n" +
                ".toast { position:fixed; bottom:20px; right:20px; padding:var(--space-3) var(--space-5); border-radius:var(--radius-md); color:#fff; z-index:2000; opacity:0; transition:opacity .3s; }\n" +
                ".toast.show { opacity:1; } .toast.success { background:var(--success); } .toast.error { background:var(--danger); }\n" +
                ".loading { text-align:center; padding:var(--space-6); color:var(--text-muted); }" +
                '<\/style>' +
                "<header class=\"page-header\">\n" +
                "  <button class=\"mobile-menu-btn\" onclick=\"toggleMobileSidebar(event)\">&#9776;</button>\n" +
                "  <h1><iconify-icon icon=lucide:inbox></iconify-icon> Agent Draft</h1>\n" +
                "</header>\n" +
                "<div class=\"content-area\">\n" +
                "  <div class=\"info-banner\">\n" +
                "    Git URL 에서 가져온 Agent 정의 (AGENT.md) 목록입니다. 채팅 중 MCP agent-ingest 도구 또는 아래 버튼으로 추가하고, 여기서 검토·보관합니다.<br>\n" +
                "    본인이 직접 만드는 페르소나는 <a href=\"/settings.html\">설정 → 내 Agent</a> 에서 관리하세요.\n" +
                "  </div>\n" +
                "  <div class=\"toolbar\">\n" +
                "    <button class=\"btn-primary\" id=\"btnImportGit\"><iconify-icon icon=lucide:link></iconify-icon> Git URL 에서 가져오기</button>\n" +
                "  </div>\n" +
                "  <div id=\"agentList\" class=\"agent-grid\"><div class=\"loading\">불러오는 중...</div></div>\n" +
                "</div>\n" +
                "<div class=\"modal-overlay\" id=\"detailModal\">\n" +
                "  <div class=\"modal\">\n" +
                "    <h2 id=\"detailTitle\">Draft 상세</h2>\n" +
                "    <div class=\"form-group\"><label>이름</label><input type=\"text\" id=\"detailName\" readonly></div>\n" +
                "    <div class=\"form-group\"><label>설명</label><input type=\"text\" id=\"detailDesc\" readonly></div>\n" +
                "    <div class=\"form-group\"><label>시스템 프롬프트</label><textarea id=\"detailPrompt\" readonly></textarea></div>\n" +
                "    <div class=\"form-group\"><label>키워드</label><input type=\"text\" id=\"detailKeywords\" readonly></div>\n" +
                "    <div class=\"form-group\"><label>출처 (Git)</label><input type=\"text\" id=\"detailSource\" readonly></div>\n" +
                "    <div class=\"modal-actions\">\n" +
                "      <button class=\"btn-secondary\" id=\"btnCloseDetail\">닫기</button>\n" +
                "      <button class=\"btn-danger\" id=\"btnArchive\">보관</button>\n" +
                "    </div>\n" +
                "  </div>\n" +
                "</div>\n" +
                "<div class=\"modal-overlay\" id=\"agentImportModal\">\n" +
                "  <div class=\"modal\">\n" +
                "    <h2>Git URL 에서 Agent 가져오기</h2>\n" +
                "    <div class=\"form-group\"><label>Git URL <span style=\"color:var(--danger,#ef4444)\">*</span></label><input type=\"text\" id=\"aiGitUrl\" placeholder=\"https://github.com/owner/repo 또는 owner/repo\" maxlength=\"500\"></div>\n" +
                "    <div class=\"form-group\"><label>파일 경로 (선택)</label><input type=\"text\" id=\"aiGitPath\" placeholder=\"agents/legal.AGENT.md (미지정 시 자동 스캔)\" maxlength=\"500\"></div>\n" +
                "    <div class=\"form-group\"><label>GitHub access token (선택)</label><input type=\"password\" id=\"aiGitToken\" placeholder=\"ghp_...\" maxlength=\"200\"></div>\n" +
                "    <div class=\"modal-actions\">\n" +
                "      <button class=\"btn-secondary\" id=\"btnCloseImport\">취소</button>\n" +
                "      <button class=\"btn-save\" id=\"btnSubmitImport\"><iconify-icon icon=lucide:link></iconify-icon> 가져오기</button>\n" +
                "    </div>\n" +
                "  </div>\n" +
                "</div>\n" +
                "<div id=\"toast\" class=\"toast\"></div>" +
            '<\/div>';
        },

        init: function() {
            try {
                const API_ENDPOINTS = window.API_ENDPOINTS || {};
                let drafts = [];
                let detailId = null;

                function authFetch(url, options = {}) {
                    return window.authFetch(url, options).then(r => r.json());
                }
                function showToast(msg, type = 'success') {
                    const t = document.getElementById('toast');
                    if (!t) return;
                    t.textContent = msg; t.className = 'toast ' + type + ' show';
                    setTimeout(() => t.classList.remove('show'), 3000);
                }
                function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

                async function loadDrafts() {
                    try {
                        const res = await authFetch(API_ENDPOINTS.AGENTS_CUSTOM_DRAFTS || '/api/agents/custom/drafts');
                        const data = res && res.data ? res.data : res;
                        drafts = Array.isArray(data) ? data : (data && data.drafts) || [];
                        renderDrafts();
                    } catch (e) { showToast('Draft 로드 실패', 'error'); }
                }

                function renderDrafts() {
                    const el = document.getElementById('agentList');
                    if (!el) return;
                    if (!drafts.length) {
                        el.innerHTML = '<div class="empty-state"><h2>아직 Agent Draft 가 없습니다</h2><p>위의 <strong><iconify-icon icon=lucide:link></iconify-icon> Git URL 에서 가져오기</strong> 또는 채팅 중 LLM 의 <code>agent-ingest</code> 도구로 추가할 수 있습니다.</p></div>';
                        return;
                    }
                    el.innerHTML = drafts.map(a => {
                        const src = (a.manifest_meta && (a.manifest_meta.gitUrl || a.manifest_meta.git_url || a.manifest_meta.source)) || '';
                        return '<div class="agent-card" data-id="' + esc(a.id) + '">' +
                            '<div class="agent-emoji">' + esc(a.emoji || '🤖') + '</div>' +
                            '<h3>' + esc(a.name) + '</h3>' +
                            '<div class="desc">' + esc(a.description || '') + '</div>' +
                            '<div class="agent-meta">' +
                                '<span class="badge badge-draft">draft</span>' +
                                (a.category ? '<span class="badge badge-cat">' + esc(a.category) + '</span>' : '') +
                                (src ? '<span class="badge badge-cat" title="' + esc(src) + '"><iconify-icon icon=lucide:package></iconify-icon> git</span>' : '') +
                            '</div>' +
                            '<div class="card-actions">' +
                                '<button data-action="detail">상세</button>' +
                                '<button data-action="archive">보관</button>' +
                            '</div>' +
                        '</div>';
                    }).join('');
                }

                // 카드 클릭 위임
                const listEl = document.getElementById('agentList');
                listEl.addEventListener('click', (e) => {
                    const btn = e.target.closest('button[data-action]');
                    const card = e.target.closest('.agent-card[data-id]');
                    if (!card) return;
                    const id = card.getAttribute('data-id');
                    const action = btn ? btn.getAttribute('data-action') : 'detail';
                    if (action === 'archive') return archiveDraft(id);
                    return openDetail(id);
                });

                function openDetail(id) {
                    const a = drafts.find(x => String(x.id) === String(id));
                    if (!a) return;
                    detailId = a.id;
                    const src = (a.manifest_meta && (a.manifest_meta.gitUrl || a.manifest_meta.git_url || a.manifest_meta.source)) || '(없음)';
                    document.getElementById('detailTitle').textContent = (a.emoji || '🤖') + ' ' + a.name;
                    document.getElementById('detailName').value = a.name || '';
                    document.getElementById('detailDesc').value = a.description || '';
                    document.getElementById('detailPrompt').value = a.system_prompt || a.systemPrompt || '';
                    document.getElementById('detailKeywords').value = (a.keywords || []).join(', ');
                    document.getElementById('detailSource').value = src;
                    document.getElementById('detailModal').classList.add('open');
                }
                function closeDetail() {
                    detailId = null;
                    document.getElementById('detailModal').classList.remove('open');
                }
                async function archiveDraft(id) {
                    if (!confirm('이 draft 를 보관 (archive) 처리합니다. 목록에서 사라집니다. 계속할까요?')) return;
                    try {
                        const url = (API_ENDPOINTS.AGENTS_CUSTOM_REJECT ? API_ENDPOINTS.AGENTS_CUSTOM_REJECT(id) : '/api/agents/custom/' + encodeURIComponent(id) + '/reject');
                        const res = await authFetch(url, { method: 'POST' });
                        if (res && res.success === false) throw new Error(res.error?.message || 'archive 실패');
                        showToast('보관 완료', 'success');
                        closeDetail();
                        await loadDrafts();
                    } catch (e) { showToast('실패: ' + (e?.message || e), 'error'); }
                }
                document.getElementById('btnArchive').addEventListener('click', () => { if (detailId) archiveDraft(detailId); });
                document.getElementById('btnCloseDetail').addEventListener('click', closeDetail);

                // Git URL import
                function openImport() {
                    document.getElementById('aiGitUrl').value = '';
                    document.getElementById('aiGitPath').value = '';
                    document.getElementById('aiGitToken').value = '';
                    document.getElementById('agentImportModal').classList.add('open');
                }
                function closeImport() {
                    document.getElementById('agentImportModal').classList.remove('open');
                }
                async function submitImport() {
                    const gitUrl = (document.getElementById('aiGitUrl').value || '').trim();
                    if (gitUrl.length < 3) { showToast('Git URL 을 입력하세요', 'error'); return; }
                    const gitPath = (document.getElementById('aiGitPath').value || '').trim() || undefined;
                    const accessToken = (document.getElementById('aiGitToken').value || '').trim() || undefined;
                    const btn = document.getElementById('btnSubmitImport');
                    if (btn) { btn.disabled = true; btn.dataset.origText = btn.innerHTML; btn.innerHTML = '<iconify-icon icon="lucide:loader-circle"></iconify-icon> 가져오는 중...'; }
                    try {
                        const res = await window.authFetch(API_ENDPOINTS.AGENTS_CUSTOM_IMPORT_FROM_GIT || '/api/agents/custom/import-from-git', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
                            body: JSON.stringify({ gitUrl, gitPath, accessToken }),
                        });
                        if (!res.ok) {
                            const e = await res.json().catch(() => ({}));
                            showToast('실패: ' + (e?.error?.message || res.statusText), 'error');
                            return;
                        }
                        const reader = res.body.getReader();
                        const decoder = new TextDecoder();
                        let buffer = ''; let result = null; let errorPayload = null;
                        while (true) {
                            const { value, done } = await reader.read();
                            if (done) break;
                            buffer += decoder.decode(value, { stream: true });
                            const events = buffer.split('\n\n'); buffer = events.pop() || '';
                            for (const raw of events) {
                                const lines = raw.split('\n'); let evName = 'message'; let dataStr = '';
                                for (const ln of lines) {
                                    if (ln.startsWith(':')) continue;
                                    if (ln.startsWith('event:')) evName = ln.slice(6).trim();
                                    else if (ln.startsWith('data:')) dataStr += ln.slice(5).trim();
                                }
                                if (!dataStr) continue;
                                try {
                                    const payload = JSON.parse(dataStr);
                                    if (evName === 'progress' && btn) {
                                        btn.innerHTML = '<iconify-icon icon="lucide:loader-circle"></iconify-icon> ' + (payload.phase || '') + '...';
                                    } else if (evName === 'result') {
                                        result = payload.data;
                                    } else if (evName === 'error') {
                                        errorPayload = payload.error;
                                    }
                                } catch (_e) { /* malformed */ }
                            }
                        }
                        if (errorPayload) { showToast('실패: ' + (errorPayload.message || errorPayload.code), 'error'); return; }
                        if (!result) { showToast('응답이 비어있습니다', 'error'); return; }
                        if (result.selectionRequired) {
                            const choice = window.prompt(
                                '여러 AGENT.md 후보 발견. 번호 선택:\n\n' + result.candidates.map((c, i) => (i + 1) + '. ' + c.path).join('\n'),
                                '1'
                            );
                            const idx = parseInt(choice, 10) - 1;
                            if (Number.isNaN(idx) || idx < 0 || idx >= result.candidates.length) return;
                            document.getElementById('aiGitPath').value = result.candidates[idx].path;
                            return submitImport();
                        }
                        const note = result.deduped ? ' (24시간 내 동일 ref — 기존 draft 재사용)' : '';
                        showToast('Agent draft 가져옴: ' + result.name + note, 'success');
                        closeImport();
                        await loadDrafts();
                    } catch (e) {
                        showToast('오류: ' + (e?.message || String(e)), 'error');
                    } finally {
                        if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.origText || '<iconify-icon icon=lucide:link></iconify-icon> 가져오기'; }
                    }
                }

                document.getElementById('btnImportGit').addEventListener('click', openImport);
                document.getElementById('btnCloseImport').addEventListener('click', closeImport);
                document.getElementById('btnSubmitImport').addEventListener('click', submitImport);

                loadDrafts();
            } catch(e) {
                console.error('[PageModule:custom-agents] init error:', e);
            }
        },

        cleanup: function() {
            _intervals.forEach(function(id) { clearInterval(id); });
            _intervals = [];
            _timeouts.forEach(function(id) { clearTimeout(id); });
            _timeouts = [];
        }
    };

const { getHTML, init, cleanup } = window.PageModules['custom-agents'];
export default { getHTML, init, cleanup };
