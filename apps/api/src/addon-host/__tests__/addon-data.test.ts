/**
 * 데이터 의무 로더 — 선언한 add-on 만, 켜짐과 무관하게 한 번 불러온다. 불러오지 못한 모듈은 null 과 사유로 남긴다
 * (부르는 쪽이 fail-closed 로 처리 — 사용자 삭제 중단, 내보내기 실패 카테고리).
 */
const defs = [
    { id: 'ok-addon', manifest: { entry: { data: 'data-module#ok' } } },
    { id: 'no-decl', manifest: { entry: { runtime: 'boot#start' } } },
    { id: 'broken-addon', manifest: { entry: { data: 'data-module#broken' } } },
];
jest.mock('../builtin-registry', () => ({ listBuiltinAddonDefs: () => defs }));
const loadAddonEntry = jest.fn((addon: { id: string }, _ref: string) => {
    if (addon.id === 'broken-addon') throw new Error('Cannot find module');
    return { exportUserData: async () => ({}) };
});
jest.mock('../entry-loader', () => ({ loadAddonEntry: (addon: { id: string }, ref: string) => loadAddonEntry(addon, ref) }));

import { getAddonDataModules, resetAddonDataModulesForTest } from '../addon-data';

beforeEach(() => { resetAddonDataModulesForTest(); loadAddonEntry.mockClear(); });

describe('getAddonDataModules', () => {
    it('선언한 add-on 만 불러오고, 실패한 모듈은 사유와 함께 null 로 남긴다', () => {
        const loaded = getAddonDataModules();
        expect(loaded.map((l) => [l.addonId, l.data === null, l.error])).toEqual([
            ['ok-addon', false, null],
            ['broken-addon', true, 'Cannot find module'],
        ]);
    });

    it('한 번만 불러온다', () => {
        getAddonDataModules();
        getAddonDataModules();
        expect(loadAddonEntry).toHaveBeenCalledTimes(2);
    });
});
