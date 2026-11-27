/**
 * 관리자 확장 현황(M3) — 구성요소 조립·승인 집계·MCP 협상 열·커서, 정책 미리보기 = 강제 ON 실제 차단 결과(같은 판정).
 */
import type { Pool } from 'pg';
import type { ExtensionInventoryRow } from '../../../data/repositories/extension-inventory-repository';

const listPage = jest.fn();
const summarizeSources = jest.fn();
const listAgentsByExtensions = jest.fn();
const listActiveForPreview = jest.fn();
jest.mock('../../../data/repositories/extension-inventory-repository', () => ({
    ...jest.requireActual('../../../data/repositories/extension-inventory-repository'),
    ExtensionInventoryRepository: jest.fn().mockImplementation(() => ({
        listPage: (...a: unknown[]) => listPage(...a),
        summarizeSources: (...a: unknown[]) => summarizeSources(...a),
        listAgentsByExtensions: (...a: unknown[]) => listAgentsByExtensions(...a),
        listActiveForPreview: (...a: unknown[]) => listActiveForPreview(...a),
    })),
}));

const skillsListLinked = jest.fn();
const mcpListLinked = jest.fn();
const mcpListLinkedDetails = jest.fn();
let mcpHasDetails = true;
let skillsUnavailable = false;
jest.mock('../../../addon-host/addon-data', () => ({
    getComponentStore: (kind: string) => {
        if (kind === 'skills') {
            if (skillsUnavailable) throw new Error('데이터 모듈 없음');
            return { listLinked: skillsListLinked };
        }
        return mcpHasDetails ? { listLinked: mcpListLinked, listLinkedDetails: mcpListLinkedDetails } : { listLinked: mcpListLinked };
    },
}));

import { resetConfig } from '../../../config/env';
import { listExtensionInventory, previewExtensionSourcePolicy } from '../inventory';
import {
    assertExtensionSourceAllowed,
    resetExtensionSourcePolicyState,
    type ExtensionSourcePolicyDeps,
} from '../source-policy';
import { decodeInventoryCursor } from '../../../data/repositories/extension-inventory-repository';
import { parseExtensionSourcePolicy } from '../../../config/extension-source-policy';

const pool = {} as Pool;
const KEYS = ['EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_ARBITRARY_URL_INSTALL', 'EXTENSION_SOURCE_POLICY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
    jest.clearAllMocks();
    mcpHasDetails = true;
    skillsUnavailable = false;
});

function row(over: Partial<ExtensionInventoryRow>): ExtensionInventoryRow {
    return {
        id: 'user-ext-1', user_id: 'u1', username: 'alice', email: 'a@x', name: 'pack', version: '1.0.0',
        source_url: 'https://github.com/openmake/pack', source_ref: 'abc', source_path: '', source_hash: 'abc123',
        tracking_ref: null, status: 'active', visibility: 'private', org_id: null, permission_state: 'granted',
        install_state: 'enabled', created_at: new Date('2026-11-27T01:00:00Z'), updated_at: new Date('2026-11-27T02:00:00Z'),
        ...over,
    };
}

