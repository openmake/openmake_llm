/**
 * 조직 확장 배포 모드 — 조정(reconcile)·제거 판정·응답 장식 (마켓플레이스 계획 v3.7 §8-1).
 *
 * 조정: 멤버의 **활성 조직**에 공개된 항목마다 모드를 해석해(config/extension-org-deployment `resolveDeploymentMode`)
 * default_on·required 이면 그 멤버 계정으로 설치한다. 설치는 갤러리 설치와 같은 엔진(`installSharedExtension`)이라
 * 스킬·MCP 서버는 멤버 소유 draft 로 들어와 각자 승인한다(MCP 재승인·스킬 승인 이어받기 규칙도 그대로 — ingest 가 적용).
 * 한 번만 설치되는 것은 DB claim(`extension_org_member_installs`) 이 보장한다 — 두 조정이 겹쳐도 행을 잡은 쪽만 설치한다.
 *
 * 조정 시점: 조직 전환(PUT active-organization) · 모드 저장 직후(그 조직) · 주기 tick(TICK_MS). 전부 fire-and-forget.
 *
 * 제거: required 항목의 설치본은 일반 멤버가 지울 수 없다(조직 owner/admin·시스템 admin 은 가능 — 모드가 required 면
 * 다음 조정이 다시 설치한다). 그 밖에는 지우면 user_removed 로 기록해 default_on 이 다시 설치하지 않는다.
 *
 * 플래그 `EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED` 가 꺼져 있으면 모든 진입점이 DB 를 건드리지 않고 바로 돌아간다.
 *
 * @module services/extensions/org-deployment
 */
import { createLogger } from '../../utils/logger';
import { redactSecrets } from '../../utils/redact';
import {
    AUTO_INSTALL_MODES,
    DEFAULT_DEPLOYMENT_MODE,
    EXTENSION_ORG_DEPLOYMENT_LIMITS,
    extensionOrgDeploymentModesEnabled,
    resolveDeploymentMode,
    type DeploymentMode,
} from '../../config/extension-org-deployment';
import type {
    ExtensionOrgDeploymentRepository,
    MemberInstallRow,
} from '../../data/repositories/extension-org-deployment-repository';
import type { UserExtensionRow } from '../../data/repositories/user-extension-repository';
import type { OrgContext } from '../org/membership-cache';
import type { OrgMembership } from '../../data/repositories/organization-repository';

const logger = createLogger('ExtensionOrgDeployment');

type Repo = Pick<ExtensionOrgDeploymentRepository,
    'listMemberInputs' | 'claimInstall' | 'markInstalled' | 'markFailed' | 'markUserRemoved'
    | 'findByInstalledExtension' | 'listInstallsForUser' | 'listReconcileCandidates'>;

export interface OrgDeploymentDeps {
    repo: Repo;
    /** 공유 확장을 그 사용자 계정으로 설치 — 기본은 갤러리 설치와 같은 `installSharedExtension` */
    install: (shared: UserExtensionRow, userId: string) => Promise<{ extensionId?: string; selectionRequired?: boolean }>;
    activeOrg: (userId: string) => Promise<OrgContext | null>;
    memberships: (userId: string) => Promise<OrgMembership[]>;
}

async function defaultDeps(): Promise<OrgDeploymentDeps> {
    const { getPool } = await import('../../data/models/unified-database');
    const { ExtensionOrgDeploymentRepository } = await import('../../data/repositories/extension-org-deployment-repository');
    const { installSharedExtension } = await import('./shared-install');
    const { activeOrgFor, membershipsFor } = await import('../org/membership-cache');
    return {
        repo: new ExtensionOrgDeploymentRepository(getPool()),
        // 조정은 사용자 요청이 아니다 — 관리자 스코프를 주지 않는다(내부 번들도 본인·공유 게시분만)
        install: (shared, userId) => installSharedExtension(shared, userId, { isAdmin: false }) as Promise<{ extensionId?: string; selectionRequired?: boolean }>,
        activeOrg: activeOrgFor,
        memberships: membershipsFor,
    };
}

export interface ReconcileSummary {
    orgId: string | null;
    installed: number;
    failed: number;
}

/** 같은 프로세스 안에서 한 멤버의 조정이 겹치지 않게(DB claim 이 최종 보장 — 이건 불필요한 왕복을 줄인다) */
const inFlight = new Set<string>();

/**
 * 멤버 한 명의 조정 — 활성 조직의 자동 설치 항목 중 아직 없는 것을 설치한다. 멱등(두 번 돌아도 한 번 설치).
 * @param maxInstalls 이번 호출에서 시도할 설치 수 상한(주기 tick 의 예산)
 */
