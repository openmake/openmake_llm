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
let editMode = false;          // Phase 3 사용자 편집 모드

// 채팅 sessionId — POST 새 버전 호출 시 필요.
// chat.js 가 setState('currentChatId', ...) 로 관리하지만 ES module 의존성 회피 위해
// 모듈 진입점에 setter 함수 노출 + WS handler 가 호출.
let currentSessionId = null;
export function setArtifactSessionId(sid) { currentSessionId = sid || null; }

/**
 * 인라인 카드의 hover tooltip 등이 본문 미리보기를 fetch 하기 위한 helper.
 * artifactStore (모듈 내부 Map) 에서 최신 버전 본문 첫 N자 반환.
 * 2026-05-26 Phase 3 (future 확장).
 */
export function getArtifactPreview(id, maxChars = 400) {
    const list = artifactStore.get(id);
    if (!list || list.length === 0) return '';
    const latest = list[list.length - 1];
    const text = String(latest.content || '');
    return text.length > maxChars ? text.slice(0, maxChars) + '...' : text;
}

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
                <button class="ap-act-edit" title="편집 (새 버전 생성)">✏️ 편집</button>
                <button class="ap-act-copy" title="본문 복사">📋 복사</button>
                <button class="ap-act-download" title="원본 다운로드">⬇ 다운</button>
                <button class="ap-act-pdf" title="미리보기를 PDF 로 저장 (pdf-lib + dom-to-image)">📄 PDF</button>
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
    root.querySelector('.ap-act-edit').addEventListener('click', toggleEditMode);
    root.querySelector('.ap-act-copy').addEventListener('click', copyCurrent);
    root.querySelector('.ap-act-download').addEventListener('click', downloadCurrent);
    root.querySelector('.ap-act-pdf').addEventListener('click', exportPdfCurrent);

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

    // Code View 탭은 항상 raw 본문. enterEditUI 가 codePane 의 innerHTML 을 textarea+버튼으로
    // 교체했을 수 있어 매번 <code> 재생성 (2026-05-26 Phase 3 편집 후 정상 복원).
    const codePane = panelEl.querySelector('.ap-code');
    codePane.innerHTML = '<code></code>';
    const codeEl = codePane.querySelector('code');
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
    // Phase 2 (2026-05-26): 신규 종류 — lazy load 패턴
    if (kind === 'chart') return renderChart(target, item);
    if (kind === 'csv') return renderCsv(target, item);
    if (kind === 'slide') return renderSlide(target, item);
    if (kind === 'react') return renderReact(target, item);
    if (kind === 'excalidraw') return renderExcalidraw(target, item);
    // fallback 으로 code 처럼 표시
    return renderCode(target, item);
}

/**
 * Excalidraw artifact (Phase 3, 2026-05-26) — RoughJS 기반 손그림 다이어그램.
 * Excalidraw 본체 (React + 2MB+) 회피 — LLM 이 도형 JSON 만 출력하고 우리가 SVG 렌더.
 *
 * content JSON 형식:
 *   {"shapes":[
 *     {"type":"rectangle","x":40,"y":40,"width":140,"height":80,"label":"User"},
 *     {"type":"ellipse","x":250,"y":200,"width":100,"height":60,"label":"DB"},
 *     {"type":"arrow","points":[[180,80],[260,220]],"label":"query"}
 *   ],"width":600,"height":400}
 */
