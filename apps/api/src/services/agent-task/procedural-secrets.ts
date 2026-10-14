/**
 * 절차 스킬 저장 전 평문 비밀 값 검사 — skill_save 가 브라우저 입력값·스크립트를 그대로 저장하면
 * 비밀번호·토큰이 agent_skills.content 에 평문으로 남고 승인 카드로 다시 노출된다.
 * 의존성이 없는 순수 모듈이다(도구 정의에서 직접 쓴다).
 *
 * @module services/agent-task/procedural-secrets
 */
import { PROCEDURAL_SECRET_FIELD_RE, PROCEDURAL_SECRET_VALUE_RES } from '../../config/procedural-skill';

interface SecretScanInput {
    kind: 'browser' | 'script';
    goal?: string;
    lang?: string;
    actions?: unknown[];
    code?: string;
}

const PARAM_ONLY_RE = /^\s*\{\{\s*[\w.-]+\s*\}\}\s*$/;

const isLiteral = (v: string): boolean => v.length > 0 && !PARAM_ONLY_RE.test(v);

/** goto 주소에 박힌 비밀 — userinfo(user:pass@)와 비밀 키 이름의 query 값. 찾은 위치 이름만 돌려준다(값은 싣지 않는다). */
function urlSecretPart(url: string): string | undefined {
    let u: URL;
    try { u = new URL(url); } catch { return undefined; }
    const raw = u.password || u.username;
    let userinfo = raw;
    try { userinfo = decodeURIComponent(raw); } catch { /* 잘못된 % 인코딩 — 원문을 리터럴로 본다 */ }
    if (isLiteral(userinfo)) return 'url userinfo';
    for (const [key, value] of u.searchParams) {
        if (PROCEDURAL_SECRET_FIELD_RE.test(key) && isLiteral(value)) return `url ?${key}`;
    }
    return undefined;
}

/**
 * PURE: 절차에 평문으로 들어 있는 비밀 값의 위치 목록(값 자체는 싣지 않는다). 비어 있으면 저장해도 된다.
 * 브라우저 액션은 비밀 입력란(selector·label·name)에 {{param}} 이 아닌 값(text·value·promptText)을 넣은 경우와 goto 주소의
 * userinfo·비밀 키 이름 query 값, 스크립트는 본문의 리터럴 키·토큰.
 */
export function findPlaintextSecrets(spec: SecretScanInput): string[] {
    const hits: string[] = [];
    if (spec.kind === 'browser') {
        (spec.actions ?? []).forEach((a, i) => {
            if (!a || typeof a !== 'object') return;
            const o = a as Record<string, unknown>;
            const urlPart = o.type === 'goto' && typeof o.url === 'string' ? urlSecretPart(o.url) : undefined;
            if (urlPart) { hits.push(`actions[${i}] (goto → ${urlPart})`); return; }
            const value = [o.text, o.value, o.promptText].find((v): v is string => typeof v === 'string' && v.length > 0);
            if (value === undefined || PARAM_ONLY_RE.test(value)) return;
            const field = [o.selector, o.label, o.name, o.placeholder].filter((v): v is string => typeof v === 'string').join(' ');
            if (PROCEDURAL_SECRET_FIELD_RE.test(field)) hits.push(`actions[${i}] (${String(o.type ?? 'action')} → ${field.trim()})`);
        });
    } else if (PROCEDURAL_SECRET_VALUE_RES.some((re) => re.test(spec.code ?? ''))) {
        hits.push('code (키·토큰·비밀번호로 보이는 리터럴 값)');
    }
    return hits;
}
