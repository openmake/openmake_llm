/**
 * Developer Page 공통 헬퍼
 * @module pages/developer-helpers
 */

/**
 * HTML 이스케이프 헬퍼 (코드 블록용)
 * @param {string} unsafe - 이스케이프할 문자열
 * @returns {string} 이스케이프된 문자열
 */
export function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * 간단한 정규식 기반 구문 강조
 * @param {string} code - 원본 코드 문자열
 * @param {string} lang - 언어 (curl, python, typescript 등)
 * @returns {string} 구문 강조된 HTML 문자열
 */
export function highlight(code, lang) {
    var html = escapeHtml(code);
    // Comments
    html = html.replace(/(\#.*$|\/\/.*$)/gm, '<span class="tok-com">$1</span>');
    // Strings
    html = html.replace(/(&quot;.*?&quot;|'.*?')/g, '<span class="tok-str">$1</span>');
    // Numbers
    html = html.replace(/\b(\d+)\b/g, '<span class="tok-num">$1</span>');
    // Keywords (basic set)
    var keywords = 'import|from|const|let|var|function|return|if|else|await|async|try|catch|true|false|null|undefined|class|new';
    var keyRegex = new RegExp('\\b(' + keywords + ')\\b', 'g');
    html = html.replace(keyRegex, '<span class="tok-key">$1</span>');
    // Methods/Functions (basic)
    html = html.replace(/\b([a-zA-Z0-9_]+)(?=\()/g, '<span class="tok-func">$1</span>');
    // Punctuation (JSON/JS objects)
    html = html.replace(/([\{\}\[\]\,\:])/g, '<span class="tok-punc">$1</span>');

    // Language specific
    if (lang === 'curl') {
        html = html.replace(/(GET|POST|PUT|PATCH|DELETE)/g, '<span class="tok-key">$1</span>');
        html = html.replace(/(-H|-d|-X)/g, '<span class="tok-param">$1</span>');
    }
    return html;
}

/**
 * 3개 탭 코드 블록 HTML 생성
 * @param {string} l1 - 첫 번째 탭 언어
 * @param {string} c1 - 첫 번째 탭 코드
 * @param {string} l2 - 두 번째 탭 언어
 * @param {string} c2 - 두 번째 탭 코드
 * @param {string} l3 - 세 번째 탭 언어
 * @param {string} c3 - 세 번째 탭 코드
 * @returns {string} 코드 블록 HTML 문자열
 */
export function getCodeBlock(l1, c1, l2, c2, l3, c3) {
    return '<div class="code-group">' +
        '<div class="code-tabs">' +
        '<button class="code-tab active" data-lang="' + l1 + '">' + formatLang(l1) + '</button>' +
        '<button class="code-tab" data-lang="' + l2 + '">' + formatLang(l2) + '</button>' +
        '<button class="code-tab" data-lang="' + l3 + '">' + formatLang(l3) + '</button>' +
        '</div>' +
        '<div class="code-content-wrapper">' +
        '<button class="copy-btn">Copy</button>' +
        '<div class="code-content active" data-lang="' + l1 + '">' + highlight(c1, l1) + '</div>' +
        '<div class="code-content" data-lang="' + l2 + '">' + highlight(c2, l2) + '</div>' +
        '<div class="code-content" data-lang="' + l3 + '">' + highlight(c3, l3) + '</div>' +
        '</div>' +
        '</div>';
}

/**
 * 언어 코드를 표시 이름으로 변환
 * @param {string} lang - 언어 코드
 * @returns {string} 표시 이름
 */
export function formatLang(lang) {
    if (lang === 'typescript') return 'TypeScript';
    if (lang === 'curl') return 'cURL';
    if (lang === 'python') return 'Python';
    return lang;
}
