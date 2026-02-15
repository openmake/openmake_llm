/**
 * ============================================
 * Sanitize Module - XSS 방어 HTML 정제
 * ============================================
 * DOMPurify 없이 순수 JS로 구현한 경량 HTML sanitizer입니다.
 * 허용 태그/속성 화이트리스트와 위험 URL 스킴 차단을 통해
 * 사용자/AI 생성 HTML의 안전한 렌더링을 보장합니다.
 *
 * 사용법:
 *   import { sanitizeHTML, escapeHTML } from './sanitize.js';
 *   element.innerHTML = sanitizeHTML(userContent);  // 안전한 HTML 허용
 *   element.textContent = escapeHTML(userInput);     // 모든 HTML 이스케이프
 *
 * @module sanitize
 */

/**
 * HTML 엔티티 이스케이프 (모든 HTML 태그 비활성화)
 * 사용자 입력을 순수 텍스트로만 표시할 때 사용합니다.
 * DOM의 textContent를 활용하여 안전하게 이스케이프합니다.
 * @param {string} str - 이스케이프할 원본 문자열
 * @returns {string} HTML 엔티티로 변환된 안전한 문자열
 */
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 안전한 HTML 태그 화이트리스트
 * 이 목록에 없는 태그는 sanitizeNode에 의해 제거됩니다.
 * @type {Set<string>}
 */
const ALLOWED_TAGS = new Set([
    'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'blockquote', 'pre', 'code', 'span', 'div',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'img', 'hr', 'sup', 'sub',
    'details', 'summary'
]);

/**
 * 태그별 허용 속성 맵
 * 목록에 없는 속성은 sanitizeNode에 의해 제거됩니다.
 * @type {Object<string, string[]>}
 */
const ALLOWED_ATTRIBUTES = {
    'a': ['href', 'title', 'target', 'rel'],
    'img': ['src', 'alt', 'title', 'width', 'height'],
    'td': ['colspan', 'rowspan'],
    'th': ['colspan', 'rowspan'],
    'code': ['class'],    // for syntax highlighting
    'span': ['class'],
    'pre': ['class'],
    'div': ['class'],
};

/**
 * 위험한 URL 스킴 패턴 (javascript:, data:, vbscript:)
 * href, src 속성에서 이 패턴이 발견되면 속성을 제거합니다.
 * @type {RegExp}
 */
const DANGEROUS_URL_SCHEMES = /^(javascript|data|vbscript):/i;

/**
 * HTML 문자열을 안전하게 정제
 * DOMParser로 파싱 후 화이트리스트 기반으로 허용되지 않은 태그와
 * 위험한 속성을 재귀적으로 제거합니다.
 * @param {string} html - 정제할 HTML 문자열
 * @returns {string} 정제된 안전한 HTML 문자열
 */
function sanitizeHTML(html) {
    if (!html) return '';

    const doc = new DOMParser().parseFromString(html, 'text/html');
    sanitizeNode(doc.body);
    return doc.body.innerHTML;
}

/**
 * DOM 노드를 재귀적으로 정제
 * 허용되지 않은 태그는 자식 노드를 부모로 이동 후 제거하고,
 * 허용되지 않은 속성을 제거하며, a 태그에 보안 속성을 추가합니다.
 * @param {Node} node - 정제할 DOM 노드
 * @returns {void}
 */
function sanitizeNode(node) {
    const childNodes = Array.from(node.childNodes);

    for (const child of childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            const tagName = child.tagName.toLowerCase();

            if (!ALLOWED_TAGS.has(tagName)) {
                // 허용되지 않은 태그: 자식 노드를 부모로 이동 후 태그 제거
                while (child.firstChild) {
                    node.insertBefore(child.firstChild, child);
                }
                node.removeChild(child);
                continue;
            }

            // 속성 정제
            const allowedAttrs = ALLOWED_ATTRIBUTES[tagName] || [];
            const attrs = Array.from(child.attributes);
            for (const attr of attrs) {
                if (!allowedAttrs.includes(attr.name)) {
                    child.removeAttribute(attr.name);
                } else {
                    // href/src의 위험한 스킴 체크
                    if ((attr.name === 'href' || attr.name === 'src') && DANGEROUS_URL_SCHEMES.test(attr.value)) {
                        child.removeAttribute(attr.name);
                    }
                }
            }

            // <a> 태그에 자동으로 안전 속성 추가
            if (tagName === 'a') {
                child.setAttribute('rel', 'noopener noreferrer');
                if (!child.getAttribute('target')) {
                    child.setAttribute('target', '_blank');
                }
            }

            // 재귀적으로 자식 정제
            sanitizeNode(child);
        }
        // 텍스트 노드와 주석은 그대로 유지
    }
}

/**
 * 마크다운 코드 블록 내용 이스케이프
 * 코드 블록 안의 HTML 태그가 실행되지 않도록 이스케이프합니다.
 * @param {string} code - 코드 블록 내용
 * @returns {string} 이스케이프된 코드 문자열
 */
function escapeCodeBlock(code) {
    return escapeHTML(code);
}

// ============================================================
// Global exposure (non-module script)
// ============================================================

/**
 * 통합 HTML 정제 함수 (DOMPurify 우선, 커스텀 폴백)
 * DOMPurify 라이브러리가 로드되어 있으면 이를 사용하고,
 * 없으면 커스텀 sanitizeHTML로 폴백합니다.
 * 사용자/AI 생성 HTML 렌더링 시 항상 이 함수를 사용하세요.
 * @param {string} html - 정제할 HTML 문자열
 * @returns {string} XSS 안전한 HTML 문자열
 */
function purifyHTML(html) {
    if (!html) return '';
    if (typeof DOMPurify !== 'undefined') {
        return DOMPurify.sanitize(html, {
            ALLOWED_TAGS: [
                'p', 'br', 'b', 'i', 'em', 'strong', 'u', 's', 'del',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li', 'dl', 'dt', 'dd',
                'blockquote', 'pre', 'code', 'span', 'div',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'a', 'img', 'hr', 'sup', 'sub',
                'details', 'summary'
            ],
            ALLOWED_ATTR: [
                'href', 'title', 'target', 'rel',
                'src', 'alt', 'width', 'height',
                'colspan', 'rowspan', 'class'
            ],
            FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
            ADD_ATTR: ['target'],
            ALLOW_DATA_ATTR: false
        });
    }
    // Fallback to custom sanitizer
    return sanitizeHTML(html);
}

// Expose on window for use in non-module scripts
window.purifyHTML = purifyHTML;
window.sanitizeHTML = sanitizeHTML;
window.escapeHTML = escapeHTML;
window.escapeCodeBlock = escapeCodeBlock;
