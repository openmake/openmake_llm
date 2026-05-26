/**
 * Artifact Panel — claude.ai-style 우측 슬라이드 패널
 *
 * 2026-05-26 Phase 1.D: WS artifact_* 이벤트 수신 → 패널에 5종 렌더 표시.
 * vendor self-host 라이브러리 (marked/hljs/mermaid/purify) 만 사용 — 외부 CDN/npm 0개.
 *
 * 사용:
 *   import { openArtifactPanel, appendArtifactChunk, finalizeArtifact } from './artifact-panel.js';
 *   openArtifactPanel({ id, kind, title, lang });
 *   appendArtifactChunk(id, '...토큰 청크...');
 *   finalizeArtifact(id);
 *
 * @module components/artifact-panel
 */

// ─── 모듈 state ──────────────────────────────────────────────────────────────

// 동일 id 의 버전 누적 (Phase 1 누적 정책 — 좌우 화살표 history 탐색).
// Map<artifactId, Array<{kind, title, lang, content, version}>>
const artifactStore = new Map();
let currentId = null;          // 현재 패널에 표시 중인 artifact id
let currentVersionIdx = 0;     // 현재 보고 있는 버전 (0-indexed within array)
let panelEl = null;            // 패널 DOM root

// ─── 패널 DOM 초기화 (lazy, body 에 한 번만 mount) ─────────────────────────

function ensurePanel() {
    if (panelEl) return panelEl;

    panelEl = document.createElement('aside');
    panelEl.className = 'artifact-panel';
    panelEl.setAttribute('aria-label', 'Artifact panel');
    panelEl.innerHTML = `
        <header class="ap-header">
            <span class="ap-title-wrap">
                <span class="ap-emoji" aria-hidden="true">📦</span>
                <h2 class="ap-title">Artifact</h2>
            </span>
            <div class="ap-tabs">
                <button class="ap-tab ap-tab-active" data-tab="preview">미리보기</button>
                <button class="ap-tab" data-tab="code">Code View</button>
            </div>
            <button class="ap-close" aria-label="패널 닫기" title="닫기 (Esc)">✕</button>
        </header>
        <div class="ap-body">
            <div class="ap-preview" data-pane="preview"></div>
            <pre class="ap-code" data-pane="code" hidden><code></code></pre>
        </div>
        <footer class="ap-footer">
            <div class="ap-version-nav">
                <button class="ap-vn-prev" aria-label="이전 버전" title="이전 버전 (←)">◀</button>
                <span class="ap-vn-label">v1</span>
                <button class="ap-vn-next" aria-label="다음 버전" title="다음 버전 (→)">▶</button>
            </div>
            <div class="ap-actions">
                <button class="ap-act-copy" title="본문 복사">📋 복사</button>
                <button class="ap-act-download" title="다운로드">⬇ 다운</button>
            </div>
        </footer>
    `;
    document.body.appendChild(panelEl);
    injectStyles();
    wireUp(panelEl);
    return panelEl;
}

function wireUp(root) {
    root.querySelector('.ap-close').addEventListener('click', closePanel);
    root.querySelectorAll('.ap-tab').forEach((t) => {
        t.addEventListener('click', () => switchTab(t.getAttribute('data-tab')));
    });
    root.querySelector('.ap-vn-prev').addEventListener('click', () => navVersion(-1));
    root.querySelector('.ap-vn-next').addEventListener('click', () => navVersion(+1));
    root.querySelector('.ap-act-copy').addEventListener('click', copyCurrent);
    root.querySelector('.ap-act-download').addEventListener('click', downloadCurrent);

    // 키보드: Esc / ←/→ — 패널이 열려 있을 때만
    document.addEventListener('keydown', (e) => {
        if (!root.classList.contains('open')) return;
        if (e.key === 'Escape') {
            closePanel();
            e.preventDefault();
        } else if (e.key === 'ArrowLeft' && !inEditableEl(e.target)) {
            navVersion(-1);
            e.preventDefault();
        } else if (e.key === 'ArrowRight' && !inEditableEl(e.target)) {
            navVersion(+1);
            e.preventDefault();
        }
    });
}

