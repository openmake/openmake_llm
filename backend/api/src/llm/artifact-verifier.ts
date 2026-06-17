/**
 * ============================================================
 * Artifact Verifier — 산출물 결정론 검증 게이트
 * ============================================================
 *
 * Harness Engineering 원칙 (Tejas Kumar, IBM "Harnesses in AI"):
 *   모델의 "성공했다"는 자기보고를 믿지 말고, 하니스가 결정론적으로 산출물을
 *   검사한다. 여기서는 에이전트가 생성한 artifact(HTML/코드/JSON)의 구문을
 *   외부 의존성 없이 가볍게 검증하여 명백한 깨짐을 surface 한다.
 *
 * 설계 원칙:
 * - 비차단(non-blocking): 검증은 결과를 annotate 할 뿐, 콘텐츠를 버리지 않는다.
 *   (사용자는 깨진 코드라도 볼 권리가 있고, 거짓 양성으로 출력이 사라지면 더 나쁘다.)
 * - 정직(honesty): 우리가 확신 있게 검사할 수 있는 종류만 checked=true.
 *   지원 밖 언어는 checked=false 로 두고 valid=true(=모름은 통과로 간주, 비차단).
 * - 결정론(deterministic): LLM 미사용, 순수 함수, 동일 입력 → 동일 출력.
 *
 * @module llm/artifact-verifier
 */

/** 산출물 검증 결과 */
export interface ArtifactValidation {
    /** 이 종류/언어를 실제로 검증했는가 (false 면 valid 는 의미 없음 — 미지원) */
    checked: boolean;
    /** 검증 통과 여부 (checked=false 면 항상 true — 비차단 기본값) */
    valid: boolean;
    /** 발견된 문제 설명 (valid=false 일 때 1개 이상) */
    issues: string[];
}

/** 검증 입력 — ArtifactInfo 의 부분집합 */
export interface ArtifactVerifyInput {
    kind?: string;
    lang?: string | null;
    content: string;
}

/** 콘텐츠가 이보다 크면 검증 스킵 (병리적 비용 방지) — 환경변수 override */
const MAX_VERIFY_BYTES = Number(process.env.ARTIFACT_VERIFY_MAX_BYTES) || 512 * 1024;

/** 괄호 균형 검사를 적용할 언어 집합 (명료한 규칙을 가진 것만) */
const BRACKET_LANGS = new Set([
    'js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx',
    'css', 'scss', 'less', 'json', 'json5',
    'java', 'c', 'cpp', 'c++', 'cs', 'csharp', 'go', 'rust', 'rs',
    'php', 'kotlin', 'swift', 'dart',
]);

const HTML_LANGS = new Set(['html', 'htm', 'xml', 'svg', 'xhtml']);
const JSON_LANGS = new Set(['json', 'json5']);

/** void(자기 닫힘) HTML 요소 — 닫는 태그 없음 */
const VOID_ELEMENTS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const PASS: ArtifactValidation = { checked: false, valid: true, issues: [] };

/**
 * 산출물을 결정론적으로 검증합니다.
 *
 * @param input - kind/lang/content
 * @returns 검증 결과 (지원 밖이면 checked=false)
 */
export function verifyArtifact(input: ArtifactVerifyInput): ArtifactValidation {
    const content = input.content ?? '';
    if (!content.trim()) return { ...PASS };
    if (content.length > MAX_VERIFY_BYTES) return { ...PASS };

    const lang = (input.lang || '').toLowerCase().trim();
    const kind = (input.kind || '').toLowerCase().trim();

    // 1) JSON — 가장 명료. JSON.parse 로 확정.
    if (JSON_LANGS.has(lang) || kind === 'json') {
        return verifyJson(content);
    }

    // 2) HTML/XML 계열 — 태그 스택 균형 (best-effort, 보수적).
    if (HTML_LANGS.has(lang) || kind === 'html') {
        return verifyHtml(content);
    }

    // 3) 괄호 균형 언어 (js/ts/css/...) — 문자열·주석 인식 스캐너.
    if (BRACKET_LANGS.has(lang)) {
        return verifyBrackets(content);
    }

    // 그 외: 검사하지 않음 (정직하게 미검증으로 표기).
    return { ...PASS };
}