async function renderExcalidraw(target, item) {
    await loadScriptOnce('/vendor/artifacts/rough.umd.min.js', 'rough');
    let spec;
    try { spec = JSON.parse(item.content); } catch (e) {
        target.innerHTML = `<div class="ap-error">Excalidraw spec JSON 파싱 실패: ${escHtml(e.message)}</div>`;
        return;
    }
    const width = spec.width || 600;
    const height = spec.height || 400;
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.style.maxHeight = '600px';
    svg.style.background = '#fff';
    target.appendChild(svg);
    target.className = 'ap-preview ap-excalidraw';

    try {
        const rc = window.rough.svg(svg);
        const shapes = Array.isArray(spec.shapes) ? spec.shapes : [];
        const drawOpts = { stroke: '#1f2937', strokeWidth: 1.5, roughness: 1.6 };
        for (const s of shapes) {
            let node = null;
            if (s.type === 'rectangle' || s.type === 'rect') {
                node = rc.rectangle(s.x || 0, s.y || 0, s.width || 100, s.height || 60, drawOpts);
            } else if (s.type === 'ellipse' || s.type === 'circle') {
                node = rc.ellipse((s.x || 0) + (s.width || 80) / 2, (s.y || 0) + (s.height || 60) / 2,
                    s.width || 80, s.height || 60, drawOpts);
            } else if (s.type === 'line' && Array.isArray(s.points) && s.points.length >= 2) {
                node = rc.line(s.points[0][0], s.points[0][1], s.points[1][0], s.points[1][1], drawOpts);
            } else if (s.type === 'arrow' && Array.isArray(s.points) && s.points.length >= 2) {
                const [from, to] = s.points;
                node = rc.line(from[0], from[1], to[0], to[1], drawOpts);
                svg.appendChild(node);
                // arrow head
                const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
                const arrLen = 10;
                const a1x = to[0] - arrLen * Math.cos(angle - Math.PI / 6);
                const a1y = to[1] - arrLen * Math.sin(angle - Math.PI / 6);
                const a2x = to[0] - arrLen * Math.cos(angle + Math.PI / 6);
                const a2y = to[1] - arrLen * Math.sin(angle + Math.PI / 6);
                svg.appendChild(rc.line(to[0], to[1], a1x, a1y, drawOpts));
                svg.appendChild(rc.line(to[0], to[1], a2x, a2y, drawOpts));
                node = null; // 이미 append 함
            }
            if (node) svg.appendChild(node);
            // 라벨
            if (s.label) {
                const cx = (s.x || (s.points ? s.points[0][0] : 0)) + (s.width || 0) / 2;
                const cy = (s.y || (s.points ? s.points[0][1] : 0)) + (s.height || 0) / 2;
                const text = document.createElementNS(svgNs, 'text');
                text.setAttribute('x', String(cx));
                text.setAttribute('y', String(cy));
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('dominant-baseline', 'middle');
                text.setAttribute('font-family', "'Comic Sans MS', cursive");
                text.setAttribute('font-size', '14');
                text.setAttribute('fill', '#1f2937');
                text.textContent = s.label;
                svg.appendChild(text);
            }
        }
    } catch (e) {
        target.innerHTML = `<div class="ap-error">Excalidraw 렌더 실패: ${escHtml(e.message)}</div>`;
    }
}

// ─── Phase 2 신규 렌더러 (lazy-loaded) ──────────────────────────────────────

/**
 * Chart artifact — content 는 JSON spec.
 * 두 엔진 dispatch (2026-05-26 Phase 2):
 *   - spec.engine === 'uplot' OR spec 의 series[0].label 이 'time-series' 라벨이면 → uPlot (가벼움, 시계열 특화)
 *   - 그 외 → Chart.js (일반 차트)
 *
 * Chart.js spec 예: {"type":"bar","data":{"labels":["A","B"],"datasets":[{"data":[1,2]}]}}
 * uPlot   spec 예: {"engine":"uplot","data":[[1700000000,1700003600,...],[10,20,...]],"series":[{label:"time"},{label:"value"}]}
 */
async function renderChart(target, item) {
    let spec;
    try {
        spec = JSON.parse(item.content);
    } catch (e) {
        target.innerHTML = `<div class="ap-error">Chart spec JSON 파싱 실패: ${escHtml(e.message)}</div>`;
        return;
    }
    const useUplot = spec.engine === 'uplot' || isLikelyTimeSeries(spec);

    if (useUplot) {
        await loadScriptOnce('/vendor/artifacts/uPlot.iife.min.js', 'uPlot');
        await loadStyleOnce('/vendor/artifacts/uPlot.min.css');
        const wrap = document.createElement('div');
        wrap.className = 'ap-chart-wrap';
        wrap.style.background = '#fff';
        wrap.style.padding = '12px';
        wrap.style.borderRadius = '6px';
        target.appendChild(wrap);
        target.className = 'ap-preview ap-chart';
        try {
            const opts = {
                width: wrap.clientWidth || 600,
                height: 360,
                title: spec.title || '',
                series: spec.series || [{}, { label: 'value', stroke: '#6366f1' }],
                scales: spec.scales || { x: { time: true } },
            };
            new window.uPlot(opts, spec.data, wrap);
        } catch (e) {
            target.innerHTML = `<div class="ap-error">uPlot 렌더 실패: ${escHtml(e.message)}</div>`;
        }
        return;
    }

    // Chart.js (default)
    await loadScriptOnce('/vendor/artifacts/chart.umd.min.js', 'Chart');
    const canvas = document.createElement('canvas');
    canvas.style.maxHeight = '600px';
    const wrap = document.createElement('div');
    wrap.className = 'ap-chart-wrap';
    wrap.style.background = '#fff';
    wrap.style.padding = '12px';
    wrap.style.borderRadius = '6px';
    wrap.appendChild(canvas);
    target.appendChild(wrap);
    target.className = 'ap-preview ap-chart';
    try {
        new window.Chart(canvas, spec);
    } catch (e) {
        target.innerHTML = `<div class="ap-error">Chart 렌더 실패: ${escHtml(e.message)}</div>`;
    }
}

/**
 * Chart spec 이 시계열일 가능성을 휴리스틱으로 추정.
 * - Chart.js 의 scales.x.type === 'time' / 'timeseries' 면 yes
 * - data.labels 가 ISO 날짜 또는 큰 timestamp 면 yes
 * - 그 외 false (Chart.js 가 더 적합)
 */
