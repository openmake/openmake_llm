/**
 * 수명주기 계약 — 진입점이 돌려준 값이 handle 인지 판별(기존 void 진입점 호환)과 정지 상태의 활성 판정.
 */
import { isAddonRuntimeHandle } from '../lifecycle-types';
import { resetAddonRuntimeStatusesForTest, resolveAddonActivation, setAddonRuntimeStatus } from '../activation';

const row = (desiredState: 'enabled' | 'disabled') =>
    ({ known: true as const, desiredState, state: desiredState, stateRevision: 1, lastFailureCode: null });

beforeEach(() => resetAddonRuntimeStatusesForTest());

describe('isAddonRuntimeHandle', () => {
    it('stop 함수가 있으면 handle 이다', () => {
        expect(isAddonRuntimeHandle({ stop: async () => undefined })).toBe(true);
        expect(isAddonRuntimeHandle({ stop: async () => undefined, resume: async () => undefined })).toBe(true);
    });

    it('void·null·stop 이 없는 객체는 handle 이 아니다(기존 진입점은 그대로 동작)', () => {
        expect(isAddonRuntimeHandle(undefined)).toBe(false);
        expect(isAddonRuntimeHandle(null)).toBe(false);
        expect(isAddonRuntimeHandle({ resume: async () => undefined })).toBe(false);
        expect(isAddonRuntimeHandle({ stop: 'no' })).toBe(false);
    });
});

describe('resolveAddonActivation — 정지 상태', () => {
    it('stopped + 의도 enabled → not_ready + restartRequired(이 프로세스에서 재개되지 않은 런타임)', () => {
        setAddonRuntimeStatus('x', 'stopped');
        const a = resolveAddonActivation({ addonId: 'x', hasRuntimeEntry: true, versionCompatible: true, row: row('enabled') });
        expect(a).toMatchObject({ runtimeStatus: 'stopped', effectiveAvailability: 'not_ready', restartRequired: true });
    });

    it('stopped + 의도 disabled → disabled, restartRequired 아님', () => {
        setAddonRuntimeStatus('x', 'stopped');
        const a = resolveAddonActivation({ addonId: 'x', hasRuntimeEntry: true, versionCompatible: true, row: row('disabled') });
        expect(a).toMatchObject({ runtimeStatus: 'stopped', effectiveAvailability: 'disabled', restartRequired: false });
    });

    it('stopping 은 not_ready 이고 restartRequired 아님(정지가 진행 중)', () => {
        setAddonRuntimeStatus('x', 'stopping');
        const a = resolveAddonActivation({ addonId: 'x', hasRuntimeEntry: true, versionCompatible: true, row: row('enabled') });
        expect(a).toMatchObject({ runtimeStatus: 'stopping', effectiveAvailability: 'not_ready', restartRequired: false });
    });
});
