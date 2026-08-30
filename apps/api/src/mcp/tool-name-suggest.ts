/**
 * ============================================================
 * 도구 이름 교정 (P0-b) — 결정적 후보 제안
 * ============================================================
 *
 * 모델이 존재하지 않는 도구 이름을 부를 때, 오류 메시지에 **무엇을 부르려던 것인지**
 * 후보를 붙여 다음 턴에 자가 교정하게 한다. 관측된 형태는 셋이다:
 *
 * 1. 다른 생태계 이름 — Claude Code 의 `Read`/`WebFetch` 등 (스킬 본문에서 옮아온다)
 * 2. 구분자·대소문자 차이 — `Python REPL::repl_run_code` vs `python-repl::repl_run_code`
 * 3. 오타·구 이름 — `web_url_read` vs `web_scrape`
 *
 * **LLM 을 부르지 않는다** — 별칭 테이블(config/skill-compat) + 정규화 + 편집거리뿐이다
 * (판단 경계 A형 금지). 후보가 없으면 종전 메시지 그대로다(fail-open).
 *
 * @module mcp/tool-name-suggest
 */
import { CLAUDE_TOOL_ALIASES } from '../config/skill-compat';
import { TOOL_NAME_SUGGEST } from '../config/tool-name-suggest';

/** 대소문자·구분자(`_`,`-`,`::`,공백)를 지운 비교용 키. */
export function normalizeToolName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 별칭 테이블을 대소문자 무시로 조회하기 위한 사전(모듈 1회 구축). */
const ALIAS_BY_NORMALIZED = new Map<string, string>();
for (const [from, to] of Object.entries(CLAUDE_TOOL_ALIASES)) {
    if (to) ALIAS_BY_NORMALIZED.set(normalizeToolName(from), to);
}

/** 표준 Levenshtein 거리 (두 행 롤링 — 도구 이름 길이라 충분하다). */
function levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(
                prev[j] + 1,
                cur[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
        prev = cur;
    }
    return prev[b.length];
}

export interface SuggestToolNamesOpts {
    maxSuggestions?: number;
    maxDistance?: number;
}

/**
 * PURE: 알 수 없는 도구 이름에 대한 후보를 우선순위대로 돌려준다.
 *
 * 우선순위 — ① 생태계 별칭(`Read`→`file_ops`) ② 정규화 완전 일치(구분자·대소문자만 다름)
 * ③ `server::tool` 의 도구 부분 일치 ④ 편집거리 근접.
 *
 * 짧은 이름은 거리 상한을 좁힌다(`floor(len/3)`) — `bash`(4자)에 거리 3 을 허용하면
 * 무관한 이름이 후보로 올라와 오히려 모델을 헷갈리게 한다.
 */
export function suggestToolNames(
    unknown: string,
    available: readonly string[],
    opts: SuggestToolNamesOpts = {},
): string[] {
    if (!unknown || available.length === 0) return [];
    const maxSuggestions = opts.maxSuggestions ?? TOOL_NAME_SUGGEST.maxSuggestions;
    const maxDistance = opts.maxDistance ?? TOOL_NAME_SUGGEST.maxDistance;
    if (maxSuggestions <= 0) return [];

    const pool = available.slice(0, TOOL_NAME_SUGGEST.maxCandidates);
    const target = normalizeToolName(unknown);
    if (!target) return [];
    const out: string[] = [];
    const push = (name: string) => {
        if (name && name !== unknown && !out.includes(name)) out.push(name);
    };

    // ① 생태계 별칭 — 이름이 그대로 있으면 가장 확실한 교정이다.
    const alias = ALIAS_BY_NORMALIZED.get(target);
    if (alias) {
        const hit = pool.find((n) => normalizeToolName(n) === normalizeToolName(alias));
        if (hit) push(hit);
    }

    // ② 정규화 완전 일치 — 구분자/대소문자만 다른 경우.
    for (const n of pool) if (normalizeToolName(n) === target) push(n);

    // ③ `server::tool` 의 도구 부분(마지막 세그먼트) 일치.
    const tail = normalizeToolName(unknown.split('::').pop() ?? '');
    if (tail && tail !== target) {
        for (const n of pool) {
            if (normalizeToolName(n.split('::').pop() ?? '') === tail) push(n);
        }
    }

    // ④ 편집거리 근접 — 짧은 이름일수록 좁게.
    if (out.length < maxSuggestions) {
        const limit = Math.max(1, Math.min(maxDistance, Math.floor(target.length / 3)));
        const scored: Array<{ name: string; d: number }> = [];
        for (const n of pool) {
            if (out.includes(n)) continue;
            const d = levenshtein(target, normalizeToolName(n));
            if (d <= limit) scored.push({ name: n, d });
        }
        scored.sort((a, b) => a.d - b.d || a.name.localeCompare(b.name));
        for (const s of scored) push(s.name);
    }

    return out.slice(0, maxSuggestions);
}

/**
 * PURE: "도구를 찾을 수 없습니다" 계열 메시지에 후보를 덧붙인다.
 * 후보가 없으면 원문 그대로 (fail-open).
 */
export function withToolNameSuggestions(
    baseMessage: string,
    unknown: string,
    available: readonly string[],
    opts: SuggestToolNamesOpts = {},
): string {
    if (!TOOL_NAME_SUGGEST.enabled) return baseMessage;
    const names = suggestToolNames(unknown, available, opts);
    if (names.length === 0) return baseMessage;
    return `${baseMessage} — 다음 이름을 의도한 것 같습니다: ${names.join(', ')}. 정확한 이름으로 다시 호출하세요.`;
}

/** `sh: 1: web_search: not found` / `bash: line 2: foo: command not found` 양식. */
const SHELL_NOT_FOUND_RE = /(?:^|\n)\s*(?:\/bin\/)?(?:sh|bash|zsh)(?::[^:\n]*)?:\s*([A-Za-z_][\w.:-]*):\s*(?:command )?not found/g;

/**
 * PURE: 셸 출력에서 "도구 이름을 셸 명령으로 실행한" 흔적을 찾는다.
 *
 * 실측(운영 30일 5건): 모델이 `web_search "질의"` 처럼 도구를 bash 안에서 부른다.
 * 셸에는 그런 명령이 없으므로 `not found` 로 끝나고, 모델은 원인을 모른 채 재시도한다.
 */
export function detectShellToolMisuse(output: string, knownTools: readonly string[]): string[] {
    if (!TOOL_NAME_SUGGEST.shellHintEnabled || !output || knownTools.length === 0) return [];
    const known = new Set(knownTools.map(normalizeToolName));
    const found: string[] = [];
    SHELL_NOT_FOUND_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SHELL_NOT_FOUND_RE.exec(output)) !== null) {
        const name = m[1];
        if (known.has(normalizeToolName(name)) && !found.includes(name)) found.push(name);
    }
    return found;
}

/** PURE: 셸 오용 안내 문구. 호출부가 도구 결과 끝에 덧붙인다. */
export function formatShellToolMisuseHint(names: readonly string[]): string {
    if (names.length === 0) return '';
    const list = names.join(', ');
    return `\n\n⚠️ ${list} 는 셸 명령이 아니라 **도구**입니다. bash 안에서는 실행할 수 없으니, 셸 대신 도구 호출(tool_calls)로 직접 부르세요.`;
}
