/**
 * add-on 실행 판정 포트 — strict 상태를 run/stopped/unknown 으로, 사용권·revision·캐시 적재를 위임한다.
 * 이 포트는 add-on 이름을 모른다(테스트는 임의 id 를 쓴다).
 */
const readAddonEnabledStrict = jest.fn();
const readAddonStateStrict = jest.fn();
const ensureAddonStates = jest.fn();
const checkAddonEntitlement = jest.fn();
jest.mock('../../services/addon/addon-state', () => ({
    readAddonEnabledStrict: (...a: unknown[]) => readAddonEnabledStrict(...a),
    readAddonStateStrict: (...a: unknown[]) => readAddonStateStrict(...a),
    ensureAddonStates: (...a: unknown[]) => ensureAddonStates(...a),
}));
jest.mock('../../services/addon/entitlement', () => ({
    checkAddonEntitlement: (...a: unknown[]) => checkAddonEntitlement(...a),
}));

import { checkUserEntitlement, readAddonRunVerdict, readAddonStateRevision, warmAddonStates } from '../addon-admission';

beforeEach(() => jest.clearAllMocks());

describe('readAddonRunVerdict', () => {
    it('켜져 있으면 run', async () => {
        readAddonEnabledStrict.mockResolvedValue({ known: true, enabled: true, state: 'enabled' });
        await expect(readAddonRunVerdict('sample-addon')).resolves.toEqual({ run: true });
        expect(readAddonEnabledStrict).toHaveBeenCalledWith('sample-addon');
    });

    it('꺼짐·실패·env 차단은 stopped(사유는 상태 이름)', async () => {
        readAddonEnabledStrict.mockResolvedValueOnce({ known: true, enabled: false, state: 'disabled' });
        await expect(readAddonRunVerdict('sample-addon')).resolves.toEqual({ run: false, reason: 'stopped', detail: 'disabled' });
        readAddonEnabledStrict.mockResolvedValueOnce({ known: true, enabled: false, state: 'failed' });
        await expect(readAddonRunVerdict('sample-addon')).resolves.toEqual({ run: false, reason: 'stopped', detail: 'failed' });
        readAddonEnabledStrict.mockResolvedValueOnce({ known: true, enabled: false, state: 'env_disabled' });
        await expect(readAddonRunVerdict('sample-addon')).resolves.toEqual({ run: false, reason: 'stopped', detail: 'env_disabled' });
    });

    it('상태 조회 실패는 unknown — 켜짐으로 읽지 않는다', async () => {
        readAddonEnabledStrict.mockResolvedValue({ known: false, reason: 'connect ECONNREFUSED' });
        await expect(readAddonRunVerdict('sample-addon')).resolves.toEqual({ run: false, reason: 'unknown', detail: 'connect ECONNREFUSED' });
    });
});

describe('사용권·revision·캐시', () => {
    it('checkUserEntitlement 는 라우트 게이트와 같은 판정에 그대로 위임한다', async () => {
        checkAddonEntitlement.mockResolvedValue('not-entitled');
        await expect(checkUserEntitlement('sample-addon', 'u-1')).resolves.toBe('not-entitled');
        expect(checkAddonEntitlement).toHaveBeenCalledWith('sample-addon', 'u-1');
    });

    it('readAddonStateRevision 은 아는 값이면 숫자, 조회 실패면 null', async () => {
        readAddonStateStrict.mockResolvedValueOnce({ known: true, registered: true, state: 'enabled', desiredState: 'enabled', stateRevision: 12, lastFailureCode: null });
        await expect(readAddonStateRevision('sample-addon')).resolves.toBe(12);
        readAddonStateStrict.mockResolvedValueOnce({ known: false, reason: 'timeout' });
        await expect(readAddonStateRevision('sample-addon')).resolves.toBeNull();
    });

    it('warmAddonStates 는 상태 캐시를 채운다', async () => {
        ensureAddonStates.mockResolvedValue(undefined);
        await warmAddonStates();
        expect(ensureAddonStates).toHaveBeenCalledTimes(1);
    });
});
