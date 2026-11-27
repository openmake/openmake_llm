/**
 * 확장 원본 정책 검사 (마켓플레이스 남은 개발계획 v3.7 M2) — 설치 엔진의 **네트워크·파일 작업 전** 단일 검사 지점.
 *
 * 규칙(구조화 원본 객체, config/extension-source-policy.ts 스키마):
 *   github {repo:'owner/repo'|'owner/*', ref?, path?} · git {url, ref?, path?} · archive {url} · hostPattern {pattern}
 *   · catalog {id} · internal · local
 *
 * 원본 식별 — 실제로 내려받는 곳 기준(설치 엔진과 같은 판정 순서): `.zip` URL·`internal://`·`local://` 은 비-git,
 * 나머지는 parseGitUrl 이 뽑은 GitHub `owner/repo`(fetcher 가 GitHub API 로 그 저장소를 받는다). GitHub 저장소 id 는
 * 소문자로 비교한다(GitHub 은 대소문자 무관). `ref` 는 요청한 추적 ref(HEAD 면 없음), `path` 는 원본 하위 경로
 * (지금 설치 경로엔 없음 — 카탈로그 하위 경로(M4)가 생기면 채운다). 설치할 파일 경로(gitPath)는 원본 식별이 아니다.
 *
 * 매칭:
 *   - deny 를 먼저, 넓게: URL 정규화(호스트 소문자·`.git`·끝 `/`·`ssh://`·`git@host:` → https), github 규칙은 같은
 *     저장소의 git URL 도 막는다, ref·path 없는 규칙은 모든 ref·경로를, 원본에 ref 가 없으면(HEAD) ref 규칙도 막는다.
 *   - allow: 정확 일치(ref·path 가 같거나 양쪽 다 없음). hostPattern 만 정규식. 이름으로는 매칭하지 않는다.
 *   - 층(전역·조직)마다 allow 가 있으면 **모든 층에서** 일치해야 한다. allow 미설정 = 제한 없음, `[]` = 전부 차단.
 *   - catalog 규칙은 그 카탈로그 원본 URL 자체에만 맞는다 — 마켓 항목이 가리키는 다른 저장소(entry)는 독립으로 검사한다
 *     (카탈로그만 허용해 둔 정책이 교차 저장소 항목으로 우회되지 않게).
 *   - `catalog-only`(EXTENSION_ARBITRARY_URL_INSTALL): 설치·업데이트·업데이트 확인의 원본은 등록(enabled) 카탈로그의
 *     URL 또는 그 스냅샷 항목의 교차 저장소 원본(`plugins[].source`)이어야 한다. 마켓 항목(entry)·내부 게시·로컬은
 *     URL 입력이 아니라 대상이 아니다(allow/deny 는 그대로 적용). 카탈로그 등록·동기화는 관리자가 원본을 들이는 길이라 제외.
 *
 * fail-closed: 깨진 정책 값 = 그 층 `allow: []`. 조직 정책 조회 실패 = 그 사용자에게 마지막으로 적용한 조직 층 유지,
 * 적용 이력이 없으면 전부 거절. 카탈로그 목록 조회 실패 = 카탈로그 없음(더 제한적).
 *
 * @module services/extensions/source-policy
 */
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import { isArchiveUrl } from '../../agents/git-ingest/archive-fetcher';
import { isInternalBundleUrl } from '../../agents/git-ingest/internal-bundle-fetcher';
import { isLocalSourceUrl } from '../../agents/git-ingest/local-directory-fetcher';
import { createLogger } from '../../utils/logger';
import {
    EXTENSION_SOURCE_POLICY_SETTINGS,
    type ArbitraryUrlInstallMode,
    type ExtensionSourcePolicyLayer,
    type ExtensionSourceRule,
} from '../../config/extension-source-policy';
import { ExtensionSourceBlockedError, type ExtensionSourceBlockDetail } from '../../errors/extension-source-blocked.error';

const logger = createLogger('ExtensionSourcePolicy');

const GITHUB_HOST = 'github.com';

