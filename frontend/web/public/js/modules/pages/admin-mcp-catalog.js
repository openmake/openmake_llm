/**
 * ============================================
 * Admin — MCP Catalog 관리 페이지 (Phase 4.6)
 * ============================================
 * mcp_server_catalog 테이블 CRUD UI.
 *
 * REST: /api/admin/mcp/catalog (admin 전용 — 라우트 가드 + 미들웨어 강제)
 *
 * 보안:
 *   - 모든 user-provided 데이터 escapeHTML 거치고 innerHTML 사용
 *   - args_schema / env_schema 는 textarea(JSON) 입력 — JSON.parse 검증
 *   - secret 필드는 JSON Schema 의 secret:true hint 로 표시
 *
 * @module pages/admin-mcp-catalog
 */
'use strict';

const escapeHTML = (str) => {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
};

window.PageModules = window.PageModules || {};

const STATE = {
    templates: [],
    editingId: null,
};

let _listeners = [];

function addListener(target, event, handler) {
    target.addEventListener(event, handler);
    _listeners.push({ target, event, handler });
}

function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
    else console.log('[toast]', type || 'info', msg);
}

async function fetchJson(path, init) {
    const opts = Object.assign({ credentials: 'include' }, init || {});
    if (opts.body && typeof opts.body !== 'string') {
        opts.body = JSON.stringify(opts.body);
        opts.headers = Object.assign({}, opts.headers || {}, { 'Content-Type': 'application/json' });
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || res.statusText;
        const details = data && data.details
            ? `: ${Array.isArray(data.details) ? JSON.stringify(data.details) : data.details}`
            : '';
        throw new Error(`${msg}${details}`);
    }
    return data;
}

async function loadTemplates() {
    const grid = document.getElementById('admin-mcp-catalog-tbody');
    if (!grid) return;
    try {
        const data = await fetchJson('/api/admin/mcp/catalog');
        STATE.templates = (data && data.data && data.data.templates) || [];
        renderTemplates();
    } catch (e) {
        grid.innerHTML = `<tr><td colspan="6" style="color:var(--text-muted);">로드 실패: ${escapeHTML(e.message || e)}</td></tr>`;
    }
}

function renderTemplates() {
    const tbody = document.getElementById('admin-mcp-catalog-tbody');
    if (!tbody) return;
    if (STATE.templates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);">템플릿이 없습니다.</td></tr>';
        return;
    }
    tbody.innerHTML = STATE.templates.map(t => {
        const enabledBadge = t.is_enabled
            ? '<span class="badge" style="background:var(--success-bg,#10b981);color:#fff;">활성</span>'
            : '<span class="badge" style="background:var(--text-muted);color:#fff;">비활성</span>';
        return `<tr>
            <td><code>${escapeHTML(t.id)}</code></td>
            <td>${escapeHTML(t.display_name)}</td>
            <td>${escapeHTML(t.transport_type)}</td>
            <td>${escapeHTML(t.required_tier)}</td>
            <td>${enabledBadge}</td>
            <td>
                <button class="btn btn-secondary btn-sm" data-action="edit" data-id="${escapeHTML(t.id)}">수정</button>
                <button class="btn btn-secondary btn-sm" data-action="toggle" data-id="${escapeHTML(t.id)}">${t.is_enabled ? '비활성화' : '활성화'}</button>
                <button class="btn btn-secondary btn-sm" data-action="delete" data-id="${escapeHTML(t.id)}" style="color:var(--danger,#ef4444);">삭제</button>
            </td>
        </tr>`;
    }).join('');
}

function openEditor(template) {
    STATE.editingId = template ? template.id : null;
    const modal = document.getElementById('admin-mcp-catalog-modal');
    if (!modal) return;
    document.getElementById('amc-modal-title').textContent = template ? `수정: ${template.id}` : '새 catalog 템플릿';

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val == null ? '' : val;
    };
    setVal('amc-id', template ? template.id : '');
    setVal('amc-display-name', template ? template.display_name : '');
    setVal('amc-description', template ? template.description : '');
    setVal('amc-transport-type', template ? template.transport_type : 'stdio');
    setVal('amc-command-template', template ? template.command_template : '');
    setVal('amc-url-template', template ? template.url_template : '');
    setVal('amc-required-tier', template ? template.required_tier : 'free');
    setVal('amc-args-schema', JSON.stringify(template ? template.args_schema : {}, null, 2));
    setVal('amc-env-schema', JSON.stringify(template ? template.env_schema : {}, null, 2));
    const enabledEl = document.getElementById('amc-is-enabled');
    if (enabledEl) enabledEl.checked = template ? !!template.is_enabled : true;

    const idInput = document.getElementById('amc-id');
    if (idInput) idInput.disabled = !!template;  // 수정 시 id 변경 불가

    modal.classList.add('active');
}

