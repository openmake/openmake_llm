/**
 * #16 개선: XSS 방어 - HTML Sanitization 유틸리티
 * 
 * DOMPurify 없이 순수 JS로 구현한 경량 HTML sanitizer.
 * 사용자 입력을 DOM에 삽입하기 전에 반드시 이 모듈을 통해 정제하세요.
 * 
 * 사용법:
 *   import { sanitizeHTML, escapeHTML } from './sanitize.js';
 *   element.innerHTML = sanitizeHTML(userContent);  // 안전한 HTML 허용
 *   element.textContent = escapeHTML(userInput);     // 모든 HTML 이스케이프
 */

/**
 * HTML 엔티티 이스케이프 (모든 HTML 태그 비활성화)
 * 사용자 입력을 텍스트로만 표시할 때 사용
 */
function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * 안전한 HTML 태그만 허용하는 sanitizer
 * Markdown 렌더링 결과 등을 표시할 때 사용
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

// 위험한 URL 스킴
const DANGEROUS_URL_SCHEMES = /^(javascript|data|vbscript):/i;

/**
 * HTML을 안전하게 정제
 * 허용되지 않은 태그는 제거, 위험한 속성은 제거
 */
function sanitizeHTML(html) {
    if (!html) return '';

    const doc = new DOMParser().parseFromString(html, 'text/html');
    sanitizeNode(doc.body);
    return doc.body.innerHTML;
}

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
 * 코드 블록 안의 HTML은 실행되지 않아야 함
 */
function escapeCodeBlock(code) {
    return escapeHTML(code);
}

// ============================================================
// Global exposure (non-module script)
// ============================================================

/**
 * Primary sanitizer: uses DOMPurify if available, falls back to custom sanitizer.
 * Always use this for rendering user-generated or LLM-generated HTML.
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