/** JSON 구문 검증 */
function verifyJson(content: string): ArtifactValidation {
    try {
        JSON.parse(content);
        return { checked: true, valid: true, issues: [] };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { checked: true, valid: false, issues: [`JSON 파싱 실패: ${msg}`] };
    }
}

/**
 * 괄호/문자열 균형 검증 — 문자열(따옴표·백틱)과 주석(라인·블록·해시)을 건너뛰며
 * (), {}, [] 의 짝을 스택으로 맞춘다. 닫히지 않은 문자열도 검출.
 */
function verifyBrackets(content: string): ArtifactValidation {
    const issues: string[] = [];
    const stack: string[] = [];
    const open: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

    let i = 0;
    const n = content.length;
    let line = 1;

    while (i < n) {
        const ch = content[i];
        if (ch === '\n') { line++; i++; continue; }

        // 라인 주석
        if (ch === '/' && content[i + 1] === '/') {
            while (i < n && content[i] !== '\n') i++;
            continue;
        }
        // 해시 주석 (css 는 미사용이나 무해)
        if (ch === '#') {
            while (i < n && content[i] !== '\n') i++;
            continue;
        }
        // 블록 주석
        if (ch === '/' && content[i + 1] === '*') {
            i += 2;
            while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
                if (content[i] === '\n') line++;
                i++;
            }
            i += 2;
            continue;
        }
        // 문자열 / 템플릿 리터럴
        if (ch === '"' || ch === "'" || ch === '`') {
            const quote = ch;
            const startLine = line;
            i++;
            let closed = false;
            while (i < n) {
                const c = content[i];
                if (c === '\\') { i += 2; continue; } // 이스케이프
                if (c === '\n') {
                    line++;
                    // 백틱(멀티라인 허용) 외에는 줄바꿈 전에 닫혀야 함
                    if (quote !== '`') break;
                }
                if (c === quote) { closed = true; i++; break; }
                i++;
            }
            if (!closed) {
                issues.push(`닫히지 않은 문자열 (${quote}) — ${startLine}번째 줄 부근`);
                return { checked: true, valid: false, issues };
            }
            continue;
        }
        // 괄호
        if (ch === '(' || ch === '[' || ch === '{') {
            stack.push(ch);
        } else if (ch === ')' || ch === ']' || ch === '}') {
            const expected = open[ch];
            const top = stack.pop();
            if (top !== expected) {
                issues.push(`괄호 불균형: '${ch}' (${line}번째 줄)에 대응하는 여는 괄호 없음/불일치`);
                return { checked: true, valid: false, issues };
            }
        }
        i++;
    }

    if (stack.length > 0) {
        issues.push(`닫히지 않은 괄호 ${stack.length}개: ${stack.join(' ')}`);
        return { checked: true, valid: false, issues };
    }
    return { checked: true, valid: true, issues: [] };
}

/**
 * HTML/XML 태그 스택 균형 검증 (보수적).
 * - 주석/DOCTYPE/script/style 내부는 무시 (JS 의 < 등 오탐 방지).
 * - void 요소·자기 닫힘 태그(/>)는 스택에 넣지 않음.
 * - 명백한 불일치(닫힘 without 열림, 종료 시 스택 잔류)만 실패로 본다.
 */
function verifyHtml(content: string): ArtifactValidation {
    // 무시 영역 제거
    const html = content
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<!doctype[^>]*>/gi, ' ')
        .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ');

    const tagPattern = /<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g;
    const stack: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tagPattern.exec(html)) !== null) {
        const isClose = m[1] === '/';
        const name = m[2].toLowerCase();
        const selfClose = m[3] === '/';
        if (VOID_ELEMENTS.has(name) || selfClose) continue;
        if (!isClose) {
            stack.push(name);
        } else {
            // 가장 가까운 동일 태그까지 pop (느슨한 매칭 — 보수적)
            const idx = stack.lastIndexOf(name);
            if (idx === -1) {
                return {
                    checked: true,
                    valid: false,
                    issues: [`닫는 태그 </${name}> 에 대응하는 여는 태그 없음`],
                };
            }
            stack.length = idx; // 해당 태그와 그 안쪽 미닫힘 태그 정리
        }
    }
    if (stack.length > 0) {
        return {
            checked: true,
            valid: false,
            issues: [`닫히지 않은 태그: ${stack.map((t) => `<${t}>`).join(', ')}`],
        };
    }
    return { checked: true, valid: true, issues: [] };
}
