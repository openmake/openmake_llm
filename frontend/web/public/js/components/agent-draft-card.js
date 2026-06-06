/**
 * ============================================================
 * Agent Draft Preview Card — 채팅 inline + custom-agents 탭 공용
 * ============================================================
 *
 * MCP tool `import_agent_from_git` (Phase 3.5) 또는 REST 응답의
 * resource content (URI prefix `openmake://agent-draft/`) 를
 * 채팅/페이지 안에 인라인으로 표시.
 *
 * @module components/agent-draft-card
 */
'use strict';

function esc(s) {
    const fn = (typeof window !== 'undefined' && window.escapeHTML) || (v => String(v));
    return fn(s == null ? '' : String(s));
}

export function renderAgentDraftCard(draft, opts) {
    const mode = (opts && opts.mode) || 'inline';
    const onAction = (opts && opts.onAction) || function () {};

    const el = document.createElement('div');
    el.className = 'skill-draft-card agent-draft-card skill-draft-card--' + mode;
    el.dataset.agentId = draft.agentId;

    const keywords = Array.isArray(draft.keywords) && draft.keywords.length > 0
        ? '<div class="skill-draft-card__triggers">' +
          draft.keywords.slice(0, 8).map(k => '<span class="sl-badge sl-badge-secondary">' + esc(k) + '</span>').join(' ') +
          '</div>'
        : '';
    const skillBindings = Array.isArray(draft.skillBindingsResolved) && draft.skillBindingsResolved.length > 0
        ? '<div class="skill-draft-card__meta">연결 skill: ' + draft.skillBindingsResolved.length + '개' +
          (draft.skillBindingsUnresolved && draft.skillBindingsUnresolved.length ? ' (미해결 ' + draft.skillBindingsUnresolved.length + ')' : '') +
          '</div>'
        : '';
    const conv = Array.isArray(draft.conventionFindings) && draft.conventionFindings.length > 0
        ? '<div class="skill-draft-card__meta" style="color:#eab308"><iconify-icon icon=lucide:triangle-alert></iconify-icon> 컨벤션 검출 ' + draft.conventionFindings.length + '건</div>'
        : '';
    const dedupedBadge = draft.deduped
        ? '<span class="sl-badge skill-draft-card__badge-deduped" title="dedupe — 기존 draft 재사용">↻ 재사용</span>'
        : '';
    const previewHtml = mode === 'full' && draft.contentPreview
        ? '<details class="skill-draft-card__preview"><summary>system_prompt 미리보기</summary>' +
          '<pre class="skill-draft-card__content">' + esc(draft.contentPreview) + '</pre></details>'
        : '';

    el.innerHTML =
        '<div class="skill-draft-card__header">' +
            '<span class="skill-draft-card__badge skill-draft-card__badge-draft"><iconify-icon icon=lucide:bot></iconify-icon> AGENT DRAFT</span>' +
            '<span class="sl-badge skill-draft-card__badge-user">' + esc(draft.emoji || '🤖') + '</span>' +
            dedupedBadge +
        '</div>' +
        '<h4 class="skill-draft-card__title">' + esc(draft.name) + '</h4>' +
        '<p class="skill-draft-card__desc">' + esc(draft.description) + '</p>' +
        '<div class="skill-draft-card__meta">카테고리 ' + esc(draft.category || 'general') + '</div>' +
        skillBindings + conv + previewHtml + keywords +
        '<div class="skill-draft-card__actions">' +
            '<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-action="approve">승인 (활성화)</button>' +
            '<button type="button" class="sl-btn sl-btn-secondary sl-btn-sm" data-action="reject">거절 (보관)</button>' +
            '<a href="/custom-agents" class="sl-btn sl-btn-outline sl-btn-sm" data-action="open-custom-agents">전체 목록</a>' +
        '</div>';

    el.addEventListener('click', function (ev) {
        const btn = ev.target.closest('[data-action]');
        if (!btn) return;
        if (btn.tagName === 'BUTTON') ev.preventDefault();
        onAction(btn.dataset.action, draft.agentId);
    });
    return el;
}

export async function handleAgentDraftAction(action, agentId, callbacks) {
    const toast = (callbacks && callbacks.onToast) || (window.showToast || function () {});
    const confirmFn = (callbacks && callbacks.confirmFn) || ((msg) => window.confirm(msg));
    if (action === 'open-custom-agents') return;

    const API = (typeof window !== 'undefined' && window.API_ENDPOINTS) || {};
    const fetch_ = window.authFetch || window.fetch;

    if (action === 'approve') {
        if (!confirmFn('이 agent draft 를 승인하시겠습니까?\n\n⚠ 승인 후 system_prompt 가 채팅의 system role 에 주입됩니다. AI 가 작성/수집한 텍스트라 prompt injection 위험이 있으니 미리보기로 확인하세요.')) return;
        const url = typeof API.AGENTS_CUSTOM_APPROVE === 'function' ? API.AGENTS_CUSTOM_APPROVE(agentId) : '/api/agents/custom/' + encodeURIComponent(agentId) + '/approve';
        const r = await fetch_(url, { method: 'POST', credentials: 'include' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) { toast('승인 실패: ' + (data?.error?.message || r.statusText), 'error'); return; }
        toast('Agent 가 활성화되었습니다.', 'success');
        window.dispatchEvent(new CustomEvent('agent-draft:approved', { detail: { agentId } }));
    } else if (action === 'reject') {
        if (!confirmFn('이 agent draft 를 거절하시겠습니까? archived 로 보관됩니다.')) return;
        const url = typeof API.AGENTS_CUSTOM_REJECT === 'function' ? API.AGENTS_CUSTOM_REJECT(agentId) : '/api/agents/custom/' + encodeURIComponent(agentId) + '/reject';
        const r = await fetch_(url, { method: 'POST', credentials: 'include' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) { toast('거절 실패: ' + (data?.error?.message || r.statusText), 'error'); return; }
        toast('거절됨 (archived).', 'info');
        window.dispatchEvent(new CustomEvent('agent-draft:rejected', { detail: { agentId } }));
    }
}
