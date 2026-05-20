/**
 * ============================================
 * MCP Servers Page — 사용자별 MCP 서버 관리
 * ============================================
 * 카탈로그 / 내 서버 / 인스턴스 상태 3-탭 페이지.
 *
 * REST endpoints (Phase 6 산출물):
 *   GET    /api/mcp/catalog
 *   POST   /api/mcp/servers/from-catalog
 *   GET    /api/mcp/servers
 *   DELETE /api/mcp/servers/:id
 *   POST   /api/mcp/servers/:id/start
 *   POST   /api/mcp/servers/:id/stop
 *   GET    /api/mcp/servers/:id/instances
 *
 * 보안:
 *   - 모든 user-provided 데이터는 escapeHTML 거치고 innerHTML 사용
 *   - 인라인 onclick 금지 — data-action 속성 + 이벤트 위임
 *   - secret 필드 type=password
 *
 * @module pages/mcp-servers
 */
'use strict';

// sanitize.js 는 ES export 없음 — window.escapeHTML 전역으로 노출됨.
// 본 모듈은 window.escapeHTML 또는 fallback inline escape 사용.
const escapeHTML = (str) => {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
};

window.PageModules = window.PageModules || {};

const STATE = {
    activeTab: 'catalog',
    catalog: [],
    myServers: [],
    instances: [],
    selectedServerForInstances: '',
    currentTemplate: null,
};

let _listeners = [];

function addListener(target, event, handler) {
    target.addEventListener(event, handler);
    _listeners.push({ target, event, handler });
}

function toast(msg, type) {
    if (typeof window.showToast === 'function') {
        window.showToast(msg, type || 'info');
    } else {
        console.log('[toast]', type || 'info', msg);
    }
}

async function fetchJson(path, init) {
    const opts = Object.assign({ credentials: 'include' }, init || {});
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_e) { /* empty */ }
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || res.statusText;
        const details = data && data.details
            ? `: ${Array.isArray(data.details) ? data.details.join(', ') : data.details}`
            : '';
        throw new Error(`${msg}${details}`);
    }
    return data;
}

function tierBadge(tier) {
    const safe = escapeHTML(String(tier || 'free'));
    const cls = tier === 'free' ? 'badge-tier-free'
        : tier === 'pro' ? 'badge-tier-pro'
        : tier === 'enterprise' ? 'badge-tier-enterprise'
        : 'badge-tier-free';
    return `<span class="badge ${cls}">${safe}</span>`;
}

function visibilityBadge(vis) {
    if (vis === 'global') return `<span class="badge badge-vis-global">🌐 전역</span>`;
    if (vis === 'user_shared') return `<span class="badge badge-vis-shared">🤝 공유</span>`;
    return `<span class="badge badge-vis-private">👤 나만</span>`;
}

function statusBadge(status) {
    const safe = escapeHTML(String(status || 'stopped'));
    const known = ['running', 'stopped', 'crashed', 'starting'];
    const cls = known.includes(status) ? `badge-status-${status}` : 'badge-status-stopped';
    return `<span class="badge ${cls}">${safe}</span>`;
}