function isLikelyTimeSeries(spec) {
    if (!spec || typeof spec !== 'object') return false;
    const xType = spec.options?.scales?.x?.type || spec.scales?.x?.type;
    if (xType === 'time' || xType === 'timeseries') return true;
    const labels = spec.data?.labels;
    if (Array.isArray(labels) && labels.length > 0) {
        const first = labels[0];
        if (typeof first === 'string' && /^\d{4}-\d{2}-\d{2}/.test(first)) return true;
        if (typeof first === 'number' && first > 1e9) return true; // unix timestamp
    }
    return false;
}

/**
 * CSV artifact — PapaParse 파싱 후 정렬/검색 가능한 표.
 * Phase 3.2 (2026-05-26): 헤더 검색 input + th 클릭 정렬 (asc/desc/none 3단)
 * 외부 라이브러리 0 — 자체 구현 (TanStack Table 등 의존성 회피).
 */
async function renderCsv(target, item) {
    await loadScriptOnce('/vendor/artifacts/papaparse.min.js', 'Papa');
    const parsed = window.Papa.parse(item.content.trim(), {
        header: true,
        skipEmptyLines: true,
    });
    // 보안 (Phase 3 보완 A.5, 2026-05-26): PapaParse 결과의 첫 row 가 `__proto__` 등 위험 키를
    // 가질 경우 Object.keys / 동적 접근 시 prototype pollution. 안전한 키만 추출 + 위험 키 제거.
    const SAFE_KEY = /^[^\s]+$/; // 단순 휴리스틱 — 공백 없는 일반 키만
    const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const allRows = parsed.data.map(row => {
        if (!row || typeof row !== 'object') return {};
        const clean = Object.create(null); // prototype-less object
        for (const k of Object.keys(row)) {
            if (DANGEROUS_KEYS.has(k)) continue;
            if (!SAFE_KEY.test(k)) continue;
            clean[k] = row[k];
        }
        return clean;
    });
    const headers = allRows.length > 0 ? Object.keys(allRows[0]) : [];

    const wrap = document.createElement('div');
    wrap.className = 'ap-csv-wrap';
    if (parsed.errors && parsed.errors.length > 0) {
        wrap.insertAdjacentHTML('beforeend', `<div class="ap-csv-warn">⚠ ${parsed.errors.length}개 파싱 경고</div>`);
    }

    // 검색 input
    const searchWrap = document.createElement('div');
    searchWrap.className = 'ap-csv-search';
    searchWrap.innerHTML = '<input type="text" placeholder="🔎 표 검색 (모든 열 부분 일치)" class="ap-csv-search-input" />';
    wrap.appendChild(searchWrap);

    const table = document.createElement('table');
    table.className = 'ap-csv-table';
    wrap.appendChild(table);

    const summary = document.createElement('div');
    summary.className = 'ap-csv-summary';
    wrap.appendChild(summary);

    target.appendChild(wrap);
    target.className = 'ap-preview ap-csv';

    // 정렬·필터 state (closure)
    const state = {
        sortKey: null,           // 현재 정렬 컬럼
        sortDir: 'none',         // 'asc' | 'desc' | 'none'
        filter: '',              // 검색 문자열
    };

    // 가상 스크롤 임계 (Phase 3, 2026-05-26): 1000행 초과 시 viewport 안 행만 render.
    // 동적 행 높이 (future #2, 2026-05-26): 행 별 높이 측정 + prefix sum 으로 위치 계산.
    // 다중 줄 셀이 있어도 정확한 가상 스크롤 — 단순 ROW_HEIGHT 고정 한계 해소.
    const VIRTUAL_THRESHOLD = 1000;
    const DEFAULT_ROW_HEIGHT_PX = 26; // 측정 전 추정값
    const VIEWPORT_BUFFER = 20;
    // 행 높이 측정 결과 cache (rowIdx → height). 측정 후 prefix sum 으로 위치 계산.
    const rowHeights = new Map();
    function getRowHeight(idx) { return rowHeights.get(idx) ?? DEFAULT_ROW_HEIGHT_PX; }
    function getRowTop(idx) {
        let sum = 0;
        for (let i = 0; i < idx; i++) sum += getRowHeight(i);
        return sum;
    }
    function getTotalHeight(count) {
        // 측정된 것 + 미측정 분 default
        let sum = 0;
        for (let i = 0; i < count; i++) sum += getRowHeight(i);
        return sum;
    }
    function findRowAtScroll(scrollTop, count) {
        // binary-ish: 미측정 행은 default 높이로. linear scan (count 만행이라 OK).
        let acc = 0;
        for (let i = 0; i < count; i++) {
            const h = getRowHeight(i);
            if (acc + h > scrollTop) return i;
            acc += h;
        }
        return count - 1;
    }

    function renderTable() {
        // 필터링
        const filtered = state.filter
            ? allRows.filter(row =>
                headers.some(h => String(row[h] ?? '').toLowerCase().includes(state.filter.toLowerCase())))
            : allRows;
        // 정렬
        let display = filtered;
        if (state.sortKey && state.sortDir !== 'none') {
            const dir = state.sortDir === 'asc' ? 1 : -1;
            display = [...filtered].sort((a, b) => {
                const va = a[state.sortKey], vb = b[state.sortKey];
                const na = Number(va), nb = Number(vb);
                if (!Number.isNaN(na) && !Number.isNaN(nb) && va !== '' && vb !== '') {
                    return (na - nb) * dir;
                }
                return String(va ?? '').localeCompare(String(vb ?? '')) * dir;
            });
        }

        const useVirtual = display.length > VIRTUAL_THRESHOLD;
        const thead = '<thead><tr>' + headers.map(h => {
            const arrow = state.sortKey === h
                ? (state.sortDir === 'asc' ? ' ▲' : state.sortDir === 'desc' ? ' ▼' : '')
                : '';
            return `<th class="ap-csv-th" data-key="${escAttr(h)}">${escHtml(h)}${arrow}</th>`;
        }).join('') + '</tr></thead>';

        if (!useVirtual) {
            // 일반 path — 1000행 이하
            const visible = display.slice(0, 1000);
            const tbody = '<tbody>' + visible.map(row =>
                '<tr>' + headers.map(h => `<td>${escHtml(row[h] ?? '')}</td>`).join('') + '</tr>'
            ).join('') + '</tbody>';
            table.innerHTML = thead + tbody;
            summary.textContent =
                `${display.length} 행 × ${headers.length} 열` +
                (state.filter ? ` (전체 ${allRows.length} 중 필터 ${display.length})` : '');
        } else {
            // 가상 스크롤 path — 큰 데이터셋 + 동적 행 높이 (Phase 3 future #2)
            rowHeights.clear(); // 새 정렬/필터 시 측정 cache reset
            table.innerHTML = thead;
            const tbody = document.createElement('tbody');
            tbody.className = 'ap-csv-virtual-tbody';
            tbody.style.position = 'relative';
            tbody.style.display = 'block';
            // spacer (전체 추정 높이 — 측정 진행에 따라 갱신)
            const spacer = document.createElement('tr');
            spacer.className = 'ap-csv-spacer';
            spacer.style.cssText = `display:block; pointer-events:none;`;
            spacer.style.height = `${getTotalHeight(display.length)}px`;
            tbody.appendChild(spacer);
            const visibleContainer = document.createElement('tr');
            visibleContainer.className = 'ap-csv-vis-rows';
            visibleContainer.style.cssText = 'position:absolute; top:0; left:0; right:0; display:block;';
            tbody.appendChild(visibleContainer);
            table.appendChild(tbody);

            const renderVisible = () => {
                const wrapRect = wrap.getBoundingClientRect();
                const scrollTop = wrap.scrollTop;
                const start = Math.max(0, findRowAtScroll(scrollTop, display.length) - VIEWPORT_BUFFER);
                const visibleCount = Math.ceil(wrapRect.height / DEFAULT_ROW_HEIGHT_PX) + VIEWPORT_BUFFER * 2;
                const end = Math.min(display.length, start + visibleCount);
                visibleContainer.style.transform = `translateY(${getRowTop(start)}px)`;
                const slice = display.slice(start, end);
                visibleContainer.innerHTML = slice.map((row, i) => {
                    const idx = start + i;
                    return `<tr data-row-idx="${idx}" style="display:flex;">` +
                        headers.map(h => `<td style="flex:1; min-width:80px;">${escHtml(row[h] ?? '')}</td>`).join('') +
                        '</tr>';
                }).join('');
                // 렌더 후 각 행 실제 높이 측정 (동적 행 높이)
                let heightsChanged = false;
                visibleContainer.querySelectorAll('tr[data-row-idx]').forEach(tr => {
                    const idx = parseInt(tr.getAttribute('data-row-idx'), 10);
                    const h = tr.offsetHeight;
                    if (h > 0 && rowHeights.get(idx) !== h) {
                        rowHeights.set(idx, h);
                        heightsChanged = true;
                    }
                });
                // 높이 측정에 따른 spacer/total 갱신 (한 번만)
                if (heightsChanged) {
                    spacer.style.height = `${getTotalHeight(display.length)}px`;
                }
            };
            renderVisible();
            let rafId = null;
            wrap.addEventListener('scroll', () => {
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(renderVisible);
            }, { passive: true });
            summary.textContent =
                `${display.length} 행 × ${headers.length} 열 (동적 가상 스크롤)` +
                (state.filter ? ` — 전체 ${allRows.length} 중 필터 ${display.length}` : '');
        }

        // th 정렬 토글
        table.querySelectorAll('.ap-csv-th').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.getAttribute('data-key');
                if (state.sortKey !== key) {
                    state.sortKey = key;
                    state.sortDir = 'asc';
                } else {
                    state.sortDir = state.sortDir === 'asc' ? 'desc'
                        : state.sortDir === 'desc' ? 'none' : 'asc';
                    if (state.sortDir === 'none') state.sortKey = null;
                }
                renderTable();
            });
        });
    }

    // 검색 input 핸들러 (debounce 없이 직접 — 500행 정렬 비용 충분히 작음)
    searchWrap.querySelector('.ap-csv-search-input').addEventListener('input', (e) => {
        state.filter = e.target.value;
        renderTable();
    });

    renderTable();
}

