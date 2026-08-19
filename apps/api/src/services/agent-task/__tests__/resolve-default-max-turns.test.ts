import { resolveDefaultMaxTurns } from '../task-inputs';
import { AGENT_TASK_LIMITS, DOC_EXTRACT_LIMITS } from '../../../config/runtime-limits';

/**
 * 기본 턴 수 결정 — 특히 LARGE_INPUT_MAX_TURNS 가 DEFAULT_MAX_TURNS 보다 작아졌을 때
 * (기본 10→32 상향, 2026-08-19) 대형 첨부가 오히려 손해를 보는 역전이 없어야 한다.
 * 둘 다 env 로 조정 가능해 역전 자체는 언제든 재현될 수 있다.
 */
describe('resolveDefaultMaxTurns', () => {
    const bigFile = { name: 'scan.pdf', size: DOC_EXTRACT_LIMITS.MAX_BYTES_PER_FILE + 1 };

    it('명시 maxTurns 가 오면 그대로 쓴다', () => {
        expect(resolveDefaultMaxTurns(7, undefined)).toBe(7);
        expect(resolveDefaultMaxTurns(7, [bigFile] as never)).toBe(7);
    });

    it('첨부가 없으면 기본값', () => {
        expect(resolveDefaultMaxTurns(undefined, undefined)).toBe(AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS);
    });

    it('대형 첨부는 기본값보다 작아지지 않는다(역전 방지)', () => {
        expect(resolveDefaultMaxTurns(undefined, [bigFile] as never))
            .toBeGreaterThanOrEqual(AGENT_TASK_LIMITS.DEFAULT_MAX_TURNS);
    });
});