describe('listExtensionInventory', () => {
    it('구성요소·승인 집계·MCP 협상 열·다음 커서를 조립한다', async () => {
        listPage.mockResolvedValue([row({ id: 'e1' }), row({ id: 'e2', created_at: new Date('2026-11-26T00:00:00Z') }), row({ id: 'e3' })]);
        skillsListLinked.mockImplementation(async (id: string) => id === 'e1' ? [{ id: 's1', name: 'sk', status: 'draft' }] : []);
        mcpListLinkedDetails.mockResolvedValue([{
            id: 'm1', extensionId: 'e1', name: 'srv', status: 'active', enabled: true, transport: 'sse',
            negotiation: { authMethod: 'none', protocolEra: 'legacy', protocolVersion: '2025-11-25', sdkGeneration: 'v1-compatible', observedAt: '2026-11-27T03:00:00.000Z' },
        }]);
        listAgentsByExtensions.mockResolvedValue([{ id: 'a1', extension_id: 'e2', name: 'ag', status: 'archived' }]);
        summarizeSources.mockResolvedValue([{ source_url: 'https://github.com/openmake/pack', installs: 3, users: 1, last_installed_at: new Date('2026-11-27T01:00:00Z') }]);

        const page = await listExtensionInventory(pool, { status: 'active' }, { limit: 2, cursor: null });
        expect(listPage).toHaveBeenCalledWith({ status: 'active' }, 3, null);
        expect(page.items.map((i) => i.id)).toEqual(['e1', 'e2']);
        expect(decodeInventoryCursor(page.nextCursor!)).toEqual({ createdAt: '2026-11-26T00:00:00.000Z', id: 'e2' });
        const e1 = page.items[0];
        expect(e1.owner).toEqual({ id: 'u1', username: 'alice', email: 'a@x' });
        expect(e1.source).toMatchObject({ url: 'https://github.com/openmake/pack', commit: 'abc123' });
        expect(e1.components.mcpServers[0]).toMatchObject({ transport: 'sse', negotiation: { protocolVersion: '2025-11-25' } });
        expect(e1.approval).toEqual({ draft: 1, active: 1, archived: 0, other: 0 });
        expect(page.items[1].approval).toEqual({ draft: 0, active: 0, archived: 1, other: 0 });
        expect(page.sources).toEqual([{ sourceUrl: 'https://github.com/openmake/pack', installs: 3, users: 1, lastInstalledAt: '2026-11-27T01:00:00.000Z' }]);
        expect(e1.componentsUnavailable).toBeUndefined();
    });

    it('다음 페이지(커서)는 원본 집계를 다시 돌리지 않고, 마지막 페이지는 nextCursor null', async () => {
        listPage.mockResolvedValue([row({ id: 'e9' })]);
        skillsListLinked.mockResolvedValue([]);
        mcpListLinkedDetails.mockResolvedValue([]);
        listAgentsByExtensions.mockResolvedValue([]);
        const page = await listExtensionInventory(pool, {}, { limit: 5, cursor: { createdAt: '2026-11-27T00:00:00.000Z', id: 'x' } });
        expect(summarizeSources).not.toHaveBeenCalled();
        expect(page.nextCursor).toBeNull();
    });

    it('협상 조회가 없는 저장 연산이면 listLinked 로 대신하고, 스킬 저장 연산이 없으면 그 열만 비운다', async () => {
        mcpHasDetails = false;
        skillsUnavailable = true;
        listPage.mockResolvedValue([row({ id: 'e1' })]);
        mcpListLinked.mockResolvedValue([{ id: 'm1', name: 'srv', status: 'draft', enabled: false }]);
        listAgentsByExtensions.mockResolvedValue([]);
        summarizeSources.mockResolvedValue([]);
        const page = await listExtensionInventory(pool, {}, { limit: 10, cursor: null });
        expect(page.items[0].components.skills).toEqual([]);
        expect(page.items[0].components.mcpServers).toEqual([{ id: 'm1', name: 'srv', status: 'draft', enabled: false }]);
        expect(page.items[0].componentsUnavailable).toBe(true);
    });
});

