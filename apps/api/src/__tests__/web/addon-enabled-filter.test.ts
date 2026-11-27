/** 웹 add-on 켜짐 필터(apps/web/addons/enabled-filter.ts) — `hideUntilEnabledKnown`(마켓플레이스 계획 v3.4 A1) */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
type Addon = { id: string; hideUntilEnabledKnown?: boolean };
const { selectEnabledWebAddons } = require('../../../../web/addons/enabled-filter') as {
    selectEnabledWebAddons: (addons: readonly Addon[], states: readonly { id: string; enabled: boolean }[] | undefined) => readonly Addon[];
};

const plain: Addon = { id: 'plain' };
const guarded: Addon = { id: 'guarded', hideUntilEnabledKnown: true };
const ids = (xs: readonly Addon[]) => xs.map(a => a.id);

describe('selectEnabledWebAddons', () => {
    it('종전 add-on 은 로딩 중·실패에 보이고(fail-open) 꺼짐으로 온 것만 빠진다 — 입력 배열 참조도 유지', () => {
        const all = [plain];
        expect(selectEnabledWebAddons(all, undefined)).toBe(all);
        expect(selectEnabledWebAddons(all, [{ id: 'plain', enabled: true }])).toBe(all);
        expect(selectEnabledWebAddons(all, [])).toBe(all);
        expect(ids(selectEnabledWebAddons(all, [{ id: 'plain', enabled: false }]))).toEqual([]);
    });

    it('hideUntilEnabledKnown add-on 은 켜짐이 확인될 때만 보인다(로딩 중·실패·목록에 없음 → 숨김)', () => {
        const all = [plain, guarded];
        expect(ids(selectEnabledWebAddons(all, undefined))).toEqual(['plain']);
        expect(ids(selectEnabledWebAddons(all, [{ id: 'plain', enabled: true }]))).toEqual(['plain']);
        expect(ids(selectEnabledWebAddons(all, [{ id: 'guarded', enabled: false }]))).toEqual(['plain']);
        expect(selectEnabledWebAddons(all, [{ id: 'guarded', enabled: true }])).toBe(all);
    });
});
