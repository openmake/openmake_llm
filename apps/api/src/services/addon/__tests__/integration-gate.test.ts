/**
 * 채팅 기능 훅 게이트(integrationGate) — 라우트 게이트와 같은 판정 함수(checkAddonEntitlement)의 결과를
 * 기능 훅용 판정으로 옮긴다. 상태 축 + 조직 사용권 축, 확인 불가는 실행하지 않는다(fail-closed).
 */
const checkAddonEntitlement = jest.fn();
jest.mock('../entitlement', () => ({ checkAddonEntitlement: (...a: unknown[]) => checkAddonEntitlement(...a) }));

import { integrationGate } from '../integration-gate';

beforeEach(() => checkAddonEntitlement.mockReset());

describe('integrationGate', () => {
    it.each([
        ['ok', { allowed: true }],
        ['disabled', { allowed: false, reason: 'disabled' }],
        ['failed', { allowed: false, reason: 'failed' }],
        ['state-unknown', { allowed: false, reason: 'state_unknown', detail: '상태·정책 조회 실패' }],
        ['not-entitled', { allowed: false, reason: 'not_entitled' }],
    ])('판정 %s → %p', async (verdict, expected) => {
        checkAddonEntitlement.mockResolvedValue(verdict);
        expect(await integrationGate('pack', 'u1')).toEqual(expected);
    });

    it('사용자 id 를 판정 함수에 그대로 넘긴다', async () => {
        checkAddonEntitlement.mockResolvedValue('ok');
        await integrationGate('pack', 'u7');
        expect(checkAddonEntitlement).toHaveBeenCalledWith('pack', 'u7');
    });

    it('사용자가 없으면(게스트·내부 호출) undefined 로 넘긴다 — 조직 축은 판정 함수가 건너뛴다', async () => {
        checkAddonEntitlement.mockResolvedValue('ok');
        await integrationGate('pack');
        expect(checkAddonEntitlement).toHaveBeenCalledWith('pack', undefined);
    });
});