/**
 * Slide artifact — Reveal.js + Marp-like syntax.
 * content: 슬라이드는 '---' 로 구분된 Markdown.
 */
async function renderSlide(target, item) {
    await loadStyleOnce('/vendor/artifacts/reveal/reveal.css');
    await loadStyleOnce('/vendor/artifacts/reveal/theme-black.css');
    await loadScriptOnce('/vendor/artifacts/reveal/reveal.js', 'Reveal');
    if (typeof window.marked === 'undefined') {
        // 매우 드문 경우 — vendor/marked 가 이미 글로벌이지만 방어
        target.innerHTML = `<pre>${escHtml(item.content)}</pre>`;
        return;
    }

    // '---' 구분자로 슬라이드 분리, 각 슬라이드를 marked 로 HTML 변환
    const slides = item.content.split(/^---\s*$/m).map(s => s.trim()).filter(s => s.length > 0);
    const slidesHtml = slides.map(md => {
        const raw = window.marked.parse(md, { breaks: true, gfm: true });
        const clean = typeof window.DOMPurify !== 'undefined'
            ? window.DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
            : raw;
        return `<section>${clean}</section>`;
    }).join('\n');

    const container = document.createElement('div');
    container.className = 'reveal ap-reveal';
    container.style.height = '500px';
    container.innerHTML = `<div class="slides">${slidesHtml}</div>`;
    target.appendChild(container);
    target.className = 'ap-preview ap-slide';

    try {
        // Reveal 인스턴스는 패널 인스턴스마다 새로 — 다른 artifact 와 충돌 방지
        const reveal = new window.Reveal(container, {
            embedded: true,
            controls: true,
            progress: true,
            hash: false,
            keyboard: false, // ←/→ 는 패널의 버전 nav 와 충돌 — 명시적 비활성
            width: '100%',
            height: '100%',
        });
        reveal.initialize();
    } catch (e) {
        target.innerHTML = `<div class="ap-error">Slide 렌더 실패: ${escHtml(e.message)}</div>`;
    }
}

