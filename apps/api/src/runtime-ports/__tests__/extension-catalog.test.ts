/**
 * 확장 카탈로그 읽기 포트(M1) — 스냅샷 정규화, 설치본 근거(경고 코드·plugin.json 공개 메타·스킬 호환 메타),
 * 스킬 저장 add-on 이 없을 때 fail-open, 사용자 id·env 를 싣지 않음.
 */
const getCatalogSourceRow = jest.fn();
const listInstalledExtensionsBySources = jest.fn();
jest.mock('../../data/extension-catalog-lookup', () => ({
    getCatalogSourceRow: (...a: unknown[]) => getCatalogSourceRow(...a),
    listInstalledExtensionsBySources: (...a: unknown[]) => listInstalledExtensionsBySources(...a),
}));
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const getImportedSkill = jest.fn();
const getComponentStore = jest.fn(() => ({ getImportedSkill }));
jest.mock('../../addon-host/addon-data', () => ({ getComponentStore: (...a: unknown[]) => (getComponentStore as jest.Mock)(...a) }));

import { extensionCatalogPort } from '../extension-catalog';

beforeEach(() => jest.clearAllMocks());

describe('extensionCatalogPort.getSource', () => {
    it('스냅샷을 정규화한다 — 이름 없는 항목은 버림', async () => {
        getCatalogSourceRow.mockResolvedValue({
            id: 'ext-cat-1', url: 'https://github.com/a/m', name: 'M', enabled: true, last_synced_at: new Date('2026-11-27T00:00:00Z'),
            plugins: [{ name: 'p', installable: false, source: 'https://github.com/b/r', extra: 1 }, { description: 'nameless' }],
        });
        expect(await extensionCatalogPort.getSource('ext-cat-1')).toEqual({
            id: 'ext-cat-1', url: 'https://github.com/a/m', name: 'M', enabled: true, lastSyncedAt: '2026-11-27T00:00:00.000Z',
            plugins: [{ name: 'p', installable: false, source: 'https://github.com/b/r' }],
        });
    });
    it('없으면 null', async () => {
        getCatalogSourceRow.mockResolvedValue(null);
        expect(await extensionCatalogPort.getSource('x')).toBeNull();
    });
});

describe('extensionCatalogPort.listInstalledEvidence', () => {
    const row = {
        name: 'p', version: '1.0.0', source_url: 'https://github.com/a/m', source_ref: 'abc123', source_path: 'plugins/p',
        updated_at: new Date('2026-11-20T00:00:00Z'),
        manifest: {
            plugin: { name: 'p', author: { name: 'Alice', email: 'a@example.com' }, license: 'MIT', homepage: 'https://x' },
            components: {
                skills: [{ path: 'skills/a', skillId: 'sk-1', name: 'a', fromCommand: true, assets: [{}, {}] }, { path: 'skills/b', error: 'bad' }],
                mcpServers: [{ name: 'srv', serverId: 'm-1', transportType: 'stdio', blockedByConvention: true, env: { SECRET: 'x' } }],
                agents: [{ path: 'agents/x', agentId: 'ag-1' }, { path: 'agents/y', error: 'e' }],
            },
            warnings: ['UNSUPPORTED_COMPONENTS: hooks', 'ASSET_TOO_LARGE: big.bin', 'free text', 'UNSUPPORTED_COMPONENTS: lsp'],
        },
    };

    it('판정용 사실만 — 경고 코드·공개 메타·스킬 호환 메타·본문', async () => {
        listInstalledExtensionsBySources.mockResolvedValue([row]);
        getImportedSkill.mockResolvedValue({
            id: 'sk-1', content: 'body', manifest_meta: {
                compat: { markers: ['.claude/'], toolMappings: [{ from: 'Read', to: 'read_file' }, { from: 'NotebookEdit', to: null }] },
                compatibility: { requiredMissing: ['Bash'], unsupportedFeatures: ['hooks'], blockedReason: 'required tool missing' },
            },
        });
        const [ev] = await extensionCatalogPort.listInstalledEvidence(['https://github.com/a/m']);
        expect(getComponentStore).toHaveBeenCalledWith('skills', expect.anything());
        expect(ev).toEqual({
            name: 'p', version: '1.0.0', sourceUrl: 'https://github.com/a/m', sourcePath: 'plugins/p', commit: 'abc123',
            installedAt: '2026-11-20T00:00:00.000Z', author: 'Alice', license: 'MIT', homepage: 'https://x',
            warningCodes: ['UNSUPPORTED_COMPONENTS', 'ASSET_TOO_LARGE'],
            skills: [
                { name: 'a', fromCommand: true, assetCount: 2, markers: ['.claude/'], unsupportedTools: ['NotebookEdit'], requiredMissing: ['Bash'], unsupportedFeatures: ['hooks'], blocked: true, content: 'body' },
                { name: null, fromCommand: false, assetCount: 0, markers: [], unsupportedTools: [], requiredMissing: [], unsupportedFeatures: [], blocked: false, content: null },
            ],
            mcpServers: [{ name: 'srv', serverId: 'm-1', transportType: 'stdio', blockedByConvention: true, failed: false }],
            agentCount: 1,
        });
        expect(JSON.stringify(ev)).not.toMatch(/SECRET|a@example\.com|user_id|userId/);
    });

    it('스킬 저장 add-on 이 없으면 스킬 메타만 비운다(fail-open)', async () => {
        listInstalledExtensionsBySources.mockResolvedValue([row]);
        getComponentStore.mockImplementationOnce(() => { throw new Error('ComponentStoreUnavailable'); });
        const [ev] = await extensionCatalogPort.listInstalledEvidence(['https://github.com/a/m']);
        expect(ev.skills[0]).toMatchObject({ name: 'a', markers: [], content: null, blocked: false });
        expect(ev.warningCodes).toEqual(['UNSUPPORTED_COMPONENTS', 'ASSET_TOO_LARGE']);
    });
});
