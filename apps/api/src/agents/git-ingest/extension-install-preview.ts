/**
 * 확장 설치 미리보기(M1b, 마켓플레이스 계획 v3.7) — **쓰기 없음 · LLM 미호출** 정적 경로.
 *
 * 실제 설치(`ExtensionIngestService.import`)와 **같은 함수**로 원본을 풀고 구성요소를 고른다:
 *   원본 해석·정책(M2) `resolveExtensionSource` → 스킬 경로 `collectSkillPaths` → 명령·에이전트 `planCommandPaths`·`planAgentPaths`
 *   → 번들 파일 `planSkillAssetCandidates` → MCP 항목 `planMcpEntries`·권한 집행 `mcpNetworkDecision` → 스킬 검증·적응 `prepareSkillContent`
 *   → MCP 정적 검사 `checkMcpServerStatic`(설치의 차단 판정과 같은 룰 — LLM 단계는 참고용이라 차단에 관여하지 않는다).
 * 그래서 "미리보기에 보인 구성요소 = 설치가 만드는 Draft 구성요소" 다(extension-install-preview.db.test 가 고정).
 *
 * DB 는 같은 이름의 기존 설치를 **읽기만** 한다(업데이트 여부·권한 재승인 판정). 저장소 행·Draft·감사 기록을 만들지 않는다.
 *
 * @module agents/git-ingest/extension-install-preview
 */
import type { Pool } from 'pg';
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import { resolveExtensionSource, isSelectionRequired, type SourceResolverDeps } from './extension-source-resolver';
import { pushManifestWarnings, collectSkillPaths } from './extension-ingest-helpers';
import {
    planCommandPaths, planAgentPaths, planSkillAssetCandidates, planMcpEntries, mcpNetworkDecision,
    screenAssetCandidate, type ComponentContext,
} from './extension-components';
import { prepareSkillContent } from './git-ingest-service';
import { commandFileToSkillMarkdown, agentFileToCustomAgent } from './plugin-component-compat';
import { checkMcpServerStatic, isBlockedByConvention, type ConventionFinding } from './convention-checker';
import { collectPlaceholderEnvKeys } from '../../tool-contract/env-placeholder';
import { evaluatePermissionState } from '../../services/extensions/permission-state';
import { UserExtensionRepository } from '../../data/repositories/user-extension-repository';
import { getMcpInstallHints, type McpInstallHint } from '../../runtime-ports/mcp-install-hints';
import { ADDON_PERMISSIONS } from '../../config/addon-permissions';
import { EXTENSION_SECURITY } from '../../config/extension-security';
import { extensionRemoteMcpEnabled } from '../../config/extension-remote-mcp';
import { checkRemoteMcpUrlStatic } from '../../services/extensions/remote-mcp-registration';
import { UNSUPPORTED_AGENT_FIELDS } from '../../config/skill-compat';
import { SKILL_CREATOR } from '../../config/constants';
import type { ImportInput, CandidateListResult } from './extension-ingest-types';

export interface PreviewSkill {
    path: string;
    /** 검증·적응 뒤 저장될 스킬 이름 */
    name?: string;
    description?: string;
    fromCommand?: boolean;
    /** 설치 시 적응(호환 안내) 요약 */
    compatNotes?: string[];
    /** 함께 보존될 번들 파일 후보(상대 경로) — 내용 검사(바이너리 혼입)는 설치 때 한 번 더 한다 */
    assets?: string[];
    /** 이 항목이 설치되지 않는 이유(검증 실패 등) */
    error?: string;
}

