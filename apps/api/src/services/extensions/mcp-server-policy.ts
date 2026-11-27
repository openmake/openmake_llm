/**
 * 확장 MCP 서버 정책 검사 (마켓플레이스 남은 개발계획 v3.7 §8-3) — MCP 서버를 **등록(저장)·spawn·연결 전에** 거르는 단일 검사 지점.
 *
 * M2(services/extensions/source-policy)와 같은 구조: 구조화 규칙 · deny 먼저 넓게 / allow 정확 · 층(전역·조직)마다 allow ·
 * allow 미설정 = 제한 없음, `[]` = 전부 차단 · 깨진 값 = 그 층 전부 차단 · 조직 조회 실패 = 마지막 적용 층 유지(없으면 거절).
 * 규칙 스키마와 식별 표는 config/extension-mcp-server-policy.ts.
 *
 * 원격(sse·streamable-http) — `{type:'url'}`:
 *   - 후보 URL 은 WHATWG URL 로 정규화한다: 스킴·호스트 소문자, IDN → punycode, 숫자 IP 정규형(`0x7f.1` → 127.0.0.1),
 *     기본 포트 제거, `.`·`..` 경로 해석, userinfo·query·fragment 무시, 끝 `.` 호스트, 경로의 비예약 문자 %XX 해제,
 *     연속 `/` 접기, 끝 `/` 제거. http(s) 가 아니거나 해석되지 않으면 식별 불가.
 *   - allow: 스킴·호스트·포트가 같고 경로가 규칙 경로의 **구간 접두**(`/v1` 은 `/v1`·`/v1/x` 만, `/v10` 아님) — 경로 대소문자 구분.
 *   - deny: 스킴 무시, 규칙에 포트가 없으면 모든 포트, 경로는 전부 %XX 해제 + 소문자로 비교.
 *   - 호스트 `*.example.com` 은 하위 도메인만(apex 아님).
 * stdio — `{type:'command', command, package?}`:
 *   - `env` 앞머리(VAR=값·-i·-u)는 걷어낸 뒤 판정한다. 실행 파일은 소문자 + Windows 확장자 제거.
 *   - 실행기(npx·pnpm dlx·npm exec·bunx·uvx·uv tool run·pipx run·docker/podman run …)면 패키지 식별자를 뽑는다
 *     (`-p/--package`·`--from`·`--spec` 우선, 아니면 플래그 뒤 첫 위치 인자). npm 은 `@scope/name@ver`, python 은 PEP 503
 *     이름 정규화 + `==`/`@` 고정 버전, 컨테이너는 `docker.io/library/` 기본 레지스트리 정규화 + 태그·digest.
 *   - allow: 실행 파일이 **그대로** 같고(경로 포함 — `/tmp/x/npx` 는 `npx` 규칙에 맞지 않는다), package 가 있으면 이름이 같고
 *     (끝 `/*` = 그 접두), 버전이 있으면 후보도 같은 버전으로 **고정**돼 있어야 한다.
 *   - deny: 실행 파일은 basename 비교 + **같은 계열 실행기끼리 동일 취급**(`npx` 차단이 `pnpm dlx`·`npm exec` 를 막는다),
 *     package 는 모든 인자 토큰에서 같은 이름을 찾고(값 플래그 오인 대비), 후보 버전이 없으면(떠다님) 버전 규칙도 막는다.
 *     셸 감싸기(`sh -c "…"`·`cmd /c …`)는 문자열 안의 명령까지 본다(깊이 상한).
 *   - 셸·`env` 는 allow 에선 투명하지 않다 — `sh -c` 서버는 `{command:'sh'}` 를 명시해야 허용된다.
 * 식별 불가(URL·명령 해석 실패)는 층이 하나라도 있으면 거절(UNIDENTIFIED), 층이 없으면 허용(제한 없음).
 *
 * 메시지·감사의 식별 문자열은 정규화 URL(query 제외) 또는 "실행 파일 + 패키지" 만 — 인자·env 값은 싣지 않는다.
 *
 * @module services/extensions/mcp-server-policy
 */
