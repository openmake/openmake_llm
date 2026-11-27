/**
 * 조직 소유 확장 설치(마켓플레이스 계획 v3.5 P8, opt-in EXTENSION_ORG_OWNED_INSTALL_ENABLED, 212).
 *
 * 소유자가 사람 대신 **조직**이다 — user_id NULL + owner_org_id. 설치한 관리자가 조직을 떠나거나 계정이 삭제돼도
 * 행이 남고(사용자 삭제의 CASCADE 대상이 아니다), 수정·업데이트·제거는 그 조직의 관리자 누구나 한다.
 *
 * 권한: security/authorize.assertCanAccess('org_extension', …) 한 곳(config/resource-policy). 요청자의 **활성 조직**
 * (멤버십으로 검증된 값)만 조직 컨텍스트가 된다 — 임의 org_id 를 받지 않는다.
 *
 * 설치는 설치 엔진과 **같은 원본 해석**(`ExtensionIngestService.resolveSource` — 원본 정책(M2)·URL 해석·매니페스트 검증,
 * 쓰기·LLM 없음)으로 원본·커밋(OCI 는 digest)을 고정하고 조직 소유 행 하나를 만든다. 구성요소는 만들지 않는다 —
 * 행은 조직의 갤러리 항목이고(visibility='organization', org_id = 소유 조직), 멤버는 종전 갤러리 설치로 자기 계정에 설치한다.
 * 모든 변경은 감사 기록(AuditService)을 남긴다.
 *
 * @module services/extensions/org-owned-install
 */
import * as crypto from 'crypto';
import type { Pool } from 'pg';
import { assertCanAccess, type AccessContext } from '../../security/authorize';
import { AppError } from '../../utils/error-handler';
import { createLogger } from '../../utils/logger';
import { ORG_OWNED_LIST_LIMIT } from '../../config/extension-org-owned';
import { OrgOwnedExtensionRepository, ORG_OWNED_NAME_CONFLICT, type OrgOwnedExtensionRow, type OrgOwnedSourceInput } from '../../data/repositories/org-owned-extension-repository';
import type { ResolvedExtensionSource } from '../../agents/git-ingest/extension-source-resolver';
import type { CandidateListResult, ImportInput } from '../../agents/git-ingest/extension-ingest-types';
import type { OrgContext } from '../org/membership-cache';
import type { AuditAction } from '../../config/audit-actions';

const logger = createLogger('OrgOwnedExtensionInstall');

export const ORG_OWNED_ERROR_CODES = {
    NO_ACTIVE_ORG: 'ORG_OWNED_NO_ACTIVE_ORG',
    NOT_FOUND: 'ORG_OWNED_NOT_FOUND',
    NAME_CONFLICT: ORG_OWNED_NAME_CONFLICT,
    SELECTION_REQUIRED: 'ORG_OWNED_SELECTION_REQUIRED',
    SOURCE_FAILED: 'ORG_OWNED_SOURCE_FAILED',
} as const;

export interface OrgOwnedActor {
    userId: string;
    role: string | null | undefined;
}

export interface OrgOwnedInstallInput {
    gitUrl: string;
    gitRef?: string;
    gitPath?: string;
    plugin?: string;
    /** 비공개 원본 토큰 — 요청 한정(DB 미저장) */
    accessToken?: string;
}

export interface OrgOwnedDeps {
    pool: Pool;
    /** 설치 엔진의 원본 해석(쓰기·LLM 없음) */
    resolveSource: (input: ImportInput) => Promise<ResolvedExtensionSource | CandidateListResult>;
    activeOrg: (userId: string) => Promise<OrgContext | null>;
    audit: (input: { action: AuditAction; userId: string; resourceId: string; details: Record<string, unknown> }) => Promise<void>;
}

/** 원본 해석 실패 — 정책 거절(403) 등 AppError 는 그대로, 그 밖(원격 조회·매니페스트)은 400 */
async function resolveOr400(deps: OrgOwnedDeps, input: ImportInput): Promise<ResolvedExtensionSource | CandidateListResult> {
    try {
        return await deps.resolveSource(input);
    } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(`원본 해석 실패: ${err instanceof Error ? err.message : String(err)}`, 400, true, ORG_OWNED_ERROR_CODES.SOURCE_FAILED);
    }
}

