/**
 * 딥리서치 청크 요약 예산 회귀 테스트.
 *
 * 2026-09-13 라이브: 청크 요약 호출에 출력 상한이 없어 모델이 1,400+ 토큰을 생성 →
 * 로컬 qwen3.8-27b(~10.7 tok/s)에서 단일 123.5초·동시5 최대 129.7초가 걸려
 * 청크 타임아웃(당시 120초)에 6/6 전멸 → "모든 청크 요약 실패" → 보고서 없이 종료.
 * (같은 조건에서 상한 800 은 72.9초로 통과)
 *
 * 상한과 타임아웃의 관계를 고정한다 — 상한을 없애거나 타임아웃을 내리면 실패한다.
 */
import { RESEARCH_DEFAULTS } from '../../../config/runtime-limits';
import { LLM_TIMEOUTS } from '../../../config/timeouts';

describe('청크 요약 예산', () => {
    it('출력 상한이 설정돼 있다', () => {
        expect(RESEARCH_DEFAULTS.CHUNK_SUMMARY_MAX_TOKENS).toBeGreaterThan(0);
        expect(RESEARCH_DEFAULTS.CHUNK_SUMMARY_MAX_TOKENS).toBeLessThanOrEqual(1200);
    });

    it('상한 × 로컬 모델 최저 속도가 타임아웃 안에 들어간다', () => {
        // 라이브 실측 하한 (2026-09-02 qwen3.8-27b 교체 후): 디코드 약 10.7 tok/s.
        // 동시 실행 경합을 감안해 보수적으로 7 tok/s 로 계산한다.
        const CONSERVATIVE_TOK_PER_SEC = 7;
        const worstCaseMs = (RESEARCH_DEFAULTS.CHUNK_SUMMARY_MAX_TOKENS / CONSERVATIVE_TOK_PER_SEC) * 1000;
        expect(worstCaseMs).toBeLessThan(LLM_TIMEOUTS.SYNTHESIS_PER_CHUNK_TIMEOUT_MS);
    });

    it('병합 타임아웃은 청크 타임아웃보다 크다', () => {
        expect(LLM_TIMEOUTS.SYNTHESIS_MERGE_TIMEOUT_MS).toBeGreaterThan(LLM_TIMEOUTS.SYNTHESIS_PER_CHUNK_TIMEOUT_MS);
    });
});