/**
 * React artifact — esbuild-wasm 로 JSX/TSX 번들 후 iframe 에서 실행.
 * import map 으로 react@18 / react-dom@18 을 esm.sh 에서 fetch.
 * 보안: iframe sandbox='allow-scripts', CSP 강제.
 */
async function renderReact(target, item) {
    target.innerHTML = '<div class="ap-loading">esbuild-wasm 로딩 중... (~3MB, 첫 사용 시 한 번만)</div>';
    let esbuild;
    try {
        await loadScriptOnce('/vendor/artifacts/esbuild-browser.js', 'esbuild');
        esbuild = window.esbuild;
        if (!window._esbuildInitialized) {
            // worker: false — 우리 CSP 가 'script-src' 에 blob: 미허용 (helmet 기본).
            // worker 비활성 시 main thread 실행 — JSX 소량 transform 은 ms 단위, UI freeze 영향 무시 가능.
            // 대안: helmet CSP 에 worker-src 'self' blob: 추가 — 별도 PR.
            await esbuild.initialize({ wasmURL: '/vendor/artifacts/esbuild.wasm', worker: false });
            window._esbuildInitialized = true;
        }
    } catch (e) {
        target.innerHTML = `<div class="ap-error">esbuild 초기화 실패: ${escHtml(e.message)}</div>`;
        return;
    }

    // JSX 번들
    let bundledCode;
    try {
        const result = await esbuild.transform(item.content, {
            loader: 'tsx',
            jsx: 'automatic',
            jsxImportSource: 'react',
            target: 'es2020',
            format: 'esm',
        });
        bundledCode = result.code;
    } catch (e) {
        target.innerHTML = `<div class="ap-error">JSX 변환 실패: ${escHtml(e.message)}</div>`;
        return;
    }

    // iframe 으로 격리 실행. importmap 으로 react / react-dom 을 esm.sh 에서 fetch.
    target.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.className = 'ap-iframe';
    iframe.style.background = '#fff';
    target.appendChild(iframe);
    target.className = 'ap-preview ap-react';

    iframe.srcdoc = `<!doctype html>
<html><head>
<meta charset="utf-8">
<style>body{font-family:system-ui,sans-serif;padding:12px;}</style>
<script type="importmap">
{ "imports": {
    "react": "https://esm.sh/react@18.3.1",
    "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
    "react-dom": "https://esm.sh/react-dom@18.3.1",
    "react-dom/client": "https://esm.sh/react-dom@18.3.1/client"
} }
</script>
</head><body>
<div id="root"></div>
<script type="module">
try {
  ${bundledCode}
  // bundledCode 가 export default Component 또는 ReactDOM.render() 호출이라 가정
  // 보통 esbuild 결과는 named exports + default — 가장 흔한 패턴: render 직접 호출
  if (typeof App !== 'undefined' && App) {
    const { createRoot } = await import('react-dom/client');
    const React = await import('react');
    createRoot(document.getElementById('root')).render(React.createElement(App));
  }
} catch (err) {
  document.getElementById('root').innerHTML = '<pre style="color:#ef4444;">React 실행 오류: ' + (err && err.message ? err.message : err) + '</pre>';
}
</script>
</body></html>`;
}

