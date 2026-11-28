/**
 * 관리자 MCP Registry 화면(M7) — 설치 방식 요약(순수), 화면 등록(관리자 영역 `/admin/mcp-registry`)과 관리자 탭,
 * 켜짐 확인 전 숨김(hideUntilEnabledKnown)이라 add-on 이 꺼져 있으면 탭이 보이지 않는다. "게시자 확인" 외의 신뢰 표기 없음.
 */
import fs from 'fs';
import path from 'path';

export {};
const WEB = path.resolve(__dirname, '../../../../web');
const read = (rel: string) => fs.readFileSync(path.join(WEB, rel), 'utf8');
const { installSummary } = require('../../../../web/addons/extension-marketplace/pages/registry-view') as {
    installSummary: (e: { remotes: Array<{ type: string; url: string }>; packages: Array<{ registryType: string; identifier: string; version: string | null }> }) => string | null;
};

describe('installSummary', () => {
    it('원격 우선, 없으면 첫 패키지, 둘 다 없으면 null', () => {
        expect(installSummary({ remotes: [{ type: 'streamable-http', url: 'https://m.example/mcp' }], packages: [{ registryType: 'npm', identifier: 'x', version: '1' }] }))
            .toBe('streamable-http https://m.example/mcp');
        expect(installSummary({ remotes: [], packages: [{ registryType: 'npm', identifier: '@a/b', version: '1.2.0' }] })).toBe('npm:@a/b@1.2.0');
        expect(installSummary({ remotes: [], packages: [{ registryType: 'pypi', identifier: 'b', version: null }] })).toBe('pypi:b');
        expect(installSummary({ remotes: [], packages: [] })).toBeNull();
    });
});

describe('MCP Registry 관리자 화면 배선', () => {
    it('add-on 화면 레지스트리에 관리자 영역으로 등록, 관리자 탭은 켜짐 확인 전 숨김', () => {
        expect(read('addons/extension-marketplace/pages/index.tsx')).toMatch(/path: "mcp-registry", area: "admin"/);
        expect(read('addons/pages.ts')).toMatch(/extensionMarketplacePages/);
        const idx = read('addons/extension-marketplace/index.ts');
        expect(idx).toMatch(/hub: "admin", href: "\/admin\/mcp-registry"/);
        expect(idx).toMatch(/hideUntilEnabledKnown: true/);
    });

    it('신뢰 표기는 "게시자 확인" 하나 — 5개 언어 모두 문구가 있다', () => {
        for (const lang of ['ko', 'en', 'ja', 'zh', 'de']) {
            const m = JSON.parse(read(`messages/${lang}.json`)) as { marketRegistry: Record<string, unknown>; nav: { items: Record<string, string> } };
            expect(typeof m.marketRegistry.publisherVerified).toBe('string');
            expect(typeof m.marketRegistry.publisherVerifiedHint).toBe('string');
            expect(m.nav.items.mcpRegistry).toBeTruthy();
            expect(Object.keys(m.marketRegistry).filter(k => /secur|safe|trust|official/i.test(k))).toEqual([]);
        }
    });
});

describe('빠른 작업(opt-in EXT_MARKET_REGISTRY_QUICK_ACTIONS) — 상태 응답의 quickActions 로만 켠다', () => {
    const { quickActionsEnabled } = require('../../../../web/addons/extension-marketplace/pages/registry-view') as {
        quickActionsEnabled: (s: unknown) => boolean;
    };
    it.each([[null, false], [{}, false], [{ quickActions: 'true' }, false], [{ quickActions: true }, true]])('%j → %s', (s, want) => {
        expect(quickActionsEnabled(s)).toBe(want);
    });
    it('승인+올리기 버튼·검색 버튼·입력 중 검색은 quick 아래에만 있다(꺼져 있으면 종전 화면)', () => {
        const src = read('addons/extension-marketplace/pages/admin-mcp-registry-page.tsx');
        expect(src).toContain('{quick && entry.curation !== "approved" && !tomb && !entry.promotedCatalogId && (');
        expect(src).toContain('/entries/approve-promote');
        expect(src).toContain('if (!quick || draft === search) return;');
        expect(src).toContain('{quick && (');
        expect(src).toContain('placeholder={t(quick ? "searchPlaceholderLive" : "searchPlaceholder")}');
        expect(src).toContain('<Td className="whitespace-nowrap">');
    });
    it('번역 키 5개가 5개 언어에 있다', () => {
        for (const lang of ['ko', 'en', 'ja', 'zh', 'de']) {
            const m = JSON.parse(read(`messages/${lang}.json`)).marketRegistry;
            for (const k of ['approvePromote', 'approvePromoted', 'search', 'searchResult', 'searchPlaceholderLive']) expect(m[k]).toEqual(expect.any(String));
        }
    });
});
