/**
 * 카탈로그 스냅샷 (admin 큐레이션 갤러리) — 소스 URL 의 플러그인 목록 + 설치 가능성 사전 판정.
 *
 * ExtensionIngestService.fetchCatalogSnapshot 의 구현부 (600줄 파일 가드 분할, 2026-08-16).
 * marketplace.json 이 있으면 그 목록, 없으면 plugin.json 스캔(상위 10개) 결과.
 * 설치는 하지 않는다 (extension_catalog_sources.plugins 스냅샷용).
 *
 * installable 판정 (동기화 시점 사전 계산 — UI 는 설치 가능만 노출):
 *   ① 플러그인 경로에 skills(/skill)/SKILL.md 존재
 *   ② .mcp.json / mcp.json 존재
 *   ③ 매니페스트(plugin.json 등)에 mcpServers 선언
 *   커스텀 명령(commands/)만 있는 플러그인은 설치 구성요소가 없어 false.
 *   교차 저장소 엔트리는 accessToken 있을 때만 대상 repo 를 프로브한다
 *   (무인증 GitHub API 60/hr 실측 — 토큰 없으면 판정 미상 유지).
 *
 * @module agents/git-ingest/catalog-snapshot
 */
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import type { GitFetcher, TreeEntry } from './git-fetcher';
import { isArchiveUrl, archivePseudoRepo } from './archive-fetcher';
import { scanForExtensionManifests, scanForMarketplaceManifests, resolveExtensionRoot } from './repo-scanner';
import { validateExtensionManifest, parseMarketplaceFile } from './extension-manifest-validator';
import { EXTENSION_INGEST } from '../../config/constants';

export interface CatalogSnapshot {
    name: string;
    description: string | null;
    plugins: Array<{ name: string; description?: string; version?: string; installable?: boolean; category?: string; description_ko?: string }>;
}

export interface CatalogSnapshotDeps {
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
    /** .zip 아카이브 소스용 fetcher (ExtensionIngestService.makeArchiveFetcher 위임) */
    archiveFetcherFor: (url: string) => GitFetcher;
}

type ExternalRepoCache = Map<string, { sha: string; treeEntries: TreeEntry[] | null } | 'notfound' | 'error'>;