function inEditableEl(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

// ─── public API: WS 이벤트 핸들러가 호출 ────────────────────────────────────

export function openArtifactPanel(info) {
    ensurePanel();
    const id = info.id;
    const list = artifactStore.get(id) ?? [];
    list.push({
        kind: info.kind || 'code',
        title: info.title || 'Artifact',
        lang: info.lang || null,
        content: '',
        version: list.length + 1,
    });
    artifactStore.set(id, list);
    currentId = id;
    currentVersionIdx = list.length - 1; // 최신 버전 표시
    panelEl.classList.add('open');
    refreshHeader();
    refreshVersionNav();
    renderCurrent(); // 빈 본문 — 곧 chunk 가 도착
}

export function appendArtifactChunk(id, delta) {
    const list = artifactStore.get(id);
    if (!list || list.length === 0) return;
    const latest = list[list.length - 1];
    latest.content += delta;
    // 현재 보고 있는 게 최신 버전이면 incremental render (스트리밍 UX).
    if (currentId === id && currentVersionIdx === list.length - 1) {
        renderCurrent();
    }
}

export function finalizeArtifact(id) {
    // streaming 종료. 현재 보는 게 이 artifact 면 한 번 더 최종 render
    // (mermaid 같이 partial 본문에서 render 실패한 종류가 finalize 시점에 성공할 수 있음).
    if (currentId === id) renderCurrent();
}

export function closeArtifactPanel() {
    closePanel();
}

// ─── 내부: 패널 컨트롤 ───────────────────────────────────────────────────────

function closePanel() {
    if (panelEl) panelEl.classList.remove('open');
}

function switchTab(tab) {
    if (!panelEl) return;
    panelEl.querySelectorAll('.ap-tab').forEach((t) => {
        const active = t.getAttribute('data-tab') === tab;
        t.classList.toggle('ap-tab-active', active);
    });
    panelEl.querySelector('[data-pane="preview"]').hidden = tab !== 'preview';
    panelEl.querySelector('[data-pane="code"]').hidden = tab !== 'code';
}

function navVersion(delta) {
    if (!currentId) return;
    const list = artifactStore.get(currentId);
    if (!list) return;
    const next = Math.max(0, Math.min(list.length - 1, currentVersionIdx + delta));
    if (next === currentVersionIdx) return;
    currentVersionIdx = next;
    refreshVersionNav();
    renderCurrent();
}

function refreshHeader() {
    if (!panelEl || !currentId) return;
    const list = artifactStore.get(currentId);
    if (!list) return;
    const item = list[currentVersionIdx];
    panelEl.querySelector('.ap-emoji').textContent = kindIcon(item.kind);
    panelEl.querySelector('.ap-title').textContent = item.title || 'Artifact';
}

function refreshVersionNav() {
    if (!panelEl || !currentId) return;
    const list = artifactStore.get(currentId);
    if (!list) return;
    const label = panelEl.querySelector('.ap-vn-label');
    label.textContent = `v${list[currentVersionIdx].version} / ${list.length}`;
    panelEl.querySelector('.ap-vn-prev').disabled = currentVersionIdx === 0;
    panelEl.querySelector('.ap-vn-next').disabled = currentVersionIdx === list.length - 1;
}

function renderCurrent() {
    if (!panelEl || !currentId) return;
    const list = artifactStore.get(currentId);
    if (!list) return;
    const item = list[currentVersionIdx];

    // Code View 탭은 항상 raw 본문
    const codeEl = panelEl.querySelector('.ap-code code');
    codeEl.textContent = item.content;
    if (typeof window.hljs !== 'undefined' && item.kind === 'code' && item.lang) {
        codeEl.className = `language-${escAttr(item.lang)}`;
        try { window.hljs.highlightElement(codeEl); } catch (_e) { /* noop */ }
    } else {
        codeEl.className = '';
    }

    // Preview 탭은 kind 별 렌더러 dispatch
    const previewEl = panelEl.querySelector('.ap-preview');
    renderPreview(previewEl, item).catch((err) => {
        previewEl.innerHTML = `<div class="ap-error">렌더 실패: ${escHtml(err && err.message ? err.message : String(err))}</div>`;
    });
}

// ─── 5종 렌더러 dispatch ────────────────────────────────────────────────────

async function renderPreview(target, item) {
    target.innerHTML = '';
    const kind = item.kind;
    if (kind === 'markdown') return renderMarkdown(target, item);
    if (kind === 'code') return renderCode(target, item);
    if (kind === 'html') return renderHtml(target, item);
    if (kind === 'svg') return renderSvg(target, item);
    if (kind === 'mermaid') return renderMermaid(target, item);
    // Phase 2 종류는 fallback 으로 code 처럼 표시
    return renderCode(target, item);
}

async function renderMarkdown(target, item) {
    if (typeof window.marked === 'undefined') {
        target.innerHTML = `<pre>${escHtml(item.content)}</pre>`;
        return;
    }
    const raw = window.marked.parse(item.content, { breaks: true, gfm: true });
    const clean = typeof window.DOMPurify !== 'undefined'
        ? window.DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
        : raw;
    target.innerHTML = clean;
    target.className = 'ap-preview ap-md';
    // 코드 블록 hljs 강조
    if (typeof window.hljs !== 'undefined') {
        target.querySelectorAll('pre code').forEach((b) => {
            try { window.hljs.highlightElement(b); } catch (_e) { /* noop */ }
        });
    }
}

async function renderCode(target, item) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = item.content;
    if (item.lang) code.className = `language-${escAttr(item.lang)}`;
    pre.appendChild(code);
    target.appendChild(pre);
    target.className = 'ap-preview ap-code-only';
    if (typeof window.hljs !== 'undefined' && item.lang) {
        try { window.hljs.highlightElement(code); } catch (_e) { /* noop */ }
    }
}

