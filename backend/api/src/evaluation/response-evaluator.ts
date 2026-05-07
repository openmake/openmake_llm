/**
 * ============================================================
 * Response Evaluator — 응답 패턴 평가기
 * ============================================================
 *
 * mustContain / mustNotContain substring 기반 검증.
 * LLM 호출 비용이 발생하므로 generator 함수를 외부 주입 받음
 * (테스트 시 mock 가능, 운영 시 ChatService 호출).
 *
 * Gemini 권고: 별도 npm script(eval:response)로 분리하여
 * 빠른 라우팅 평가와 느린 응답 평가를 구분 실행.
 *
 * @module evaluation/response-evaluator
 */
import { createLogger } from '../utils/logger';
import type { GoldenCase, CaseResult, EvaluationSummary, GoldenDataset, EvaluationCategory } from './types';

const logger = createLogger('ResponseEvaluator');

/**
 * 외부 주입 가능한 응답 생성 함수 (테스트 시 mock)
 * 실제 운영에서는 ChatService.processMessage 등을 wrapping
 */
export type ResponseGenerator = (query: string, language?: string) => Promise<string>;

/**
 * 단일 response-pattern 케이스 평가
 *
 * 통과 조건:
 * - mustContain: 모든 substring이 응답에 포함
 * - mustNotContain: 어떤 substring도 응답에 포함되지 않음
 * - 두 조건 동시 명시 시 둘 다 만족 (AND)
 */
export async function evaluateResponseCase(
    goldenCase: GoldenCase,
    generator: ResponseGenerator
): Promise<CaseResult> {
    const start = Date.now();
    try {
        const response = await generator(goldenCase.query, goldenCase.language);

        const missing = (goldenCase.mustContain ?? []).filter((s) => !response.includes(s));
        const forbidden = (goldenCase.mustNotContain ?? []).filter((s) => response.includes(s));

        let passed = true;
        let failureReason: string | undefined;

        if (missing.length > 0 && forbidden.length > 0) {
            passed = false;
            failureReason = `누락 substring=[${missing.join(',')}], 금지 substring 포함=[${forbidden.join(',')}]`;
        } else if (missing.length > 0) {
            passed = false;
            failureReason = `누락 substring=[${missing.join(',')}]`;
        } else if (forbidden.length > 0) {
            passed = false;
            failureReason = `금지 substring이 응답에 포함=[${forbidden.join(',')}]`;
        }

        return {
            caseId: goldenCase.id,
            category: goldenCase.category,
            passed,
            failureReason,
            actual: { responseLength: response.length, missing, forbidden },
            expected: {
                mustContain: goldenCase.mustContain ?? [],
                mustNotContain: goldenCase.mustNotContain ?? [],
            },
            durationMs: Date.now() - start,
        };
    } catch (e) {
        return {
            caseId: goldenCase.id,
            category: goldenCase.category,
            passed: false,
            failureReason: `응답 생성 중 예외: ${e instanceof Error ? e.message : String(e)}`,
            durationMs: Date.now() - start,
        };
    }
}

/**
 * 데이터셋 전체에 대해 response-pattern 평가 실행
 */
export async function runResponseEvaluation(
    dataset: GoldenDataset,
    generator: ResponseGenerator
): Promise<EvaluationSummary> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const cases = dataset.cases.filter((c) => c.category === 'response-pattern');

    if (cases.length === 0) {
        logger.warn('response-pattern 카테고리 케이스가 없음 — 빈 결과 반환');
    }

    const results: CaseResult[] = [];
    for (const c of cases) {
        const result = await evaluateResponseCase(c, generator);
        results.push(result);
        if (!result.passed) {
            logger.warn(`[FAIL] ${c.id}: ${result.failureReason}`);
        }
    }

    const passedCount = results.filter((r) => r.passed).length;
    const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
    const avgDuration = results.length > 0 ? Math.round(totalDuration / results.length) : 0;

    const passRateByCategory: Partial<Record<EvaluationCategory, { total: number; passed: number; rate: number }>> = {};
    if (results.length > 0) {
        passRateByCategory['response-pattern'] = {
            total: results.length,
            passed: passedCount,
            rate: passedCount / results.length,
        };
    }

    const summary: EvaluationSummary = {
        datasetVersion: dataset.version,
        startedAt,
        completedAt: new Date().toISOString(),
        totalCases: results.length,
        passedCases: passedCount,
        failedCases: results.length - passedCount,
        passRate: results.length > 0 ? passedCount / results.length : 0,
        passRateByCategory,
        avgDurationMs: avgDuration,
        results,
    };

    const totalMs = Date.now() - startMs;
    logger.info(
        `응답 평가 완료: ${passedCount}/${results.length} 통과 ` +
        `(${(summary.passRate * 100).toFixed(1)}%), 총 ${totalMs}ms`
    );
    return summary;
}