// ─── lazy load helpers ──────────────────────────────────────────────────────

const loadedScripts = new Set();
const loadedStyles = new Set();

function loadScriptOnce(src, globalCheck) {
    if (loadedScripts.has(src)) return Promise.resolve();
    if (globalCheck && typeof window[globalCheck] !== 'undefined') {
        loadedScripts.add(src);
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => { loadedScripts.add(src); resolve(); };
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(s);
    });
}

function loadStyleOnce(href) {
    if (loadedStyles.has(href)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => { loadedStyles.add(href); resolve(); };
        link.onerror = () => reject(new Error(`Failed to load ${href}`));
        document.head.appendChild(link);
    });
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

/**
 * Phase 3 — 사용자 편집 모드 토글.
 * Code View 탭의 <code> 를 <textarea> 로 교체. 저장 시 POST /api/sessions/:sid/artifacts/:aid
 * 호출하여 새 버전 INSERT (version 자동 증가). 미리보기 자동 갱신.
 */
function toggleEditMode() {
    if (!panelEl || !currentId) return;
    if (editMode) {
        // 편집 종료 (저장 없이) — UI 만 복원
        editMode = false;
        renderCurrent();
        updateEditButton();
        return;
    }
    if (!currentSessionId) {
        flashAction('.ap-act-edit', '세션 미설정');
        return;
    }
    editMode = true;
    switchTab('code');
    updateEditButton();
    enterEditUI();
}

function updateEditButton() {
    const btn = panelEl?.querySelector('.ap-act-edit');
    if (!btn) return;
    if (editMode) {
        btn.textContent = '💾 저장';
        btn.title = '새 버전으로 저장';
        btn.classList.add('ap-edit-saving');
    } else {
        btn.textContent = '✏️ 편집';
        btn.title = '편집 (새 버전 생성)';
        btn.classList.remove('ap-edit-saving');
    }
}

async function enterEditUI() {
    if (!panelEl || !currentId) return;
    const list = artifactStore.get(currentId);
    if (!list) return;
    const item = list[currentVersionIdx];

    const codePane = panelEl.querySelector('.ap-code');
    codePane.innerHTML = '';

    // textarea (CodeMirror 가 이걸 hijack 해서 editor 로 변환)
    const textarea = document.createElement('textarea');
    textarea.className = 'ap-edit-textarea';
    textarea.value = item.content;
    textarea.spellcheck = false;
    codePane.appendChild(textarea);

    const actionRow = document.createElement('div');
    actionRow.className = 'ap-edit-actions';
    actionRow.innerHTML = `
        <button class="ap-edit-save-btn">💾 새 버전으로 저장</button>
        <button class="ap-edit-cancel-btn">취소</button>
    `;
    codePane.appendChild(actionRow);

    // CodeMirror 5 lazy load + 모드 fetch + editor mount
    // 실패 시 plain textarea 로 fallback (graceful)
    // Phase 3 보완 C.4 (2026-05-26): 첫 진입 ~3초 동안 spinner 표시.
    let cmInstance = null;
    const spinner = document.createElement('div');
    spinner.className = 'ap-edit-loading';
    spinner.textContent = '⏳ 편집기 로딩 중... (첫 진입 시만 ~3초)';
    codePane.insertBefore(spinner, textarea);
    try {
        await loadStyleOnce('/vendor/artifacts/codemirror/codemirror.min.css');
        await loadStyleOnce('/vendor/artifacts/codemirror/material-darker.css');
        await loadScriptOnce('/vendor/artifacts/codemirror/codemirror.min.js', 'CodeMirror');
        const modeName = cmModeFor(item.kind, item.lang);
        if (modeName) {
            await loadScriptOnce(`/vendor/artifacts/codemirror/mode-${modeName}.js`);
        }
        spinner.remove();
        cmInstance = window.CodeMirror.fromTextArea(textarea, {
            mode: cmModeMime(modeName),
            theme: 'material-darker',
            lineNumbers: true,
            indentUnit: 2,
            lineWrapping: true,
            viewportMargin: Infinity,
        });
        // panel 의 ap-code 영역 안에서 적절한 높이로
        cmInstance.setSize('100%', '420px');
        cmInstance.focus();
    } catch (e) {
        console.warn('[Artifact] CodeMirror lazy load 실패 — plain textarea 사용:', e);
        if (spinner.parentNode) spinner.remove();
        textarea.focus();
    }

    actionRow.querySelector('.ap-edit-save-btn').addEventListener('click', async () => {
        const newContent = cmInstance ? cmInstance.getValue() : textarea.value;
        await saveEditedArtifact(newContent);
    });
    actionRow.querySelector('.ap-edit-cancel-btn').addEventListener('click', () => {
        if (cmInstance) cmInstance.toTextArea(); // CodeMirror 정리
        editMode = false;
        renderCurrent();
        updateEditButton();
    });
}

