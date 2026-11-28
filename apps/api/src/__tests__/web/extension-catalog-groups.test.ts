/** 갤러리 카탈로그 원본 묶음(apps/web/addons/extension-curation/catalog-groups.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
const lib = require('../../../../web/addons/extension-curation/catalog-groups') as {
    catalogGroupingEnabled: (g: unknown) => boolean;
    catalogGroups: (s: unknown[]) => Array<{ id: string; name: string; installable: number; mcp: number }>;
    isGroupedCatalogView: (enabled: boolean, selected: string, q: string) => boolean;
};
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

describe('catalogGroupingEnabled — 플래그 OFF 면 종전 평면 목록', () => {
    it.each([
        [undefined, false], [null, false], [{}, false], [{ groupSources: 'true' }, false], [{ groupSources: true }, true],
    ])('%j → %s', (g, want) => {
        expect(lib.catalogGroupingEnabled(g)).toBe(want);
    });
});

describe('catalogGroups', () => {
    it('설치 가능 플러그인 2개 이상인 원본만, MCP 수는 hasMcp=true 만 센다', () => {
        const groups = lib.catalogGroups([
            { id: 'ruflo', name: 'ruflo', plugins: [{ hasMcp: true }, { hasMcp: false }, {}, { installable: false, hasMcp: true }] },
            { id: 'one', name: 'single', plugins: [{}] },
            { id: 'two-hidden', name: 'x', plugins: [{}, { installable: false }] },
        ]);
        expect(groups).toEqual([{ id: 'ruflo', name: 'ruflo', installable: 3, mcp: 1 }]);
    });
});

describe('isGroupedCatalogView', () => {
    it('플래그 ON + 원본·카테고리 미선택 + 검색어 없음일 때만', () => {
        expect(lib.isGroupedCatalogView(true, '', '')).toBe(true);
        expect(lib.isGroupedCatalogView(true, '', '  ')).toBe(true);
        expect(lib.isGroupedCatalogView(false, '', '')).toBe(false);
        expect(lib.isGroupedCatalogView(true, 'src-1', '')).toBe(false);
        expect(lib.isGroupedCatalogView(true, '', 'swarm')).toBe(false);
    });
});

describe('갤러리 배선(정적)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../../web/addons/extension-curation/components/extensions-section.tsx'), 'utf8');
    it('응답의 groupSources 로만 묶음을 켜고, MCP 표시도 그 플래그 아래에만 있다', () => {
        expect(src).toContain('setCatalogGrouping(catalogGroupingEnabled(res?.data))');
        expect(src).toContain('{catalogGrouping && p.hasMcp && (');
    });
    it('번역 키 3개가 5개 언어에 있다', () => {
        for (const lang of ['ko', 'en', 'ja', 'zh', 'de']) {
            const m = JSON.parse(fs.readFileSync(path.join(__dirname, `../../../../web/messages/${lang}.json`), 'utf8'));
            for (const k of ['groupSummary', 'groupMcp', 'groupOpen']) expect(m.extensions.catalog[k]).toEqual(expect.any(String));
        }
    });
});
