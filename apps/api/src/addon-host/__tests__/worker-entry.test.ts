/**
 * 별도 프로세스 worker 진입 — 매니페스트 entry.workers[].name 으로 add-on 구현을 찾는다(Base 는 add-on 이름·경로를 모른다).
 * env 로 꺼진 add-on·선언 없는 이름은 설정 오류(종료 코드 78).
 */
const mockAddons: Array<{ id: string; dir: string; manifest: { entry?: { workers?: Array<{ name: string; module: string }> } } }> = [];
const mockDisabled = new Set<string>();
jest.mock('../builtin-registry', () => ({
    listBuiltinAddonDefs: () => mockAddons,
    isBuiltinAddonEnabled: (id: string) => !mockDisabled.has(id),
}));
const mockLoad = jest.fn();
jest.mock('../entry-loader', () => ({ loadAddonEntry: (...a: unknown[]) => mockLoad(...a) }));

import { ADDON_WORKER_CONFIG_EXIT_CODE, AddonWorkerConfigError, loadAddonWorker } from '../worker-entry';

const sample = { id: 'sample-addon', dir: '/tmp/sample', manifest: { entry: { workers: [{ name: 'sample-worker', module: 'standalone/run#start' }] } } };

beforeEach(() => {
    mockAddons.length = 0;
    mockDisabled.clear();
    mockLoad.mockReset();
});

describe('loadAddonWorker', () => {
    it('이름으로 선언한 add-on 을 찾아 그 진입 함수를 돌려준다', () => {
        const start = jest.fn();
        mockLoad.mockReturnValue(start);
        mockAddons.push({ id: 'other', dir: '/tmp/o', manifest: {} }, sample);
        expect(loadAddonWorker('sample-worker')).toEqual({ addonId: 'sample-addon', start });
        expect(mockLoad).toHaveBeenCalledWith(sample, 'standalone/run#start');
    });

    it('env(ADDON_BUILTIN_DISABLED)로 꺼진 add-on 이면 설정 오류', () => {
        mockAddons.push(sample);
        mockDisabled.add('sample-addon');
        expect(() => loadAddonWorker('sample-worker')).toThrow(AddonWorkerConfigError);
        expect(mockLoad).not.toHaveBeenCalled();
    });

    it('선언한 add-on 이 없으면 설정 오류', () => {
        mockAddons.push(sample);
        expect(() => loadAddonWorker('missing-worker')).toThrow("매니페스트에 worker 'missing-worker' 을 선언한 내장 add-on 이 없다");
    });

    it('설정 오류 종료 코드는 78(EX_CONFIG — PM2 stop_exit_codes)', () => {
        expect(ADDON_WORKER_CONFIG_EXIT_CODE).toBe(78);
    });
});
