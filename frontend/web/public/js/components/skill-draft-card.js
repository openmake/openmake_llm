/**
 * ============================================================
 * Skill Draft Preview Card — 채팅 inline + 라이브러리 공용 컴포넌트
 * ============================================================
 *
 * MCP tool `create_skill` 이 반환한 resource content (uri prefix
 * `openmake://skill-draft/`) 를 채팅 메시지 안에 인라인으로 표시하거나,
 * 스킬 라이브러리의 drafts 탭에서 동일한 카드로 표시.
 *
 * @module components/skill-draft-card
 */
'use strict';

/**
 * @typedef {Object} SkillDraft
 * @property {string} skillId
 * @property {string} name
 * @property {string} description
 * @property {string} category
 * @property {'user'|'system'} target
 * @property {string} contentPreview
 * @property {string[]} [triggers]
 * @property {string} [createdAt]
 * @property {string} [modelUsed]
 * @property {number} [tokensUsed]
 * @property {boolean} [deduped]
 */

/** XSS sanitize — sanitize.js 의 전역 window.escapeHTML 사용 */
function esc(s) {
    const fn = (typeof window !== 'undefined' && window.escapeHTML) || (v => String(v));
    return fn(s == null ? '' : String(s));
}

/**
 * @param {SkillDraft} draft
 * @param {{ mode?: 'inline'|'full', onAction?: (action: string, skillId: string) => void }} [opts]
 * @returns {HTMLElement}
 */
export function renderSkillDraftCard(draft, opts) {
    const mode = (opts && opts.mode) || 'inline';
    const onAction = (opts && opts.onAction) || function () {};

    const el = document.createElement('div');
    el.className = 'skill-draft-card skill-draft-card--' + mode;
    el.dataset.skillId = draft.skillId;
    el.dataset.target = draft.target || 'user';

    const targetBadge = draft.target === 'system'
        ? '<span class="sl-badge skill-draft-card__badge-system">🔒 시스템</span>'
        : '<span class="sl-badge skill-draft-card__badge-user">👤 본인</span>';

    const dedupedBadge = draft.deduped
        ? '<span class="sl-badge skill-draft-card__badge-deduped" title="24시간 내 동일 요청으로 기존 draft 재사용">↻ 재사용</span>'
        : '';

    const triggersHtml = (Array.isArray(draft.triggers) && draft.triggers.length > 0)
        ? '<div class="skill-draft-card__triggers">' +
          draft.triggers.slice(0, 8).map(t => '<span class="sl-badge sl-badge-secondary">' + esc(t) + '</span>').join(' ') +
          '</div>'
        : '';

    const previewHtml = mode === 'full' && draft.contentPreview
        ? '<details class="skill-draft-card__preview">' +
          '<summary>본문 미리보기</summary>' +
          '<pre class="skill-draft-card__content">' + esc(draft.contentPreview) + '</pre>' +
          '</details>'
        : '';

    const metaLine = mode === 'inline'
        ? '<div class="skill-draft-card__meta">' +
          (draft.modelUsed ? '모델 ' + esc(draft.modelUsed) + ' · ' : '') +
          (draft.tokensUsed != null ? '토큰 ' + esc(draft.tokensUsed) + ' · ' : '') +
          '카테고리 ' + esc(draft.category || 'general') +
          '</div>'
        : '';

    el.innerHTML =
        '<div class="skill-draft-card__header">' +
            '<span class="skill-draft-card__badge skill-draft-card__badge-draft">📝 초안</span>' +
            targetBadge +
            dedupedBadge +
        '</div>' +
        '<h4 class="skill-draft-card__title">' + esc(draft.name) + '</h4>' +
        '<p class="skill-draft-card__desc">' + esc(draft.description) + '</p>' +
        metaLine +
        previewHtml +
        triggersHtml +
        '<div class="skill-draft-card__actions">' +
            '<button type="button" class="sl-btn sl-btn-primary sl-btn-sm" data-action="approve">승인 (활성화)</button>' +
            '<button type="button" class="sl-btn sl-btn-secondary sl-btn-sm" data-action="reject">거절 (보관)</button>' +
            '<a href="/skill-library" class="sl-btn sl-btn-outline sl-btn-sm" data-action="open-library">라이브러리에서 검토</a>' +
        '</div>';

    el.addEventListener('click', function (ev) {
        const btn = ev.target.closest('[data-action]');
        if (!btn) return;
        if (btn.tagName === 'BUTTON') ev.preventDefault();
        onAction(btn.dataset.action, draft.skillId);
    });

    return el;
}

/**
 * 카드의 승인/거절 액션 핸들러.
 * 백엔드 endpoint 는 API_ENDPOINTS.AGENTS_SKILLS_APPROVE/REJECT (path builder).
 *
 * @param {'approve'|'reject'|'open-library'} action
 * @param {string} skillId
 * @param {{ onToast?: (msg: string, type?: string) => void, confirmFn?: () => boolean }} [callbacks]
 */
export async function handleSkillDraftAction(action, skillId, callbacks) {
    const toast = (callbacks && callbacks.onToast) || (window.showToast || function () {});
    const confirmFn = (callbacks && callbacks.confirmFn) || ((msg) => window.confirm(msg));

    if (action === 'open-library') {
        // 링크 자체 동작 — 핸들러는 no-op
        return;
    }

    const API = (typeof window !== 'undefined' && window.API_ENDPOINTS) || {};
    const fetch_ = window.authFetch || window.fetch;

    if (action === 'approve') {
        if (!confirmFn('이 draft 를 승인하시겠습니까?\n\n⚠ 승인 후 채팅 system prompt 에 주입됩니다. AI 가 작성한 텍스트라 의심스러운 지시문이 없는지 라이브러리 미리보기로 확인하세요.')) return;
        const url = typeof API.AGENTS_SKILLS_APPROVE === 'function'
            ? API.AGENTS_SKILLS_APPROVE(skillId)
            : '/api/agents/skills/' + encodeURIComponent(skillId) + '/approve';
        const r = await fetch_(url, { method: 'POST', credentials: 'include' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) {
            toast('승인 실패: ' + (data?.error?.message || data?.error || r.statusText), 'error');
            return;
        }
        toast('스킬이 활성화되었습니다.', 'success');
        window.dispatchEvent(new CustomEvent('skill-draft:approved', { detail: { skillId } }));
    } else if (action === 'reject') {
        if (!confirmFn('이 draft 를 거절하시겠습니까? archived 상태로 보관됩니다 (영구 삭제 아님).')) return;
        const url = typeof API.AGENTS_SKILLS_REJECT === 'function'
            ? API.AGENTS_SKILLS_REJECT(skillId)
            : '/api/agents/skills/' + encodeURIComponent(skillId) + '/reject';
        const r = await fetch_(url, { method: 'POST', credentials: 'include' });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.success) {
            toast('거절 실패: ' + (data?.error?.message || data?.error || r.statusText), 'error');
            return;
        }
        toast('거절됨 (archived).', 'info');
        window.dispatchEvent(new CustomEvent('skill-draft:rejected', { detail: { skillId } }));
    }
}
