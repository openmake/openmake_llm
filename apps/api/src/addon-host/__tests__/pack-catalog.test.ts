import * as fs from 'fs';
import * as path from 'path';
import { BUILTIN_ADDON_IDS } from '../builtin-registry';
import { installPackCatalog, loadPackCatalog } from '../pack-catalog';

const ENV_KEY = 'ADDON_BUILTIN_DISABLED';

describe('팩 MCP 카탈로그', () => {
    const all = BUILTIN_ADDON_IDS.flatMap(id => loadPackCatalog(id).map(t => ({ addon: id, ...t })));

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