export async function fetchCatalogSnapshot(
    deps: CatalogSnapshotDeps,
    url: string,
    accessToken?: string,
): Promise<CatalogSnapshot> {
    const isArchive = isArchiveUrl(url);
    const parsed = isArchive ? archivePseudoRepo(url) : parseGitUrl(url);
    if (!parsed) throw new Error(`INVALID_GIT_URL: ${url}`);
    const fetcher = isArchive ? deps.archiveFetcherFor(url) : deps.fetcherFactory({ accessToken });
    const sha = await fetcher.resolveRef(parsed.owner, parsed.repo, 'HEAD');

    // tree 는 있으면 skills/.mcp.json 판정에 사용 (거대 repo 는 실패 허용 — 매니페스트 판정만)
    let treeEntries: TreeEntry[] | null = null;

    // (a) marketplace.json 표준 경로 직접 조회 — 거대 repo 의 listTree 상한(maxTreeEntries)
    //     우회 (jeremylongshore 22,982 blobs 실측). 실패 시 tree 스캔 폴백.
    let marketplace: ReturnType<typeof parseMarketplaceFile> | null = null;
    for (const mkPath of ['.claude-plugin/marketplace.json', 'marketplace.json']) {
        try {
            const mkRaw = await fetcher.fetchFile(parsed.owner, parsed.repo, sha, mkPath, EXTENSION_INGEST.marketplaceMaxBytes);
            const mk = parseMarketplaceFile(mkRaw);
            if (mk.ok) { marketplace = mk; break; }
        } catch {
            /* 해당 경로 없음 — 다음 후보/폴백 */
        }
    }
    if (!marketplace) {
        const tree = await fetcher.listTree(parsed.owner, parsed.repo, sha, EXTENSION_INGEST.maxTreeEntries);
        treeEntries = tree.entries;
        const mkCandidates = scanForMarketplaceManifests(tree.entries);
        if (mkCandidates.length > 0) {
            const mkRaw = await fetcher.fetchFile(parsed.owner, parsed.repo, sha, mkCandidates[0].path, EXTENSION_INGEST.marketplaceMaxBytes);
            const mk = parseMarketplaceFile(mkRaw);
            if (mk.ok) marketplace = mk;
        }
    }

    if (marketplace?.ok) {
        if (!treeEntries) {
            try {
                treeEntries = (await fetcher.listTree(parsed.owner, parsed.repo, sha, EXTENSION_INGEST.maxTreeEntries)).entries;
            } catch {
                /* 거대 repo — 매니페스트 기반 판정만 수행 */
            }
        }
        const entries = marketplace.marketplace.plugins;
        const enriched: Array<{ name: string; description?: string; installable?: boolean; category?: string }> = [];
        // 교차 저장소 repo 별 resolveRef/listTree 재사용 캐시 (한 sync 실행 한정)
        const externalCache: ExternalRepoCache = new Map();
        // 소규모 동시성 배치 — raw fetch 위주라 rate limit 부담 낮음
        const BATCH = 8;
        for (let i = 0; i < entries.length; i += BATCH) {
            const batch = entries.slice(i, i + BATCH);
            const results = await Promise.all(batch.map(async (p) => {
                // 교차 저장소 엔트리 — 토큰 있으면 대상 repo 프로브, 없으면 판정 미상 유지
                if (p.url) {
                    const p2 = parseGitUrl(p.url);
                    if (p2 && (p2.owner !== parsed.owner || p2.repo !== parsed.repo)) {
                        if (!accessToken) return { name: p.name, description: p.description, category: p.category };
                        const installable = await probeExternalEntry(fetcher, p2.owner, p2.repo, p.ref, p.path, externalCache);
                        return installable === undefined
                            ? { name: p.name, description: p.description, category: p.category }
                            : { name: p.name, description: p.description, installable, category: p.category };
                    }
                }
                const prefix = p.path ? `${p.path}/` : '';
                const installable = await probeInstallableAt(fetcher, parsed.owner, parsed.repo, sha, prefix, treeEntries);
                return { name: p.name, description: p.description, installable, category: p.category };
            }));
            enriched.push(...results);
        }
        return { name: marketplace.marketplace.name, description: null, plugins: enriched };
    }

    // marketplace 없음 — plugin.json/gemini-extension.json 후보 스캔 (상위 10개)
    if (!treeEntries) {
        treeEntries = (await fetcher.listTree(parsed.owner, parsed.repo, sha, EXTENSION_INGEST.maxTreeEntries)).entries;
    }
    const candidates = scanForExtensionManifests(treeEntries).slice(0, 10);
    if (candidates.length === 0) {
        throw new Error(`NO_EXTENSION_FOUND: 소스에 marketplace.json/plugin.json 없음 (${url})`);
    }
    const plugins: CatalogSnapshot['plugins'] = [];
    for (const c of candidates) {
        try {
            const raw = await fetcher.fetchFile(parsed.owner, parsed.repo, sha, c.path, EXTENSION_INGEST.manifestMaxBytes);
            const v = validateExtensionManifest(raw);
            if (v.ok) {
                const root = resolveExtensionRoot(c.path);
                const skillPat = buildSkillDiscoveryPattern(root);
                const installable = v.manifest.mcpServers.length > 0
                    || treeEntries.some(e => skillPat.test(e.path) || e.path === `${root}.mcp.json` || e.path === `${root}mcp.json`);
                plugins.push({ name: v.manifest.name, description: v.manifest.description, version: v.manifest.version, installable });
            }
        } catch {
            /* 개별 후보 실패 — 건너뜀 */
        }
    }
    if (plugins.length === 0) throw new Error(`NO_EXTENSION_FOUND: 유효한 plugin.json 없음 (${url})`);
    return {
        name: plugins[0].name,
        description: plugins[0].description ?? null,
        plugins,
    };
}