export interface PreviewMcpServer {
    name: string;
    transportType: string;
    command?: string;
    url?: string;
    /** 정적 룰 판정 — 설치되면 차단 표시(blockedByConvention)가 붙는 서버 */
    blockedByConvention: boolean;
    findings: ConventionFinding[];
    /** 권한(network:internet) 없이 들어와 `--network none` 샌드박스로 저장된다 */
    networkRestricted: boolean;
    /** 승인 때 값을 입력해야 하는 env 키(자리표시자) */
    requiredEnv: string[];
    /** 전송 퇴역·원격 인증 등 안내 — MCP 런타임 add-on 이 없으면 빈 배열 */
    hints: McpInstallHint[];
    /** 설치에서 빠지는 이유(권한 없음·재승인 필요) */
    excluded?: string;
    /** 원격 관리 등록(EXTENSION_REMOTE_MCP_ENABLED) — 선언 URL 고정, 승인 뒤 OAuth 로그인으로 연결 */
    remoteRegistration?: { urlLocked: true; auth: 'oauth' };
}

export interface PreviewAgent {
    path: string;
    name: string;
    /** 저장 예정 이름(`<확장>-<이름>`) — 같은 이름이 이미 있으면 설치 때 접미사가 붙을 수 있다 */
    plannedName: string;
    description?: string;
    /** 승인함 승인 뒤 사용(EXTENSION_AGENT_APPROVAL_REQUIRED) */
    requiresApproval: boolean;
    ignoredFields?: string[];
    error?: string;
}

export interface ExtensionInstallPreview {
    extension: { name: string; version: string; description: string };
    /** 원본 — 실제로 구성요소를 읽는 저장소·커밋·매니페스트 경로 */
    source: { url: string; requestedUrl: string; commit: string; path: string; trackingRef: string | null };
    /** 설치할 커밋(source.commit 과 같다 — 계획서 응답 형식) */
    commit: string;
    components: { skills: PreviewSkill[]; mcpServers: PreviewMcpServer[]; agents: PreviewAgent[] };
    permissions: {
        /** 번들이 요청한 권한 — openmake-addon.json 미동봉이면 null(집행 없음, 종전 동작) */
        requested: string[] | null;
        /** 이전 승인 범위를 넘어 재승인 전까지 막히는 권한(업데이트) */
        blocked: string[];
        /** 설치 뒤 권한 상태 */
        state: string;
    };
    /** 같은 이름의 기존 설치 — 같은 원본이면 업데이트, 다른 원본이면 설치가 거절된다 */
    existingInstall: { extensionId: string; version: string; sameSource: boolean; upToDate: boolean } | null;
    warnings: string[];
}

export interface PreviewDeps extends SourceResolverDeps {
    pool: Pool;
}

const SKILL_FILE_MAX = (): number => SKILL_CREATOR.gitMaxFileSize ?? 262144;