/** artifact kind/lang → CodeMirror 5 mode 파일명 */
function cmModeFor(kind, lang) {
    if (kind === 'markdown') return 'markdown';
    if (kind === 'html' || kind === 'svg') return 'xml';
    if (kind === 'mermaid') return null; // mermaid 별도 mode 없음 — plain
    if (kind === 'react') return 'javascript';
    if (kind !== 'code') return null;
    const langLow = (lang || '').toLowerCase();
    if (['python', 'py'].includes(langLow)) return 'python';
    if (['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'json'].includes(langLow)) return 'javascript';
    if (['html', 'xml', 'svg'].includes(langLow)) return 'xml';
    if (['css', 'scss', 'sass'].includes(langLow)) return 'css';
    if (['markdown', 'md'].includes(langLow)) return 'markdown';
    return null;
}
function cmModeMime(modeName) {
    if (modeName === 'python') return 'text/x-python';
    if (modeName === 'javascript') return 'text/javascript';
    if (modeName === 'xml') return 'application/xml';
    if (modeName === 'css') return 'text/css';
    if (modeName === 'markdown') return 'text/x-markdown';
    return 'text/plain';
}

async function saveEditedArtifact(newContent) {
    if (!currentId || !currentSessionId) return;
    const list = artifactStore.get(currentId);
    if (!list) return;
    const item = list[currentVersionIdx];

    const saveBtn = panelEl.querySelector('.ap-edit-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '저장 중...'; }
    try {
        const url = `/api/sessions/${encodeURIComponent(currentSessionId)}/artifacts/${encodeURIComponent(currentId)}`;
        const fetchFn = window.authFetch || fetch;
        const res = await fetchFn(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: item.kind,
                title: item.title,
                language: item.lang,
                content: newContent,
            }),
        });
        const data = await (res.json ? res.json() : Promise.resolve(res));
        const saved = data && data.data ? data.data : data;
        if (!saved || !saved.version) throw new Error('서버 응답 형식 오류');

        // 새 버전을 store 에 push + 현재 표시 이동
        list.push({
            kind: saved.kind,
            title: saved.title,
            lang: saved.lang,
            content: saved.content,
            version: saved.version,
        });
        currentVersionIdx = list.length - 1;
        editMode = false;
        updateEditButton();
        refreshHeader();
        refreshVersionNav();
        renderCurrent();
        switchTab('preview');
        flashAction('.ap-act-edit', `✓ v${saved.version}`);
    } catch (e) {
        console.error('[Artifact] 편집 저장 실패:', e);
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '재시도'; }
        flashAction('.ap-act-edit', '실패');
    }
}

/**
 * PDF export (Phase 2): 미리보기 영역을 PNG 로 캡처 → pdf-lib 로 A4 PDF 생성 → 다운로드.
 * 통합 패턴 — code/markdown/svg/chart/mermaid 모두 시각적 결과 그대로 보존.
 *
 * 의존성:
 *   - dom-to-image-more: DOM → PNG (lazy load)
 *   - pdf-lib: PNG embed → PDF (lazy load)
 */
