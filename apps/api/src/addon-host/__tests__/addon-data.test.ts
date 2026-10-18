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
    return { exportUserData: async () => ({}), stores: { skills: (db: unknown) => ({ boundTo: db }) } };
});
jest.mock('../entry-loader', () => ({ loadAddonEntry: (addon: { id: string }, ref: string) => loadAddonEntry(addon, ref) }));

import { getAddonDataModules, getComponentStore, resetAddonDataModulesForTest } from '../addon-data';
import { ComponentStoreUnavailableError } from '../../runtime-ports/component-stores';

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

    it('구성요소 저장 연산은 선언한 데이터 모듈에서 DB 연결에 묶어 돌려준다', () => {
        const db = { query: jest.fn() };
        expect(getComponentStore('skills', db)).toEqual({ boundTo: db });
    });

    it('그 종류를 선언한 모듈이 없으면 조용히 건너뛰지 않고 명시 오류(불러오지 못한 모듈 사유 포함)', () => {
        let err: unknown;
        try { getComponentStore('mcpServers', { query: jest.fn() }); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(ComponentStoreUnavailableError);
        expect(String((err as Error).message)).toContain('broken-addon: Cannot find module');
    });
});
