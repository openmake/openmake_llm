/**
 * ============================================
 * Projects Page — claude.ai-style 카드 그리드 (Phase R3)
 * ============================================
 * skill-library / mcp-servers 진입점.
 * 사용자가 단일 hub 에서 사용 가능한 도구/스킬 카테고리 선택.
 * (Agent Draft 는 별도 /custom-agents — projects hub 에서 제외, 2026-05-26)
 *
 * @module pages/projects
 */
'use strict';

window.PageModules = window.PageModules || {};

const escapeHTML = (str) => {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(str);
    const d = document.createElement('div');
    d.textContent = str == null ? '' : String(str);
    return d.innerHTML;
};

const CARDS = [
    {
        key: 'skills',
        unit: '스킬',
        href: '/skill-library.html',
        icon: '<iconify-icon icon=lucide:package></iconify-icon>',
        title: '스킬 라이브러리',
        desc: '재사용 가능한 매니페스트 + 도구 바인딩 (Anthropic Skills 동형)',
        tier: 'pro',
        actions: ['.SKILL 업로드', '커스텀 작성', '시스템 스킬'],
    },
    {
        key: 'mcp',
        unit: '서버',
        href: '/mcp-servers.html',
        icon: '<iconify-icon icon=lucide:plug></iconify-icon>',
        title: 'MCP 서버',
        desc: '로컬 도구 (파일 시스템, GitHub 등) 를 LLM 에 연결',
        tier: 'free',
        actions: ['카탈로그 선택', '사용자 등록', 'lifecycle 추적'],
    },
];

function renderCard(card) {
    const actions = card.actions.map((a) => `<span class="proj-card-pill">${escapeHTML(a)}</span>`).join('');
    return `
        <a class="proj-card" href="${escapeHTML(card.href)}" data-projects-navigate="${escapeHTML(card.href)}">
            <div class="proj-card-icon">${card.icon}</div>
            <div class="proj-card-body">
                <h3 class="proj-card-title">${escapeHTML(card.title)}
                    <span class="proj-card-tier proj-tier-${escapeHTML(card.tier)}">${escapeHTML(card.tier)}</span>
                </h3>
                <p class="proj-card-desc">${escapeHTML(card.desc)}</p>
                <div class="proj-card-stats">
                    <span class="proj-card-count" data-count="${escapeHTML(card.key)}">—</span>
                    <span class="proj-card-draft" data-draft="${escapeHTML(card.key)}" style="display:none;"></span>
                </div>
                <div class="proj-card-actions">${actions}</div>
            </div>
            <span class="proj-card-arrow" aria-hidden="true">→</span>
        </a>`;
}

function getHTML() {
    const cards = CARDS.map(renderCard).join('');
    return '<div class="projects-page">' +
        '<style data-spa-style="projects">' +
        '.projects-page{padding:var(--space-5);width:100%;}' +
        '.projects-header{margin-bottom:var(--space-6);}' +
        '.projects-header h1{font-size:28px;margin:0 0 var(--space-2);color:var(--text-primary);}' +
        '.projects-header p{color:var(--text-muted);margin:0;}' +
        '.proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:var(--space-4);}' +
        '.proj-card{display:flex;gap:var(--space-4);align-items:flex-start;background:var(--bg-card);border:1px solid var(--border-light);border-radius:var(--radius-lg);padding:var(--space-5);text-decoration:none;color:inherit;transition:border-color .15s,transform .15s;}' +
        '.proj-card:hover{border-color:var(--accent-primary);transform:translateY(-2px);}' +
        '.proj-card-icon{font-size:32px;flex-shrink:0;color:var(--accent-primary);}' +
        '.proj-card-icon iconify-icon{font-size:32px;}' +
        '.proj-card-body{flex:1;min-width:0;}' +
        '.proj-card-title{display:flex;align-items:center;gap:var(--space-2);margin:0 0 var(--space-2);font-size:16px;color:var(--text-primary);}' +
        '.proj-card-tier{font-size:10px;padding:2px 6px;border-radius:var(--radius-sm);font-weight:var(--font-weight-semibold);text-transform:uppercase;}' +
        '.proj-tier-free{background:var(--bg-tertiary);color:var(--text-secondary);}' +
        '.proj-tier-pro{background:var(--accent-primary-light);color:var(--accent-primary);border:1px solid var(--border-color);}' +
        '.proj-card-desc{color:var(--text-muted);font-size:var(--font-size-sm);margin:0 0 var(--space-3);line-height:1.5;}' +
        '.proj-card-actions{display:flex;flex-wrap:wrap;gap:var(--space-1);}' +
        '.proj-card-pill{padding:2px 8px;background:var(--bg-tertiary);color:var(--text-secondary);border-radius:var(--radius-md);font-size:11px;}' +
        '.proj-card-stats{display:flex;align-items:center;gap:var(--space-2);margin:0 0 var(--space-3);min-height:20px;}' +
        '.proj-card-count{font-size:var(--font-size-sm);color:var(--text-secondary);font-weight:var(--font-weight-semibold);}' +
        '.proj-card-draft{display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:var(--radius-md);background:var(--accent-primary-light);color:var(--accent-primary);border:1px solid var(--border-color);font-weight:var(--font-weight-semibold);}' +
        '.proj-card-arrow{color:var(--text-muted);font-size:18px;align-self:center;flex-shrink:0;transition:transform .15s;}' +
        '.proj-card:hover .proj-card-arrow{color:var(--accent-primary);transform:translateX(4px);}' +
        '</style>' +
        '<header class="projects-header">' +
        '<h1><iconify-icon icon=lucide:folder></iconify-icon> 프로젝트</h1>' +
        '<p>스킬 / MCP 서버 — 작업 도구 통합 hub</p>' +
        '</header>' +
        `<div class="proj-grid">${cards}</div>` +
        '</div>';
}

