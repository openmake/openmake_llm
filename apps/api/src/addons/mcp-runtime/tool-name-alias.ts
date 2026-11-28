/**
 * @module addons/mcp-runtime/tool-name-alias
 * @description 외부 도구 이름 별칭 해석 — 외부 스킬·플러그인이 쓰는 MCP 도구 표기를 이 환경의 실제 이름으로 잇는다.
 *
 * 확장 번들의 MCP 서버는 `<확장명>-<키>` 로 저장되고(충돌 시 `-xxxxxx` 접미) 도구는 `<서버명>::<도구>` 로 노출된다.
 * 외부 스킬 본문은 Claude Code 표기 `mcp__<키>__<도구>` 나 `<키>::<도구>` 로 적혀 있어, 모델이 그 이름 그대로 부르면
 * "도구를 찾을 수 없습니다" 가 됐다(2026-09-21 조사 ① — Apollo 는 서버가 active 인데 이름만 달라 못 썼다).
 *
 * opt-in — `MCP_TOOL_ALIAS_RESOLVE=true` 일 때만 해석한다(기본 OFF = 종전대로 not-found + 이름 제안).
 *
 * 규칙(결정적, 2026-11-25):
 *  - 입력이 이미 아는 이름이면 해석하지 않는다.
 *  - 도구 부분은 그대로 같아야 한다(도구 이름은 추측하지 않는다).
 *  - 서버 부분은 정규화(소문자 + 영숫자 외 `_`) 후 키와 같거나 `_<키>` 로 끝나야 한다 — 충돌 접미 `-xxxxxx` 는 떼고 본다.
 *  - 후보가 정확히 하나일 때만 잇는다. 여럿이면 서버 부분이 키와 똑같은 것 하나를 고르고, 그래도 여럿이면 잇지 않는다
 *    (모호한 이름을 아무 서버로나 보내지 않는다 — not-found + 이름 제안으로 떨어진다).
 *  - Claude Code 플러그인 표기 `mcp__plugin_<플러그인>_<서버 키>__<도구>`(ruvnet/ruflo 등 — 2026-11-28 실측)는
 *    opt-in `MCP_TOOL_ALIAS_PLUGIN_FORM=true` 일 때만 본다: `<플러그인>_<키>` 가 서버 이름과 같으면(종전 이름 `ruflo-core-ruflo`)
 *    정확 일치, `_<서버 이름>` 으로 끝나면(서버 키 이름 `ruflo`) 후보. 끄면 종전처럼 이 표기는 어느 서버와도 맞지 않는다.
 *  - 후보는 **이 사용자가 지금 쓸 수 있는 이름** 안에서만 고른다. 해석된 이름은 Base 디스패처의 거버넌스(반출·서킷·역할·훅)를
 *    그 이름으로 다시 지난다.
 */
// 이 모듈은 Base 내부를 import 하지 않는다(add-on 경계 래칫) — 네임스페이스 구분자는 호출자(tool-router)가 넘긴다.

/** 플러그인 표기(`mcp__plugin_<플러그인>_<키>__…`) 해석 켜짐 여부 — 호출 시점에 읽는다(기본 OFF) */
export function toolAliasPluginFormEnabled(): boolean {
    return process.env.MCP_TOOL_ALIAS_PLUGIN_FORM === 'true';
}

/** 별칭 해석 켜짐 여부 — 호출 시점에 읽는다(기본 OFF) */
export function toolAliasResolveEnabled(): boolean {
    return process.env.MCP_TOOL_ALIAS_RESOLVE === 'true';
}

const CLAUDE_MCP_ALIAS = /^mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+)$/;
const COLLISION_SUFFIX = /-[0-9a-f]{6}$/;

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** 별칭 후보 형태인가 — 해석을 시도할 가치가 있는 이름만(매 도구 호출의 빠른 경로). */
export function looksLikeToolAlias(name: string, sep: string): boolean {
    return CLAUDE_MCP_ALIAS.test(name) || name.includes(sep);
}

function splitAlias(name: string, sep: string): { key: string; tool: string } | null {
    const m = CLAUDE_MCP_ALIAS.exec(name);
    if (m) return { key: m[1], tool: m[2] };
    const i = name.indexOf(sep);
    if (i <= 0) return null;
    const tool = name.slice(i + sep.length);
    return tool ? { key: name.slice(0, i), tool } : null;
}

export interface ToolAliasResolution {
    /** 유일하게 해석된 실제 이름 */
    resolved?: string;
    /** 후보가 여럿이라 잇지 않았을 때 그 후보들(로그용) */
    ambiguous?: string[];
}

/** @param sep 도구 네임스페이스 구분자(`::` — 호출자가 Base 계약에서 넘긴다) */
export function resolveToolNameAlias(name: string, known: readonly string[], sep: string): ToolAliasResolution {
    if (known.includes(name)) return {};
    const alias = splitAlias(name, sep);
    if (!alias) return {};
    const key = norm(alias.key);
    if (!key) return {};
    const scored: Array<{ name: string; exact: boolean }> = [];
    const pluginRest = key.startsWith('plugin_') && toolAliasPluginFormEnabled() ? key.slice('plugin_'.length) : null;
    for (const k of new Set(known)) {
        const i = k.indexOf(sep);
        if (i <= 0 || k.slice(i + sep.length) !== alias.tool) continue;
        const server = k.slice(0, i);
        const forms = [norm(server), norm(server.replace(COLLISION_SUFFIX, ''))];
        if (forms.some(f => f === key)) scored.push({ name: k, exact: true });
        else if (forms.some(f => f.endsWith(`_${key}`))) scored.push({ name: k, exact: false });
        else if (pluginRest && forms.some(f => f === pluginRest)) scored.push({ name: k, exact: true });
        else if (pluginRest && forms.some(f => f && pluginRest.endsWith(`_${f}`))) scored.push({ name: k, exact: false });
    }
    if (scored.length === 1) return { resolved: scored[0].name };
    const exact = scored.filter(s => s.exact);
    if (exact.length === 1) return { resolved: exact[0].name };
    return scored.length > 1 ? { ambiguous: scored.map(s => s.name) } : {};
}
