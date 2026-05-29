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
    var esc = escapeHtml(code);
    // 단일 패스 토크나이저 — 삽입한 <span class="..."> 마크업을 후속 패스가 재매칭하던
    // 버그(특히 'class' 키워드가 span 속성을 깨던 문제) 방지. 좌→우 1회 스캔, 문자열/주석은 원자적.
    // 각 패턴은 capture group 1개씩 (내부는 (?:...) 비캡처) — group index ↔ patterns index 정렬.
    var patterns = [
        { cls: 'tok-com', src: '#.*|\\/\\/.*' },
        { cls: 'tok-str', src: '&quot;.*?&quot;|&#039;.*?&#039;' },
    ];
    if (lang === 'curl') {
        patterns.push({ cls: 'tok-key', src: '\\b(?:GET|POST|PUT|PATCH|DELETE)\\b' });
        patterns.push({ cls: 'tok-param', src: '-H|-d|-X' });
    }
    patterns.push({ cls: 'tok-key', src: '\\b(?:import|from|const|let|var|function|return|if|else|await|async|try|catch|true|false|null|undefined|class|new)\\b' });
    patterns.push({ cls: 'tok-num', src: '\\b\\d+(?:\\.\\d+)?\\b' });
    patterns.push({ cls: 'tok-func', src: '[a-zA-Z_]\\w*(?=\\()' });
    patterns.push({ cls: 'tok-punc', src: '[{}\\[\\],:]' });

    var master = new RegExp(patterns.map(function (p) { return '(' + p.src + ')'; }).join('|'), 'g');
    return esc.replace(master, function () {
        var args = arguments;
        for (var i = 0; i < patterns.length; i++) {
            if (args[i + 1] !== undefined) {
                return '<span class="' + patterns[i].cls + '">' + args[i + 1] + '</span>';
            }
        }
        return args[0];
    });
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

export default { escapeHtml, highlight, getCodeBlock, formatLang };
