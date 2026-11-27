/**
 * ExtensionIngestService — Git URL → plugin.json (Agent Plugins v1) 확장 번들 설치.
 *
 * 흐름:
 *   1. parseGitUrl → owner/repo
 *   2. fetcher.resolveRef → sha
 *   3. fetcher.listTree → tree
 *   4. scanForExtensionManifests → candidates ((multi) selectionRequired 조기 반환)
 *   5. fetchFile plugin.json → validateExtensionManifest
 *   6. dedupe(source_hash) + active 설치 상한 + 동명 active 설치 충돌 검사
 *   7. 구성요소 수집:
 *      - skills:  <root>skills/<dir>/SKILL.md → GitIngestService.import 체인 (기존 draft 파이프라인 재사용)
 *      - mcp:     plugin.json mcpServers > <root>mcp.json — ConventionChecker.checkMcpServer 후
 *                 McpServerDraftRepository.insertDraft (draft + enabled=false + user_private 3중 잠금)
 *   8. user_extensions INSERT + 구성요소 extension_id 링크
 *
 * 구성요소는 각자 기존 draft→approve 라이프사이클을 그대로 따른다 — 이 서비스는
 * 번들 단위 설치/기록만 담당하고 새 승인 경로를 만들지 않는다.
 *
 * @module agents/git-ingest/extension-ingest-service
 */
import * as crypto from 'crypto';
import type { Pool } from 'pg';
import type { LLMClient } from '../../llm/client';
import { createLogger } from '../../utils/logger';
import { recordExtensionInstallation } from '../../services/addon/addon-state';
import { isLocalSourceUrl } from './local-directory-fetcher';
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import { GitFetcher } from './git-fetcher';
import { isNonGitSourceUrl, nonGitPseudoRepo, type LoadedBundle } from './internal-bundle-fetcher';
import { fetchCatalogSnapshot as fetchCatalogSnapshotImpl, type CatalogSnapshot } from './catalog-snapshot';
import { translateCatalogDescriptions } from './catalog-translator';
// 기존 import 경로 호환 재노출 (테스트 등이 이 모듈에서 import)
export { buildSkillDiscoveryPattern } from './catalog-snapshot';
import { validateExtensionManifest } from './extension-manifest-validator';
import { resolveExtensionSource, isSelectionRequired, type SourceResolverDeps } from './extension-source-resolver';
import { previewExtensionInstall, type ExtensionInstallPreview } from './extension-install-preview';
import {
    collectCommandSkills,
    collectPluginAgents,
    collectSkillAssets,
    collectMcpDrafts,
    type ComponentContext,
} from './extension-components';
import { GitIngestService } from './git-ingest-service';
import {
    makeNonGitFetcher,
    pushManifestWarnings,
    collectSkillPaths,
    importSkillPaths,
    shapeFromRow,
} from './extension-ingest-helpers';
import { UserExtensionRepository } from '../../data/repositories/user-extension-repository';
import { evaluatePermissionState } from '../../services/extensions/permission-state';
import { listLinkedMcpServerIds, releaseLinkedMcpServers } from '../../services/extensions/release-linked-mcp';
import { EXTENSION_INGEST, SKILL_CREATOR } from '../../config/constants';
import { EXTENSION_SECURITY } from '../../config/extension-security';
import { assertExtensionSourceAllowed, checkCatalogSource, type CatalogSourcePolicyInput } from '../../services/extensions/source-policy';

const logger = createLogger('ExtensionIngestService');

// 공개 타입은 extension-ingest-types.ts 로 분리 — 기존 import 경로 호환 위해 재노출
import type {
    ImportInput,
    SkillInstallResult,
    ImportResult,
    UpdateCheckResult,
    CandidateListResult,
} from './extension-ingest-types';

interface ExtensionIngestOptions {
    pool: Pool;
    llmClientFactory: (model: string) => LLMClient;
    fetcherFactory: (opts: { accessToken?: string }) => GitFetcher;
    /** .zip 아카이브 소스용 fetcher (테스트 주입용 — 기본은 ArchiveFetcher) */
    archiveFetcherFactory?: (url: string) => GitFetcher;
    /** 내부 번들(internal://bundle/<id>) 로더 — 갤러리 게시분 설치용. 미주입 시 내부 소스는 실패한다 */
    internalBundleLoader?: (id: string) => Promise<LoadedBundle | null>;
}