import { createLogger } from '../../utils/logger';
import {
    EXTENSION_MCP_SERVER_POLICY_SETTINGS,
    type ExtensionMcpServerPolicyLayer,
    type ExtensionMcpServerRule,
} from '../../config/extension-mcp-server-policy';
import { ExtensionMcpServerBlockedError, type ExtensionMcpServerBlockDetail } from '../../errors/extension-mcp-server-blocked.error';
import {
    broadPath,
    describeMcpServer,
    familyOfBase,
    hostMatches,
    normalizeCommand,
    parsePackageSpec,
    parseUrlRule,
    pathPrefix,
    type Invocation,
    type McpServerDescriptor,
    type McpServerSpec,
    type PackageId,
} from './mcp-server-identity';

export { describeMcpServer, normalizeMcpServerUrl, parsePackageSpec } from './mcp-server-identity';
export type { Invocation, McpServerDescriptor, McpServerSpec, PackageId } from './mcp-server-identity';

const logger = createLogger('ExtensionMcpServerPolicy');

/** 검사 지점 — 감사 기록에 남긴다 */
export type McpServerPolicyOrigin = 'extension-install' | 'extension-approve' | 'git-ingest' | 'catalog';

export type McpServerVerdict = { allowed: true } | ({ allowed: false } & ExtensionMcpServerBlockDetail);

function packageMatches(rule: PackageId, cand: PackageId, mode: 'allow' | 'deny'): boolean {
    const nameOk = rule.wildcard ? cand.name.startsWith(rule.name) : cand.name === rule.name;
    if (!nameOk) return false;
    if (rule.version === undefined) return true;
    if (mode === 'allow') return cand.version === rule.version;
    return cand.version === undefined || cand.version === rule.version;
}

function ruleCommand(rule: Extract<ExtensionMcpServerRule, { type: 'command' }>) {
    const rc = normalizeCommand(rule.command);
    return { ...rc, family: familyOfBase(rc.base) };
}

/** allow — 실행 파일이 그대로 같고, 패키지 규칙이면 그 패키지에 맞는지 */
function commandRuleAllowsPackage(rule: Extract<ExtensionMcpServerRule, { type: 'command' }>, inv: Invocation, pkg: PackageId | undefined): boolean {
    const rc = ruleCommand(rule);
    if (rc.command !== inv.command) return false;
    if (rule.package === undefined) return true;
    const rp = parsePackageSpec(rule.package, inv.family ?? rc.family);
    return !!rp && !!pkg && packageMatches(rp, pkg, 'allow');
}

/** allow(층 하나의 규칙 목록) — 실행기가 받는 패키지가 **전부** 허용 규칙에 맞아야 한다(`-p 허용 -p 악성` 우회 차단) */
function stdioAllowedBy(rules: readonly ExtensionMcpServerRule[], inv: Invocation): boolean {
    const cmdRules = rules.filter((r): r is Extract<ExtensionMcpServerRule, { type: 'command' }> => r.type === 'command');
    if (inv.pkgs.length === 0) return cmdRules.some((r) => r.package === undefined && commandRuleAllowsPackage(r, inv, undefined));
    return inv.pkgs.every((p) => cmdRules.some((r) => commandRuleAllowsPackage(r, inv, p)));
}

function commandRuleDenies(rule: Extract<ExtensionMcpServerRule, { type: 'command' }>, inv: Invocation): boolean {
    const rc = ruleCommand(rule);
    const sameCommand = rc.base === inv.base || (!!rc.family && rc.family === inv.family);
    if (!sameCommand) return false;
    if (rule.package === undefined) return true;
    const fam = inv.family ?? rc.family;
    const rp = parsePackageSpec(rule.package, fam);
    if (!rp) return false;
    if (inv.pkgs.some((p) => packageMatches(rp, p, 'deny'))) return true;
    // 값 플래그 오인 대비 — 모든 인자 토큰(플래그 값·쉼표 목록 포함)에서 같은 이름을 찾는다
    for (const tok of inv.tokens) {
        const value = tok.startsWith('-') ? (tok.includes('=') ? tok.slice(tok.indexOf('=') + 1) : '') : tok;
        for (const part of value.split(',')) {
            if (!part) continue;
            const cp = parsePackageSpec(part, fam);
            if (cp && packageMatches(rp, cp, 'deny')) return true;
        }
    }
    return false;
}