function closeEditor() {
    const modal = document.getElementById('admin-mcp-catalog-modal');
    if (modal) modal.classList.remove('active');
    STATE.editingId = null;
}

async function submitEditor() {
    const get = (id) => (document.getElementById(id) || {}).value || '';
    let argsSchema, envSchema;
    try {
        argsSchema = JSON.parse(get('amc-args-schema') || '{}');
        envSchema = JSON.parse(get('amc-env-schema') || '{}');
    } catch (e) {
        toast('JSON 파싱 실패: ' + (e.message || e), 'error');
        return;
    }
    const payload = {
        display_name: get('amc-display-name'),
        description: get('amc-description') || null,
        transport_type: get('amc-transport-type'),
        command_template: get('amc-command-template') || null,
        url_template: get('amc-url-template') || null,
        args_schema: argsSchema,
        env_schema: envSchema,
        required_tier: get('amc-required-tier'),
        is_enabled: !!document.getElementById('amc-is-enabled').checked,
    };

    try {
        if (STATE.editingId) {
            await fetchJson(`/api/admin/mcp/catalog/${encodeURIComponent(STATE.editingId)}`, {
                method: 'PUT',
                body: payload,
            });
            toast('수정되었습니다.', 'success');
        } else {
            payload.id = get('amc-id');
            await fetchJson('/api/admin/mcp/catalog', {
                method: 'POST',
                body: payload,
            });
            toast('생성되었습니다.', 'success');
        }
        closeEditor();
        await loadTemplates();
    } catch (e) {
        toast('실패: ' + (e.message || e), 'error');
    }
}

async function deleteTemplate(id) {
    if (!window.confirm(`정말로 '${id}' 를 삭제하시겠습니까? 영구 삭제됩니다.`)) return;
    try {
        await fetchJson(`/api/admin/mcp/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast('삭제되었습니다.', 'success');
        await loadTemplates();
    } catch (e) {
        toast('삭제 실패: ' + (e.message || e), 'error');
    }
}

async function toggleTemplate(id) {
    const t = STATE.templates.find(x => x.id === id);
    if (!t) return;
    try {
        await fetchJson(`/api/admin/mcp/catalog/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: { is_enabled: !t.is_enabled },
        });
        toast(`${!t.is_enabled ? '활성화' : '비활성화'} 되었습니다.`, 'success');
        await loadTemplates();
    } catch (e) {
        toast('변경 실패: ' + (e.message || e), 'error');
    }
}

