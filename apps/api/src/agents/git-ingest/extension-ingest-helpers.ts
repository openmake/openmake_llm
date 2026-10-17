/**
 * ExtensionIngestService 의 순수 헬퍼 — fetcher 생성, add-on 매니페스트 로드, 스킬 경로 수집·import,
 * 설치 리포트 경고, 기존 설치 행 → ImportResult 변환. extension-ingest-service.ts 에서 분리 (동작 동일).
 *
 * @module agents/git-ingest/extension-ingest-helpers
 */
import { LocalDirectoryFetcher, isLocalSourceUrl } from './local-directory-fetcher';
import type { GitFetcher, TreeEntry } from './git-fetcher';
import { ArchiveFetcher } from './archive-fetcher';
import { InternalBundleFetcher, isInternalBundleUrl, type LoadedBundle } from './internal-bundle-fetcher';
import { detectUnsupportedComponents } from './repo-scanner';
import type { ExtensionManifest } from './extension-manifest-validator';
import { ADDON_MANIFEST_FILENAME, parseInstallableAddonManifest } from '../../addon-host/manifest';
import { APP_VERSION, EXTENSION_INGEST } from '../../config/constants';
import { discoverSkillPaths, symlinkedSkillPaths } from './extension-discovery';
import type { GitIngestService } from './git-ingest-service';
import type {
    SkillInstallResult,
    AgentInstallResult,
    McpServerInstallResult,
    ImportResult,
} from './extension-ingest-types';

/** git 이 아닌 소스(.zip 아카이브 · 내부 번들 · 로컬 디렉터리) fetcher 생성 — GitFetcher 동형 (duck-typed). */
export function makeNonGitFetcher(
    url: string,
    opts: {
        archiveFetcherFactory?: (url: string) => GitFetcher;
        internalBundleLoader?: (id: string) => Promise<LoadedBundle | null>;
    },
): GitFetcher {
    if (isLocalSourceUrl(url)) {
        // 서버 파일시스템을 읽는 소스 — 루트 고정(realpath)·관리자 전용(import 에서 게이트).
        return new LocalDirectoryFetcher(url, {
            root: EXTENSION_INGEST.localSourceRoot,
            maxEntries: EXTENSION_INGEST.localSourceMaxEntries,
            maxTotalBytes: EXTENSION_INGEST.localSourceMaxTotalBytes,
        }) as unknown as GitFetcher;
    }
    if (isInternalBundleUrl(url)) {
        const loader = opts.internalBundleLoader;
        if (!loader) throw new Error('INTERNAL_BUNDLE_UNSUPPORTED: internalBundleLoader 미주입');
        return new InternalBundleFetcher(url, loader) as unknown as GitFetcher;
    }
    if (opts.archiveFetcherFactory) return opts.archiveFetcherFactory(url);
    return new ArchiveFetcher(url, {
        maxArchiveBytes: EXTENSION_INGEST.archiveMaxBytes,
        maxEntries: EXTENSION_INGEST.archiveMaxEntries,
        maxTotalBytes: EXTENSION_INGEST.archiveMaxTotalBytes,
    }) as unknown as GitFetcher;
}

/**
 * (4-1) 번들이 Add-on 매니페스트를 동봉했으면 내장 add-on 과 같은 계약으로 검증한다 (없으면 종전 그대로).
 * 동봉했으면 permissions 를 deny-by-default 로 집행한다(미동봉 = undefined = 종전 동작).
 */
export async function loadBundledAddonManifest(
    fetcher: GitFetcher,
    src: { owner: string; repo: string; sha: string; entries: TreeEntry[]; root: string },
): Promise<{ addonPermissions: readonly string[] | undefined; addonScope: string | undefined }> {
    const addonManifestPath = `${src.root}${ADDON_MANIFEST_FILENAME}`; // root 는 '' 또는 '/' 로 끝난다
    let addonPermissions: readonly string[] | undefined;
    let addonScope: string | undefined;
    if (src.entries.some(e => e.path === addonManifestPath)) {
        const addonRaw = await fetcher.fetchFile(src.owner, src.repo, src.sha, addonManifestPath, EXTENSION_INGEST.manifestMaxBytes);
        const parsedAddon = parseInstallableAddonManifest(addonRaw, APP_VERSION);
        if (parsedAddon.errors.length > 0) throw new Error(`INVALID_ADDON_MANIFEST: ${parsedAddon.errors.join('; ')}`);
        addonPermissions = parsedAddon.manifest?.permissions ?? [];
        addonScope = parsedAddon.manifest?.scope;
    }
    return { addonPermissions, addonScope };
}