/** PURE: 규칙 하나 ↔ 서버. mode deny = 넓게, allow = 정확(stdio allow 는 층 단위 `stdioAllowedBy` 가 판정). */
export function mcpServerRuleMatches(rule: ExtensionMcpServerRule, d: McpServerDescriptor, mode: 'allow' | 'deny'): boolean {
    if (d.kind === 'unidentified') return false;
    if (rule.type === 'url') {
        if (d.kind !== 'remote') return false;
        const r = parseUrlRule(rule.url);
        if (!r || !hostMatches(r, d.host)) return mode === 'deny' && !r;
        if (mode === 'allow') return r.scheme === d.scheme && r.port === d.port && pathPrefix(r.path, d.path);
        return (r.port === '' || r.port === d.port) && pathPrefix(broadPath(r.path), broadPath(d.path));
    }
    if (d.kind !== 'stdio') return false;
    if (mode === 'allow') return stdioAllowedBy([rule], d.primary);
    return [d.primary, ...d.nested].some((inv) => commandRuleDenies(rule, inv));
}

/** 층 하나의 allow 목록이 서버를 허용하는가 */
function layerAllows(rules: readonly ExtensionMcpServerRule[], d: McpServerDescriptor): boolean {
    if (d.kind === 'stdio') return stdioAllowedBy(rules, d.primary);
    return rules.some((r) => mcpServerRuleMatches(r, d, 'allow'));
}

/** PURE: 판정. deny(모든 층) → allow(층마다). 식별 불가는 층이 있으면 거절. */
export function evaluateMcpServer(input: { server: McpServerDescriptor; layers: ExtensionMcpServerPolicyLayer[]; name?: string }): McpServerVerdict {
    const { server, layers } = input;
    const base = { server: server.display, ...(input.name ? { name: input.name } : {}) };
    if (layers.length === 0) return { allowed: true };
    if (server.kind === 'unidentified') {
        const broken = layers.find((l) => l.broken);
        return { allowed: false, reason: broken ? 'POLICY_INVALID' : 'UNIDENTIFIED', ...(broken ? { scope: broken.scope } : {}), ...base };
    }
    for (const layer of layers) {
        const hit = layer.deny.find((r) => mcpServerRuleMatches(r, server, 'deny'));
        if (hit) return { allowed: false, reason: 'DENIED', scope: layer.scope, rule: hit, ...base };
    }
    for (const layer of layers) {
        if (layer.allow === undefined) continue;
        if (!layerAllows(layer.allow, server)) {
            return { allowed: false, reason: layer.broken ? 'POLICY_INVALID' : 'NOT_ALLOWED', scope: layer.scope, ...base };
        }
    }
    return { allowed: true };
}

// ── 정책 해석(I/O) ──────────────────────────────────────────────────────────────

export interface ExtensionMcpServerPolicyDeps {
    /** 활성 조직 층 — 조직이 없거나 정책이 없으면 undefined. 조회 실패는 예외 */
    loadOrgLayer: (userId: string | undefined) => Promise<ExtensionMcpServerPolicyLayer | undefined>;
    /** 거절 감사 기록 — 실패는 삼킨다 */
    audit: (userId: string | undefined, origin: McpServerPolicyOrigin, detail: ExtensionMcpServerBlockDetail) => Promise<void>;
}

const defaultDeps: ExtensionMcpServerPolicyDeps = {
    loadOrgLayer: async (userId) => {
        const { resolveEffectivePolicyStrict } = await import('../org/effective-policy');
        return (await resolveEffectivePolicyStrict(userId)).extensionMcpServer;
    },
    audit: async (userId, origin, detail) => {
        const { getAuditService } = await import('../AuditService');
        await getAuditService().logAudit({
            action: 'extension.mcp_server_blocked',
            userId,
            resourceType: 'mcp_server',
            resourceId: detail.server,
            details: { origin, reason: detail.reason, scope: detail.scope, rule: detail.rule, name: detail.name },
        });
    },
};

const lastOrgLayer = new Map<string, ExtensionMcpServerPolicyLayer | undefined>();
const ANON_KEY = '';