function getHTML() {
    return '<div id="admin-mcp-catalog-root">' +
        '<style data-spa-style="admin-mcp-catalog">' +
        '.amc-page{padding:var(--space-5);max-width:1200px;margin:0 auto;}' +
        '.amc-toolbar{display:flex;gap:var(--space-3);margin-bottom:var(--space-4);align-items:center;}' +
        '.amc-table{width:100%;border-collapse:collapse;}' +
        '.amc-table th,.amc-table td{padding:var(--space-3);border-bottom:1px solid var(--border-light);text-align:left;}' +
        '.amc-modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;}' +
        '.amc-modal.active{display:flex;}' +
        '.amc-modal-content{background:var(--bg-card);border-radius:var(--radius-lg);padding:var(--space-5);max-width:700px;width:90%;max-height:90vh;overflow:auto;}' +
        '.amc-field{margin-bottom:var(--space-3);}' +
        '.amc-field label{display:block;margin-bottom:var(--space-1);font-weight:var(--font-weight-medium);}' +
        '.amc-field input,.amc-field select,.amc-field textarea{width:100%;padding:var(--space-2);border:1px solid var(--border-light);border-radius:var(--radius-md);background:var(--bg-input);color:var(--text-primary);}' +
        '.amc-field textarea{min-height:120px;font-family:monospace;font-size:0.85em;}' +
        '</style>' +
        '<div class="amc-page">' +
        '<header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--space-4);">' +
            '<div><h1>MCP 카탈로그 관리</h1><p style="color:var(--text-muted);margin:0;">사용자가 from-catalog 로 설치 가능한 MCP 서버 템플릿을 관리합니다.</p></div>' +
            '<button class="btn btn-primary" id="amc-new-btn" type="button">+ 새 템플릿</button>' +
        '</header>' +
        '<table class="amc-table"><thead><tr><th>ID</th><th>이름</th><th>Transport</th><th>요구 Tier</th><th>상태</th><th>작업</th></tr></thead>' +
        '<tbody id="admin-mcp-catalog-tbody"><tr><td colspan="6">로딩 중…</td></tr></tbody></table>' +
        '</div>' +
        '<div id="admin-mcp-catalog-modal" class="amc-modal" role="dialog" aria-modal="true">' +
            '<div class="amc-modal-content">' +
                '<h3 id="amc-modal-title">새 catalog 템플릿</h3>' +
                '<div class="amc-field"><label>ID (mcp- prefix, 소문자/숫자/하이픈)</label><input id="amc-id" type="text" placeholder="mcp-example"></div>' +
                '<div class="amc-field"><label>표시 이름</label><input id="amc-display-name" type="text"></div>' +
                '<div class="amc-field"><label>설명</label><input id="amc-description" type="text"></div>' +
                '<div class="amc-field"><label>Transport</label><select id="amc-transport-type"><option value="stdio">stdio</option><option value="sse">sse</option><option value="streamable-http">streamable-http</option></select></div>' +
                '<div class="amc-field"><label>Command template (stdio)</label><input id="amc-command-template" type="text" placeholder="npx -y @scope/package"></div>' +
                '<div class="amc-field"><label>URL template (sse/streamable-http)</label><input id="amc-url-template" type="text" placeholder="https://..."></div>' +
                '<div class="amc-field"><label>요구 Tier</label><select id="amc-required-tier"><option value="free">free</option><option value="starter">starter</option><option value="standard">standard</option><option value="pro">pro</option><option value="enterprise">enterprise</option></select></div>' +
                '<div class="amc-field"><label>Args Schema (JSON)</label><textarea id="amc-args-schema">{}</textarea></div>' +
                '<div class="amc-field"><label>Env Schema (JSON)</label><textarea id="amc-env-schema">{}</textarea></div>' +
                '<div class="amc-field"><label><input id="amc-is-enabled" type="checkbox" checked> 활성</label></div>' +
                '<div style="display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-4);">' +
                    '<button class="btn btn-secondary" data-action="close-amc-modal">취소</button>' +
                    '<button class="btn btn-primary" id="amc-submit">저장</button>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '</div>';
}

function init() {
    const root = document.getElementById('app-root') || document.body;
    const delegate = (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute('data-action');
        const id = target.getAttribute('data-id');
        if (action === 'edit' && id) {
            const tpl = STATE.templates.find(t => t.id === id);
            if (tpl) openEditor(tpl);
        } else if (action === 'delete' && id) {
            deleteTemplate(id);
        } else if (action === 'toggle' && id) {
            toggleTemplate(id);
        } else if (target.getAttribute('data-action') === 'close-amc-modal') {
            closeEditor();
        }
    };
    addListener(root, 'click', delegate);

    const newBtn = document.getElementById('amc-new-btn');
    if (newBtn) addListener(newBtn, 'click', () => openEditor(null));
    const submitBtn = document.getElementById('amc-submit');
    if (submitBtn) addListener(submitBtn, 'click', submitEditor);

    const escHandler = (ev) => { if (ev.key === 'Escape') closeEditor(); };
    addListener(document, 'keydown', escHandler);

    loadTemplates();
}

function cleanup() {
    for (const { target, event, handler } of _listeners) {
        try { target.removeEventListener(event, handler); } catch { /* noop */ }
    }
    _listeners = [];
    STATE.templates = [];
    STATE.editingId = null;
}

window.PageModules['admin-mcp-catalog'] = { getHTML, init, cleanup };

const pageModule = window.PageModules['admin-mcp-catalog'];
export default pageModule;