export async function previewExtensionInstall(
    deps: PreviewDeps,
    input: ImportInput,
): Promise<ExtensionInstallPreview | CandidateListResult> {
    const resolved = await resolveExtensionSource(deps, input);
    if (isSelectionRequired(resolved)) return resolved;
    const { fetcher, isArchive, owner, repo, sha, tree, candidate, effectiveGitUrl, effectiveTrackingRef, manifest, root, addonPermissions, warnings } = resolved;

    // 같은 이름의 기존 설치 — 읽기만(업데이트 판정·권한 재승인 대조). 설치의 (5) 단계와 같은 규칙
    const existing = await new UserExtensionRepository(deps.pool).findActiveByName(input.userId, manifest.name);
    let existingInstall: ExtensionInstallPreview['existingInstall'] = null;
    let updateTarget = null as typeof existing;
    if (existing) {
        const prevParsed = isArchive ? null : parseGitUrl(existing.source_url);
        const sameSource = isArchive
            ? existing.source_url === effectiveGitUrl
            : !!(prevParsed && prevParsed.owner === owner && prevParsed.repo === repo);
        existingInstall = { extensionId: existing.id, version: existing.version, sameSource, upToDate: sameSource && existing.source_ref === sha };
        if (sameSource) updateTarget = existing;
        else warnings.push(`EXTENSION_ALREADY_INSTALLED: "${manifest.name}" 이 다른 소스(${existing.source_url})로 이미 설치됨 — 먼저 제거해야 설치할 수 있습니다`);
    }

    const permission = evaluatePermissionState({
        state: updateTarget ? (updateTarget.permission_state ?? 'legacy_unreviewed') : null,
        granted: updateTarget?.permissions_granted ?? null,
        requested: addonPermissions ?? null,
    });
    if (permission.blocked.length > 0) warnings.push(`PERMISSION_REVIEW_REQUIRED: ${permission.blocked.join(', ')} — 이전에 승인한 범위보다 넓어 재승인 전까지 막힙니다`);

    pushManifestWarnings(tree.entries, root, manifest, warnings);

    const ctx: Omit<ComponentContext, 'pool' | 'userId' | 'isAdmin' | 'gitUrl' | 'manifestPath' | 'extensionName'> = {
        fetcher, owner, repo, sha, tree, root, warnings,
        ...(permission.effective !== undefined ? { addonPermissions: permission.effective, blockedPermissions: permission.blocked } : {}),
        commandPaths: manifest.commandPaths,
        mcpServersPath: manifest.mcpServersPath,
    };

    // 스킬 — SKILL.md 와 commands/*.md(스킬로 변환) 모두 설치와 같은 검증·적응
    const skills: PreviewSkill[] = [];
    for (const path of collectSkillPaths(tree.entries, root, manifest.skillPaths, warnings)) {
        skills.push(await previewSkill(ctx, path, undefined));
    }
    for (const path of planCommandPaths(ctx)) {
        skills.push(await previewSkill(ctx, path, 'command'));
    }
    for (const s of skills) {
        if (s.error) continue;
        const assets: string[] = [];
        let total = 0;
        for (const c of await planSkillAssetCandidates(ctx, s)) {
            const screen = screenAssetCandidate(c, total, s.name ?? s.path);
            if (screen.warning) warnings.push(screen.warning);
            if (screen.action === 'skip') continue;
            if (screen.action === 'stop') break;
            assets.push(c.relPath);
            total += c.entry.size;
        }
        if (assets.length > 0) s.assets = assets;
    }
    const adapted = skills.filter(s => s.compatNotes && s.compatNotes.length > 0);
    if (adapted.length > 0) warnings.push(`SKILLS_ADAPTED: ${adapted.length}개 스킬에 호환 안내 주입 (${adapted.map(s => s.name ?? s.path).join(', ')})`);

    // MCP 서버 — 정적 룰만(LLM 미호출), 권한 집행은 설치와 같은 판정
    const { networkAllowed, networkNeedsReview } = mcpNetworkDecision(ctx);
    const mcpServers: PreviewMcpServer[] = (await planMcpEntries(ctx, manifest.mcpServers)).map(entry => {
        const findings = checkMcpServerStatic({ command: entry.command, args: entry.args });
        // 원격 관리 등록(opt-in EXTENSION_REMOTE_MCP_ENABLED) — 네트워크 없는 정적 검사만(형식·https·URL 자격증명).
        // 호스트(SSRF) 확인은 설치·승인에서 한다(미리보기는 쓰기·네트워크 없음).
        const remoteManaged = networkAllowed && entry.transportType !== 'stdio' && extensionRemoteMcpEnabled();
        const remoteStatic = remoteManaged ? checkRemoteMcpUrlStatic(entry.url) : null;
        const excluded = !networkAllowed && entry.transportType !== 'stdio'
            ? (networkNeedsReview ? `PERMISSION_REVIEW_REQUIRED: ${ADDON_PERMISSIONS.NETWORK_INTERNET} 재승인 필요` : `PERMISSION_DENIED: ${ADDON_PERMISSIONS.NETWORK_INTERNET} 권한 없음`)
            : remoteStatic && !remoteStatic.ok ? `${remoteStatic.code}: ${remoteStatic.reason}` : undefined;
        return {
            name: entry.name,
            transportType: entry.transportType,
            ...(entry.command ? { command: entry.command } : {}),
            ...(entry.url ? { url: entry.url } : {}),
            blockedByConvention: isBlockedByConvention(findings),
            findings,
            networkRestricted: !networkAllowed && entry.transportType === 'stdio',
            requiredEnv: collectPlaceholderEnvKeys(entry.env),
            hints: getMcpInstallHints({ name: entry.name, transportType: entry.transportType, url: entry.url ?? null, command: entry.command ?? null }),
            ...(excluded ? { excluded } : {}),
            ...(remoteStatic?.ok ? { remoteRegistration: { urlLocked: true as const, auth: 'oauth' as const } } : {}),
        };
    });

    // Custom Agent — 본문이 시스템 프롬프트
    const agents: PreviewAgent[] = [];
    for (const path of planAgentPaths(ctx)) {
        try {
            const raw = await fetcher.fetchFile(owner, repo, sha, path, SKILL_FILE_MAX());
            const parsed = agentFileToCustomAgent(path, raw);
            const ignoredFields = Object.keys(parsed.upstreamFields).filter(k => k in UNSUPPORTED_AGENT_FIELDS).map(k => UNSUPPORTED_AGENT_FIELDS[k]);
            agents.push({
                path, name: parsed.name,
                plannedName: `${manifest.name}-${parsed.name}`.slice(0, 100),
                ...(parsed.description ? { description: parsed.description } : {}),
                requiresApproval: EXTENSION_SECURITY.AGENT_APPROVAL_REQUIRED,
                ...(ignoredFields.length > 0 ? { ignoredFields } : {}),
                ...(!parsed.systemPrompt || parsed.systemPrompt.length < 10 ? { error: '시스템 프롬프트가 비어있음' } : {}),
            });
        } catch (e) {
            agents.push({ path, name: path, plannedName: path, requiresApproval: EXTENSION_SECURITY.AGENT_APPROVAL_REQUIRED, error: e instanceof Error ? e.message : String(e) });
        }
    }

    const installable = skills.some(s => !s.error) || mcpServers.some(m => !m.excluded) || agents.some(a => !a.error);
    if (!installable) warnings.push('NO_COMPONENTS_INSTALLED: 설치 가능한 구성요소가 없어 설치가 실패합니다');

    return {
        extension: { name: manifest.name, version: manifest.version, description: manifest.description ?? '' },
        source: { url: effectiveGitUrl, requestedUrl: input.gitUrl, commit: sha, path: candidate.path, trackingRef: effectiveTrackingRef },
        commit: sha,
        components: { skills, mcpServers, agents },
        permissions: { requested: permission.requested, blocked: permission.blocked, state: permission.next },
        existingInstall,
        warnings,
    };
}

/** 스킬 한 건 — 설치(GitIngestService.import)와 같은 검증·적응. 실패는 항목 error 로(설치에서도 그 항목만 빠진다) */
async function previewSkill(
    ctx: Pick<ComponentContext, 'fetcher' | 'owner' | 'repo' | 'sha'>,
    path: string,
    kind: 'command' | undefined,
): Promise<PreviewSkill> {
    const fromCommand = kind === 'command' ? { fromCommand: true } : {};
    try {
        const raw = await ctx.fetcher.fetchFile(ctx.owner, ctx.repo, ctx.sha, path, SKILL_FILE_MAX());
        const content = kind === 'command' ? commandFileToSkillMarkdown(path, raw).content : raw;
        const { validation, adapted } = await prepareSkillContent(content, path, ctx.repo, []);
        return {
            path, name: validation.manifest.name,
            ...(validation.manifest.description ? { description: validation.manifest.description } : {}),
            ...fromCommand,
            ...(adapted.notes.length > 0 ? { compatNotes: adapted.notes } : {}),
        };
    } catch (e) {
        return { path, ...fromCommand, error: e instanceof Error ? e.message : String(e) };
    }
}