export type ExtensionSourceAction = 'install' | 'update' | 'update-check' | 'catalog-register' | 'catalog-sync' | 'entry';

/** catalog-only 를 적용하는 동작 — URL 을 입력받는 설치 경로 */
const CATALOG_ONLY_ACTIONS: ReadonlySet<ExtensionSourceAction> = new Set(['install', 'update', 'update-check']);

export type ExtensionSourceDescriptor =
    | { kind: 'github'; repo: string; owner: string; host: string; url: string; ref?: string; path?: string }
    | { kind: 'archive'; host: string; url: string; urlNoQuery: string }
    | { kind: 'internal'; url: string }
    | { kind: 'local'; url: string };

export interface CatalogRef { id: string; url: string; plugins?: Array<{ source?: string }> }

export type SourceVerdict = { allowed: true } | ({ allowed: false } & ExtensionSourceBlockDetail);

/** PURE: URL 정규화 — 스킴·호스트 소문자, userinfo·fragment 제거, ssh/git 형식 → https, 끝 `/`·`.git` 제거. */
export function normalizeSourceUrl(raw: string): string {
    let u = raw.trim();
    const scp = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(u);   // git@host:owner/repo
    if (scp) u = `https://${scp[1]}/${scp[2]}`;
    u = u.replace(/^(ssh|git|git\+ssh|git\+https|http|https):\/\//i, (_m, s: string) => (s.toLowerCase() === 'http' ? 'http://' : 'https://'));
    const m = /^(https?:\/\/)([^/?#]*)(.*)$/i.exec(u);
    if (m) {
        const host = m[2].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();
        u = `${m[1].toLowerCase()}${host}${m[3]}`;
    }
    u = u.replace(/#.*$/, '');
    for (let prev = ''; prev !== u;) { prev = u; u = u.replace(/\/+$/, '').replace(/\.git$/i, ''); }
    return u;
}

/** deny 용 아카이브 비교 키 — 스킴·query 무시 */
function broadArchiveKey(normalized: string): string {
    return normalized.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
}

function hostOf(url: string): string {
    const m = /^https?:\/\/([^/?#]+)/i.exec(url);
    return m ? m[1].toLowerCase() : '';
}

/**
 * PURE: 원본 식별. `gitFirst` = parseGitUrl 을 비-git 판정보다 먼저(GitIngestService 단독 경로와 같은 순서).
 * 판정 불가(INVALID_GIT_URL 이 될 입력)는 null — 설치 엔진이 네트워크 전에 거절한다.
 */
export function describeExtensionSource(rawUrl: string, opts: { ref?: string | null; gitFirst?: boolean } = {}): ExtensionSourceDescriptor | null {
    const url = rawUrl.trim();
    const ref = opts.ref && opts.ref !== 'HEAD' ? opts.ref : undefined;
    const nonGit = (): ExtensionSourceDescriptor | null => {
        if (isInternalBundleUrl(url)) return { kind: 'internal', url };
        if (isLocalSourceUrl(url)) return { kind: 'local', url };
        if (isArchiveUrl(url)) {
            const n = normalizeSourceUrl(url);
            return { kind: 'archive', host: hostOf(n), url: n, urlNoQuery: broadArchiveKey(n) };
        }
        return null;
    };
    const git = (): ExtensionSourceDescriptor | null => {
        const p = parseGitUrl(url);
        if (!p) return null;
        const repo = `${p.owner}/${p.repo}`.toLowerCase();
        return { kind: 'github', repo, owner: p.owner.toLowerCase(), host: GITHUB_HOST, url: `https://${GITHUB_HOST}/${repo}`, ...(ref ? { ref } : {}) };
    };
    return opts.gitFirst ? (git() ?? nonGit()) : (nonGit() ?? git());
}

/** 원본의 동일성 키 — 카탈로그 소속 판정용 */
function identityKey(d: ExtensionSourceDescriptor): string {
    if (d.kind === 'github') return `github:${d.repo}`;
    if (d.kind === 'archive') return `archive:${d.url}`;
    return `${d.kind}:${d.url}`;
}

function githubRuleRepo(rule: ExtensionSourceRule): string | null {
    if (rule.type === 'github') return rule.repo.toLowerCase();
    if (rule.type === 'git') {
        const p = parseGitUrl(normalizeSourceUrl(rule.url));
        return p ? `${p.owner}/${p.repo}`.toLowerCase() : null;
    }
    return null;
}

function repoMatches(ruleRepo: string, d: Extract<ExtensionSourceDescriptor, { kind: 'github' }>): boolean {
    if (ruleRepo.endsWith('/*')) return d.owner === ruleRepo.slice(0, -2);
    return d.repo === ruleRepo;
}

/** PURE: 규칙 하나 ↔ 원본. mode deny = 넓게, allow = 정확. */
export function ruleMatches(
    rule: ExtensionSourceRule,
    d: ExtensionSourceDescriptor,
    mode: 'allow' | 'deny',
    ctx: { action: ExtensionSourceAction; catalogs: CatalogRef[] },
): boolean {
    switch (rule.type) {
        case 'github':
        case 'git': {
            if (d.kind !== 'github') return false;
            const repo = githubRuleRepo(rule);
            if (!repo || !repoMatches(repo, d)) return false;
            if (mode === 'deny') {
                const refOk = rule.ref === undefined || d.ref === undefined || rule.ref === d.ref;
                const pathOk = rule.path === undefined || d.path === undefined || d.path === rule.path || d.path.startsWith(`${rule.path.replace(/\/+$/, '')}/`);
                return refOk && pathOk;
            }
            return rule.ref === d.ref && rule.path === d.path;
        }
        case 'archive': {
            if (d.kind !== 'archive') return false;
            const n = normalizeSourceUrl(rule.url);
            return mode === 'deny' ? broadArchiveKey(n) === d.urlNoQuery : n === d.url;
        }
        case 'hostPattern': {
            if (d.kind !== 'github' && d.kind !== 'archive') return false;
            try { return new RegExp(rule.pattern).test(d.host); } catch { return mode === 'deny'; }
        }
        case 'catalog': {
            if (ctx.action === 'entry') return false;
            const cat = ctx.catalogs.find((c) => c.id === rule.id);
            const cd = cat ? describeExtensionSource(cat.url) : null;
            return !!cd && identityKey(cd) === identityKey(d);
        }
        case 'internal':
            return d.kind === 'internal';
        case 'local':
            return d.kind === 'local';
    }
}

/** PURE: 원본이 등록 카탈로그(URL 또는 스냅샷 항목의 교차 저장소 원본)에 속하는지 */
export function isCatalogMember(d: ExtensionSourceDescriptor, catalogs: CatalogRef[]): boolean {
    const key = identityKey(d);
    return catalogs.some((c) => {
        const cd = describeExtensionSource(c.url);
        if (cd && identityKey(cd) === key) return true;
        return (c.plugins ?? []).some((p) => {
            const pd = p.source ? describeExtensionSource(p.source) : null;
            return !!pd && identityKey(pd) === key;
        });
    });
}

/** PURE: 판정. deny(모든 층) → allow(층마다) → catalog-only. */
export function evaluateExtensionSource(input: {
    source: ExtensionSourceDescriptor;
    action: ExtensionSourceAction;
    layers: ExtensionSourcePolicyLayer[];
    catalogs: CatalogRef[];
    arbitraryUrlInstall: ArbitraryUrlInstallMode;
}): SourceVerdict {
    const { source, action, layers, catalogs } = input;
    const ctx = { action, catalogs };
    const shown = source.kind === 'github' && source.ref ? `${source.url}@${source.ref}` : source.url;
    for (const layer of layers) {
        const hit = layer.deny.find((r) => ruleMatches(r, source, 'deny', ctx));
        if (hit) return { allowed: false, reason: 'DENIED', scope: layer.scope, rule: hit, source: shown };
    }
    for (const layer of layers) {
        if (layer.allow === undefined) continue;
        if (!layer.allow.some((r) => ruleMatches(r, source, 'allow', ctx))) {
            return { allowed: false, reason: layer.broken ? 'POLICY_INVALID' : 'NOT_ALLOWED', scope: layer.scope, source: shown };
        }
    }
    if (input.arbitraryUrlInstall === 'catalog-only' && CATALOG_ONLY_ACTIONS.has(action)
        && (source.kind === 'github' || source.kind === 'archive') && !isCatalogMember(source, catalogs)) {
        return { allowed: false, reason: 'CATALOG_ONLY', source: shown };
    }
    return { allowed: true };
}

// ── 정책 해석(I/O) ──────────────────────────────────────────────────────────────

export interface ExtensionSourcePolicyDeps {
    /** 활성 조직 층 — 조직이 없거나 정책이 없으면 undefined. 조회 실패는 예외 */
    loadOrgLayer: (userId: string | undefined) => Promise<ExtensionSourcePolicyLayer | undefined>;
    /** 등록(enabled) 카탈로그 — 실패는 예외 */
    loadCatalogs: () => Promise<CatalogRef[]>;
    /** 거절 감사 기록 — 실패는 삼킨다 */
    audit: (userId: string | undefined, action: ExtensionSourceAction, verdict: Extract<SourceVerdict, { allowed: false }>) => Promise<void>;
}

const defaultDeps: ExtensionSourcePolicyDeps = {
    loadOrgLayer: async (userId) => {
        const { resolveEffectivePolicyStrict } = await import('../org/effective-policy');
        return (await resolveEffectivePolicyStrict(userId)).extensionSource;
    },
    loadCatalogs: async () => {
        const { ExtensionCatalogRepository } = await import('../../data/repositories/extension-catalog-repository');
        const { getPool } = await import('../../data/models/unified-database');
        return (await new ExtensionCatalogRepository(getPool()).listEnabled()).map((c) => ({ id: c.id, url: c.url, plugins: c.plugins }));
    },
    audit: async (userId, action, verdict) => {
        const { getAuditService } = await import('../AuditService');
        await getAuditService().logAudit({
            action: 'extension.source_blocked',
            userId,
            resourceType: 'extension_source',
            resourceId: verdict.source,
            details: { action, reason: verdict.reason, scope: verdict.scope, rule: verdict.rule },
        });
    },
};

/** 사용자별 마지막으로 적용한 조직 층(undefined = 조직 층 없음) — 조회 실패 시 유지할 값 */
const lastOrgLayer = new Map<string, ExtensionSourcePolicyLayer | undefined>();
const ANON_KEY = '';

/** 테스트용 */
export function resetExtensionSourcePolicyState(): void {
    lastOrgLayer.clear();
}

export interface ExtensionSourceGate {
    /** PURE(해석된 정책 위): 원본 판정. 식별 불가 원본은 허용(설치 엔진이 INVALID_GIT_URL 로 네트워크 전에 거절) */
    evaluate(req: { url: string; ref?: string | null; action: ExtensionSourceAction; gitFirst?: boolean }): SourceVerdict;
}

export interface LoadExtensionSourceGateOptions {
    /**
     * 강제 플래그와 무관하게 해석한다 — 관리자 정책 미리보기(M3)가 "켜면 무엇이 막히는지"를 **같은 판정**으로 보여 주는 길.
     * 실제 설치 경로는 이 옵션을 쓰지 않는다(강제 OFF = 종전 동작).
     */
    force?: boolean;
}

/** 정책을 한 번 해석해 여러 원본을 판정한다(카탈로그 동기화의 항목 프로브). 강제 OFF 면 null(`force` 면 그래도 해석). */
export async function loadExtensionSourceGate(
    userId: string | undefined,
    deps: ExtensionSourcePolicyDeps = defaultDeps,
    opts: LoadExtensionSourceGateOptions = {},
): Promise<ExtensionSourceGate | null> {
    if (!EXTENSION_SOURCE_POLICY_SETTINGS.enforced && !opts.force) return null;
    const layers: ExtensionSourcePolicyLayer[] = [];
    const globalLayer = EXTENSION_SOURCE_POLICY_SETTINGS.globalLayer;
    if (globalLayer) layers.push(globalLayer);
    const key = userId ?? ANON_KEY;
    let unavailable = false;
    try {
        const org = await deps.loadOrgLayer(userId);
        lastOrgLayer.set(key, org);
        if (org) layers.push(org);
    } catch (e) {
        if (lastOrgLayer.has(key)) {
            logger.warn(`조직 원본 정책 조회 실패 — 마지막으로 적용한 정책 유지 (user=${key || '-'}):`, e);
            const prev = lastOrgLayer.get(key);
            if (prev) layers.push(prev);
        } else {
            logger.warn(`조직 원본 정책 조회 실패 — 적용 이력이 없어 거절 (user=${key || '-'}):`, e);
            unavailable = true;
        }
    }
    const mode = EXTENSION_SOURCE_POLICY_SETTINGS.arbitraryUrlInstall;
    const needsCatalogs = mode === 'catalog-only' || layers.some((l) => (l.allow ?? []).some((r) => r.type === 'catalog'));
    let catalogs: CatalogRef[] = [];
    if (needsCatalogs && !unavailable) {
        try { catalogs = await deps.loadCatalogs(); } catch (e) { logger.warn('카탈로그 목록 조회 실패 — 등록 원본 없음으로 판정:', e); }
    }
    return {
        evaluate(req) {
            const source = describeExtensionSource(req.url, { ref: req.ref, gitFirst: req.gitFirst });
            if (!source) return { allowed: true };
            if (unavailable) return { allowed: false, reason: 'POLICY_UNAVAILABLE', source: source.url };
            return evaluateExtensionSource({ source, action: req.action, layers, catalogs, arbitraryUrlInstall: mode });
        },
    };
}

/** 판정이 거절이면 감사 기록 후 ExtensionSourceBlockedError(403) */
export async function rejectIfBlocked(userId: string | undefined, action: ExtensionSourceAction, verdict: SourceVerdict, deps: ExtensionSourcePolicyDeps = defaultDeps): Promise<void> {
    if (verdict.allowed) return;
    const { allowed: _a, ...detail } = verdict;
    logger.warn(`확장 원본 거절: ${detail.reason} ${detail.source} (action=${action}, user=${userId ?? '-'})`);
    try { await deps.audit(userId, action, verdict); } catch (e) { logger.warn('원본 거절 감사 기록 실패:', e); }
    throw new ExtensionSourceBlockedError(detail);
}

export interface CatalogSourcePolicyInput { userId?: string; action: 'catalog-register' | 'catalog-sync' }

/**
 * 카탈로그 등록·동기화 — 카탈로그 원본을 판정(거절이면 403)하고, 같은 해석본으로 교차 저장소 항목 판정기를 돌려준다
 * (동기화가 막힌 항목 저장소에 프로브 요청을 보내지 않게). 강제 OFF 면 undefined.
 */
export async function checkCatalogSource(url: string, policy: CatalogSourcePolicyInput, deps: ExtensionSourcePolicyDeps = defaultDeps): Promise<((entryUrl: string) => boolean) | undefined> {
    const gate = await loadExtensionSourceGate(policy.userId, deps);
    if (!gate) return undefined;
    await rejectIfBlocked(policy.userId, policy.action, gate.evaluate({ url, action: policy.action }), deps);
    return (entryUrl) => gate.evaluate({ url: entryUrl, action: 'entry' }).allowed;
}

/**
 * 설치 엔진 진입부의 단일 검사 — 네트워크·파일 작업 **전에** 부른다. 강제 OFF 면 아무 것도 하지 않는다(종전 동작).
 */
export async function assertExtensionSourceAllowed(
    req: { url: string; ref?: string | null; userId?: string; action: ExtensionSourceAction; gitFirst?: boolean },
    deps: ExtensionSourcePolicyDeps = defaultDeps,
): Promise<void> {
    const gate = await loadExtensionSourceGate(req.userId, deps);
    if (!gate) return;
    await rejectIfBlocked(req.userId, req.action, gate.evaluate(req), deps);
}
