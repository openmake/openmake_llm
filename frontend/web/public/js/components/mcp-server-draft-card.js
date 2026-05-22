/**
 * ============================================================
 * MCP Server Draft Preview Card — mcp-servers 페이지 inline
 * ============================================================
 *
 * Git URL → MCPSERVER.md → mcp_servers draft 의 검토/승인/거부 UI.
 *
 * draft.manifest_meta 의 conventionFindings.error 가 있으면 approve 비활성화.
 * required_env 가 있으면 approve 시 envOverrides 입력 prompt.
 *
 * @module components/mcp-server-draft-card
 */
'use strict';

function esc(s) {
    const fn = (typeof window !== 'undefined' && window.escapeHTML) || (v => String(v));
    return fn(s == null ? '' : String(s));
}

function isPlaceholder(v) {
    if (!v) return true;
    return /^\$\{.+\}$/.test(String(v));
}

export function renderMcpServerDraftCard(draft, opts) {
    const mode = (opts && opts.mode) || 'inline';
    const onAction = (opts && opts.onAction) || function () {};

    const el = document.createElement('div');
    el.className = 'skill-draft-card mcp-server-draft-card skill-draft-card--' + mode;
    el.dataset.serverId = draft.serverId || draft.id;

    const meta = draft.manifest_meta || {};
    const findings = Array.isArray(meta.conventionFindings) ? meta.conventionFindings : (draft.conventionFindings || []);
    const blocked = !!meta.blockedByConvention || findings.some(f => f && f.severity === 'error');
    const requiredEnv = Array.isArray(meta.requiredEnv) ? meta.requiredEnv : (draft.requiredEnv || []);

    const env = draft.env || {};
    const args = Array.isArray(draft.args) ? draft.args : [];

    const findingsHtml = findings.length > 0
        ? '<details class="skill-draft-card__preview">' +
          '<summary>컨벤션 검출 ' + findings.length + '건' + (blocked ? ' <span style="color:#ef4444">(승인 차단)</span>' : '') + '</summary>' +
          '<ul class="mcp-draft-card__findings">' +
          findings.map(f => '<li><b>' + esc(f.severity) + '</b> · ' + esc(f.rule) + ' — ' + esc(f.message) + '</li>').join('') +
          '</ul></details>'
        : '';

    const commandHtml = draft.command
        ? '<div class="skill-draft-card__meta"><b>command</b>: <code>' + esc(draft.command) + '</code></div>'
        : '';
    const urlHtml = draft.url
        ? '<div class="skill-draft-card__meta"><b>url</b>: <code>' + esc(draft.url) + '</code></div>'
        : '';
    const argsHtml = args.length > 0
        ? '<details class="skill-draft-card__preview"><summary>args (' + args.length + ')</summary>' +
          '<pre class="skill-draft-card__content">' + args.map(a => esc(a)).join('\n') + '</pre></details>'
        : '';
    const envEntries = Object.entries(env);
    const envHtml = envEntries.length > 0
        ? '<details class="skill-draft-card__preview"><summary>env (' + envEntries.length + (requiredEnv.length ? ', 필수 ' + requiredEnv.length : '') + ')</summary>' +
          '<pre class="skill-draft-card__content">' +
          envEntries.map(([k, v]) => esc(k) + '=' + esc(v) + (isPlaceholder(v) ? '  ← placeholder' : '')).join('\n') +
          '</pre></details>'
        : '';
    const gitSrc = meta.gitUrl
        ? '<div class="skill-draft-card__meta">출처: <code>' + esc(meta.gitUrl) + '@' + esc((meta.gitRef || '').slice(0, 7)) + '</code> · <code>' + esc(meta.gitPath || '') + '</code></div>'
        : '';
    const dedupedBadge = draft.deduped
        ? '<span class="sl-badge skill-draft-card__badge-deduped" title="dedupe — 기존 draft 재사용">↻ 재사용</span>'
        : '';
    const approveDisabled = blocked ? ' disabled aria-disabled="true" title="위험 명령 패턴 감지 — 승인 차단"' : '';

    el.innerHTML =
        '<div class="skill-draft-card__header">' +
            '<span class="skill-draft-card__badge skill-draft-card__badge-draft">🔌 MCP DRAFT</span>' +
            '<span class="sl-badge skill-draft-card__badge-user">' + esc(draft.transportType || draft.transport_type || 'stdio') + '</span>' +
            dedupedBadge +
        '</div>' +
        '<h4 class="skill-draft-card__title">' + esc(draft.name) + '</h4>' +
        '<p class="skill-draft-card__desc">' + esc(draft.description || meta.description || '') + '</p>' +
        '<div class="skill-draft-card__meta">카테고리 ' + esc(draft.category || meta.category || 'general') + '</div>' +
        commandHtml + urlHtml + argsHtml + envHtml + gitSrc + findingsHtml +
        '<div class="skill-draft-card__actions">' +
            '<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-action="approve"' + approveDisabled + '>승인 (활성화)</button>' +
            '<button type="button" class="sl-btn sl-btn-secondary sl-btn-sm" data-action="reject">거절 (보관)</button>' +
            '<a href="/mcp-servers" class="sl-btn sl-btn-outline sl-btn-sm" data-action="open-mcp-servers">전체 목록</a>' +
        '</div>';

    el.addEventListener('click', function (ev) {
        const btn = ev.target.closest('[data-action]');
        if (!btn) return;
        if (btn.tagName === 'BUTTON' && btn.disabled) { ev.preventDefault(); return; }
        if (btn.tagName === 'BUTTON') ev.preventDefault();
        onAction(btn.dataset.action, draft.serverId || draft.id, { draft, blocked, requiredEnv });
    });
    return el;
}

