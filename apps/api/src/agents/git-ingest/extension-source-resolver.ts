/**
 * 확장 원본 해석 — 설치(`ExtensionIngestService.import`)와 설치 미리보기(M1b)가 **같은 함수**로 원본을 푼다.
 *
 * URL 해석 → 원본 정책(M2) → ref·tree → marketplace 엔트리·매니페스트 후보 → plugin.json 검증 → 동봉 Add-on 매니페스트까지.
 * DB 를 읽거나 쓰지 않는다(미리보기의 읽기 전용 보장). 종전 import() 의 (1)~(4-1) 단계를 그대로 옮긴 것이라
 * 설치 동작은 바뀌지 않는다.
 *
 * @module agents/git-ingest/extension-source-resolver
 */
import { createLogger } from '../../utils/logger';
import { isLocalSourceUrl } from './local-directory-fetcher';
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import type { GitFetcher, TreeEntry } from './git-fetcher';
import { isNonGitSourceUrl, nonGitPseudoRepo } from './internal-bundle-fetcher';
import { scanForExtensionManifests, scanForMarketplaceManifests, resolveExtensionRoot, type ManifestCandidate } from './repo-scanner';
import { validateExtensionManifest, parseMarketplaceFile, type ExtensionManifest } from './extension-manifest-validator';
import {
    findExtensionManifestPath,
    synthesizedManifestPath,
    isSynthesizedManifestPath,
    rootOfSynthesizedPath,
} from './extension-discovery';
import { loadBundledAddonManifest } from './extension-ingest-helpers';
import { catalogRootPrefix, underPrefix } from './catalog-snapshot';
import { EXTENSION_INGEST } from '../../config/constants';
import { assertExtensionSourceAllowed } from '../../services/extensions/source-policy';
import type { ImportInput, CandidateListResult } from './extension-ingest-types';

const logger = createLogger('ExtensionIngestService');

/** 해석이 끝난 확장 원본 — 설치·미리보기가 같은 값으로 구성요소를 모은다. */
export interface ResolvedExtensionSource {
    fetcher: GitFetcher;
    isArchive: boolean;
    owner: string;
    repo: string;
    sha: string;
    tree: { entries: TreeEntry[] };
    candidate: ManifestCandidate;
    /** 실제 구성요소를 읽는 저장소 URL(marketplace 엔트리가 다른 저장소를 가리키면 그 URL) */
    effectiveGitUrl: string;
    effectiveTrackingRef: string | null;
    manifest: ExtensionManifest;
    /** 확장 루트 prefix ('' 또는 'dir/') */
    root: string;
    addonPermissions: readonly string[] | undefined;
    addonScope: string | undefined;
    /** 해석 단계 경고(합성 매니페스트 등) — 구성요소 수집이 이어서 push 한다 */
    warnings: string[];
}

export interface SourceResolverDeps {
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
    /** git 이 아닌 소스(.zip · internal:// · local:// · oci://) fetcher — OCI 사설 레지스트리는 accessToken */
    makeArchiveFetcher: (url: string, source?: { accessToken?: string }) => GitFetcher;
}

