/**
 * 저장소 행 → 계약 DTO 변환 — 포트가 add-on·Base 사이에 넘기는 값은 저장소 타입이 아니라 계약 DTO 다.
 */
import { toAddonInstallationIntent } from '../contract-mappers';
import type { AddonInstallationRow } from '../../data/repositories/addon-state-repository';

const row = (over: Partial<AddonInstallationRow> = {}): AddonInstallationRow => ({
    addon_id: 'a', name: 'A', version: '1.0.0', kind: 'content', source: 'builtin', state: 'enabled', desired_state: 'enabled',
    state_revision: 1, last_failure_code: null, failure_reason: null, entitlement_sku: null,
    installed_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z',
    ...over,
});

describe('toAddonInstallationIntent', () => {
    it('관리자 의도와 호환 상태만 옮긴다', () => {
        expect(toAddonInstallationIntent(row())).toEqual({ addonId: 'a', desiredState: 'enabled', state: 'enabled' });
    });

    it('부팅 실패(state=failed)여도 관리자 의도는 그대로다', () => {
        expect(toAddonInstallationIntent(row({ state: 'failed', desired_state: 'enabled', last_failure_code: 'runtime_failed' })))
            .toEqual({ addonId: 'a', desiredState: 'enabled', state: 'failed' });
    });

    it('관리자가 끈 add-on 은 desiredState disabled', () => {
        expect(toAddonInstallationIntent(row({ state: 'disabled', desired_state: 'disabled' })))
            .toEqual({ addonId: 'a', desiredState: 'disabled', state: 'disabled' });
    });
});