function isCandidateList(r: ResolvedExtensionSource | CandidateListResult): r is CandidateListResult {
    return 'selectionRequired' in r && r.selectionRequired === true;
}

async function accessContext(deps: OrgOwnedDeps, actor: OrgOwnedActor): Promise<AccessContext & { org: OrgContext | null }> {
    const org = await deps.activeOrg(actor.userId);
    return { userId: actor.userId, role: actor.role, orgId: org?.orgId ?? null, orgRole: org?.orgRole ?? null, org };
}

/** 원본 해석 결과 → 저장 값(source_hash 는 조직 축) */
function sourceInput(orgId: string, r: ResolvedExtensionSource): OrgOwnedSourceInput {
    const sourceHash = 'sha256:' + crypto.createHash('sha256')
        .update(JSON.stringify({ org: orgId, url: r.effectiveGitUrl, sha: r.sha, path: r.candidate.path }))
        .digest('hex');
    return {
        name: r.manifest.name,
        version: r.manifest.version,
        description: r.manifest.description ?? null,
        sourceUrl: r.effectiveGitUrl,
        sourceRef: r.sha,
        sourcePath: r.candidate.path,
        sourceHash,
        trackingRef: r.effectiveTrackingRef,
        manifest: {
            plugin: r.manifest.raw,
            orgOwned: true,
            warnings: r.warnings,
            ...(r.addonPermissions !== undefined ? { addonPermissions: r.addonPermissions } : {}),
        },
    };
}

function rethrowConflict(err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith(`${ORG_OWNED_NAME_CONFLICT}:`)) {
        throw new AppError('같은 이름의 조직 소유 확장이 이미 있습니다', 409, true, ORG_OWNED_ERROR_CODES.NAME_CONFLICT);
    }
    throw err;
}

export async function listOrgOwnedExtensions(deps: OrgOwnedDeps, actor: OrgOwnedActor): Promise<OrgOwnedExtensionRow[]> {
    const ctx = await accessContext(deps, actor);
    if (!ctx.org) return [];
    assertCanAccess('org_extension', 'read', { ownerId: null, orgId: ctx.org.orgId }, ctx);
    return new OrgOwnedExtensionRepository(deps.pool).listForOrg(ctx.org.orgId, ORG_OWNED_LIST_LIMIT);
}

export async function installOrgOwnedExtension(
    deps: OrgOwnedDeps,
    actor: OrgOwnedActor,
    input: OrgOwnedInstallInput,
): Promise<OrgOwnedExtensionRow | CandidateListResult> {
    const ctx = await accessContext(deps, actor);
    if (!ctx.org) throw new AppError('활성 조직이 없습니다 — 조직을 선택한 뒤 설치하세요', 400, true, ORG_OWNED_ERROR_CODES.NO_ACTIVE_ORG);
    // 설치 = 그 조직 자원에 대한 쓰기(원본 해석·네트워크 전에 판정)
    assertCanAccess('org_extension', 'write', { ownerId: null, orgId: ctx.org.orgId }, ctx);
    const resolved = await resolveOr400(deps, {
        userId: actor.userId,
        isAdmin: false,           // local:// 같은 관리자 전용 원본은 열지 않는다
        gitUrl: input.gitUrl,
        gitRef: input.gitRef,
        gitPath: input.gitPath,
        plugin: input.plugin,
        accessToken: input.accessToken,
    });
    if (isCandidateList(resolved)) return resolved;
    let row: OrgOwnedExtensionRow;
    try {
        row = await new OrgOwnedExtensionRepository(deps.pool).insert(ctx.org.orgId, actor.userId, sourceInput(ctx.org.orgId, resolved));
    } catch (err) {
        rethrowConflict(err);
    }
    await deps.audit({
        action: 'extension.org_owned_installed', userId: actor.userId, resourceId: row.id,
        details: { orgId: ctx.org.orgId, name: row.name, version: row.version, sourceUrl: row.source_url, sourceRef: row.source_ref },
    });
    logger.info(`조직 소유 설치: ${row.id} "${row.name}@${row.version}" org=${ctx.org.orgId} by=${actor.userId}`);
    return row;
}