/**
 * 표준 approve/reject 호출 헬퍼. 호출자에서 envOverrides UI 처리 후 사용.
 *
 * @param {string} action 'approve' | 'reject'
 * @param {string} serverId
 * @param {object} ctx { draft, blocked, requiredEnv, envOverrides?, enableImmediately? }
 * @param {object} callbacks { onToast?, confirmFn? }
 */
export async function handleMcpServerDraftAction(action, serverId, ctx, callbacks) {
    const toast = (callbacks && callbacks.onToast) || (window.showToast || function () {});
    const confirmFn = (callbacks && callbacks.confirmFn) || ((msg) => window.confirm(msg));
    if (action === 'open-mcp-servers') return;

    const API = (typeof window !== 'undefined' && window.API_ENDPOINTS) || {};
    const fetch_ = window.authFetch || window.fetch;

    if (action === 'approve') {
        if (ctx && ctx.blocked) {
            toast('위험 명령 패턴이 감지되어 승인할 수 없습니다.', 'error');
            return;
        }
        if (!confirmFn('이 MCP server draft 를 승인하시겠습니까?\n\n⚠ 승인 후 enabled=true 로 활성화되며 LifecycleSupervisor 가 spawn 합니다. command/args 가 사용자 시스템에서 실행되니 미리보기로 검토하세요.')) return;
        const url = typeof API.MCP_SERVERS_APPROVE === 'function' ? API.MCP_SERVERS_APPROVE(serverId) : '/api/mcp/servers/' + encodeURIComponent(serverId) + '/approve';
        const body = {};
        if (ctx && ctx.envOverrides) body.envOverrides = ctx.envOverrides;
        if (ctx && ctx.enableImmediately === false) body.enableImmediately = false;
        const r = await fetch_(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 422 && data.error === 'REQUIRED_ENV_MISSING') {
            toast('required_env 가 채워지지 않았습니다: ' + (Array.isArray(data.missing) ? data.missing.join(', ') : ''), 'warning');
            return;
        }
        if (r.status === 409 && data.error === 'CONVENTION_BLOCKED') {
            toast('위험 명령 패턴이 감지되어 승인할 수 없습니다.', 'error');
            return;
        }
        if (!r.ok || !data.success) {
            toast('승인 실패: ' + (data?.error || r.statusText), 'error');
            return;
        }
        toast('MCP server 가 활성화되었습니다.', 'success');
        window.dispatchEvent(new CustomEvent('mcp-server-draft:approved', { detail: { serverId } }));
    } else if (action === 'reject') {
        if (!confirmFn('이 MCP server draft 를 거절하시겠습니까? archived 로 보관됩니다.')) return;
        const url = typeof API.MCP_SERVERS_REJECT === 'function' ? API.MCP_SERVERS_REJECT(serverId) : '/api/mcp/servers/' + encodeURIComponent(serverId) + '/reject';
        const r = await fetch_(url, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) {
            toast('거절 실패: ' + (data?.error || r.statusText), 'error');
            return;
        }
        toast('거절됨 (archived).', 'info');
        window.dispatchEvent(new CustomEvent('mcp-server-draft:rejected', { detail: { serverId } }));
    }
}