export async function reconcileMemberDeployments(
    userId: string,
    opts: { deps?: OrgDeploymentDeps; maxInstalls?: number } = {},
): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = { orgId: null, installed: 0, failed: 0 };
    if (!extensionOrgDeploymentModesEnabled()) return summary;
    if (inFlight.has(userId)) return summary;
    inFlight.add(userId);
    try {
        const deps = opts.deps ?? await defaultDeps();
        const ctx = await deps.activeOrg(userId);
        if (!ctx) return summary;
        summary.orgId = ctx.orgId;
        const max = opts.maxInstalls ?? Number.POSITIVE_INFINITY;
        const L = EXTENSION_ORG_DEPLOYMENT_LIMITS;
        for (const row of await deps.repo.listMemberInputs(userId, ctx.orgId)) {
            if (summary.installed + summary.failed >= max) break;
            const mode = resolveDeploymentMode(row.item_mode, row.group_modes);
            if (!AUTO_INSTALL_MODES.has(mode)) continue;
            // 게시자는 원본을 이미 가지고 있다 — 자기 계정에 사본을 만들지 않는다
            if (String(row.user_id) === String(userId)) continue;
            const claimed = await deps.repo.claimInstall(row.id, userId, ctx.orgId, mode, {
                failedRetryMs: L.FAILED_RETRY_MS, maxAttempts: L.MAX_ATTEMPTS, installingStaleMs: L.INSTALLING_STALE_MS,
            });
            if (!claimed) continue;
            try {
                const result = await deps.install(row, userId);
                if (result.selectionRequired || !result.extensionId) throw new Error('설치할 plugin.json 을 고를 수 없습니다');
                await deps.repo.markInstalled(row.id, userId, result.extensionId);
                summary.installed++;
                logger.info(`조직 배포 설치: source=${row.id} → ${result.extensionId} (user=${userId}, org=${ctx.orgId}, mode=${mode})`);
            } catch (e) {
                const msg = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, L.ERROR_MAX_CHARS);
                await deps.repo.markFailed(row.id, userId, msg);
                summary.failed++;
                logger.warn(`조직 배포 설치 실패: source=${row.id} (user=${userId}, org=${ctx.orgId}): ${msg}`);
            }
        }
        return summary;
    } finally {
        inFlight.delete(userId);
    }
}

/**
 * 주기 조정 한 번 — 활성 조직에 자동 설치 값이 있는 멤버를 차례로 맞춘다(설치 예산 MAX_INSTALLS_PER_TICK).
 * @param orgId 주면 그 조직 멤버만(모드 저장 직후)
 */
export async function runOrgDeploymentReconcile(
    opts: { deps?: OrgDeploymentDeps; orgId?: string | null } = {},
): Promise<{ members: number; installed: number; failed: number }> {
    const total = { members: 0, installed: 0, failed: 0 };
    if (!extensionOrgDeploymentModesEnabled()) return total;
    const deps = opts.deps ?? await defaultDeps();
    const L = EXTENSION_ORG_DEPLOYMENT_LIMITS;
    for (const c of await deps.repo.listReconcileCandidates(L.CANDIDATES_PER_TICK, opts.orgId ?? null)) {
        const remaining = L.MAX_INSTALLS_PER_TICK - total.installed - total.failed;
        if (remaining <= 0) break;
        const s = await reconcileMemberDeployments(c.user_id, { deps, maxInstalls: remaining });
        total.members++;
        total.installed += s.installed;
        total.failed += s.failed;
    }
    return total;
}

/** fire-and-forget 진입점 — 조직 전환·모드 저장 직후. 실패는 경고만(다음 tick 이 다시 맞춘다) */
export function triggerMemberReconcile(userId: string): void {
    if (!extensionOrgDeploymentModesEnabled()) return;
    void reconcileMemberDeployments(userId).catch((e) => logger.warn(`조정 실패 (user=${userId}, 다음 tick 재시도):`, e));
}

