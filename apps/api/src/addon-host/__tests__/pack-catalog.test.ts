import * as fs from 'fs';
import * as path from 'path';
import { builtinAddonIds } from '../builtin-registry';
import { installPackCatalog, loadPackCatalog } from '../pack-catalog';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

describe('팩 MCP 카탈로그', () => {
    const all = builtinAddonIds().flatMap(id => loadPackCatalog(id).map(t => ({ addon: id, ...t })));

    it('모든 add-on 의 카탈로그가 스키마에 맞고 템플릿 id 가 add-on 사이에서 겹치지 않는다', () => {
        expect(all.length).toBeGreaterThan(0);
        expect(new Set(all.map(t => t.id)).size).toBe(all.length);
    });

    it('통합 기능의 MCP 서버 템플릿은 그 add-on 이 싣는다', () => {
        expect(loadPackCatalog('kakao-map').map(t => t.id)).toEqual(['mcp-kakao']);
        expect(loadPackCatalog('notebooklm').map(t => t.id)).toEqual(['mcp-notebooklm']);
    });

    it('마이그레이션 163 의 백필 id 는 모두 팩이 싣는 템플릿이다 (백필만 있고 소유 add-on 이 없으면 끌 수 없다)', () => {
        const sql = fs.readFileSync(path.resolve(__dirname, '../../../../../db/migrations/163_addon_installed_items.sql'), 'utf-8');
        const backfilled = [...sql.matchAll(/\('([a-z-]+)', 'mcp-catalog', '([^']+)'\)/g)].map(m => `${m[1]}/${m[2]}`).sort();
        const owned = new Set(all.map(t => `${t.addon}/${t.id}`));
        expect(backfilled.length).toBeGreaterThan(0);
        expect(backfilled.filter(k => !owned.has(k))).toEqual([]);
    });
});

describe('installPackCatalog', () => {
    it('이력이 있는 항목은 설치로 세지 않고, 한 건의 실패가 나머지를 막지 않는다', async () => {
        const templates = loadPackCatalog('connectors-pack');
        const result = await installPackCatalog('connectors-pack', {
            installCatalogTemplateOnce: async (addonId, t) => {
                expect(addonId).toBe('connectors-pack');
                if (t.id === templates[0].id) throw new Error('boom');
                return t.id === templates[1].id;
            },
        });
        expect(result.installed).toEqual([templates[1].id]);
        expect(result.failed).toEqual([`${templates[0].id}: boom`]);
    });
});

describe('installPackCatalog — 이전 판 이관 (MCP-3, opt-in)', () => {
    const templates = loadPackCatalog('connectors-pack');
    const superseding = templates.filter(t => t.supersedes?.length);

    it('Atlassian 원격 템플릿은 v2 주소이고 v1 을 이전 판으로 적는다', () => {
        const t = templates.find(x => x.id === 'mcp-atlassian-remote');
        expect(t?.urlTemplate).toBe('https://mcp.atlassian.com/v2/mcp');
        expect(t?.supersedes).toEqual([{ transportType: 'streamable-http', urlTemplate: 'https://mcp.atlassian.com/v1/mcp' }]);
    });

    it('옵션이 없으면 이관 연산을 부르지 않는다(종전 "항목당 1회 설치" 그대로)', async () => {
        const upgradeSupersededTemplate = jest.fn(async () => true);
        const result = await installPackCatalog('connectors-pack', { installCatalogTemplateOnce: async () => false, upgradeSupersededTemplate });
        expect(upgradeSupersededTemplate).not.toHaveBeenCalled();
        expect(result.upgraded).toEqual([]);
    });

    it('옵션을 켜면 이미 설치된, supersedes 가 있는 템플릿만 이관을 시도한다', async () => {
        const upgradeSupersededTemplate = jest.fn(async (t: { id: string }) => t.id === 'mcp-atlassian-remote');
        const result = await installPackCatalog(
            'connectors-pack',
            { installCatalogTemplateOnce: async () => false, upgradeSupersededTemplate },
            { upgradeSuperseded: true },
        );
        expect(upgradeSupersededTemplate.mock.calls.map(c => c[0].id)).toEqual(superseding.map(t => t.id));
        expect(result.upgraded).toEqual(['mcp-atlassian-remote']);
    });

    it('이번에 새로 설치한 항목은 이관하지 않는다', async () => {
        const upgradeSupersededTemplate = jest.fn(async () => true);
        await installPackCatalog('connectors-pack', { installCatalogTemplateOnce: async () => true, upgradeSupersededTemplate }, { upgradeSuperseded: true });
        expect(upgradeSupersededTemplate).not.toHaveBeenCalled();
    });
});

describe('disabledCatalogTemplateIds', () => {
    it('꺼진 add-on 의 템플릿 id 만 돌려준다', () => {
        const before = process.env[ENV_KEY];
        try {
            process.env[ENV_KEY] = 'kakao-map';
            jest.isolateModules(() => expect(require('../pack-catalog').disabledCatalogTemplateIds()).toEqual(['mcp-kakao']));
            delete process.env[ENV_KEY];
            jest.isolateModules(() => expect(require('../pack-catalog').disabledCatalogTemplateIds()).toEqual([]));
        } finally {
            if (before === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = before;
        }
    });
});
