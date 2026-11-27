/** 승인함 출처 표시(apps/web/lib/extension-origin.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
const { formatExtensionOrigin } = require('../../../../web/lib/extension-origin') as {
    formatExtensionOrigin: (source: string | null | undefined, ref: string | null | undefined) => string | null;
};

describe('formatExtensionOrigin', () => {
    it.each([
        ['https://github.com/acme/pack.git', 'abcdef0123456789', 'github.com/acme/pack@abcdef0'],
        ['https://github.com/acme/pack/', null, 'github.com/acme/pack'],
        ['internal://bundle/b1', 'r1', 'bundle/b1@r1'],
        ['not a url', 'deadbeefcafe', 'not a url@deadbee'],
    ])('%s @ %s → %s', (source, ref, expected) => {
        expect(formatExtensionOrigin(source, ref)).toBe(expected);
    });
    it('원본이 없으면 null', () => {
        expect(formatExtensionOrigin(null, 'abc')).toBeNull();
        expect(formatExtensionOrigin(undefined, undefined)).toBeNull();
    });
});
