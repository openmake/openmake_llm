/** 설치 미리보기 화면 판정(apps/web/lib/extension-install-preview.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
const lib = require('../../../../web/lib/extension-install-preview') as {
    catalogInstallMode: (g: unknown) => 'preview' | 'direct';
    previewHintKey: (code: string) => string | null;
    splitWarning: (w: string) => { code: string | null; text: string };
    installableCounts: (p: unknown) => { skills: number; mcpServers: number; agents: number };
};

describe('catalogInstallMode — 플래그 OFF 면 종전처럼 바로 설치', () => {
    it.each([
        [undefined, 'direct'], [null, 'direct'], [{}, 'direct'], [{ installPreview: false }, 'direct'],
        [{ installPreview: 'true' }, 'direct'], [{ installPreview: true }, 'preview'],
    ])('%j → %s', (g, want) => {
        expect(lib.catalogInstallMode(g)).toBe(want);
    });
});

describe('previewHintKey', () => {
    it('서버 안내 코드 4종은 번역 키로, 모르는 코드는 null', () => {
        expect(lib.previewHintKey('deprecated-transport')).toBe('deprecatedTransport');
        expect(lib.previewHintKey('endpoint-sunset')).toBe('endpointSunset');
        expect(lib.previewHintKey('endpoint-moved')).toBe('endpointMoved');
        expect(lib.previewHintKey('remote-auth-may-be-required')).toBe('remoteAuth');
        expect(lib.previewHintKey('future-code')).toBeNull();
    });
});

describe('갤러리 배선(정적) — 플래그 OFF 면 설치 버튼이 바로 설치한다', () => {
    // apps/web 에는 테스트 러너가 없어 소스를 정적으로 확인한다
    const src: string = (require('fs') as typeof import('fs')).readFileSync(
        (require('path') as typeof import('path')).join(__dirname, '../../../../web/components/settings/extensions-section.tsx'), 'utf8');
    it('모드 초기값은 direct, 갤러리 응답으로만 preview 가 된다', () => {
        expect(src).toContain('useState<"preview" | "direct">("direct")');
        expect(src).toContain('setCatalogMode(catalogInstallMode(res?.data))');
    });
    it('direct 모드의 클릭은 종전 installFromCatalog 를 부른다', () => {
        expect(src).toMatch(/if \(catalogMode === "preview"\) setPreviewTarget\(\{[^}]*\}\);\s*else void installFromCatalog\(sourceId, plugin\);/);
        expect(src).toContain('onClick={() => onCatalogInstallClick(');
    });
});

describe('splitWarning · installableCounts', () => {
    it('`CODE: 설명` 은 코드와 설명으로 나눈다', () => {
        expect(lib.splitWarning('SKILLS_ADAPTED: 2개 스킬')).toEqual({ code: 'SKILLS_ADAPTED', text: '2개 스킬' });
        expect(lib.splitWarning('그냥 문장')).toEqual({ code: null, text: '그냥 문장' });
    });
    it('오류·제외 항목은 설치 수에서 뺀다', () => {
        expect(lib.installableCounts({
            components: {
                skills: [{ path: 'a' }, { path: 'b', error: 'x' }],
                mcpServers: [{ name: 'm' }, { name: 'r', excluded: 'PERMISSION_DENIED' }],
                agents: [{ path: 'g', name: 'g', plannedName: 'p-g' }],
            },
        })).toEqual({ skills: 1, mcpServers: 1, agents: 1 });
    });
});
