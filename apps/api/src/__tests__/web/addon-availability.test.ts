/** add-on 가용성 오류 분류(apps/web/lib/addon-availability.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
type Kind = 'disabled' | 'unavailable' | 'failed' | 'other';
const { addonErrorOf, classifyAddonError, addonAvailabilityMessageKey } = require('../../../../web/lib/addon-availability') as {
    addonErrorOf: (e: unknown) => { status?: number; code?: string };
    classifyAddonError: (status: number | undefined, code: string | undefined) => Kind;
    addonAvailabilityMessageKey: (kind: Kind) => 'disabledByAdmin' | 'unavailable' | 'notReady' | 'serverError';
};

describe('addonErrorOf', () => {
    it('ApiError 모양(status + body.error.code)에서 status·code 를 뽑는다', () => {
        const e = Object.assign(new Error('x'), { status: 503, body: { success: false, error: { code: 'ADDON_STATE_UNKNOWN', message: 'm' } } });
        expect(addonErrorOf(e)).toEqual({ status: 503, code: 'ADDON_STATE_UNKNOWN' });
    });
    it('모양이 다르면 둘 다 undefined', () => {
        expect(addonErrorOf(new Error('x'))).toEqual({ status: undefined, code: undefined });
        expect(addonErrorOf(null)).toEqual({ status: undefined, code: undefined });
    });
});

describe('classifyAddonError', () => {
    it('503 ADDON_STATE_UNKNOWN → unavailable (재시도 가능)', () => {
        expect(classifyAddonError(503, 'ADDON_STATE_UNKNOWN')).toBe('unavailable');
    });
    it('404 ADDON_DISABLED → disabled (관리자가 끔)', () => {
        expect(classifyAddonError(404, 'ADDON_DISABLED')).toBe('disabled');
    });
    it('503 ADDON_FAILED → failed (부팅 실패, 관리자 조치 필요)', () => {
        expect(classifyAddonError(503, 'ADDON_FAILED')).toBe('failed');
    });
    it('ADDON_FAILED 라도 503 이 아니면 other', () => {
        expect(classifyAddonError(404, 'ADDON_FAILED')).toBe('other');
    });
    it('코드가 맞아도 상태가 다르면 other (일반 404 와 섞지 않는다)', () => {
        expect(classifyAddonError(404, undefined)).toBe('other');
        expect(classifyAddonError(500, 'ADDON_DISABLED')).toBe('other');
        expect(classifyAddonError(undefined, undefined)).toBe('other');
    });
});

describe('addonAvailabilityMessageKey', () => {
    it('종류 → knowledge 네임스페이스 키', () => {
        expect(addonAvailabilityMessageKey('disabled')).toBe('disabledByAdmin');
        expect(addonAvailabilityMessageKey('unavailable')).toBe('unavailable');
        expect(addonAvailabilityMessageKey('failed')).toBe('notReady');
        expect(addonAvailabilityMessageKey('other')).toBe('serverError');
    });
});