export class ExtensionIngestService {
    constructor(private opts: ExtensionIngestOptions) {}

    /** git 이 아닌 소스(.zip 아카이브 · 내부 번들 · 로컬 디렉터리) fetcher 생성 — GitFetcher 동형 (duck-typed). */
    private makeArchiveFetcher(url: string): GitFetcher {
        return makeNonGitFetcher(url, this.opts);
    }

    /** 원본 해석기 의존성 — 설치·미리보기 공용 */
    private resolverDeps(): SourceResolverDeps {
        return { fetcherFactory: this.opts.fetcherFactory, makeArchiveFetcher: (u) => this.makeArchiveFetcher(u) };
    }

    async import(input: ImportInput): Promise<ImportResult | CandidateListResult> {
        // (1)~(4-1) 원본 해석 — 설치 미리보기(M1b)와 같은 함수(extension-source-resolver). DB 를 건드리지 않는다.
        const resolved = await resolveExtensionSource(this.resolverDeps(), input);
        if (isSelectionRequired(resolved)) return resolved;
        const { fetcher, isArchive, owner, repo, sha, tree, candidate, effectiveGitUrl, effectiveTrackingRef, manifest, root, addonPermissions, addonScope, warnings } = resolved;

        // (5) dedupe + 상한 + 동명 충돌
        const sourceHash = 'sha256:' + crypto.createHash('sha256')
            .update(JSON.stringify({ uid: input.userId, url: effectiveGitUrl, sha, path: candidate.path }))
            .digest('hex');
        const extRepo = new UserExtensionRepository(this.opts.pool);

        const existing = await extRepo.findRecentByHash(input.userId, sourceHash, EXTENSION_INGEST.dedupeWindowHours);
        if (existing) {
            logger.info(`extension-ingest dedupe hit: ${existing.id}`);
            return shapeFromRow(existing, true);
        }

        // 동일 이름 active 설치: 같은 소스(같은 repo 또는 같은 아카이브 URL)면 업데이트 모드, 다른 소스면 충돌
        const sameName = await extRepo.findActiveByName(input.userId, manifest.name);
        let updateTarget: typeof sameName = null;
        let approvedBefore: Awaited<ReturnType<typeof extRepo.snapshotApprovedSkills>> = [];
        let approvedAgentsBefore: Awaited<ReturnType<typeof extRepo.snapshotApprovedAgents>> = [];
        if (sameName) {
            const prevParsed = isArchive ? null : parseGitUrl(sameName.source_url);
            const sameSource = isArchive
                ? sameName.source_url === effectiveGitUrl
                : !!(prevParsed && prevParsed.owner === owner && prevParsed.repo === repo);
            if (sameSource) {
                if (sameName.source_ref === sha) {
                    // 이미 최신 — 변경 없음
                    return { ...shapeFromRow(sameName, false), upToDate: true };
                }
                updateTarget = sameName;
                // 회수 전에 승인 상태를 기억한다 — 같은 이름으로 다시 들어온 스킬은 승인·배정을 이어받는다.
                approvedBefore = await extRepo.snapshotApprovedSkills(sameName.id, { withFingerprint: EXTENSION_SECURITY.APPROVAL_FINGERPRINT });
                // Custom Agent 승인 대기 opt-in 일 때만 — 꺼져 있으면 에이전트는 즉시 활성이라 이어받을 승인이 없다
                if (EXTENSION_SECURITY.AGENT_APPROVAL_REQUIRED) approvedAgentsBefore = await extRepo.snapshotApprovedAgents(sameName.id);
                // 회수는 링크를 끊으므로(unlink) 구 MCP 서버 id 를 먼저 받아 둔다 — 회수 뒤 떠 있는 옛 버전 연결을 닫는다.
                const oldMcpServerIds = await listLinkedMcpServerIds(this.opts.pool, sameName.id);
                // ⚠️ 구 구성요소 회수는 **신규 생성 전에** 해야 한다. Custom Agent 는
                // UNIQUE(user_id, name) 이라 구 행이 살아 있으면 신규가 랜덤 suffix 를 달고
                // 생성돼 이름이 업데이트마다 표류한다(사용자가 고르던 에이전트를 잃는다).
                await extRepo.archiveLinkedComponents(sameName.id);
                await releaseLinkedMcpServers(this.opts.pool, sameName.id, input.userId, oldMcpServerIds);
            } else {
                throw new Error(`EXTENSION_ALREADY_INSTALLED: "${manifest.name}" 이 다른 소스(${sameName.source_url})로 이미 설치됨 (${sameName.id}) — 먼저 제거 후 재설치하세요`);
            }
        }

        if (!updateTarget) {
            const activeCount = await extRepo.countActiveForUser(input.userId);
            if (activeCount >= EXTENSION_INGEST.maxPerUser) {
                throw new Error(`EXTENSION_LIMIT_EXCEEDED: ${activeCount}/${EXTENSION_INGEST.maxPerUser}`);
            }
        }

        // (5-b) 권한 상태(190) — 요청 권한을 이전 승인과 대조한다. 초과분만 재승인 전까지 막고 기존 승인 범위는 유지한다. 상태는 확장 행 쓰기와 같은 문장으로 저장한다(user-extension-repository).
        const permission = evaluatePermissionState({ state: updateTarget ? (updateTarget.permission_state ?? 'legacy_unreviewed') : null, granted: updateTarget?.permissions_granted ?? null, requested: addonPermissions ?? null });
        const permissionSave = { state: permission.next, granted: permission.granted, requested: permission.requested, reviewedBy: permission.reviewedNow ? input.userId : null };
        if (permission.blocked.length > 0) warnings.push(`PERMISSION_REVIEW_REQUIRED: ${permission.blocked.join(', ')} — 이전에 승인한 범위보다 넓어 재승인 전까지 막았습니다(설정 → 확장에서 재승인)`);

        // (5-c) 이 환경이 설치하지 않는 구성요소 · 건너뛴 mcpServers 항목 리포트
        pushManifestWarnings(tree.entries, root, manifest, warnings);

        // (6-a) skills — 기본 레이아웃 + plugin.json `skills` 경로 필드 + 루트 컨테이너 폴백 (extension-discovery)
        const skillPaths = collectSkillPaths(tree.entries, root, manifest.skillPaths, warnings);
        const skillService = new GitIngestService({
            pool: this.opts.pool,
            llmClientFactory: this.opts.llmClientFactory,
            // 아카이브 소스면 이미 로드된 동일 ArchiveFetcher 재사용 (재다운로드 방지)
            fetcherFactory: isArchive ? () => fetcher : this.opts.fetcherFactory,
            // 거대 마켓플레이스 repo — 확장 경로 상한으로 재조회 (스킬 ingest 기본 상한이면 REPO_TOO_LARGE)
            maxTreeEntries: EXTENSION_INGEST.maxTreeEntries,
            // 원본 정책은 이 서비스 진입부·항목에서 이미 판정 — 스킬마다(고정 sha ref 로) 다시 판정하지 않는다
            sourcePolicyPrechecked: true,
        });
        const skillResults: SkillInstallResult[] = await importSkillPaths(skillService, skillPaths, {
            userId: input.userId, isAdmin: input.isAdmin, gitUrl: effectiveGitUrl, sha, accessToken: input.accessToken,
        });

        // (6-a2~a3) commands/*.md → 스킬, 스킬 번들 파일 보존 (Phase 2)
        const componentCtx: ComponentContext = {
            pool: this.opts.pool,
            fetcher, owner, repo, sha, tree, root,
            userId: input.userId,
            isAdmin: input.isAdmin,
            accessToken: input.accessToken,
            gitUrl: effectiveGitUrl,
            manifestPath: candidate.path,
            extensionName: manifest.name,
            warnings,
            ...(permission.effective !== undefined ? { addonPermissions: permission.effective, blockedPermissions: permission.blocked } : {}),
            commandPaths: manifest.commandPaths,
            mcpServersPath: manifest.mcpServersPath,
        };
        await collectCommandSkills(componentCtx, skillService, skillResults);
        await collectSkillAssets(componentCtx, skillResults);

        // (6-b) MCP servers — plugin.json mcpServers 우선, 없으면 <root>mcp.json / <root>.mcp.json
        const mcpResults = await collectMcpDrafts(componentCtx, manifest.mcpServers, this.opts.llmClientFactory, manifest.userConfig);

        // (6-c) agents/<name>.md → Custom Agent (Phase 2)
        const agentResults = await collectPluginAgents(componentCtx);

        // 스킬 적응 요약 — 확장 단위 리포트에 합류 (구성요소별 상세는 skills[].compatNotes)
        const adaptedSkills = skillResults.filter(r => r.compatNotes && r.compatNotes.length > 0);
        if (adaptedSkills.length > 0) {
            warnings.push(`SKILLS_ADAPTED: ${adaptedSkills.length}개 스킬에 호환 안내 주입 (${adaptedSkills.map(r => r.name ?? r.path).join(', ')})`);
        }

        // (7) 전 구성요소 실패/부재 검증
        const okSkills = skillResults.filter(r => r.skillId);
        const okServers = mcpResults.filter(r => r.serverId);
        const okAgentResults = agentResults.filter(r => r.agentId);
        if (okSkills.length === 0 && okServers.length === 0 && okAgentResults.length === 0) {
            const detail = [...skillResults, ...mcpResults, ...agentResults]
                .map(r => r.error)
                .filter(Boolean)
                .join('; ');
            throw new Error(`NO_COMPONENTS_INSTALLED: 설치 가능한 구성요소 없음${detail ? ` (${detail})` : ''}`);
        }

        // (8) user_extensions INSERT(신규) 또는 UPDATE(재설치) + 링크
        const componentManifest = {
            plugin: manifest.raw,
            components: { skills: skillResults, mcpServers: mcpResults, agents: agentResults },
            // 설치 리포트 — 미지원 구성요소·건너뛴 MCP 항목·스킬 적응 (상세 UI 노출)
            warnings,
            // 번들이 요청한 권한 원문(마이그레이션 190 백필·재적용의 출처) — 매니페스트 미동봉이면 키 없음
            ...(addonPermissions !== undefined ? { addonPermissions } : {}),
        };
        let row;
        let previousVersion: string | undefined;
        if (updateTarget) {
            previousVersion = updateTarget.version;
            // (구 구성요소 archive 는 위 update 판정 직후 이미 수행됨 — 이름 충돌 회피)
            row = await extRepo.updateAfterReinstall(updateTarget.id, {
                version: manifest.version,
                description: manifest.description ?? null,
                sourceRef: sha,
                sourcePath: candidate.path,
                sourceHash,
                trackingRef: effectiveTrackingRef,
                manifest: componentManifest,
                permission: permissionSave, expected: { state: updateTarget.permission_state, granted: updateTarget.permissions_granted }, // 읽은 뒤 철회됐으면 0행
            });
            if (!row) throw new Error(`EXTENSION_UPDATE_CONFLICT: ${updateTarget.id} — 업데이트 도중 권한 상태가 바뀌었거나 확장이 제거됨, 다시 업데이트하세요`);
        } else {
            row = await extRepo.insert({
                userId: input.userId,
                name: manifest.name,
                version: manifest.version,
                description: manifest.description ?? null,
                sourceUrl: effectiveGitUrl,
                sourceRef: sha,
                sourcePath: candidate.path,
                sourceHash,
                trackingRef: effectiveTrackingRef,
                manifest: componentManifest,
                permission: permissionSave,
            });
        }
        // 매니페스트 scope=organization — **새 설치**만 설치자의 활성 조직 갤러리에 공개한다(업데이트는 소유자가 정한 공개범위를 건드리지 않는다).
        // 구성원은 갤러리에서 각자 설치·승인한다 — 소유권 경계는 user_id 그대로다(조직은 공유 범위를 덧씌우는 축).
        if (!updateTarget && addonScope === 'organization') {
            const { activeOrgFor } = await import('../../services/org/membership-cache');
            const org = await activeOrgFor(input.userId);
            if (org) {
                row = (await extRepo.setVisibility(row.id, input.userId, 'organization', org.orgId)) ?? row;
                warnings.push('ORG_SCOPE_PUBLISHED: 조직 범위 add-on 이라 활성 조직의 갤러리에 공개했습니다. 구성원은 갤러리에서 각자 설치합니다(설정에서 비공개로 바꿀 수 있습니다).');
            } else {
                warnings.push('ORG_SCOPE_NO_ACTIVE_ORG: 조직 범위 add-on 이지만 활성 조직이 없어 개인 설치로 두었습니다. 조직을 선택한 뒤 공개범위를 "조직" 으로 바꾸면 구성원 갤러리에 나옵니다.');
            }
        }

        // 사용법 안내 — 설치한 스킬은 매 턴 자동 주입되지 않는다(프롬프트 팽창·무관한 질의 오염 방지, 2026-08-18).
        // 안내가 없으면 "설치했는데 왜 안 되지" 가 된다(2026-09-20 법무 팩 실전 검증).
        if (!updateTarget && okSkills.length > 0) {
            warnings.push("SKILLS_ON_DEMAND: 설치한 스킬은 승인 후 필요할 때 모델이 불러옵니다. '/스킬이름' 으로 직접 호출할 수 있고, 항상 적용하려면 스킬 화면에서 '내게 배정' 하세요.");
        }

        // 업데이트 — 종전에 승인돼 있던 스킬(같은 이름)은 승인·배정을 이어받는다. MCP 서버는 재승인 대상.
        // opt-in EXTENSION_APPROVAL_FINGERPRINT 면 내용(설명·본문·번들)도 그대로여야 하고, 바뀐 스킬은 재승인 대상이다.
        const requireSameContent = EXTENSION_SECURITY.APPROVAL_FINGERPRINT;
        if (updateTarget && approvedBefore.length > 0) {
            const reinstalled = okSkills.filter(r => r.skillId && r.name).map(r => ({ skillId: r.skillId!, name: r.name! }));
            const carried = await extRepo.carryOverSkillApprovals(reinstalled, approvedBefore, { requireSameContent });
            if (carried.length > 0) warnings.push(`SKILL_APPROVAL_CARRIED: 종전 승인을 이어받은 스킬 ${carried.length}개 (새로 추가${requireSameContent ? '되거나 내용이 바뀐' : '된'} 스킬과 MCP 서버는 승인 대기)`);
            if (requireSameContent) {
                const approvedNames = new Set(approvedBefore.map(s => s.name));
                const carriedIds = new Set(carried);
                const changed = reinstalled.filter(r => approvedNames.has(r.name) && !carriedIds.has(r.skillId)).map(r => r.name);
                if (changed.length > 0) warnings.push(`SKILL_CHANGED_REVIEW: 내용이 바뀌어 다시 승인해야 하는 스킬 ${changed.length}개 — ${changed.join(', ')}`);
            }
        }

        // Custom Agent 승인 대기(opt-in EXTENSION_AGENT_APPROVAL_REQUIRED, 206) — 종전 승인은 스킬과 같은 규칙으로 이어받고
        // 나머지는 승인함에서 승인한다. 옵션이 꺼져 있으면 에이전트는 종전대로 설치 즉시 활성이다.
        if (EXTENSION_SECURITY.AGENT_APPROVAL_REQUIRED) {
            const installedAgents = okAgentResults.filter(r => r.agentId && r.storedName).map(r => ({ agentId: r.agentId!, storedName: r.storedName! }));
            const carriedAgents = updateTarget && approvedAgentsBefore.length > 0
                ? await extRepo.carryOverAgentApprovals(installedAgents, approvedAgentsBefore, { requireSameContent })
                : [];
            const pendingAgents = installedAgents.length - carriedAgents.length;
            if (pendingAgents > 0) warnings.push(`AGENTS_PENDING_APPROVAL: Custom Agent ${pendingAgents}개는 승인함(/approvals)에서 승인한 뒤 사용할 수 있습니다`);
        }

        await extRepo.linkComponents(
            row.id,
            okSkills.map(r => r.skillId!),
            okServers.map(r => r.serverId!),
            okAgentResults.map(r => r.agentId!),
        );

        // 내장 add-on 과 같은 설치 표에 남긴다 — 관리 화면이 내장/설치형을 한 목록으로 본다(S3).
        await recordExtensionInstallation({
            extensionId: row.id, name: manifest.name, version: manifest.version,
            // 소스 구분: internal://bundle(마켓 게시분) · zip/tar 아카이브 · 그 외 Git
            source: input.gitUrl.startsWith('internal://') ? 'marketplace'
                : isLocalSourceUrl(input.gitUrl) ? 'local'
                : (isArchive ? 'zip' : 'git'),
        });

        logger.info(`extension-ingest ${updateTarget ? 'updated' : 'created'}: ${row.id} "${manifest.name}@${manifest.version}"${previousVersion ? ` (from ${previousVersion})` : ''} (${owner}/${repo}@${sha.slice(0, 7)}, skills=${okSkills.length}, mcp=${okServers.length}, agents=${okAgentResults.length})`);
        return {
            extensionId: row.id,
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? '',
            status: 'active',
            source: 'git-url',
            gitUrl: effectiveGitUrl,
            gitRef: sha,
            gitPath: candidate.path,
            skills: skillResults,
            mcpServers: mcpResults,
            agents: agentResults,
            validationWarnings: warnings,
            deduped: false,
            ...(updateTarget ? { updated: true, previousVersion } : {}),
        };
    }