async function loadCatalog() {
    const grid = document.getElementById('mcp-catalog-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="mcp-loading">로딩 중…</div>';
    try {
        const data = await fetchJson('/api/mcp/catalog');
        STATE.catalog = (data && (data.data?.templates || data.templates)) || [];
        renderCatalog();
    } catch (e) {
        grid.innerHTML = `<div class="mcp-empty">불러오기 실패: ${escapeHTML(e.message)}</div>`;
    }
}

function renderCatalog() {
    const grid = document.getElementById('mcp-catalog-grid');
    if (!grid) return;
    if (STATE.catalog.length === 0) {
        grid.innerHTML = `<div class="mcp-empty">사용 가능한 카탈로그가 없습니다.</div>`;
        return;
    }
    grid.innerHTML = STATE.catalog.map(t => `
        <div class="mcp-card">
            <h3>${escapeHTML(t.display_name)}</h3>
            <div class="mcp-meta">
                ${tierBadge(t.required_tier)}
                <span class="badge badge-cat">${escapeHTML(t.transport_type)}</span>
            </div>
            <div class="mcp-desc">${escapeHTML(t.description || '')}</div>
            <div class="mcp-actions">
                <button data-action="register" data-template-id="${escapeHTML(t.id)}">등록하기</button>
            </div>
        </div>
    `).join('');
}

async function loadMyServers() {
    const grid = document.getElementById('mcp-my-servers-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="mcp-loading">로딩 중…</div>';
    try {
        const data = await fetchJson('/api/mcp/servers');
        STATE.myServers = (data && (data.data?.servers || data.servers)) || [];
        renderMyServers();
        updateInstanceServerSelect();
    } catch (e) {
        grid.innerHTML = `<div class="mcp-empty">불러오기 실패: ${escapeHTML(e.message)}</div>`;
    }
}

function renderMyServers() {
    const grid = document.getElementById('mcp-my-servers-grid');
    if (!grid) return;
    if (STATE.myServers.length === 0) {
        grid.innerHTML = `<div class="mcp-empty">등록된 서버가 없습니다. 카탈로그에서 추가하세요.</div>`;
        return;
    }
    grid.innerHTML = STATE.myServers.map(s => {
        const isOwner = s.user_id !== null;
        const conn = s.connectionStatus || 'disconnected';
        const connClass = conn === 'connected' ? 'badge-status-running' : 'badge-status-stopped';
        const templateLine = s.catalog_template_id
            ? `template: <code>${escapeHTML(s.catalog_template_id)}</code>`
            : '';
        const toolLine = s.toolCount ? `<br>도구 ${escapeHTML(String(s.toolCount))}개` : '';
        return `
        <div class="mcp-card">
            <h3>${escapeHTML(s.name)}</h3>
            <div class="mcp-meta">
                ${visibilityBadge(s.visibility)}
                <span class="badge badge-cat">${escapeHTML(s.transport_type)}</span>
                <span class="badge ${connClass}">${escapeHTML(conn)}</span>
            </div>
            <div class="mcp-desc">${templateLine}${toolLine}</div>
            <div class="mcp-actions">
                <button data-action="start" data-server-id="${escapeHTML(s.id)}">▶ 시작</button>
                <button data-action="stop" data-server-id="${escapeHTML(s.id)}">⏸ 중지</button>
                ${isOwner ? `<button class="btn-danger" data-action="delete" data-server-id="${escapeHTML(s.id)}">🗑 삭제</button>` : ''}
            </div>
        </div>`;
    }).join('');
}

function updateInstanceServerSelect() {
    const sel = document.getElementById('mcp-instance-server-select');
    if (!sel) return;
    const opts = ['<option value="">서버 선택…</option>']
        .concat(STATE.myServers.map(s => `<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`));
    sel.innerHTML = opts.join('');
}

async function loadInstances(serverId) {
    const container = document.getElementById('mcp-instances-container');
    if (!container) return;
    if (!serverId) {
        container.innerHTML = `<div class="mcp-empty">서버를 선택하세요.</div>`;
        return;
    }
    container.innerHTML = `<div class="mcp-loading">로딩 중…</div>`;
    try {
        const data = await fetchJson(`/api/mcp/servers/${encodeURIComponent(serverId)}/instances`);
        STATE.instances = (data && (data.data?.instances || data.instances)) || [];
        renderInstances();
    } catch (e) {
        container.innerHTML = `<div class="mcp-empty">불러오기 실패: ${escapeHTML(e.message)}</div>`;
    }
}

function renderInstances() {
    const container = document.getElementById('mcp-instances-container');
    if (!container) return;
    if (STATE.instances.length === 0) {
        container.innerHTML = `<div class="mcp-empty">이 서버의 인스턴스 기록이 없습니다.</div>`;
        return;
    }
    const rows = STATE.instances.map(i => `
        <tr>
            <td>${escapeHTML(String(i.id))}</td>
            <td>${statusBadge(i.status)}</td>
            <td>${escapeHTML(i.pid != null ? String(i.pid) : '-')}</td>
            <td>${escapeHTML(i.started_at || '-')}</td>
            <td>${escapeHTML(i.stopped_at || '-')}</td>
            <td>${escapeHTML(i.last_error || '-')}</td>
        </tr>
    `).join('');
    container.innerHTML = `
        <table class="mcp-instance-table">
            <thead>
                <tr>
                    <th>#</th><th>상태</th><th>PID</th><th>시작</th><th>종료</th><th>마지막 에러</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function openRegisterModal(templateId) {
    const template = STATE.catalog.find(t => t.id === templateId);
    if (!template) { toast('템플릿을 찾을 수 없습니다', 'error'); return; }
    STATE.currentTemplate = template;

    const titleEl = document.getElementById('mcp-modal-title');
    const descEl = document.getElementById('mcp-modal-desc');
    const fieldsEl = document.getElementById('mcp-modal-fields');
    if (titleEl) titleEl.textContent = `${template.display_name} 등록`;
    if (descEl) descEl.textContent = template.description || '';
    if (fieldsEl) fieldsEl.innerHTML = renderTemplateFields(template);

    document.getElementById('mcp-register-modal')?.classList.add('open');
}

function renderTemplateFields(template) {
    let html = `
        <div class="mcp-field">
            <label for="mcp-field-name">서버 이름 *</label>
            <div class="field-desc">영숫자/언더스코어/하이픈만 (예: my-filesystem)</div>
            <input type="text" id="mcp-field-name" pattern="[a-zA-Z0-9_-]+" required>
        </div>
        <div class="mcp-field">
            <label for="mcp-field-visibility">공개 범위</label>
            <select id="mcp-field-visibility">
                <option value="user_private" selected>👤 나만 (private)</option>
                <option value="user_shared">🤝 공유 (shared)</option>
            </select>
        </div>
    `;

    const argsProps = (template.args_schema && template.args_schema.properties) || {};
    const argsRequired = new Set((template.args_schema && template.args_schema.required) || []);
    for (const [key, prop] of Object.entries(argsProps)) {
        const safeKey = escapeHTML(key);
        const title = escapeHTML(prop.title || key);
        const desc = prop.description ? `<div class="field-desc">${escapeHTML(prop.description)}</div>` : '';
        const isReq = argsRequired.has(key);
        html += `
            <div class="mcp-field">
                <label for="mcp-arg-${safeKey}">${title}${isReq ? ' *' : ''}</label>
                ${desc}
                <input type="text" id="mcp-arg-${safeKey}" data-arg-key="${safeKey}" ${isReq ? 'required' : ''}>
            </div>`;
    }

    const envProps = (template.env_schema && template.env_schema.properties) || {};
    const envRequired = new Set((template.env_schema && template.env_schema.required) || []);
    for (const [key, prop] of Object.entries(envProps)) {
        const safeKey = escapeHTML(key);
        const title = escapeHTML(prop.title || key);
        const desc = prop.description ? `<div class="field-desc">${escapeHTML(prop.description)}</div>` : '';
        const isReq = envRequired.has(key);
        const isSecret = prop.secret === true;
        const inputType = isSecret ? 'password' : 'text';
        const placeholder = isSecret ? 'placeholder="(비밀)"' : '';
        const lockIcon = isSecret ? ' 🔒' : '';
        html += `
            <div class="mcp-field">
                <label for="mcp-env-${safeKey}">${title}${isReq ? ' *' : ''}${lockIcon}</label>
                ${desc}
                <input type="${inputType}" id="mcp-env-${safeKey}" data-env-key="${safeKey}" ${isReq ? 'required' : ''} ${placeholder}>
            </div>`;
    }
    return html;
}

function closeRegisterModal() {
    document.getElementById('mcp-register-modal')?.classList.remove('open');
    STATE.currentTemplate = null;
}

async function submitRegister() {
    const template = STATE.currentTemplate;
    if (!template) return;
    const nameEl = document.getElementById('mcp-field-name');
    const visEl = document.getElementById('mcp-field-visibility');
    const name = (nameEl && nameEl.value.trim()) || '';
    const visibility = (visEl && visEl.value) || 'user_private';
    if (!name) { toast('이름을 입력하세요', 'error'); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) { toast('이름 형식이 잘못되었습니다', 'error'); return; }

    const args = {};
    document.querySelectorAll('[data-arg-key]').forEach((el) => {
        const k = el.getAttribute('data-arg-key');
        const v = el.value.trim();
        if (k && v) args[k] = v;
    });
    const env = {};
    document.querySelectorAll('[data-env-key]').forEach((el) => {
        const k = el.getAttribute('data-env-key');
        const v = el.value;
        if (k && v) env[k] = v;
    });

    const submitBtn = document.getElementById('mcp-modal-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '등록 중…'; }
    try {
        const data = await fetchJson('/api/mcp/servers/from-catalog', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: template.id, name, visibility, args, env }),
        });
        const server = (data && (data.data?.server || data.server)) || {};
        toast(`등록 완료: ${server.name || name}`, 'success');
        closeRegisterModal();
        await loadMyServers();
        switchTab('my-servers');
    } catch (e) {
        toast(`등록 실패: ${e.message}`, 'error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '등록'; }
    }
}

async function handleServerAction(serverId, action) {
    if (action === 'delete' && !window.confirm('정말 삭제하시겠습니까?')) return;
    if (action === 'stop' && !window.confirm('서버를 중지하시겠습니까?')) return;
    try {
        if (action === 'delete') {
            await fetchJson(`/api/mcp/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
            toast('삭제 완료', 'success');
        } else if (action === 'start') {
            await fetchJson(`/api/mcp/servers/${encodeURIComponent(serverId)}/start`, { method: 'POST' });
            toast('시작 요청 전송', 'info');
        } else if (action === 'stop') {
            await fetchJson(`/api/mcp/servers/${encodeURIComponent(serverId)}/stop`, { method: 'POST' });
            toast('중지 요청 전송', 'info');
        }
        await loadMyServers();
    } catch (e) {
        toast(`${action} 실패: ${e.message}`, 'error');
    }
}