export function triggerOrgReconcile(orgId: string): void {
    if (!extensionOrgDeploymentModesEnabled()) return;
    void runOrgDeploymentReconcile({ orgId }).catch((e) => logger.warn(`조정 실패 (org=${orgId}, 다음 tick 재시도):`, e));
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/** 주기 tick — 타이머는 걸되 매 tick 플래그를 읽는다(꺼짐 = 아무것도 안 함, DB 조회 0) */
export function startOrgDeploymentReconcile(): void {
    if (timer) return;
    timer = setInterval(() => {
        if (running || !extensionOrgDeploymentModesEnabled()) return;
        running = true;
        void runOrgDeploymentReconcile()
            .catch((e) => logger.warn('조직 배포 조정 tick 실패 (다음 tick 재시도):', e))
            .finally(() => { running = false; });
    }, EXTENSION_ORG_DEPLOYMENT_LIMITS.TICK_MS);
    timer.unref?.();
}

export function stopOrgDeploymentReconcile(): void {
    if (timer) { clearInterval(timer); timer = null; }
}

// ── 멤버 쪽 판정 (제거·응답 장식) ───────────────────────────────

/** 멤버에게 적용되는 모드 — 그 조직 멤버가 아니거나 원본이 더 이상 그 조직에 공개돼 있지 않으면 default_off */
async function modeFor(deps: OrgDeploymentDeps, userId: string, link: MemberInstallRow, list: OrgMembership[]): Promise<DeploymentMode> {
    if (!list.some((m) => m.orgId === link.org_id)) return DEFAULT_DEPLOYMENT_MODE;
    const row = (await deps.repo.listMemberInputs(userId, link.org_id)).find((r) => r.id === link.source_extension_id);
    return row ? resolveDeploymentMode(row.item_mode, row.group_modes) : DEFAULT_DEPLOYMENT_MODE;
}

/** 그 조직에서 required 를 지울 수 있는 역할 — 조직 owner/admin(시스템 admin 은 호출부가 먼저 통과시킨다) */
function canOverrideRequired(list: OrgMembership[], orgId: string): boolean {
    const m = list.find((x) => x.orgId === orgId);
    return !!m && (m.role === 'owner' || m.role === 'admin');
}

export interface RemovalDecision {
    allowed: boolean;
    /** 배포로 설치된 항목이면 그 기록 — 제거 뒤 user_removed 로 남긴다 */
    link: MemberInstallRow | null;
    mode: DeploymentMode | null;
}

/** 설치본 제거 판정 — 플래그 OFF·배포 설치본이 아니면 언제나 허용(종전) */
export async function decideExtensionRemoval(
    installedExtensionId: string,
    userId: string,
    isSystemAdmin: boolean,
    opts: { deps?: OrgDeploymentDeps } = {},
): Promise<RemovalDecision> {
    if (!extensionOrgDeploymentModesEnabled()) return { allowed: true, link: null, mode: null };
    const deps = opts.deps ?? await defaultDeps();
    const link = await deps.repo.findByInstalledExtension(installedExtensionId, userId);
    if (!link) return { allowed: true, link: null, mode: null };
    const list = await deps.memberships(userId);
    const mode = await modeFor(deps, userId, link, list);
    const allowed = mode !== 'required' || isSystemAdmin || canOverrideRequired(list, link.org_id);
    return { allowed, link, mode };
}

/** 제거가 끝난 뒤 — default_on 이 다시 설치하지 않게 기록한다(required 는 조정이 다시 잡는다) */
export async function recordExtensionRemoval(link: MemberInstallRow, opts: { deps?: OrgDeploymentDeps } = {}): Promise<void> {
    const deps = opts.deps ?? await defaultDeps();
    await deps.repo.markUserRemoved(link.source_extension_id, link.user_id);
}

export interface InstalledDeploymentInfo {
    mode: DeploymentMode;
    /** false 면 화면이 제거 버튼을 비활성화한다(required + 일반 멤버) */
    removable: boolean;
}

/** 설치 목록 장식 — 배포로 설치된 행만 installedExtensionId → {mode, removable}. 플래그 OFF 면 null(필드를 싣지 않는다) */
export async function installedDeploymentInfo(
    userId: string,
    isSystemAdmin: boolean,
    opts: { deps?: OrgDeploymentDeps } = {},
): Promise<Map<string, InstalledDeploymentInfo> | null> {
    if (!extensionOrgDeploymentModesEnabled()) return null;
    const deps = opts.deps ?? await defaultDeps();
    const links = await deps.repo.listInstallsForUser(userId);
    const out = new Map<string, InstalledDeploymentInfo>();
    if (links.length === 0) return out;
    const list = await deps.memberships(userId);
    for (const link of links) {
        if (!link.installed_extension_id) continue;
        const mode = await modeFor(deps, userId, link, list);
        out.set(link.installed_extension_id, {
            mode,
            removable: mode !== 'required' || isSystemAdmin || canOverrideRequired(list, link.org_id),
        });
    }
    return out;
}

/** 갤러리 장식 — 활성 조직에 공개된 항목의 이 멤버 적용 모드(source id → mode). 플래그 OFF 면 null */
export async function galleryDeploymentModes(
    userId: string,
    opts: { deps?: OrgDeploymentDeps } = {},
): Promise<Map<string, DeploymentMode> | null> {
    if (!extensionOrgDeploymentModesEnabled()) return null;
    const deps = opts.deps ?? await defaultDeps();
    const out = new Map<string, DeploymentMode>();
    const ctx = await deps.activeOrg(userId);
    if (!ctx) return out;
    for (const row of await deps.repo.listMemberInputs(userId, ctx.orgId)) {
        out.set(row.id, resolveDeploymentMode(row.item_mode, row.group_modes));
    }
    return out;
}

/** 테스트 전용 */
export function resetOrgDeploymentState(): void {
    stopOrgDeploymentReconcile();
    inFlight.clear();
    running = false;
}
