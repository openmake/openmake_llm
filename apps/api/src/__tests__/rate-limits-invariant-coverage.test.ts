/**
 * Rate-limits invariant coverage 검증.
 *
 * 의도: `config/rate-limits.ts` 에서 export 된 모든 `RL_*` config 가
 * `_windowMsInvariant` 배열에 등록되어 module load 시 windowMs
 * 32-bit overflow 검증 대상이 되도록 보장.
 *
 * 회귀 시나리오:
 *   - 개발자가 신규 `RL_FOO` 추가 + invariant 배열 갱신 누락
 *   - boot 시점 검증 자체가 누락 → 운영 중 windowMs 30일 같은 값 들어와도 통과
 *   - 본 test 가 PR 단계에서 누락 차단 (CI/local jest)
 *
 * runtime invariant (module load 시 throw) 가 1차 방어, 본 test 는
 * coverage 검증 보완재.
 */
import * as RateLimits from '../config/rate-limits';

describe('rate-limits invariant coverage', () => {
    test('모든 RL_* export 가 _windowMsInvariant 에 등록되어 있어야 한다', () => {
        // 1) 모든 RL_* named export 수집
        const allExportedRLNames = Object.keys(RateLimits)
            .filter(k => k.startsWith('RL_'))
            .sort();

        // 2) invariant 에 등록된 이름
        const registered = RateLimits.getRegisteredInvariantNames().sort();

        // 3) 누락 검사
        const missing = allExportedRLNames.filter(n => !registered.includes(n));
        const extra = registered.filter(n => !allExportedRLNames.includes(n));

        if (missing.length > 0 || extra.length > 0) {
            const msg: string[] = [];
            if (missing.length > 0) {
                msg.push(
                    `_windowMsInvariant 에 누락된 RL_* (boot 검증 누락):\n  ${missing.join('\n  ')}\n` +
                    `→ apps/api/src/config/rate-limits.ts 의 _windowMsInvariant 배열에 추가하세요.`,
                );
            }
            if (extra.length > 0) {
                msg.push(
                    `_windowMsInvariant 에는 있지만 export 안 된 이름 (오타?):\n  ${extra.join('\n  ')}`,
                );
            }
            throw new Error(msg.join('\n\n'));
        }

        expect(missing).toEqual([]);
        expect(extra).toEqual([]);
    });

    test('등록된 모든 RL_* 의 windowMs 가 2^31-1 (24.85일) 이하여야 한다', () => {
        const SAFE_32BIT_MS = 2_147_483_647;
        const allRL = Object.keys(RateLimits)
            .filter(k => k.startsWith('RL_'))
            .map(k => ({ name: k, cfg: (RateLimits as Record<string, unknown>)[k] as { windowMs: number } }));

        const overflowing = allRL.filter(r => r.cfg.windowMs > SAFE_32BIT_MS);
        if (overflowing.length > 0) {
            throw new Error(
                `windowMs 32-bit overflow:\n` +
                overflowing.map(r => `  ${r.name}.windowMs=${r.cfg.windowMs} > ${SAFE_32BIT_MS}`).join('\n'),
            );
        }
        expect(overflowing).toEqual([]);
    });
});