/** (5-c) 이 환경이 설치하지 않는 구성요소 — 조용히 무시하지 않고 리포트한다 */
export function pushManifestWarnings(entries: TreeEntry[], root: string, manifest: ExtensionManifest, warnings: string[]): void {
    const unsupported = detectUnsupportedComponents(entries, root, manifest.raw);
    if (unsupported.length > 0) {
        warnings.push(`UNSUPPORTED_COMPONENTS: ${unsupported.join(', ')} — 이 환경에 대응 개념이 없어 설치되지 않았습니다`);
    }
    // plugin.json mcpServers 항목 단위 사유 (설치는 나머지 항목으로 계속)
    if (manifest.mcpWarnings.length > 0) {
        warnings.push(`MCP_ENTRIES_SKIPPED: ${manifest.mcpWarnings.join('; ')}`);
    }
}

/** (6-a) skills — 기본 레이아웃 + plugin.json `skills` 경로 필드 + 루트 컨테이너 폴백 (extension-discovery) */
export function collectSkillPaths(entries: TreeEntry[], root: string, skillPathsField: string[], warnings: string[]): string[] {
    let skillPaths = discoverSkillPaths(entries, root, skillPathsField);
    const symlinked = symlinkedSkillPaths(entries, root);
    if (symlinked.length > 0) {
        warnings.push(`SKILL_SYMLINK_SKIPPED: git 심링크라 설치 불가 — ${symlinked.join(', ')}`);
    }
    if (skillPaths.length > EXTENSION_INGEST.maxSkillsPerExtension) {
        warnings.push(`SKILLS_TRUNCATED: ${skillPaths.length}개 중 ${EXTENSION_INGEST.maxSkillsPerExtension}개만 설치`);
        skillPaths = skillPaths.slice(0, EXTENSION_INGEST.maxSkillsPerExtension);
    }
    return skillPaths;
}

/** 스킬 경로마다 GitIngestService.import 체인 (기존 draft 파이프라인 재사용) — 경로 단위 실패는 결과에 기록 */
export async function importSkillPaths(
    skillService: GitIngestService,
    skillPaths: string[],
    src: { userId: string; isAdmin: boolean; gitUrl: string; sha: string; accessToken?: string },
): Promise<SkillInstallResult[]> {
    const skillResults: SkillInstallResult[] = [];
    for (const path of skillPaths) {
        try {
            const r = await skillService.import({
                userId: src.userId,
                isAdmin: src.isAdmin,
                gitUrl: src.gitUrl,
                gitRef: src.sha,
                gitPath: path,
                accessToken: src.accessToken,
                target: 'user',
            });
            if ('selectionRequired' in r && r.selectionRequired) {
                // explicit gitPath 라 도달 불가하지만 방어
                skillResults.push({ path, error: 'unexpected multi-candidate' });
            } else {
                skillResults.push({
                    path, skillId: r.skillId, name: r.name, deduped: r.deduped,
                    ...(r.compatNotes.length > 0 ? { compatNotes: r.compatNotes } : {}),
                });
            }
        } catch (e) {
            skillResults.push({ path, error: e instanceof Error ? e.message : String(e) });
        }
    }
    return skillResults;
}

/** dedupe hit 시 기존 설치 레코드를 ImportResult shape 로 변환. */
export function shapeFromRow(
    row: {
        id: string; name: string; version: string; description: string | null;
        source_url: string; source_ref: string; source_path: string;
        manifest: Record<string, unknown>;
    },
    deduped: boolean,
): ImportResult {
    const components = (row.manifest?.components ?? {}) as {
        skills?: SkillInstallResult[];
        mcpServers?: McpServerInstallResult[];
        agents?: AgentInstallResult[];
    };
    return {
        extensionId: row.id,
        name: row.name,
        version: row.version,
        description: row.description ?? '',
        status: 'active',
        source: 'git-url',
        gitUrl: row.source_url,
        gitRef: row.source_ref,
        gitPath: row.source_path,
        skills: components.skills ?? [],
        agents: components.agents ?? [],
        mcpServers: components.mcpServers ?? [],
        validationWarnings: [],
        deduped,
    };
}