describe('previewExtensionSourcePolicy — 강제 ON 실제 차단 결과와 같다', () => {
    const rows = [
        row({ id: 'ok', user_id: 'u1', source_url: 'https://github.com/openmake/pack' }),
        row({ id: 'denied', user_id: 'u1', source_url: 'https://github.com/evil/pack' }),
        row({ id: 'org-denied', user_id: 'u2', source_url: 'https://github.com/other/thing', tracking_ref: 'v2' }),
        row({ id: 'zip', user_id: 'u2', source_url: 'https://example.com/a.zip' }),
    ];
    const deps: ExtensionSourcePolicyDeps = {
        loadOrgLayer: async (userId) => userId === 'u2'
            ? parseExtensionSourcePolicy({ deny: [{ type: 'github', repo: 'other/*' }] }, 'organization')
            : undefined,
        loadCatalogs: async () => [],
        audit: async () => undefined,
    };

    it('강제 OFF 에서도 같은 판정으로 차단될 설치를 고른다(차단·조직 층·사용자별 해석)', async () => {
        process.env.EXTENSION_SOURCE_POLICY = JSON.stringify({ deny: [{ type: 'github', repo: 'evil/*' }, { type: 'hostPattern', pattern: '^example\\.com$' }] });
        delete process.env.EXTENSION_SOURCE_POLICY_ENFORCED;
        resetConfig();
        listActiveForPreview.mockResolvedValue(rows);
        const result = await previewExtensionSourcePolicy(pool, deps);
        expect(result.enforced).toBe(false);
        expect(result.checked).toBe(4);
        expect(result.truncated).toBe(false);
        expect(result.blocked.map((b) => b.extensionId).sort()).toEqual(['denied', 'org-denied', 'zip']);
        expect(result.blocked.find((b) => b.extensionId === 'org-denied')!.verdict).toMatchObject({ reason: 'DENIED', scope: 'organization' });

        // 같은 정책으로 강제를 켰을 때 실제 설치 경로(업데이트 = 원본 URL + 추적 ref 재설치)의 결과와 일치
        process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true';
        resetConfig();
        const actuallyBlocked: string[] = [];
        for (const r of rows) {
            try {
                await assertExtensionSourceAllowed({ url: r.source_url, ref: r.tracking_ref, userId: r.user_id, action: 'install' }, deps);
            } catch {
                actuallyBlocked.push(r.id);
            }
        }
        expect(actuallyBlocked.sort()).toEqual(result.blocked.map((b) => b.extensionId).sort());
    });

    it('정책이 없으면 아무 것도 막지 않는다', async () => {
        delete process.env.EXTENSION_SOURCE_POLICY;
        resetConfig();
        listActiveForPreview.mockResolvedValue(rows);
        const result = await previewExtensionSourcePolicy(pool, { ...deps, loadOrgLayer: async () => undefined });
        expect(result.blocked).toEqual([]);
    });

    it('조직 정책 조회 실패(적용 이력 없음)면 그 사용자의 설치는 POLICY_UNAVAILABLE 로 표시(fail-closed 와 같은 결과)', async () => {
        delete process.env.EXTENSION_SOURCE_POLICY;
        resetConfig();
        listActiveForPreview.mockResolvedValue([rows[0]]);
        const result = await previewExtensionSourcePolicy(pool, { ...deps, loadOrgLayer: async () => { throw new Error('db down'); } });
        expect(result.blocked[0]).toMatchObject({ extensionId: 'ok', verdict: { reason: 'POLICY_UNAVAILABLE' } });
    });
});

describe('조직 소유 행(212)의 소유자 칸 — EXTENSION_ORG_OWNED_INSTALL_ENABLED', () => {
    const FLAG = 'EXTENSION_ORG_OWNED_INSTALL_ENABLED';
    const original = process.env[FLAG];
    afterEach(() => { if (original === undefined) delete process.env[FLAG]; else process.env[FLAG] = original; resetConfig(); });
    const orgRow = row({ id: 'eo', user_id: null as unknown as string, username: null, email: null, visibility: 'organization', org_id: 'org-a', owner_org_id: 'org-a', owner_org_name: 'Acme' });
    const personal = row({ id: 'ep' });

    async function owners(): Promise<unknown[]> {
        listPage.mockResolvedValue([orgRow, personal]);
        mcpListLinkedDetails.mockResolvedValue([]);
        skillsListLinked.mockResolvedValue([]);
        listAgentsByExtensions.mockResolvedValue([]);
        summarizeSources.mockResolvedValue([]);
        const page = await listExtensionInventory(pool, {}, { limit: 10, cursor: null });
        return page.items.map((i) => i.owner);
    }

    it('OFF — 종전과 같다(조직 행도 빈 소유자, org 필드 없음)', async () => {
        delete process.env[FLAG];
        resetConfig();
        const out = await owners();
        expect(JSON.stringify(out)).toBe(JSON.stringify([
            { id: null, username: null, email: null },
            { id: 'u1', username: 'alice', email: 'a@x' },
        ]));
    });

    it('ON — 조직 소유 행은 조직 이름을 소유자로, org 를 붙인다(사람 소유 행은 그대로)', async () => {
        process.env[FLAG] = 'true';
        resetConfig();
        expect(await owners()).toEqual([
            { id: null, username: 'Acme', email: null, org: { id: 'org-a', name: 'Acme' } },
            { id: 'u1', username: 'alice', email: 'a@x' },
        ]);
    });

    it('ON — 정책 미리보기의 차단 항목도 조직 이름(email 없음)', async () => {
        process.env[FLAG] = 'true';
        process.env.EXTENSION_SOURCE_POLICY = JSON.stringify({ deny: [{ type: 'github', repo: 'openmake/*' }] });
        resetConfig();
        listActiveForPreview.mockResolvedValue([orgRow]);
        const result = await previewExtensionSourcePolicy(pool, { loadOrgLayer: async () => undefined, loadCatalogs: async () => [], audit: async () => undefined });
        expect(result.blocked[0].owner).toEqual({ id: null, username: 'Acme', org: { id: 'org-a', name: 'Acme' } });
    });
});