function switchTab(tabName) {
    STATE.activeTab = tabName;
    document.querySelectorAll('.mcp-tab').forEach(b => {
        b.classList.toggle('active', b.getAttribute('data-tab') === tabName);
    });
    document.querySelectorAll('.mcp-tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === `mcp-panel-${tabName}`);
    });
    if (tabName === 'my-servers') loadMyServers();
    else if (tabName === 'instances') loadInstances(STATE.selectedServerForInstances);
}

function getHTML() {
    return '<div id="mcp-page-root-spa">' +
        '<style data-spa-style="mcp-servers">' +
        '.mcp-page-spa{padding:var(--space-5);max-width:1200px;margin:0 auto;}' +
        '.mcp-page-spa .mcp-tabs{display:flex;gap:var(--space-2);margin-bottom:var(--space-4);border-bottom:1px solid var(--border-light);}' +
        '.mcp-page-spa .mcp-tab{padding:var(--space-3) var(--space-4);background:transparent;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--text-secondary);}' +
        '.mcp-page-spa .mcp-tab.active{color:var(--accent-primary);border-bottom-color:var(--accent-primary);font-weight:var(--font-weight-semibold);}' +
        '.mcp-page-spa .mcp-tab-panel{display:none;}' +
        '.mcp-page-spa .mcp-tab-panel.active{display:block;}' +
        '.mcp-page-spa .mcp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:var(--space-4);}' +
        '.mcp-page-spa .mcp-card{background:var(--bg-card);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:var(--space-5);}' +
        '</style>' +
        '<div class="mcp-page-spa">' +
        '<header class="mcp-header"><h1>🔌 MCP 서버</h1><p style="color:var(--text-muted);">로컬 도구를 LLM 이 사용할 수 있도록 연결합니다.</p></header>' +
        '<div class="mcp-tabs" role="tablist">' +
        '<button class="mcp-tab active" data-tab="catalog">📚 카탈로그</button>' +
        '<button class="mcp-tab" data-tab="my-servers">👤 내 서버</button>' +
        '<button class="mcp-tab" data-tab="instances">📊 인스턴스 상태</button>' +
        '</div>' +
        '<section id="mcp-panel-catalog" class="mcp-tab-panel active"><div id="mcp-catalog-grid" class="mcp-grid"><div class="mcp-loading">로딩 중…</div></div></section>' +
        '<section id="mcp-panel-my-servers" class="mcp-tab-panel"><div class="mcp-toolbar"><button class="mcp-tab" id="mcp-refresh-my-servers">새로고침</button></div><div id="mcp-my-servers-grid" class="mcp-grid"><div class="mcp-loading">로딩 중…</div></div></section>' +
        '<section id="mcp-panel-instances" class="mcp-tab-panel"><div class="mcp-toolbar"><select id="mcp-instance-server-select" class="mcp-select"><option value="">서버 선택…</option></select><button class="mcp-tab" id="mcp-refresh-instances">새로고침</button></div><div id="mcp-instances-container"><div class="mcp-empty">서버를 선택하세요.</div></div></section>' +
        '</div>' +
        '<div id="mcp-register-modal" class="mcp-modal" role="dialog" aria-modal="true"><div class="mcp-modal-content"><h3 id="mcp-modal-title">서버 등록</h3><p id="mcp-modal-desc" style="color:var(--text-muted);"></p><div id="mcp-modal-fields"></div><div class="mcp-modal-actions"><button class="btn-secondary" data-close-mcp-modal>취소</button><button class="btn-primary" id="mcp-modal-submit">등록</button></div></div></div>' +
        '</div>';
}