const _listeners = [];

function init() {
    document.querySelectorAll('[data-projects-navigate]').forEach((card) => {
        const handler = (ev) => {
            ev.preventDefault();
            const target = card.getAttribute('data-projects-navigate');
            if (!target) return;
            if (window.Router && typeof window.Router.navigate === 'function') {
                window.Router.navigate(target);
            } else {
                window.location.href = target;
            }
        };
        card.addEventListener('click', handler);
        _listeners.push({ el: card, ev: 'click', fn: handler });
    });
    loadStats();
}

async function fetchJson(url) {
    const res = await window.authFetch(url);
    if (!res || !res.ok) throw new Error('http ' + (res ? res.status : '?'));
    return res.json();
}

function setCount(key, n, unit) {
    const el = document.querySelector('[data-count="' + key + '"]');
    if (el) el.textContent = (n == null) ? '—' : (n + ' ' + unit);
}

function setDraft(key, n) {
    const el = document.querySelector('[data-draft="' + key + '"]');
    if (!el) return;
    if (n > 0) {
        el.innerHTML = '<iconify-icon icon="lucide:inbox"></iconify-icon> 검토 대기 ' + n;
        el.style.display = '';
        el.title = '미승인 draft ' + n + '건 — 클릭하여 검토';
    } else {
        el.style.display = 'none';
    }
}

// 허브 통계 요약 — 각 도메인 개수 + 미승인 draft 배지 (실패 시 graceful degrade)
async function loadStats() {
    const API = window.API_ENDPOINTS || {};
    const SKILLS = API.AGENTS_SKILLS || '/api/agents/skills';
    const SKILLS_DRAFTS = API.AGENTS_SKILLS_DRAFTS || '/api/agents/skills/drafts';

    fetchJson(SKILLS + '?limit=1')
        .then((d) => setCount('skills', (d && d.data && (d.data.total != null ? d.data.total : (d.data.skills || []).length)) || 0, '스킬'))
        .catch(() => setCount('skills', null, '스킬'));
    fetchJson(SKILLS_DRAFTS + '?target=user&limit=50')
        .then((d) => setDraft('skills', ((d && d.data && d.data.drafts) || []).length))
        .catch(() => { /* draft 미지원/실패 — 배지 숨김 유지 */ });

    fetchJson('/api/mcp/servers')
        .then((d) => setCount('mcp', (((d && d.data && d.data.servers) || (d && d.servers)) || []).length, '서버'))
        .catch(() => setCount('mcp', null, '서버'));
    fetchJson('/api/mcp/servers/drafts')
        .then((d) => setDraft('mcp', (d && Array.isArray(d.data)) ? d.data.length : 0))
        .catch(() => { /* noop */ });
}

function cleanup() {
    while (_listeners.length) {
        const { el, ev, fn } = _listeners.pop();
        try { el.removeEventListener(ev, fn); } catch (_e) { /* noop */ }
    }
}

window.PageModules['projects'] = { getHTML, init, cleanup };

const pageModule = window.PageModules['projects'];
export default pageModule;
