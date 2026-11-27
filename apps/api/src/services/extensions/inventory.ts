/**
 * 관리자 확장 현황·정책 미리보기(마켓플레이스 남은 개발계획 v3.7 M3).
 *
 * - 현황: 사용자별 설치 확장 + 구성요소(스킬·MCP 서버·에이전트)와 승인 상태 + MCP 서버의 협상 관측(MCP-1, 있으면) + 원본별 집계.
 *   스킬·MCP 는 add-on 소유 표라 구성요소 저장 연산(getComponentStore)으로만 읽는다 — 저장 연산이 없거나 실패하면
 *   그 구성요소 열만 비우고(componentsUnavailable) 현황은 계속 보인다.
 * - 정책 미리보기: M2 의 **같은 판정**(`loadExtensionSourceGate` + `evaluate`)을 강제 ON(`force`)으로 각 설치의 소유자 기준으로 돌린다.
 *   설치 엔진의 업데이트(재설치)와 같은 입력(원본 URL + 추적 ref, action 'install')이라, 강제를 켰을 때 그 확장의
 *   업데이트가 막히는지와 결과가 같다. 이미 설치된 확장을 막지는 않는다(정책 위반 표시만 — 실행 시점 차단은 후속 opt-in).
 *
 * @module services/extensions/inventory
 */
import type { Pool } from 'pg';
import { getComponentStore } from '../../addon-host/addon-data';
import { EXTENSION_ADMIN_INVENTORY_LIMITS as LIMITS } from '../../config/extension-admin-inventory';
import { EXTENSION_SOURCE_POLICY_SETTINGS } from '../../config/extension-source-policy';
import {
    ExtensionInventoryRepository,
    encodeInventoryCursor,
    type ExtensionInventoryFilter,
    type ExtensionInventoryRow,
    type InventoryCursor,
} from '../../data/repositories/extension-inventory-repository';
import type { McpLinkedServerDetail } from '../../runtime-ports/component-stores';
import type { ExtensionSourceBlockDetail } from '../../errors/extension-source-blocked.error';
import { createLogger } from '../../utils/logger';
import { extensionOrgOwnedInstallEnabled } from '../../config/extension-org-owned';
import { loadExtensionSourceGate, type ExtensionSourceGate, type ExtensionSourcePolicyDeps } from './source-policy';
import { EXTENSION_MCP_SERVER_POLICY_SETTINGS } from '../../config/extension-mcp-server-policy';
import type { ExtensionMcpServerBlockDetail } from '../../errors/extension-mcp-server-blocked.error';
import { loadExtensionMcpServerGate, type ExtensionMcpServerGate, type ExtensionMcpServerPolicyDeps } from './mcp-server-policy';

const logger = createLogger('ExtensionInventory');

export interface InventoryComponent { id: string; name: string; status: string; enabled?: boolean }
export interface InventoryMcpComponent extends InventoryComponent {
    transport?: string;
    negotiation?: McpLinkedServerDetail['negotiation'];
}

export interface InventoryItem {
    id: string;
    name: string;
    version: string;
    status: string;
    owner: { id: string; username: string | null; email: string | null } & OrgOwnerMark;
    source: { url: string; ref: string; trackingRef: string | null; path: string; commit: string };
    visibility: string;
    orgId: string | null;
    permissionState: string;
    installState: string | null;
    components: { skills: InventoryComponent[]; mcpServers: InventoryMcpComponent[]; agents: InventoryComponent[] };
    /** 구성요소 상태별 개수 — draft = 승인 대기 */
    approval: { draft: number; active: number; archived: number; other: number };
    /** 스킬·MCP 구성요소 저장 연산을 쓰지 못했다(그 add-on 데이터 모듈 없음 등) */
    componentsUnavailable?: true;
    createdAt: string;
    updatedAt: string;
}

export interface InventoryPage {
    items: InventoryItem[];
    nextCursor: string | null;
    sources: Array<{ sourceUrl: string; installs: number; users: number; lastInstalledAt: string }>;
}

function iso(v: Date | string): string {
    return v instanceof Date ? v.toISOString() : String(v);
}

function countApproval(all: InventoryComponent[]): InventoryItem['approval'] {
    const out = { draft: 0, active: 0, archived: 0, other: 0 };
    for (const c of all) {
        if (c.status === 'draft' || c.status === 'active' || c.status === 'archived') out[c.status] += 1;
        else out.other += 1;
    }
    return out;
}

