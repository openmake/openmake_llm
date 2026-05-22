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

import {
    renderMcpServerDraftCard,
    handleMcpServerDraftAction,
} from '../../components/mcp-server-draft-card.js';

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
    instanceMetrics: null,
    instancesSummary: null,
    drafts: [],
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
        STATE.instanceMetrics = null;
        container.innerHTML = `<div class="mcp-empty">서버를 선택하세요.</div>`;
        return;
    }
    container.innerHTML = `<div class="mcp-loading">로딩 중…</div>`;
    try {
        const [instData, metricsData] = await Promise.all([
            fetchJson(`/api/mcp/servers/${encodeURIComponent(serverId)}/instances`),
            fetchJson(`/api/mcp/servers/${encodeURIComponent(serverId)}/metrics`).catch(() => null),
        ]);
        STATE.instances = (instData && (instData.data?.instances || instData.instances)) || [];
        STATE.instanceMetrics = (metricsData && (metricsData.data?.metrics || metricsData.metrics)) || null;
        renderInstances();
    } catch (e) {
        container.innerHTML = `<div class="mcp-empty">불러오기 실패: ${escapeHTML(e.message)}</div>`;
    }
}

function formatUptime(sec) {
    if (sec == null) return '-';
    const s = Math.abs(sec);
    if (s < 60) return `${s.toFixed(1)}초`;
    if (s < 3600) return `${(s / 60).toFixed(1)}분`;
    if (s < 86400) return `${(s / 3600).toFixed(1)}시간`;
    return `${(s / 86400).toFixed(1)}일`;
}

