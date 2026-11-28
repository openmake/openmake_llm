/**
 * 확장 설치 — 스킬이 부르는 MCP 서버가 없을 때의 안내 (opt-in `EXTENSION_MCP_DEPENDENCY_HINTS`, 2026-11-28).
 *
 * 배경: Claude Code 마켓플레이스는 MCP 서버 하나를 여러 플러그인이 나눠 쓰는 구성이 흔하다(ruvnet/ruflo —
 * 서버 `ruflo` 는 `ruflo-core` 에만 정의돼 있고 46개 플러그인이 `mcp__ruflo__*` 도구를 부른다). 서버 없는
 * 플러그인만 설치하면 스킬은 들어오지만 도구 호출이 실패한다 — 설치는 그대로 두고 리포트에 안내만 붙인다
 * (자동 설치는 사용자가 고르지 않은 플러그인을 들이므로 하지 않는다).
 *
 * 판정은 런타임 별칭 해석(add-on mcp-runtime `resolveToolNameAlias`)과 같은 규칙이다 — 서버 이름(충돌 접미사 제외)을
 * 정규화해 키와 같거나 `_<키>` 로 끝나면 충족. 저장소에서 그 키를 정의한 `.mcp.json`/`mcp.json` 을 찾으면 그 디렉터리를 알려 준다.
 * 실패는 전부 조용히 건너뛴다(fail-open — 안내가 설치를 막지 않는다).
 *
 * @module agents/git-ingest/mcp-dependency-hint
 */
import { MCP_TOOL_ALIAS_PATTERN } from '../../config/skill-compat';
import { SKILL_CREATOR } from '../../config/constants';
import type { ComponentContext } from './extension-components';

/** 제공 플러그인을 찾으려고 읽는 MCP 정의 파일 상한 — 거대 마켓플레이스에서 요청이 불어나지 않게 */
export const MCP_DEPENDENCY_PROVIDER_SCAN_MAX = 20;

const COLLISION_SUFFIX = /-[0-9a-f]{6}$/;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** PURE: 본문들이 부르는 MCP 서버 키(정규화) */
export function referencedMcpKeys(bodies: readonly string[]): string[] {
    const keys = new Set<string>();
    for (const b of bodies) for (const m of b.matchAll(MCP_TOOL_ALIAS_PATTERN)) { const k = norm(m[1]); if (k) keys.add(k); }
    return [...keys];
}

/**
 * PURE: 서버 이름 목록이 키를 충족하는가(런타임 별칭 해석과 같은 규칙). Claude Code 플러그인 표기
 * `plugin_<플러그인>_<서버 키>` 는 `<플러그인>_<키>` 와 같은 이름(종전) 또는 `_<서버 이름>` 으로 끝나는 이름(서버 키 이름)이 충족한다.
 */
export function serverSatisfiesKey(serverNames: readonly string[], key: string): boolean {
    const rest = key.startsWith('plugin_') ? key.slice('plugin_'.length) : null;
    return serverNames.some((n) => [norm(n), norm(n.replace(COLLISION_SUFFIX, ''))].some((f) =>
        f === key || f.endsWith(`_${key}`) || (rest !== null && !!f && (f === rest || rest.endsWith(`_${f}`)))));
}

/** PURE: 디렉터리의 MCP 정의 키가 참조 키를 정의하는가 — 일반 표기(`<키>`)·플러그인 표기(`plugin_<디렉터리 구성 이름>_<키>`) */
export function providesKey(dir: string, serverKey: string, refKey: string): boolean {
    const k = norm(serverKey);
    if (k === refKey) return true;
    return dir.split('/').some((seg) => seg && refKey === `plugin_${norm(seg)}_${k}`);
}

/** PURE: MCP 정의 JSON 의 서버 키 — `{ mcpServers: {...} }` 와 최상위 맵 둘 다 */
export function mcpConfigServerKeys(raw: string): string[] {
    try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const map = (obj && typeof obj.mcpServers === 'object' && obj.mcpServers) ? obj.mcpServers as Record<string, unknown> : obj;
        return map && typeof map === 'object' ? Object.keys(map).filter((k) => typeof map[k] === 'object') : [];
    } catch { return []; }
}

const isMcpConfig = (p: string): boolean => /(^|\/)\.?mcp\.json$/.test(p);
const pluginDirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/'))) || '.';

export async function buildMcpDependencyHints(
    ctx: Pick<ComponentContext, 'fetcher' | 'owner' | 'repo' | 'sha' | 'tree' | 'root'>,
    input: { skillPaths: readonly string[]; serverNames: readonly string[] },
): Promise<string[]> {
    const maxSize = SKILL_CREATOR.gitMaxFileSize ?? 262144;
    const bodies: string[] = [];
    for (const p of input.skillPaths) {
        try { bodies.push(await ctx.fetcher.fetchFile(ctx.owner, ctx.repo, ctx.sha, p, maxSize)); } catch { /* fail-open */ }
    }
    const missing = referencedMcpKeys(bodies).filter((k) => !serverSatisfiesKey(input.serverNames, k));
    const original = new Map<string, string>();
    for (const b of bodies) for (const m of b.matchAll(MCP_TOOL_ALIAS_PATTERN)) if (!original.has(norm(m[1]))) original.set(norm(m[1]), m[1]);
    if (missing.length === 0) return [];

    // 제공 플러그인 — 이 확장 밖(같은 저장소)의 MCP 정의 파일에서 키를 찾는다
    const providers = new Map<string, string>();
    const files = ctx.tree.entries.map((e) => e.path).filter((p) => isMcpConfig(p) && !(ctx.root && p.startsWith(ctx.root)));
    for (const p of files.slice(0, MCP_DEPENDENCY_PROVIDER_SCAN_MAX)) {
        try {
            const raw = await ctx.fetcher.fetchFile(ctx.owner, ctx.repo, ctx.sha, p, maxSize);
            const dir = pluginDirOf(p);
            for (const k of mcpConfigServerKeys(raw)) for (const m of missing) if (!providers.has(m) && providesKey(dir, k, m)) providers.set(m, dir);
        } catch { /* fail-open */ }
    }
    return missing.map((k) => providers.has(k)
        ? `MCP_SERVER_MISSING: 스킬이 MCP 서버 '${original.get(k) ?? k}' 의 도구를 부르지만 설치된 서버가 없습니다 — 같은 저장소의 '${providers.get(k)}' 플러그인이 이 서버를 제공합니다(그 플러그인을 먼저 설치하세요)`
        : `MCP_SERVER_MISSING: 스킬이 MCP 서버 '${original.get(k) ?? k}' 의 도구를 부르지만 설치된 서버가 없습니다 — 이 서버를 제공하는 확장을 먼저 설치하세요`);
}