function init() {
    // 탭 전환
    document.querySelectorAll('.mcp-tab[data-tab]').forEach(btn => {
        const handler = () => switchTab(btn.getAttribute('data-tab'));
        addListener(btn, 'click', handler);
    });

    // 카드/모달 액션 — 이벤트 위임 (innerHTML 재생성 후에도 작동)
    const root = document.getElementById('app-root') || document.body;
    const delegateHandler = (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute('data-action');
        if (action === 'register') {
            const tid = target.getAttribute('data-template-id');
            if (tid) openRegisterModal(tid);
        } else if (action === 'start' || action === 'stop' || action === 'delete') {
            const sid = target.getAttribute('data-server-id');
            if (sid) handleServerAction(sid, action);
        } else if (target.hasAttribute('data-close-mcp-modal')) {
            closeRegisterModal();
        }
    };
    addListener(root, 'click', delegateHandler);

    document.getElementById('mcp-modal-submit') && addListener(document.getElementById('mcp-modal-submit'), 'click', submitRegister);
    document.getElementById('mcp-refresh-my-servers') && addListener(document.getElementById('mcp-refresh-my-servers'), 'click', loadMyServers);
    document.getElementById('mcp-refresh-instances') && addListener(document.getElementById('mcp-refresh-instances'), 'click', () => loadInstances(STATE.selectedServerForInstances));

    const sel = document.getElementById('mcp-instance-server-select');
    if (sel) {
        addListener(sel, 'change', (ev) => {
            STATE.selectedServerForInstances = ev.target.value;
            loadInstances(STATE.selectedServerForInstances);
        });
    }

    const escHandler = (ev) => { if (ev.key === 'Escape') closeRegisterModal(); };
    addListener(document, 'keydown', escHandler);

    loadCatalog();
}

function cleanup() {
    for (const { target, event, handler } of _listeners) {
        try { target.removeEventListener(event, handler); } catch (_e) { /* noop */ }
    }
    _listeners = [];
    STATE.activeTab = 'catalog';
    STATE.catalog = [];
    STATE.myServers = [];
    STATE.instances = [];
    STATE.selectedServerForInstances = '';
    STATE.currentTemplate = null;
}

window.PageModules['mcp-servers'] = { getHTML, init, cleanup };

const pageModule = window.PageModules['mcp-servers'];
export default pageModule;
