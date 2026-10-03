/**
 * 브라우저 실행 결과 검사 — 실행이 끝난 뒤 호스트에서 결과를 보고 모델에 줄 내용을 정한다.
 *
 * 리다이렉트 대응: 실행 전 검사(browser-url-guard)는 모델이 적은 goto 주소만 본다. 공개 주소가 사설망·메타데이터
 * 주소로 리다이렉트하면 그 검사를 지나간다. 러너는 결과에 도착한 주소(finalUrl, goto 결과의 url)를 싣으므로,
 * 그 주소를 같은 가드로 다시 검사해 막힌 주소면 결과 본문을 모델에 주지 않는다.
 *
 * 봇 차단 안내: 결과 본문이 봇 차단·캡차 확인 화면으로 보이면 결과 뒤에 경고를 붙인다 — 모델이 그 화면을
 * 실제 내용으로 읽거나 같은 요청을 되풀이하지 않게 한다.
 *
 * 한계: 요청은 이미 나갔다 — 여기서 막는 것은 응답 본문이 모델에 닿는 것뿐이다. 요청 자체를 막으려면
 * 컨테이너 안(러너의 요청 가로채기·egress 프록시의 IP 검사)에서 해야 한다.
 *
 * @module services/task-sandbox/browser-result-guard
 */
import { validateOutboundUrl } from '../../security/ssrf-guard';
import { BROWSER_RESULT_GUARD, BROWSER_BOT_BLOCK } from '../../config/agent-task-browser-web';
import { getBrowserRedirectBlockedMessage, BROWSER_BOT_BLOCK_NOTICE } from '../../prompts/agent-task-browser-web';
import type { ExecResult } from './executor';

/** 잘린 출력에서 주소 필드를 찾는다 — 본문 안의 같은 글자는 따옴표가 이스케이프돼 있어 걸리지 않는다. */
const URL_FIELD = /"(?:finalUrl|url)":"((?:[^"\\]|\\.)*)"/g;

function isHttpUrl(v: unknown): v is string {
    return typeof v === 'string' && /^https?:\/\//i.test(v);
}

/** PURE: 러너 출력(JSON)에서 실제로 도착한 주소 — finalUrl 과 goto 결과의 url. http(s) 만, 중복 없이. */
export function visitedUrls(stdout: string): string[] {
    const found: unknown[] = [];
    try {
        const obj = JSON.parse(stdout) as { finalUrl?: unknown; results?: unknown } | null;
        found.push(obj?.finalUrl);
        if (Array.isArray(obj?.results)) for (const r of obj.results) found.push((r as { url?: unknown } | null)?.url);
    } catch {
        // 출력 상한에 잘렸으면 JSON 이 깨진다 — 주소 필드만 찾는다
        if (!stdout.startsWith('{')) return [];
        for (const m of stdout.matchAll(URL_FIELD)) {
            try { found.push(JSON.parse(`"${m[1]}"`)); } catch { /* 깨진 조각은 건너뛴다 */ }
        }
    }
    return [...new Set(found.filter(isHttpUrl))];
}

/**
 * PURE: 결과 본문이 봇 차단·캡차 확인 화면으로 보이는가 — 결정적 패턴만 쓴다(LLM 판단 아님).
 * 본문 텍스트는 짧을 때만 본다(차단 화면은 짧다 — 긴 기사에 같은 낱말이 있는 경우를 거른다).
 * HTML 은 제목과 차단 서비스의 표지(스크립트 경로 등)로 판정한다. 출력이 잘려 JSON 이 깨졌으면 판정하지 않는다.
 */
export function looksBotBlocked(stdout: string): boolean {
    let results: unknown;
    try { results = (JSON.parse(stdout) as { results?: unknown } | null)?.results; } catch { return false; }
    if (!Array.isArray(results)) return false;
    const matches = (text: string): boolean => BROWSER_BOT_BLOCK.TEXT_PATTERNS.some((p) => p.test(text));
    for (const r of results) {
        const { text, html } = (r ?? {}) as { text?: unknown; html?: unknown };
        if (typeof text === 'string' && text.length <= BROWSER_BOT_BLOCK.SHORT_TEXT_MAX_CHARS && matches(text)) return true;
        if (typeof html === 'string') {
            const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '';
            if (matches(title) || BROWSER_BOT_BLOCK.HTML_MARKERS.some((p) => p.test(html))) return true;
        }
    }
    return false;
}

interface GuardOptions {
    /** 통과면 resolve, 막으면 throw — 테스트가 DNS 없이 주입한다. */
    validate?: (url: string) => Promise<unknown>;
    redirectGuard?: boolean;
    botNotice?: boolean;
}

/** 실행 결과를 검사해 모델에 줄 결과를 돌려준다. 문제가 없으면 받은 결과 그대로. */
export async function guardBrowserResult(r: ExecResult, opts: GuardOptions = {}): Promise<ExecResult> {
    const validate = opts.validate ?? ((url: string) => validateOutboundUrl(url));
    if (opts.redirectGuard ?? BROWSER_RESULT_GUARD.REDIRECT_GUARD_ENABLED) {
        const blocked: string[] = [];
        for (const url of visitedUrls(r.stdout)) {
            try { await validate(url); } catch { blocked.push(url); }
        }
        if (blocked.length > 0) {
            return { ...r, stdout: '', stderr: getBrowserRedirectBlockedMessage(blocked), exitCode: -1 };
        }
    }
    // 경고는 stderr 뒤에 붙인다 — stdout(JSON)은 계측·절차 스킬이 파싱하므로 건드리지 않는다.
    if ((opts.botNotice ?? BROWSER_BOT_BLOCK.NOTICE_ENABLED) && looksBotBlocked(r.stdout)) {
        return { ...r, stderr: r.stderr ? `${r.stderr}\n${BROWSER_BOT_BLOCK_NOTICE}` : BROWSER_BOT_BLOCK_NOTICE };
    }
    return r;
}