async function loadSkillsAndMcp(pool: Pool, ids: string[]): Promise<{
    skills: Map<string, InventoryComponent[]>;
    mcp: Map<string, InventoryMcpComponent[]>;
    unavailable: boolean;
}> {
    const skills = new Map<string, InventoryComponent[]>();
    const mcp = new Map<string, InventoryMcpComponent[]>();
    let unavailable = false;
    try {
        const store = getComponentStore('skills', pool);
        for (const id of ids) {
            skills.set(id, (await store.listLinked(id)).map(({ id: sid, name, status }) => ({ id: sid, name, status })));
        }
    } catch (e) {
        unavailable = true;
        logger.warn('스킬 구성요소 조회 실패 — 현황의 스킬 열을 비운다:', e);
    }
    try {
        const store = getComponentStore('mcpServers', pool);
        if (store.listLinkedDetails) {
            for (const d of await store.listLinkedDetails(ids)) {
                const list = mcp.get(d.extensionId) ?? [];
                list.push({ id: d.id, name: d.name, status: d.status, enabled: d.enabled, transport: d.transport, negotiation: d.negotiation });
                mcp.set(d.extensionId, list);
            }
        } else {
            for (const id of ids) {
                mcp.set(id, (await store.listLinked(id)).map(({ id: sid, name, status, enabled }) => ({ id: sid, name, status, enabled: enabled === true })));
            }
        }
    } catch (e) {
        unavailable = true;
        logger.warn('MCP 서버 구성요소 조회 실패 — 현황의 MCP 열을 비운다:', e);
    }
    return { skills, mcp, unavailable };
}

/** 조직 소유 행(212)의 소유자 표시 — 플래그가 켜져 있을 때만 붙는다(꺼져 있으면 응답 모양이 종전과 같다) */
export interface OrgOwnerMark { org?: { id: string; name: string | null } }

/**
 * 소유자 칸 — 사람 소유는 종전 그대로(users JOIN). 조직 소유(212)는 user_id 가 없어 비어 보이므로,
 * EXTENSION_ORG_OWNED_INSTALL_ENABLED 가 켜져 있으면 소유 조직 이름을 username 자리에 싣고 `org` 를 붙인다.
 */
type OwnerSource = Pick<ExtensionInventoryRow, 'user_id' | 'username' | 'owner_org_id' | 'owner_org_name'> & { email?: string | null };

function ownerOf(row: OwnerSource): { id: string; username: string | null; email: string | null } & OrgOwnerMark {
    const base = { id: row.user_id, username: row.username, email: row.email ?? null };
    if (!row.owner_org_id || !extensionOrgOwnedInstallEnabled()) return base;
    return { ...base, username: row.owner_org_name ?? row.owner_org_id, org: { id: row.owner_org_id, name: row.owner_org_name ?? null } };
}

function shortOwnerOf(row: OwnerSource): { id: string; username: string | null } & OrgOwnerMark {
    const { email: _e, ...rest } = ownerOf(row);
    return rest;
}