function renderInstances() {
    const container = document.getElementById('mcp-instances-container');
    if (!container) return;

    const m = STATE.instanceMetrics;
    const metricsHtml = m ? `
        <div class="mcp-metrics-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:var(--space-3);margin-bottom:var(--space-4);">
            <div class="mcp-metric-card" style="background:var(--bg-card);padding:var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-light);">
                <div style="font-size:0.85em;color:var(--text-muted);">현재 활성</div>
                <div style="font-size:1.8em;font-weight:700;color:${m.currentRunning > 0 ? 'var(--success-bright,#22c55e)' : 'var(--text-muted)'};">${escapeHTML(String(m.currentRunning))}</div>
            </div>
            <div class="mcp-metric-card" style="background:var(--bg-card);padding:var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-light);">
                <div style="font-size:0.85em;color:var(--text-muted);">총 spawn</div>
                <div style="font-size:1.8em;font-weight:700;">${escapeHTML(String(m.totalSpawned))}</div>
            </div>
            <div class="mcp-metric-card" style="background:var(--bg-card);padding:var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-light);">
                <div style="font-size:0.85em;color:var(--text-muted);">24h crash</div>
                <div style="font-size:1.8em;font-weight:700;color:${m.crashed24h > 0 ? 'var(--danger-bright,#dc2626)' : 'var(--text-muted)'};">${escapeHTML(String(m.crashed24h))}</div>
            </div>
            <div class="mcp-metric-card" style="background:var(--bg-card);padding:var(--space-3);border-radius:var(--radius-md);border:1px solid var(--border-light);">
                <div style="font-size:0.85em;color:var(--text-muted);">평균 uptime</div>
                <div style="font-size:1.4em;font-weight:600;">${escapeHTML(formatUptime(m.avgUptimeSec))}</div>
            </div>
        </div>
        ${m.lastErrorMessage ? `<div style="background:var(--danger-bg,#fee2e2);color:var(--danger,#991b1b);padding:var(--space-3);border-radius:var(--radius-md);margin-bottom:var(--space-3);"><b>최근 에러:</b> ${escapeHTML(m.lastErrorMessage)} <span style="color:var(--text-muted);">(${escapeHTML(m.lastErrorAt || '')})</span></div>` : ''}
    ` : '';

    if (STATE.instances.length === 0) {
        container.innerHTML = metricsHtml + `<div class="mcp-empty">이 서버의 인스턴스 기록이 없습니다.</div>`;
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
    container.innerHTML = metricsHtml + `
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

// Phase 5.2: instances 탭 활성 시 N초 polling timer
let _instancePollTimer = null;
const INSTANCE_POLL_INTERVAL_MS = 15_000;

function startInstancePoll() {
    if (_instancePollTimer) return;
    _instancePollTimer = setInterval(() => {
        if (STATE.activeTab === 'instances' && STATE.selectedServerForInstances) {
            loadInstances(STATE.selectedServerForInstances);
        }
    }, INSTANCE_POLL_INTERVAL_MS);
}

function stopInstancePoll() {
    if (_instancePollTimer) {
        clearInterval(_instancePollTimer);
        _instancePollTimer = null;
    }
}

async function runHealthCheck() {
    const serverId = STATE.selectedServerForInstances;
    if (!serverId) { toast('서버를 먼저 선택하세요', 'warning'); return; }
    try {
        const data = await fetchJson(`/api/mcp/servers/${encodeURIComponent(serverId)}/instances/health-check`, { method: 'POST' });
        const r = (data && (data.data?.result || data.result)) || {};
        const msg = `검증 완료 — alive ${r.verified ?? 0} / 사망 마킹 ${r.declaredDead ?? 0}${r.missingPid ? ` / pid 없음 ${r.missingPid}` : ''}`;
        toast(msg, r.declaredDead > 0 ? 'warning' : 'success');
        await loadInstances(serverId);
    } catch (e) {
        toast(`health check 실패: ${e.message}`, 'error');
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
    else if (tabName === 'instances') {
        loadInstances(STATE.selectedServerForInstances);
        startInstancePoll();
    } else {
        stopInstancePoll();
    }
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
        '<header class="mcp-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-3);">' +
            '<div><h1>🔌 MCP 서버</h1><p style="color:var(--text-muted);margin:0;">로컬 도구를 LLM 이 사용할 수 있도록 연결합니다.</p></div>' +
            '<button class="btn-primary" id="mcp-import-from-git-btn" type="button">📥 Git 에서 가져오기</button>' +
        '</header>' +
        '<div class="mcp-tabs" role="tablist">' +
        '<button class="mcp-tab active" data-tab="catalog">📚 카탈로그</button>' +
        '<button class="mcp-tab" data-tab="my-servers">👤 내 서버</button>' +
        '<button class="mcp-tab" data-tab="instances">📊 인스턴스 상태</button>' +
        '</div>' +
        '<section id="mcp-panel-catalog" class="mcp-tab-panel active"><div id="mcp-catalog-grid" class="mcp-grid"><div class="mcp-loading">로딩 중…</div></div></section>' +
        '<section id="mcp-panel-my-servers" class="mcp-tab-panel">' +
            '<div class="mcp-toolbar"><button class="mcp-tab" id="mcp-refresh-my-servers">새로고침</button><button class="mcp-tab" id="mcp-refresh-drafts">draft 새로고침</button></div>' +
            '<div id="mcp-drafts-section" style="margin-bottom:var(--space-5);">' +
                '<h3 style="margin:var(--space-2) 0;">📥 검토 대기 (draft)</h3>' +
                '<div id="mcp-drafts-container" class="mcp-grid"><div class="mcp-loading">로딩 중…</div></div>' +
            '</div>' +
            '<h3 style="margin:var(--space-2) 0;">👤 활성 서버</h3>' +
            '<div id="mcp-my-servers-grid" class="mcp-grid"><div class="mcp-loading">로딩 중…</div></div>' +
        '</section>' +
        '<section id="mcp-panel-instances" class="mcp-tab-panel"><div class="mcp-toolbar"><select id="mcp-instance-server-select" class="mcp-select"><option value="">서버 선택…</option></select><button class="mcp-tab" id="mcp-refresh-instances">새로고침</button><button class="mcp-tab" id="mcp-health-check-btn" title="running 상태인 instance 의 pid 검증">🩺 Health check</button><span style="margin-left:auto;font-size:0.85em;color:var(--text-muted);">15초마다 자동 갱신</span></div><div id="mcp-instances-container"><div class="mcp-empty">서버를 선택하세요.</div></div></section>' +
        '</div>' +
        '<div id="mcp-register-modal" class="mcp-modal" role="dialog" aria-modal="true"><div class="mcp-modal-content"><h3 id="mcp-modal-title">서버 등록</h3><p id="mcp-modal-desc" style="color:var(--text-muted);"></p><div id="mcp-modal-fields"></div><div class="mcp-modal-actions"><button class="btn-secondary" data-close-mcp-modal>취소</button><button class="btn-primary" id="mcp-modal-submit">등록</button></div></div></div>' +
        '<div id="mcp-import-modal" class="mcp-modal" role="dialog" aria-modal="true">' +
            '<div class="mcp-modal-content">' +
                '<h3>📥 Git URL 에서 MCP server 가져오기</h3>' +
                '<p style="color:var(--text-muted);">저장소의 <code>MCPSERVER.md</code> 매니페스트를 fetch → 검증 → draft 로 저장합니다. 승인 전까지 spawn 되지 않습니다.</p>' +
                '<div class="mcp-modal-fields">' +
                    '<label style="display:block;margin:var(--space-2) 0;">Git URL ' +
                        '<input id="mcp-import-git-url" type="text" placeholder="https://github.com/owner/repo 또는 owner/repo" style="width:100%;padding:var(--space-2);margin-top:var(--space-1);">' +
                    '</label>' +
                    '<label style="display:block;margin:var(--space-2) 0;">Access Token (private repo 만 필요, 옵션) ' +
                        '<input id="mcp-import-access-token" type="password" placeholder="ghp_..." style="width:100%;padding:var(--space-2);margin-top:var(--space-1);">' +
                    '</label>' +
                '</div>' +
                '<div class="mcp-modal-actions">' +
                    '<button class="btn-secondary" data-close-mcp-import-modal>취소</button>' +
                    '<button class="btn-primary" id="mcp-import-submit">가져오기</button>' +
                '</div>' +
            '</div>' +
        '</div>' +
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
        } else if (target.hasAttribute('data-close-mcp-import-modal')) {
            closeImportModal();
        }
    };
    addListener(root, 'click', delegateHandler);

    const modalSubmit = document.getElementById('mcp-modal-submit');
    if (modalSubmit) addListener(modalSubmit, 'click', submitRegister);
    const refreshMyServers = document.getElementById('mcp-refresh-my-servers');
    if (refreshMyServers) addListener(refreshMyServers, 'click', loadMyServers);
    const refreshDrafts = document.getElementById('mcp-refresh-drafts');
    if (refreshDrafts) addListener(refreshDrafts, 'click', loadDrafts);
    const refreshInstances = document.getElementById('mcp-refresh-instances');
    if (refreshInstances) addListener(refreshInstances, 'click', () => loadInstances(STATE.selectedServerForInstances));
    const healthBtn = document.getElementById('mcp-health-check-btn');
    if (healthBtn) addListener(healthBtn, 'click', runHealthCheck);
    const importBtn = document.getElementById('mcp-import-from-git-btn');
    if (importBtn) addListener(importBtn, 'click', openImportModal);
    const importSubmit = document.getElementById('mcp-import-submit');
    if (importSubmit) addListener(importSubmit, 'click', submitImport);

    const sel = document.getElementById('mcp-instance-server-select');
    if (sel) {
        addListener(sel, 'change', (ev) => {
            STATE.selectedServerForInstances = ev.target.value;
            loadInstances(STATE.selectedServerForInstances);
        });
    }

    const escHandler = (ev) => {
        if (ev.key === 'Escape') {
            closeRegisterModal();
            closeImportModal();
        }
    };
    addListener(document, 'keydown', escHandler);

    loadCatalog();
    loadDrafts();
}

// ────────────────────────────────────────────────────────────────────
// Phase 4 — Git URL → MCPSERVER.md → draft 워크플로
// ────────────────────────────────────────────────────────────────────

async function loadDrafts() {
    const container = document.getElementById('mcp-drafts-container');
    if (!container) return;
    try {
        const data = await fetchJson('/api/mcp/servers/drafts');
        STATE.drafts = Array.isArray(data && data.data) ? data.data : [];
        renderDrafts();
    } catch (e) {
        container.innerHTML = `<div class="mcp-empty" style="color:var(--text-muted);">draft 조회 실패: ${escapeHTML(e.message || e)}</div>`;
    }
}

function renderDrafts() {
    const container = document.getElementById('mcp-drafts-container');
    if (!container) return;
    container.innerHTML = '';
    if (STATE.drafts.length === 0) {
        container.innerHTML = '<div class="mcp-empty" style="color:var(--text-muted);">대기 중인 draft 가 없습니다.</div>';
        return;
    }
    for (const row of STATE.drafts) {
        // listDrafts 반환은 raw mcp_servers row — manifest_meta / args / env 모두 포함
        const draft = {
            serverId: row.id,
            name: row.name,
            description: (row.manifest_meta && row.manifest_meta.description) || '',
            category: (row.manifest_meta && row.manifest_meta.category) || 'general',
            transport_type: row.transport_type,
            command: row.command,
            url: row.url,
            args: row.args,
            env: row.env,
            manifest_meta: row.manifest_meta,
        };
        const card = renderMcpServerDraftCard(draft, {
            mode: 'full',
            onAction: async (action, serverId, ctx) => {
                // approve 시 placeholder env 가 있으면 사용자 입력 prompt
                const ctxAug = Object.assign({}, ctx);
                if (action === 'approve' && Array.isArray(ctx.requiredEnv) && ctx.requiredEnv.length > 0) {
                    const overrides = {};
                    for (const key of ctx.requiredEnv) {
                        const cur = (ctx.draft.env || {})[key];
                        if (cur && !/^\$\{.+\}$/.test(String(cur))) continue;
                        const v = window.prompt(`required_env: ${key}\n(현재값 placeholder: ${cur || '(없음)'})\n실제 값을 입력하세요`, '');
                        if (v == null) return;  // 사용자 취소
                        if (v) overrides[key] = v;
                    }
                    ctxAug.envOverrides = overrides;
                }
                await handleMcpServerDraftAction(action, serverId, ctxAug, { onToast: toast });
                await loadDrafts();
                await loadMyServers();
            },
        });
        container.appendChild(card);
    }
}

function openImportModal() {
    const modal = document.getElementById('mcp-import-modal');
    if (!modal) return;
    modal.classList.add('active');
    const input = document.getElementById('mcp-import-git-url');
    if (input) { input.value = ''; input.focus(); }
}

function closeImportModal() {
    const modal = document.getElementById('mcp-import-modal');
    if (modal) modal.classList.remove('active');
}

async function submitImport() {
    const gitUrlEl = document.getElementById('mcp-import-git-url');
    const tokenEl = document.getElementById('mcp-import-access-token');
    const gitUrl = (gitUrlEl && gitUrlEl.value || '').trim();
    if (!gitUrl) { toast('Git URL 을 입력하세요', 'warning'); return; }
    const body = { gitUrl };
    if (tokenEl && tokenEl.value) body.accessToken = tokenEl.value.trim();

    try {
        const data = await fetchJson('/api/mcp/servers/import-from-git', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const result = data && data.data;
        if (result && result.selectionRequired) {
            toast(`다중 후보 (${result.candidates.length}). 단일 후보로 가져오려면 gitPath 를 명시하세요.`, 'info');
            return;
        }
        if (result && result.deduped) {
            toast('동일 URL 의 기존 draft 가 있습니다. 재사용됨.', 'info');
        } else {
            toast('MCP server draft 가 생성되었습니다.', 'success');
        }
        closeImportModal();
        // 내 서버 탭으로 이동 + draft 새로고침
        switchTab('my-servers');
        await loadDrafts();
    } catch (e) {
        toast('가져오기 실패: ' + (e.message || e), 'error');
    }
}

function cleanup() {
    stopInstancePoll();
    for (const { target, event, handler } of _listeners) {
        try { target.removeEventListener(event, handler); } catch { /* noop */ }
    }
    _listeners = [];
    STATE.activeTab = 'catalog';
    STATE.catalog = [];
    STATE.myServers = [];
    STATE.instances = [];
    STATE.drafts = [];
    STATE.selectedServerForInstances = '';
    STATE.currentTemplate = null;
}

window.PageModules['mcp-servers'] = { getHTML, init, cleanup };

const pageModule = window.PageModules['mcp-servers'];
export default pageModule;