    /**
     * 업데이트 확인 — tracking_ref(NULL=HEAD)를 다시 resolve 해 설치된 source_ref 와 비교.
     * 변경이 있으면 최신 ref 의 plugin.json version 도 조회 (실패 시 null, fail-open).
     */
    /**
     * 설치 미리보기(M1b) — 설치와 같은 함수로 원본·구성요소를 풀되 쓰기·LLM 호출이 없다(extension-install-preview).
     * marketplace 목록·후보 선택은 설치와 같은 `selectionRequired` 응답.
     */
    async preview(input: ImportInput): Promise<ExtensionInstallPreview | CandidateListResult> {
        return previewExtensionInstall({ pool: this.opts.pool, ...this.resolverDeps() }, input);
    }

    async checkForUpdate(input: {
        sourceUrl: string;
        sourcePath: string;
        currentRef: string;
        trackingRef?: string | null;
        accessToken?: string;
        userId?: string;   // 원본 정책(M2) 판정 대상 — 활성 조직 층
    }): Promise<UpdateCheckResult> {
        await assertExtensionSourceAllowed({ url: input.sourceUrl, ref: input.trackingRef, userId: input.userId, action: 'update-check' });
        // 아카이브 소스: 재다운로드 sha256 을 latestRef 로 사용 (내용 변경 감지)
        const isArchive = isNonGitSourceUrl(input.sourceUrl);
        const parsed = isArchive ? nonGitPseudoRepo(input.sourceUrl) : parseGitUrl(input.sourceUrl);
        if (!parsed) throw new Error(`INVALID_GIT_URL: ${input.sourceUrl}`);
        const fetcher = isArchive
            ? this.makeArchiveFetcher(input.sourceUrl)
            : this.opts.fetcherFactory({ accessToken: input.accessToken });
        const latestRef = await fetcher.resolveRef(parsed.owner, parsed.repo, input.trackingRef ?? 'HEAD');
        if (latestRef === input.currentRef) {
            return { updateAvailable: false, currentRef: input.currentRef, latestRef, latestVersion: null };
        }
        let latestVersion: string | null = null;
        try {
            const raw = await fetcher.fetchFile(parsed.owner, parsed.repo, latestRef, input.sourcePath, EXTENSION_INGEST.manifestMaxBytes);
            const validation = validateExtensionManifest(raw);
            if (validation.ok) latestVersion = validation.manifest.version;
        } catch {
            /* 최신 버전 조회 실패 — updateAvailable 판정에는 영향 없음 */
        }
        return { updateAvailable: true, currentRef: input.currentRef, latestRef, latestVersion };
    }