/** 테스트용 */
export function resetExtensionMcpServerPolicyState(): void {
    lastOrgLayer.clear();
}

export interface ExtensionMcpServerGate {
    /** PURE(해석된 정책 위): 서버 판정 */
    evaluate(spec: McpServerSpec): McpServerVerdict;
}

/**
 * 정책을 한 번 해석해 여러 서버를 판정한다(확장 번들의 서버 여럿). 강제 OFF 면 null — `force` 면 그래도 해석한다
 * (관리자 정책 미리보기 M3 가 "켜면 무엇이 막히는지"를 **같은 판정**으로 보여 주는 길. 실제 설치 경로는 쓰지 않는다).
 */
export async function loadExtensionMcpServerGate(
    userId: string | undefined,
    deps: ExtensionMcpServerPolicyDeps = defaultDeps,
    opts: { force?: boolean } = {},
): Promise<ExtensionMcpServerGate | null> {
    if (!EXTENSION_MCP_SERVER_POLICY_SETTINGS.enforced && !opts.force) return null;
    const layers: ExtensionMcpServerPolicyLayer[] = [];
    const globalLayer = EXTENSION_MCP_SERVER_POLICY_SETTINGS.globalLayer;
    if (globalLayer) layers.push(globalLayer);
    const key = userId ?? ANON_KEY;
    let unavailable = false;
    try {
        const org = await deps.loadOrgLayer(userId);
        lastOrgLayer.set(key, org);
        if (org) layers.push(org);
    } catch (e) {
        if (lastOrgLayer.has(key)) {
            logger.warn(`조직 MCP 서버 정책 조회 실패 — 마지막으로 적용한 정책 유지 (user=${key || '-'}):`, e);
            const prev = lastOrgLayer.get(key);
            if (prev) layers.push(prev);
        } else {
            logger.warn(`조직 MCP 서버 정책 조회 실패 — 적용 이력이 없어 거절 (user=${key || '-'}):`, e);
            unavailable = true;
        }
    }
    return {
        evaluate(spec) {
            const server = describeMcpServer(spec);
            if (unavailable) return { allowed: false, reason: 'POLICY_UNAVAILABLE', server: server.display, ...(spec.name ? { name: spec.name } : {}) };
            return evaluateMcpServer({ server, layers, name: spec.name });
        },
    };
}

/** 거절 판정을 로그·감사에 남긴다(실패는 삼킨다) — 확장 설치처럼 서버 하나만 빼고 계속하는 경로가 쓴다 */
export async function recordMcpServerBlocked(
    userId: string | undefined,
    origin: McpServerPolicyOrigin,
    verdict: Extract<McpServerVerdict, { allowed: false }>,
    deps: ExtensionMcpServerPolicyDeps = defaultDeps,
): Promise<ExtensionMcpServerBlockDetail> {
    const { allowed: _a, ...detail } = verdict;
    logger.warn(`MCP 서버 거절: ${detail.reason} ${detail.name ?? ''} ${detail.server} (origin=${origin}, user=${userId ?? '-'})`);
    try { await deps.audit(userId, origin, detail); } catch (e) { logger.warn('MCP 서버 거절 감사 기록 실패:', e); }
    return detail;
}

/**
 * 단일 서버 등록 경로의 검사 — 저장·spawn·연결 **전에** 부른다. 강제 OFF 면 아무 것도 하지 않는다(종전 동작).
 * 거절이면 감사 기록 후 ExtensionMcpServerBlockedError(403).
 */
export async function assertMcpServerAllowed(
    req: { userId?: string; origin: McpServerPolicyOrigin; server: McpServerSpec | (() => McpServerSpec) },
    deps: ExtensionMcpServerPolicyDeps = defaultDeps,
): Promise<void> {
    const gate = await loadExtensionMcpServerGate(req.userId, deps);
    if (!gate) return;
    const verdict = gate.evaluate(typeof req.server === 'function' ? req.server() : req.server);
    if (verdict.allowed) return;
    throw new ExtensionMcpServerBlockedError(await recordMcpServerBlocked(req.userId, req.origin, verdict, deps));
}