async function renderHtml(target, item) {
    // 보안: iframe sandbox — allow-scripts 만, allow-same-origin 비활성.
    // → 부모 페이지의 cookie/storage 접근 불가, fetch 시 origin null (same-origin 정책으로 대부분 차단).
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.className = 'ap-iframe';
    target.appendChild(iframe);
    target.className = 'ap-preview ap-html';
    // srcdoc 으로 격리 — content 가 부모 페이지의 DOM 에 직접 inject 되지 않음.
    iframe.srcdoc = item.content;
}

async function renderSvg(target, item) {
    // SVG 는 DOMPurify 로 위생화 후 inline.
    const clean = typeof window.DOMPurify !== 'undefined'
        ? window.DOMPurify.sanitize(item.content, { USE_PROFILES: { svg: true, svgFilters: true } })
        : escHtml(item.content);
    const wrap = document.createElement('div');
    wrap.className = 'ap-svg-wrap';
    wrap.innerHTML = clean;
    target.appendChild(wrap);
    target.className = 'ap-preview ap-svg';
}

async function renderMermaid(target, item) {
    if (typeof window.mermaid === 'undefined') {
        target.innerHTML = `<pre>${escHtml(item.content)}</pre>`;
        return;
    }
    // 글로벌 초기화 (한 번만, ui.js 의 _mermaidInitialized 와 공유 가능)
    if (!window._mermaidInitialized) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        window.mermaid.initialize({
            startOnLoad: false,
            theme: isDark ? 'dark' : 'default',
            securityLevel: 'strict',
        });
        window._mermaidInitialized = true;
    }
    const id = `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        const { svg } = await window.mermaid.render(id, item.content);
        const wrap = document.createElement('div');
        wrap.className = 'ap-mermaid-wrap';
        wrap.innerHTML = svg;
        target.appendChild(wrap);
        target.className = 'ap-preview ap-mermaid';
    } catch (err) {
        // partial 본문 (streaming 중) 에서 render 실패 — finalizeArtifact 시점에 재시도.
        target.innerHTML = `<pre class="ap-mermaid-partial">${escHtml(item.content)}</pre>`;
    }
}

// ─── 액션: 복사 / 다운로드 ──────────────────────────────────────────────────

async function copyCurrent() {
    if (!currentId) return;
    const item = artifactStore.get(currentId)?.[currentVersionIdx];
    if (!item) return;
    try {
        await navigator.clipboard.writeText(item.content);
        flashAction('.ap-act-copy', '복사됨');
    } catch (_e) {
        flashAction('.ap-act-copy', '실패');
    }
}

function downloadCurrent() {
    if (!currentId) return;
    const item = artifactStore.get(currentId)?.[currentVersionIdx];
    if (!item) return;
    const mime = mimeFor(item.kind, item.lang);
    const ext = extFor(item.kind, item.lang);
    const filename = `${currentId}-v${item.version}.${ext}`;
    const blob = new Blob([item.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flashAction(selector, msg) {
    const btn = panelEl?.querySelector(selector);
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = orig; }, 1200);
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────

function kindIcon(kind) {
    const map = {
        markdown: '📝', code: '💻', html: '🌐', svg: '🖼️', mermaid: '📊',
        react: '⚛️', chart: '📈', csv: '📊', slide: '🎞️', excalidraw: '✏️',
    };
    return map[kind] || '📦';
}

function mimeFor(kind, lang) {
    if (kind === 'html') return 'text/html';
    if (kind === 'svg') return 'image/svg+xml';
    if (kind === 'markdown') return 'text/markdown';
    if (kind === 'mermaid') return 'text/plain';
    if (kind === 'code') {
        const m = { javascript: 'application/javascript', typescript: 'application/typescript',
            python: 'text/x-python', json: 'application/json' };
        return m[lang || ''] || 'text/plain';
    }
    return 'text/plain';
}

function extFor(kind, lang) {
    if (kind === 'html') return 'html';
    if (kind === 'svg') return 'svg';
    if (kind === 'markdown') return 'md';
    if (kind === 'mermaid') return 'mmd';
    if (kind === 'code') {
        const m = { javascript: 'js', typescript: 'ts', python: 'py', go: 'go',
            rust: 'rs', java: 'java', json: 'json', yaml: 'yml', sh: 'sh', bash: 'sh' };
        return m[lang || ''] || 'txt';
    }
    return 'txt';
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}
function escAttr(s) {
    return String(s).replace(/[^\w-]/g, '');
}

// ─── CSS (한 번만 inject) ──────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById('artifact-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'artifact-panel-styles';
    style.textContent = `