function toItem(row: ExtensionInventoryRow, comps: InventoryItem['components'], unavailable: boolean): InventoryItem {
    return {
        id: row.id,
        name: row.name,
        version: row.version,
        status: row.status,
        owner: ownerOf(row),
        source: { url: row.source_url, ref: row.source_ref, trackingRef: row.tracking_ref, path: row.source_path, commit: row.source_hash },
        visibility: row.visibility,
        orgId: row.org_id,
        permissionState: row.permission_state,
        installState: row.install_state,
        components: comps,
        approval: countApproval([...comps.skills, ...comps.mcpServers, ...comps.agents]),
        ...(unavailable ? { componentsUnavailable: true as const } : {}),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

export async function listExtensionInventory(
    pool: Pool,
    filter: ExtensionInventoryFilter,
    opts: { limit: number; cursor: InventoryCursor | null },
): Promise<InventoryPage> {
    const repo = new ExtensionInventoryRepository(pool);
    const rows = await repo.listPage(filter, opts.limit + 1, opts.cursor);
    const page = rows.slice(0, opts.limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > opts.limit && last ? encodeInventoryCursor({ createdAt: iso(last.created_at), id: last.id }) : null;
    const ids = page.map((r) => r.id);
    const [{ skills, mcp, unavailable }, agents, sources] = await Promise.all([
        loadSkillsAndMcp(pool, ids),
        repo.listAgentsByExtensions(ids),
        // 원본 집계는 첫 페이지에서만 — 다음 페이지 요청이 같은 집계를 다시 돌리지 않게
        opts.cursor ? Promise.resolve([]) : repo.summarizeSources(filter, LIMITS.SOURCE_SUMMARY_MAX),
    ]);
    const agentsBy = new Map<string, InventoryComponent[]>();
    for (const a of agents) {
        const list = agentsBy.get(a.extension_id) ?? [];
        list.push({ id: a.id, name: a.name, status: a.status });
        agentsBy.set(a.extension_id, list);
    }
    return {
        items: page.map((r) => toItem(r, {
            skills: skills.get(r.id) ?? [],
            mcpServers: mcp.get(r.id) ?? [],
            agents: agentsBy.get(r.id) ?? [],
        }, unavailable)),
        nextCursor,
        sources: sources.map((s) => ({ sourceUrl: s.source_url, installs: s.installs, users: s.users, lastInstalledAt: iso(s.last_installed_at) })),
    };
}

export interface PolicyPreviewBlocked {
    extensionId: string;
    name: string;
    owner: { id: string; username: string | null } & OrgOwnerMark;
    source: { url: string; trackingRef: string | null };
    verdict: ExtensionSourceBlockDetail;
}

export interface PolicyPreviewMcpBlocked {
    extensionId: string;
    name: string;
    owner: { id: string; username: string | null } & OrgOwnerMark;
    server: { id: string; name: string; transport: string };
    verdict: ExtensionMcpServerBlockDetail;
}

export interface PolicyPreviewResult {
    /** 지금 강제가 켜져 있는가(미리보기는 꺼져 있어도 같은 판정으로 돈다) */
    enforced: boolean;
    arbitraryUrlInstall: string;
    checked: number;
    blocked: PolicyPreviewBlocked[];
    /** 상한(PREVIEW_MAX)을 넘어 뒤쪽 설치를 판정하지 않았다 */
    truncated: boolean;
    /**
     * 확장 MCP 서버 정책(§8-3) 미리보기 — 같은 설치들의 (보관되지 않은) MCP 서버를 설치 경로와 같은 판정으로.
     * `unavailable` = MCP 구성요소 저장 연산을 쓰지 못해 판정하지 않았다(그 add-on 데이터 모듈 없음 등).
     */
    mcpServers: { enforced: boolean; checked: number; blocked: PolicyPreviewMcpBlocked[]; unavailable?: true };
}

/**
 * 정책 미리보기 — 활성 설치마다 소유자 기준 판정. 사용자별로 정책을 한 번만 해석한다.
 * `deps` 는 테스트 주입용(기본 = M2 의 기본 의존성).
 */
export async function previewExtensionSourcePolicy(pool: Pool, deps?: ExtensionSourcePolicyDeps, mcpDeps?: ExtensionMcpServerPolicyDeps): Promise<PolicyPreviewResult> {
    const rows = await new ExtensionInventoryRepository(pool).listActiveForPreview(LIMITS.PREVIEW_MAX);
    const truncated = rows.length > LIMITS.PREVIEW_MAX;
    const targets = rows.slice(0, LIMITS.PREVIEW_MAX);
    const gates = new Map<string, ExtensionSourceGate>();
    const blocked: PolicyPreviewBlocked[] = [];
    for (const row of targets) {
        let gate = gates.get(row.user_id);
        if (!gate) {
            gate = (await loadExtensionSourceGate(row.user_id, deps, { force: true }))!;
            gates.set(row.user_id, gate);
        }
        const verdict = gate.evaluate({ url: row.source_url, ref: row.tracking_ref, action: 'install' });
        if (!verdict.allowed) {
            const { allowed: _a, ...detail } = verdict;
            blocked.push({
                extensionId: row.id,
                name: row.name,
                owner: shortOwnerOf(row),
                source: { url: row.source_url, trackingRef: row.tracking_ref },
                verdict: detail,
            });
        }
    }
    return {
        enforced: EXTENSION_SOURCE_POLICY_SETTINGS.enforced,
        arbitraryUrlInstall: EXTENSION_SOURCE_POLICY_SETTINGS.arbitraryUrlInstall,
        checked: targets.length,
        blocked,
        truncated,
        mcpServers: await previewMcpServerPolicy(pool, targets, mcpDeps),
    };
}

/** MCP 서버 정책 미리보기 — 소유자별로 정책을 한 번 해석하고, 저장된 연결 설정(설치 때 저장한 값 그대로)을 같은 판정에 넣는다 */
async function previewMcpServerPolicy(
    pool: Pool,
    targets: Array<{ id: string; name: string; user_id: string; username: string | null; owner_org_id?: string | null; owner_org_name?: string | null }>,
    deps?: ExtensionMcpServerPolicyDeps,
): Promise<PolicyPreviewResult['mcpServers']> {
    const enforced = EXTENSION_MCP_SERVER_POLICY_SETTINGS.enforced;
    let servers;
    try {
        const store = getComponentStore('mcpServers', pool);
        if (!store.listLinkedConnections) return { enforced, checked: 0, blocked: [], unavailable: true };
        servers = await store.listLinkedConnections(targets.map((t) => t.id));
    } catch (e) {
        logger.warn('MCP 서버 연결 설정 조회 실패 — MCP 서버 정책 미리보기를 건너뛴다:', e);
        return { enforced, checked: 0, blocked: [], unavailable: true };
    }
    const byId = new Map(targets.map((t) => [t.id, t]));
    const gates = new Map<string, ExtensionMcpServerGate>();
    const blocked: PolicyPreviewMcpBlocked[] = [];
    let checked = 0;
    for (const s of servers) {
        const ext = byId.get(s.extensionId);
        if (!ext) continue;
        let gate = gates.get(ext.user_id);
        if (!gate) {
            gate = (await loadExtensionMcpServerGate(ext.user_id, deps, { force: true }))!;
            gates.set(ext.user_id, gate);
        }
        checked += 1;
        const verdict = gate.evaluate({ transport: s.transport, command: s.command, args: s.args, url: s.url });
        if (!verdict.allowed) {
            const { allowed: _a, ...detail } = verdict;
            blocked.push({
                extensionId: ext.id,
                name: ext.name,
                owner: shortOwnerOf(ext),
                server: { id: s.id, name: s.name, transport: s.transport },
                verdict: detail,
            });
        }
    }
    return { enforced, checked, blocked };
}
