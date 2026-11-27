/**
 * 갤러리 판정 배지(M1) — 응답 → 배지 값(순수), 그리고 add-on 이 꺼져 있으면 갤러리는 종전 그대로:
 * add-on 은 켜짐 확인 전 숨김(hideUntilEnabledKnown)이고, 갤러리 슬롯은 배지 기여가 없으면 아무것도 그리지 않는다.
 */
import fs from 'fs';
import path from 'path';

export {};
type Addon = { id: string; hideUntilEnabledKnown?: boolean; galleryItemBadges?: unknown[] };
const WEB = path.resolve(__dirname, '../../../../web');
const { buildVerdictViews } = require('../../../../web/addons/extension-marketplace/verdict-view') as {
    buildVerdictViews: (items: unknown) => Map<string, Record<string, unknown>>;
};
const { selectEnabledWebAddons } = require('../../../../web/addons/enabled-filter') as {
    selectEnabledWebAddons: (addons: readonly Addon[], states: readonly { id: string; enabled: boolean }[] | undefined) => readonly Addon[];
};
const read = (rel: string) => fs.readFileSync(path.join(WEB, rel), 'utf8');

describe('buildVerdictViews', () => {
    it('판정 → 색·사유(불가 먼저)·참고·짧은 커밋', () => {
        const m = buildVerdictViews([
            {
                plugin: 'p', verdict: 'unsupported', evaluated: 'installed',
                reasons: [
                    { code: 'SKILL_MCP_TOOL_IDIOM', severity: 'degrading', count: 1 },
                    { code: 'NOT_INSTALLABLE', severity: 'blocking', count: 0 },
                    { code: 'CROSS_REPO_SOURCE', severity: 'info', count: 0 },
                ],
                provenance: { publisher: 'acme', commit: 'abcdef1234', license: 'MIT', sourceUrl: 'u' },
            },
            { plugin: 'q', verdict: 'partial', reasons: [], provenance: { publisher: null, commit: null, license: null, sourceUrl: 'u' }, evaluated: 'snapshot' },
        ]);
        expect(m.get('p')).toEqual({
            verdict: 'unsupported', tone: 'danger', causes: ['NOT_INSTALLABLE', 'SKILL_MCP_TOOL_IDIOM'], notes: ['CROSS_REPO_SOURCE'],
            shortCommit: 'abcdef1', publisher: 'acme', license: 'MIT', snapshotOnly: false,
        });
        expect(m.get('q')).toMatchObject({ tone: 'warn', snapshotOnly: true, shortCommit: null });
    });

    it('모양이 틀린 응답은 배지를 만들지 않는다(갤러리는 그대로)', () => {
        expect(buildVerdictViews(undefined).size).toBe(0);
        expect(buildVerdictViews([{ plugin: 'p', verdict: 'great' }, null, { verdict: 'supported' }]).size).toBe(0);
    });
});

describe('add-on 꺼짐 → 갤러리 무변화', () => {
    it('웹 add-on 은 켜짐 확인 전 숨기고, 배지 하나만 기여한다', () => {
        const src = read('addons/extension-marketplace/index.ts');
        expect(src).toMatch(/id:\s*"extension-marketplace"/);
        expect(src).toMatch(/hideUntilEnabledKnown:\s*true/);
        expect(src).toMatch(/galleryItemBadges:/);
        expect(read('addons/registry.ts')).toMatch(/extensionMarketplaceAddon/);
    });

    it('꺼짐·로딩 중·목록에 없음이면 레지스트리에서 빠진다', () => {
        const market: Addon = { id: 'extension-marketplace', hideUntilEnabledKnown: true, galleryItemBadges: [{}] };
        const other: Addon = { id: 'knowledge-runtime' };
        const ids = (xs: readonly Addon[]) => xs.map(a => a.id);
        expect(ids(selectEnabledWebAddons([other, market], undefined))).toEqual(['knowledge-runtime']);
        expect(ids(selectEnabledWebAddons([other, market], [{ id: 'extension-marketplace', enabled: false }]))).toEqual(['knowledge-runtime']);
        expect(ids(selectEnabledWebAddons([other, market], []))).toEqual(['knowledge-runtime']);
        expect(ids(selectEnabledWebAddons([other, market], [{ id: 'extension-marketplace', enabled: true }]))).toEqual(['knowledge-runtime', 'extension-marketplace']);
    });

    it('갤러리 슬롯은 기여가 없으면 null — Base 는 add-on 이름을 모른다', () => {
        const slot = read('components/settings/gallery-item-badges.tsx');
        expect(slot).toMatch(/if \(badges\.length === 0\) return null;/);
        expect(slot).not.toMatch(/marketplace/i);
        expect(read('components/settings/extensions-section.tsx')).toMatch(/<GalleryItemBadges catalogId=\{e\.srcId\} pluginName=\{p\.name\} \/>/);
    });
});