async function exportPdfCurrent() {
    if (!currentId || !panelEl) return;
    const item = artifactStore.get(currentId)?.[currentVersionIdx];
    if (!item) return;
    const previewEl = panelEl.querySelector('.ap-preview');
    if (!previewEl) return;

    flashAction('.ap-act-pdf', '생성 중...');
    try {
        // 미리보기 탭 활성화 (소스 탭이면 캡처 불가)
        switchTab('preview');
        // 다음 paint 까지 대기 (탭 전환 직후 캡처 race 방지)
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        await loadScriptOnce('/vendor/artifacts/dom-to-image-more.min.js', 'domtoimage');
        await loadScriptOnce('/vendor/artifacts/pdf-lib.min.js', 'PDFLib');

        // DOM → PNG dataURL
        const pngDataUrl = await window.domtoimage.toPng(previewEl, {
            bgcolor: '#ffffff',
            quality: 0.95,
        });

        // PNG → PDF (A4 portrait, 595 × 842 pt)
        const { PDFDocument } = window.PDFLib;
        const pdfDoc = await PDFDocument.create();
        const pngBytes = await fetch(pngDataUrl).then(r => r.arrayBuffer());
        const pngImg = await pdfDoc.embedPng(pngBytes);
        const page = pdfDoc.addPage([595, 842]);
        const margin = 28;
        const maxW = 595 - margin * 2;
        const maxH = 842 - margin * 2;
        // 비율 유지하며 페이지에 fit
        const scale = Math.min(maxW / pngImg.width, maxH / pngImg.height, 1);
        const w = pngImg.width * scale;
        const h = pngImg.height * scale;
        page.drawImage(pngImg, {
            x: margin + (maxW - w) / 2,
            y: 842 - margin - h,
            width: w,
            height: h,
        });
        const pdfBytes = await pdfDoc.save();

        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentId}-v${item.version}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        flashAction('.ap-act-pdf', '✓ 저장');
    } catch (e) {
        console.error('[Artifact] PDF export 실패:', e);
        flashAction('.ap-act-pdf', '실패');
    }
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

/* Phase 2 신규 kind 스타일 */
.ap-preview.ap-chart { padding: 0; background: transparent; border: none; }
.ap-preview.ap-csv { padding: 0; background: transparent; border: none; }
.ap-csv-wrap { background: var(--bg-secondary, #0f0f0f); border: 1px solid var(--border-light, #2a2a2a); border-radius: var(--radius-md, 6px); padding: 12px; max-height: 100%; overflow: auto; }
.ap-csv-warn { font-size: 11px; color: var(--warning, #fbbf24); margin-bottom: 6px; }
.ap-csv-search { margin-bottom: 8px; }
.ap-csv-search-input {
    width: 100%; padding: 6px 10px; box-sizing: border-box;
    background: var(--bg-tertiary, #2a2a2a); color: var(--text-primary, #fff);
    border: 1px solid var(--border-light, #2a2a2a); border-radius: var(--radius-md, 6px);
    font-size: 12px; font-family: inherit;
}
.ap-csv-search-input:focus {
    outline: none; border-color: var(--accent-primary, #6366f1);
}
.ap-csv-table { border-collapse: collapse; font-size: 12px; width: 100%; }
.ap-csv-table th, .ap-csv-table td { border: 1px solid var(--border-light, #2a2a2a); padding: 4px 8px; text-align: left; }
.ap-csv-table th { background: var(--bg-tertiary, #2a2a2a); font-weight: var(--font-weight-semibold, 600); }
.ap-csv-th { cursor: pointer; user-select: none; }
.ap-csv-th:hover { background: var(--accent-primary, #6366f1); color: #fff; }
.ap-csv-summary { font-size: 11px; color: var(--text-muted, #888); margin-top: 6px; text-align: right; }
.ap-preview.ap-slide { padding: 0; background: #000; border: none; }
.ap-reveal { width: 100%; }
.ap-preview.ap-react { padding: 0; background: transparent; border: none; }
.ap-loading { text-align: center; padding: 24px; color: var(--text-muted, #888); }

/* Phase 3 사용자 편집 모드 */
.ap-edit-textarea {
    width: 100%; min-height: 320px; box-sizing: border-box;
    padding: 12px; border: 1px solid var(--accent-primary, #6366f1);
    border-radius: var(--radius-md, 6px); background: var(--bg-secondary, #0f0f0f);
    color: var(--text-primary, #fff); font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 13px; line-height: 1.5; resize: vertical;
}
.ap-edit-actions { display: flex; gap: 8px; margin-top: 8px; }
.ap-edit-actions button {
    padding: 6px 14px; border: 1px solid var(--border-light, #2a2a2a);
    border-radius: var(--radius-md, 6px); cursor: pointer; font-size: 12px;
    background: var(--bg-tertiary, #2a2a2a); color: var(--text-primary, #fff);
}
.ap-edit-save-btn { background: var(--accent-primary, #6366f1) !important; color: #fff !important; }
.ap-edit-save-btn:disabled { opacity: 0.6; cursor: default; }
.ap-act-edit.ap-edit-saving { background: var(--accent-primary, #6366f1); color: #fff; }

/* CodeMirror 5 통합 — material-darker 와 우리 design token 정렬 */
.ap-code .CodeMirror {
    height: 420px !important;
    border: 1px solid var(--accent-primary, #6366f1);
    border-radius: var(--radius-md, 6px);
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 13px;
    line-height: 1.5;
}
.ap-code .CodeMirror-scroll { padding-top: 4px; padding-bottom: 4px; }
.ap-edit-loading {
    padding: 12px; text-align: center; color: var(--text-muted, #888);
    font-size: 12px; background: var(--bg-tertiary, #2a2a2a);
    border-radius: var(--radius-md, 6px); margin-bottom: 8px;
}
    `;
    document.head.appendChild(style);
}