.artifact-panel {
    position: fixed; top: 0; right: 0;
    width: min(720px, 50vw); height: 100vh;
    background: var(--bg-card, #1a1a1a);
    border-left: 1px solid var(--border-light, #2a2a2a);
    box-shadow: -8px 0 24px rgba(0,0,0,0.25);
    transform: translateX(100%);
    transition: transform 0.2s ease-out;
    display: flex; flex-direction: column;
    z-index: 1200; color: var(--text-primary, #fff);
}
.artifact-panel.open { transform: translateX(0); }
@media (max-width: 768px) { .artifact-panel { width: 100vw; } }

.ap-header {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-light, #2a2a2a);
}
.ap-title-wrap { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-width: 0; }
.ap-emoji { font-size: 22px; }
.ap-title {
    margin: 0; font-size: 15px; font-weight: var(--font-weight-semibold, 600);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;
}
.ap-tabs { display: flex; gap: 4px; flex: 1; justify-content: center; }
.ap-tab {
    padding: 4px 12px; border: 1px solid var(--border-light, #2a2a2a);
    background: transparent; color: var(--text-muted, #888);
    border-radius: var(--radius-md, 6px); cursor: pointer; font-size: 13px;
}
.ap-tab-active {
    background: var(--accent-primary, #6366f1); color: #fff;
    border-color: var(--accent-primary, #6366f1);
}
.ap-close {
    background: transparent; border: none; color: var(--text-muted, #888);
    font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px;
}
.ap-close:hover { background: var(--bg-tertiary, #2a2a2a); color: var(--text-primary, #fff); }

.ap-body { flex: 1; overflow-y: auto; padding: 16px; min-height: 0; }
.ap-preview {
    background: var(--bg-secondary, #0f0f0f);
    border: 1px solid var(--border-light, #2a2a2a);
    border-radius: var(--radius-md, 6px); padding: 12px; min-height: 200px;
    word-break: break-word;
}
.ap-preview.ap-md { padding: 16px 20px; line-height: 1.6; }
.ap-preview.ap-md h1,
.ap-preview.ap-md h2,
.ap-preview.ap-md h3 { margin-top: 16px; }
.ap-preview.ap-md pre {
    background: var(--bg-tertiary, #2a2a2a); padding: 8px; border-radius: 4px;
    overflow-x: auto;
}
.ap-preview.ap-md code:not(pre code) {
    background: var(--bg-tertiary, #2a2a2a); padding: 1px 4px; border-radius: 3px;
    font-size: 0.9em;
}
.ap-preview.ap-code-only { padding: 0; background: transparent; border: none; }
.ap-preview.ap-code-only pre {
    margin: 0; padding: 12px; background: var(--bg-secondary, #0f0f0f);
    border: 1px solid var(--border-light, #2a2a2a); border-radius: var(--radius-md, 6px);
    overflow-x: auto; font-size: 13px;
}
.ap-preview.ap-html { padding: 0; background: transparent; border: none; }
.ap-iframe {
    width: 100%; min-height: 400px; border: 1px solid var(--border-light, #2a2a2a);
    border-radius: var(--radius-md, 6px); background: #fff;
}
.ap-svg-wrap, .ap-mermaid-wrap {
    background: #fff; padding: 16px; border-radius: var(--radius-md, 6px);
    display: flex; justify-content: center; align-items: center; min-height: 200px;
}
.ap-svg-wrap svg, .ap-mermaid-wrap svg { max-width: 100%; height: auto; }
.ap-mermaid-partial { font-size: 12px; color: var(--text-muted, #888); }
.ap-error { color: var(--danger, #ef4444); padding: 8px; }

.ap-code {
    margin: 0; padding: 12px; background: var(--bg-secondary, #0f0f0f);
    border: 1px solid var(--border-light, #2a2a2a); border-radius: var(--radius-md, 6px);
    overflow-x: auto; font-size: 13px; max-height: 100%;
}
.ap-code code { font-family: 'JetBrains Mono', 'Courier New', monospace; }

.ap-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 16px; border-top: 1px solid var(--border-light, #2a2a2a);
    background: var(--bg-tertiary, #0f0f0f);
}
.ap-version-nav { display: flex; align-items: center; gap: 6px; }
.ap-version-nav button {
    background: transparent; border: 1px solid var(--border-light, #2a2a2a);
    color: var(--text-secondary, #888); width: 26px; height: 26px;
    border-radius: 4px; cursor: pointer; font-size: 11px;
}
.ap-version-nav button:disabled { opacity: 0.4; cursor: default; }
.ap-vn-label { font-size: 12px; color: var(--text-muted, #888); min-width: 60px; text-align: center; }
.ap-actions { display: flex; gap: 6px; }
.ap-actions button {
    background: var(--bg-secondary, #0f0f0f); border: 1px solid var(--border-light, #2a2a2a);
    color: var(--text-primary, #fff); padding: 4px 10px;
    border-radius: var(--radius-md, 6px); cursor: pointer; font-size: 12px;
}
.ap-actions button:hover { background: var(--accent-primary, #6366f1); color: #fff; }
    `;
    document.head.appendChild(style);
}