    /**
     * 카탈로그 스냅샷 (admin 큐레이션 갤러리) — catalog-snapshot.ts 위임.
     * 판정 규칙·형식은 그 모듈 doc 참고 (600줄 파일 가드 분할).
     */
    async fetchCatalogSnapshot(url: string, accessToken?: string, policy: CatalogSourcePolicyInput = { action: 'catalog-sync' }, subpath?: string | null): Promise<CatalogSnapshot> {
        // 원본 정책(M2) — 카탈로그 원본은 받기 전에 판정, 교차 저장소 항목은 프로브(네트워크) 전에 같은 해석본으로 판정
        const isEntrySourceAllowed = await checkCatalogSource(url, policy);
        return fetchCatalogSnapshotImpl({
            fetcherFactory: this.opts.fetcherFactory,
            archiveFetcherFor: (u) => this.makeArchiveFetcher(u),
            isEntrySourceAllowed,
        }, url, accessToken, subpath);
    }

    /**
     * 카탈로그 설명 한국어 번역 — catalog-translator.ts 위임 (fail-open, snapshot mutate).
     * previous 를 주면 (name, description) 일치 항목의 기존 번역을 재사용한다.
     */
    async translateCatalogSnapshot(
        snapshot: CatalogSnapshot,
        previous?: Array<{ name: string; description?: string; description_ko?: string }>,
    ): Promise<void> {
        const llm = this.opts.llmClientFactory(SKILL_CREATOR.authorModel);
        await translateCatalogDescriptions(llm, snapshot.plugins, previous);
    }
}