/**
 * 플러그인 경로(prefix)의 설치 가능성 프로브 — 판정 규칙 ①②③.
 * treeEntries 가 없으면(거대 repo) 매니페스트 mcpServers 검사만 수행.
 */
async function probeInstallableAt(
    fetcher: GitFetcher,
    owner: string,
    repo: string,
    sha: string,
    prefix: string,
    treeEntries: TreeEntry[] | null,
): Promise<boolean> {
    if (treeEntries) {
        const skillPat = buildSkillDiscoveryPattern(prefix);
        if (treeEntries.some(e =>
            skillPat.test(e.path) || e.path === `${prefix}.mcp.json` || e.path === `${prefix}mcp.json`)) {
            return true;
        }
    }
    // 매니페스트의 mcpServers 선언 검사 (raw 직접 조회)
    for (const mp of [`${prefix}.claude-plugin/plugin.json`, `${prefix}plugin.json`, `${prefix}gemini-extension.json`]) {
        try {
            const raw = await fetcher.fetchFile(owner, repo, sha, mp, EXTENSION_INGEST.manifestMaxBytes);
            const v = validateExtensionManifest(raw);
            return v.ok && v.manifest.mcpServers.length > 0;  // 매니페스트를 찾았으면 다음 경로 시도 불필요
        } catch {
            /* 해당 경로 없음 — 다음 후보 */
        }
    }
    return false;
}

/**
 * 교차 저장소 marketplace 엔트리 판정 — 대상 repo 를 resolveRef+listTree 후 동일 규칙 프로브.
 * repo@ref 단위 캐시로 같은 외부 repo 를 가리키는 엔트리 간 API 호출 재사용.
 * 반환: true/false = 판정 확정, undefined = 판정 미상(일시 오류 등 — 노출 유지).
 */
async function probeExternalEntry(
    fetcher: GitFetcher,
    owner: string,
    repo: string,
    ref: string | undefined,
    path: string | undefined,
    cache: ExternalRepoCache,
): Promise<boolean | undefined> {
    const key = `${owner}/${repo}@${ref ?? 'HEAD'}`;
    let resolved = cache.get(key);
    if (!resolved) {
        try {
            const extSha = await fetcher.resolveRef(owner, repo, ref ?? 'HEAD');
            let extTree: TreeEntry[] | null = null;
            try {
                extTree = (await fetcher.listTree(owner, repo, extSha, EXTENSION_INGEST.maxTreeEntries)).entries;
            } catch {
                /* 거대 repo — 매니페스트 기반 판정만 수행 */
            }
            resolved = { sha: extSha, treeEntries: extTree };
        } catch (e) {
            resolved = e instanceof Error && e.message.startsWith('REPO_NOT_FOUND') ? 'notfound' : 'error';
        }
        cache.set(key, resolved);
    }
    if (resolved === 'notfound') return false;  // 삭제/비공개 repo — 설치 불가 확정
    if (resolved === 'error') return undefined; // 일시 오류 — 판정 미상 유지
    try {
        const prefix = path ? `${path}/` : '';
        return await probeInstallableAt(fetcher, owner, repo, resolved.sha, prefix, resolved.treeEntries);
    } catch {
        return undefined;
    }
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 확장 루트 기준 SKILL.md 탐지 패턴 (순수 함수 — 테스트용 export).
 * 매칭: skills/<dir>/SKILL.md (Agent Plugins v1) · skill/SKILL.md (Qwen-MM-Plugins 등
 * 단수 레이아웃) · skills/SKILL.md. 하위 디렉토리 중첩은 1단계까지만.
 */
export function buildSkillDiscoveryPattern(root: string): RegExp {
    return new RegExp(`^${escapeRegExp(root)}skills?/(?:[^/]+/)?SKILL\\.md$`, 'i');
}
