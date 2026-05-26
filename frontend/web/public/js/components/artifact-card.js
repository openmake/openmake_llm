/**
 * Artifact inline card — 채팅 메시지 안에 표시되는 미니카드.
 * 클릭 시 우측 패널 오픈/포커스.
 *
 * 2026-05-26 Phase 1.D
 * @module components/artifact-card
 */

import { openArtifactPanel } from './artifact-panel.js';

/**
 * 채팅 메시지 본문에 inline 카드 삽입.
 * 패널은 이미 openArtifactPanel 로 열렸지만, 카드는 메시지 영역에 nav handle 로 작동.
 *
 * @param {HTMLElement} container - 메시지 본문 컨테이너 (.message-content 등)
 * @param {{id, kind, title, lang}} info - artifact 메타
 * @returns {HTMLElement} 생성된 카드 요소
 */
export function insertArtifactCard(container, info) {
    if (!container || !info || !info.id) return null;

    // 카드를 message-content 가 아닌 그 부모 (메시지 wrapper) 에 삽입.
    // 이유: chat-renderer.js 의 appendToken 이 매 token 마다
    // `content.textContent = fullText` 로 innerHTML 전체를 reset 하기 때문 —
    // message-content 내부에 카드를 두면 streaming 중에 사라짐.
    const target = container.parentElement || container;

    // 같은 id 카드가 이미 있으면 (v2 등) 새로 만들지 않고 기존 카드 강조
    const existing = target.querySelector(`.artifact-card[data-id="${cssEsc(info.id)}"]`);
    if (existing) {
        existing.classList.add('artifact-card-updated');
        setTimeout(() => existing.classList.remove('artifact-card-updated'), 1500);
        return existing;
    }

    injectCardStyles();

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'artifact-card';
    card.setAttribute('data-id', info.id);
    card.setAttribute('aria-label', `Artifact ${info.title || info.id} 패널 열기`);
    card.innerHTML = `
        <span class="ac-icon" aria-hidden="true">${kindIcon(info.kind)}</span>
        <span class="ac-body">
            <span class="ac-title">${escHtml(info.title || info.id)}</span>
            <span class="ac-meta">${escHtml(info.kind || 'artifact')}${info.lang ? ` · ${escHtml(info.lang)}` : ''}</span>
        </span>
        <span class="ac-arrow" aria-hidden="true">↗</span>
    `;
    card.addEventListener('click', () => {
        // 클릭 시 패널 포커스 (이미 열려 있어도 다시 open 호출 가능 — 같은 id 의 새 버전이 아니면 noop)
        // 단, 같은 id 의 기존 버전을 다시 표시하려면 별도 mechanism 필요 — 일단 패널이 그 id 를
        // 보여주고 있지 않으면 그대로. 향후 panel API 의 focus(id) 추가 검토.
        openArtifactPanel({ id: info.id, kind: info.kind, title: info.title, lang: info.lang });
    });
    target.appendChild(card);
    return card;
}

function kindIcon(kind) {
    const map = {
        markdown: '📝', code: '💻', html: '🌐', svg: '🖼️', mermaid: '📊',
        react: '⚛️', chart: '📈', csv: '📊', slide: '🎞️', excalidraw: '✏️',
    };
    return map[kind] || '📦';
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}
function cssEsc(s) {
    return String(s).replace(/["\\]/g, '\\$&');
}

function injectCardStyles() {
    if (document.getElementById('artifact-card-styles')) return;
    const style = document.createElement('style');
    style.id = 'artifact-card-styles';
    style.textContent = `
.artifact-card {
    display: flex; align-items: center; gap: 10px;
    margin: 8px 0; padding: 10px 12px;
    background: var(--bg-card, #1a1a1a);
    border: 1px solid var(--border-light, #2a2a2a);
    border-left: 3px solid var(--accent-primary, #6366f1);
    border-radius: var(--radius-md, 6px);
    cursor: pointer; text-align: left; width: 100%; max-width: 480px;
    font-family: inherit; color: var(--text-primary, #fff);
    transition: border-color 0.15s, transform 0.15s;
}
.artifact-card:hover {
    border-color: var(--accent-primary, #6366f1);
    transform: translateX(2px);
}
.artifact-card-updated {
    animation: artifact-card-flash 1.4s ease-out;
}
@keyframes artifact-card-flash {
    0%  { background: var(--accent-primary, #6366f1); }
    100% { background: var(--bg-card, #1a1a1a); }
}
.ac-icon { font-size: 22px; flex-shrink: 0; }
.ac-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.ac-title {
    font-weight: var(--font-weight-semibold, 600); font-size: 13px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ac-meta { font-size: 11px; color: var(--text-muted, #888); }
.ac-arrow { color: var(--text-muted, #888); font-size: 14px; flex-shrink: 0; }
.artifact-card:hover .ac-arrow {
    color: var(--accent-primary, #6366f1);
}
    `;
    document.head.appendChild(style);
}