async function loadForWrite(deps: OrgOwnedDeps, actor: OrgOwnedActor, id: string, action: 'write' | 'delete') {
    const row = await new OrgOwnedExtensionRepository(deps.pool).getById(id);
    if (!row) throw new AppError('조직 소유 확장이 없습니다', 404, true, ORG_OWNED_ERROR_CODES.NOT_FOUND);
    const ctx = await accessContext(deps, actor);
    // 다른 조직의 행은 존재도 드러내지 않는다(읽기 권한이 없으면 404)
    try {
        assertCanAccess('org_extension', 'read', { ownerId: null, orgId: row.owner_org_id }, ctx);
    } catch {
        throw new AppError('조직 소유 확장이 없습니다', 404, true, ORG_OWNED_ERROR_CODES.NOT_FOUND);
    }
    assertCanAccess('org_extension', action, { ownerId: null, orgId: row.owner_org_id }, ctx);
    return row;
}

/** 업데이트 — 같은 원본(추적 ref)을 다시 풀어 커밋/digest 가 바뀌었으면 갱신. 같으면 upToDate */
export async function updateOrgOwnedExtension(
    deps: OrgOwnedDeps,
    actor: OrgOwnedActor,
    id: string,
    opts: { accessToken?: string } = {},
): Promise<{ row: OrgOwnedExtensionRow; upToDate: boolean; previousRef: string; previousVersion: string }> {
    const row = await loadForWrite(deps, actor, id, 'write');
    const previousRef = row.source_ref;
    const previousVersion = row.version;
    const resolved = await resolveOr400(deps, {
        userId: actor.userId,
        isAdmin: false,
        gitUrl: row.source_url,
        gitRef: row.tracking_ref ?? undefined,
        gitPath: row.source_path,
        plugin: row.name,
        accessToken: opts.accessToken,
    });
    if (isCandidateList(resolved)) throw new AppError('plugin.json 후보가 모호합니다', 400, true, ORG_OWNED_ERROR_CODES.SELECTION_REQUIRED);
    if (resolved.sha === previousRef) return { row, upToDate: true, previousRef, previousVersion };
    const next = sourceInput(row.owner_org_id, resolved);
    let updated: OrgOwnedExtensionRow | null;
    try {
        updated = await new OrgOwnedExtensionRepository(deps.pool).updateSource(row.id, row.owner_org_id, { ...next, name: row.name });
    } catch (err) {
        rethrowConflict(err);
    }
    if (!updated) throw new AppError('조직 소유 확장이 없습니다', 404, true, ORG_OWNED_ERROR_CODES.NOT_FOUND);
    await deps.audit({
        action: 'extension.org_owned_updated', userId: actor.userId, resourceId: row.id,
        details: { orgId: row.owner_org_id, fromRef: previousRef, toRef: updated.source_ref, fromVersion: previousVersion, toVersion: updated.version },
    });
    return { row: updated, upToDate: false, previousRef, previousVersion };
}

export async function removeOrgOwnedExtension(deps: OrgOwnedDeps, actor: OrgOwnedActor, id: string): Promise<OrgOwnedExtensionRow> {
    const row = await loadForWrite(deps, actor, id, 'delete');
    const removed = await new OrgOwnedExtensionRepository(deps.pool).remove(row.id, row.owner_org_id);
    if (!removed) throw new AppError('조직 소유 확장이 없습니다', 404, true, ORG_OWNED_ERROR_CODES.NOT_FOUND);
    await deps.audit({
        action: 'extension.org_owned_removed', userId: actor.userId, resourceId: row.id,
        details: { orgId: row.owner_org_id, name: row.name, version: row.version },
    });
    return removed;
}