export async function resolveExtensionSource(
    deps: SourceResolverDeps,
    input: ImportInput,
): Promise<ResolvedExtensionSource | CandidateListResult> {
    if (!EXTENSION_INGEST.enabled) {
        throw new Error('EXTENSION_INGEST_DISABLED');
    }

    // 로컬 디렉터리 소스는 관리자만 — 임의 서버 경로 읽기를 일반 사용자에게 열지 않는다(에어갭 운영용).
    if (isLocalSourceUrl(input.gitUrl) && !input.isAdmin) {
        throw new Error('LOCAL_SOURCE_ADMIN_ONLY: 로컬 디렉터리 설치는 관리자만 가능합니다');
    }
    // 확장 원본 정책(M2, opt-in) — 어떤 네트워크·파일 작업보다 먼저. 채팅 도구·갤러리·카탈로그·내부 게시·업데이트·미리보기 공통 진입점
    await assertExtensionSourceAllowed({ url: input.gitUrl, ref: input.gitRef, userId: input.userId, action: 'install' });

    // (1) URL parse — .zip 아카이브 URL 은 pseudo repo (ArchiveFetcher 가 owner/repo 무시)
    const isArchive = isNonGitSourceUrl(input.gitUrl);
    const parsed = isArchive ? nonGitPseudoRepo(input.gitUrl) : parseGitUrl(input.gitUrl);
    if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.gitUrl}`);
    let { owner, repo } = parsed;
    // marketplace 엔트리가 다른 저장소/고정 ref 를 가리킬 수 있어 effective 값으로 관리
    let effectiveGitUrl = input.gitUrl;
    // 아카이브는 ref 개념이 없음 — tracking_ref=null, 업데이트 확인은 재다운로드 해시 비교
    let effectiveTrackingRef: string | null = isArchive ? null : (input.gitRef ?? null);

    // (2) fetcher — 아카이브면 safeFetch 기반 ArchiveFetcher (SSRF 가드 + 압축 폭탄 방어)
    const fetcher = isArchive
        ? deps.makeArchiveFetcher(input.gitUrl, { accessToken: input.accessToken })
        : deps.fetcherFactory({ accessToken: input.accessToken });
    let sha = await fetcher.resolveRef(owner, repo, input.gitRef ?? 'HEAD');

    // (3) tree
    let tree = await fetcher.listTree(owner, repo, sha, EXTENSION_INGEST.maxTreeEntries);
    let candidate: ManifestCandidate | undefined;
    // plugin.json 이 없는 마켓 엔트리 — 엔트리 메타로 매니페스트를 합성한다 (상류 규격상 plugin.json 은 선택.
    // 공식 마켓 receipts·session-report·anthropics/skills 실사례). candidate.path 는 가상 경로.
    let synthesized: { name: string; description?: string } | undefined;

    // (3-a) marketplace.json 인덱스 (gitPath 미지정 시) — Claude Code 마켓플레이스 저장소
    // 카탈로그 하위 경로(M4) — 그 디렉터리를 카탈로그 루트로 본다(스냅샷과 같은 규칙). 없으면 저장소 루트
    const catalogRoot = catalogRootPrefix(input.catalogSubpath);
    if (!input.gitPath) {
        const mkCandidates = scanForMarketplaceManifests(underPrefix(tree.entries, catalogRoot));
        if (mkCandidates.length > 0) {
            const mkRaw = await fetcher.fetchFile(owner, repo, sha, mkCandidates[0].path, EXTENSION_INGEST.marketplaceMaxBytes);
            const mk = parseMarketplaceFile(mkRaw);
            // 플러그인이 하나뿐인 마켓플레이스는 고를 것이 없다 — 그 하나로 해석한다(이름 추측·치환이 아니다).
            // 카탈로그 갤러리는 단일 플러그인 원본에 plugin 을 싣지 않아, 종전엔 "플러그인 이름을 지정하세요 — 가능: X" 로 막혔다
            const plugin = input.plugin
                ?? (mk.ok && mk.marketplace.plugins.length === 1 ? mk.marketplace.plugins[0].name : undefined);
            if (mk.ok && !plugin) {
                // 목록만 반환 — plugin 인자로 재호출 유도
                return {
                    gitUrl: input.gitUrl,
                    gitRef: sha,
                    candidates: [],
                    totalCandidates: mk.marketplace.plugins.length,
                    selectionRequired: true,
                    marketplace: {
                        name: mk.marketplace.name,
                        plugins: mk.marketplace.plugins.map(p => ({ name: p.name, description: p.description })),
                    },
                };
            }
            if (mk.ok && plugin) {
                const entry = mk.marketplace.plugins.find(p => p.name === plugin);
                if (!entry) {
                    throw new Error(`PLUGIN_NOT_IN_MARKETPLACE: "${plugin}" — 가능한 플러그인: ${mk.marketplace.plugins.map(p => p.name).join(', ')}`);
                }
                // 다른 저장소를 가리키는 엔트리 (git-subdir url)
                if (entry.url) {
                    const p2 = parseGitUrl(entry.url);
                    if (p2 && (p2.owner !== owner || p2.repo !== repo)) {
                        // 항목의 실제 원본도 검사 — 카탈로그만 허용한 정책이 교차 저장소 항목으로 우회되지 않게(재조회 전에)
                        await assertExtensionSourceAllowed({ url: entry.url, userId: input.userId, action: 'entry' });
                        owner = p2.owner;
                        repo = p2.repo;
                        effectiveGitUrl = entry.url;
                    }
                }
                // 고정 ref (릴리스 태그) 또는 저장소 변경 시 tree 재조회. 이름 설치(M5)는 고정 커밋 sha 가 ref 보다 우선
                const pinnedRef = (input.pinEntrySha && entry.sha) || entry.ref;
                if (pinnedRef || effectiveGitUrl !== input.gitUrl) {
                    sha = await fetcher.resolveRef(owner, repo, pinnedRef ?? 'HEAD');
                    tree = await fetcher.listTree(owner, repo, sha, EXTENSION_INGEST.maxTreeEntries);
                }
                if (pinnedRef) effectiveTrackingRef = pinnedRef;
                // 같은 저장소 항목은 카탈로그 루트 기준, 다른 저장소 항목은 그 저장소 루트 기준
                const entryRoot = effectiveGitUrl === input.gitUrl ? catalogRoot : '';
                const prefix = `${entryRoot}${entry.path ? `${entry.path}/` : ''}`;
                // plugin.json > gemini-extension.json (단일 소스 경로·카탈로그 판정과 같은 우선순위)
                const manifestPath = findExtensionManifestPath(tree.entries, prefix);
                const pj = manifestPath ? tree.entries.find(e => e.path === manifestPath) : undefined;
                if (pj) {
                    candidate = { path: pj.path, sha: pj.sha, size: pj.size };
                } else {
                    synthesized = { name: entry.name, description: entry.description };
                    candidate = { path: synthesizedManifestPath(prefix), sha: '', size: 0 };
                }
                logger.info(`marketplace plugin resolved: ${plugin} → ${owner}/${repo}@${sha.slice(0, 7)}:${candidate.path}${synthesized ? ' (합성)' : ''}`);
            }
            // mk 파싱 실패 → 일반 plugin.json 스캔으로 폴백
        }
    }

    // (3-a2) 합성 설치본의 재설치 (갤러리 — source_path 가 가상 경로): 이름은 호출측 plugin > 루트 디렉토리명 > repo
    if (!candidate && input.gitPath && isSynthesizedManifestPath(input.gitPath)) {
        const synthRoot = rootOfSynthesizedPath(input.gitPath);
        const dirName = synthRoot.replace(/\/$/, '').split('/').pop();
        synthesized = { name: input.plugin ?? (dirName || repo) };   // 루트('') 설치본은 repo 이름
        candidate = { path: input.gitPath, sha: '', size: 0 };
    }

    // (3-b) 일반 plugin.json 스캔 (marketplace 미해당)
    if (!candidate) {
        const candidates = scanForExtensionManifests(tree.entries, input.gitPath);
        if (candidates.length === 0) {
            // 잘못된 gitPath 로 마켓플레이스 분기를 우회한 경우 — plugin 인자 사용을 안내해
            // 도구 루프 내 자가 교정 유도 (2026-08-16 라이브 실측: 모델이 gitPath 를 지어냄)
            const mk = scanForMarketplaceManifests(tree.entries);
            if (mk.length > 0) {
                throw new Error(`NO_EXTENSION_FOUND: 해당 gitPath 에 plugin.json 없음. 이 저장소는 마켓플레이스(.claude-plugin/marketplace.json)입니다 — gitPath 대신 plugin 인자로 플러그인 이름을 지정해 재호출하세요. 예: import_extension_from_git({ gitUrl: "${input.gitUrl}", plugin: "<플러그인 이름>" }) (gitPath/gitRef 는 생략)`);
            }
            throw new Error(`NO_EXTENSION_FOUND: tree 에 plugin.json 후보 없음 (gitUrl=${input.gitUrl}, ref=${sha})`);
        }
        if (candidates.length > 1 && !input.gitPath) {
            return {
                gitUrl: input.gitUrl,
                gitRef: sha,
                candidates,
                totalCandidates: candidates.length,
                selectionRequired: true,
            };
        }
        candidate = candidates[0];
    }

    const warnings: string[] = [];

    // (4) plugin.json fetch + validate (합성이면 같은 스키마로 엔트리 메타를 검증 — name 정규화 포함)
    const manifestRaw = synthesized
        ? JSON.stringify({ name: synthesized.name, version: '0.0.0', description: synthesized.description })
        : await fetcher.fetchFile(owner, repo, sha, candidate.path, EXTENSION_INGEST.manifestMaxBytes);
    const validation = validateExtensionManifest(manifestRaw);
    if (!validation.ok) {
        throw new Error(`INVALID_EXTENSION_MANIFEST: ${validation.errors.join('; ')}`);
    }
    const manifest = validation.manifest;
    const root = synthesized ? rootOfSynthesizedPath(candidate.path) : resolveExtensionRoot(candidate.path);
    if (synthesized) warnings.push('MANIFEST_SYNTHESIZED: plugin.json 이 없어 마켓플레이스 엔트리 메타로 설치');

    // (4-1) 번들 동봉 Add-on 매니페스트 검증 — permissions 는 deny-by-default 집행 (extension-ingest-helpers)
    const { addonPermissions, addonScope } = await loadBundledAddonManifest(fetcher, { owner, repo, sha, entries: tree.entries, root });

    return {
        fetcher, isArchive, owner, repo, sha, tree, candidate,
        effectiveGitUrl, effectiveTrackingRef, manifest, root,
        addonPermissions, addonScope, warnings,
    };
}

/** 해석 결과가 후보 목록(선택 필요)인지 */
export function isSelectionRequired(r: ResolvedExtensionSource | CandidateListResult): r is CandidateListResult {
    return 'selectionRequired' in r && r.selectionRequired === true;
}
