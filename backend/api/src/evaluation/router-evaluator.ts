/**
 * ============================================================
 * Router Evaluator — 라우팅 정확도 평가기
 * ============================================================
 *
 * 골든셋의 routing-accuracy 케이스에 대해 keyword router를 호출하고
 * 예상 에이전트와 일치하는지 측정합니다.
 *
 * PoC 단계는 keyword router(deterministic)만 평가:
 * - 빠르고 비용 0
 * - 회귀 검출에 충분
 * - LLM router 평가는 별도 모듈로 향후 추가
 *
 * @module evaluation/router-evaluator
 */
import { createLogger } from '../utils/logger';
import { routeToAgent } from '../agents';
import type { GoldenCase, CaseResult, EvaluationSummary, GoldenDataset, EvaluationCategory } from './types';

const logger = createLogger('RouterEvaluator');

/**
 * 외부 주입 가능한 라우팅 함수 (테스트 시 mock 가능)
 */
export type RoutingFunction = typeof routeToAgent;

/**
 * 케이스의 expectedAgentId(legacy)와 expectedAgentIds(new)를 합집합으로 만듭니다.
 * 둘 다 비어 있으면 빈 배열.
 */
function collectExpectedAgentIds(c: GoldenCase): string[] {
    const set = new Set<string>();
    if (c.expectedAgentId) set.add(c.expectedAgentId);
    if (c.expectedAgentIds) c.expectedAgentIds.forEach((id) => set.add(id));
    return Array.from(set);
}

/**
 * 케이스의 expectedCategory(legacy)와 expectedCategories(new)를 합집합으로 만듭니다.
 */
function collectExpectedCategories(c: GoldenCase): string[] {
    const set = new Set<string>();
    if (c.expectedCategory) set.add(c.expectedCategory);
    if (c.expectedCategories) c.expectedCategories.forEach((cat) => set.add(cat));
    return Array.from(set);
}

/**
 * 단일 라우팅 케이스 평가
 *
 * 정답 판정 (Gemini 권고: union 처리):
 * - expectedAgentId/expectedAgentIds 합집합에 actualAgentId가 있으면 통과
 * - expectedCategory/expectedCategories 합집합에 actualCategory가 있으면 통과
 * - 둘 다 명시되면 둘 다 만족해야 함 (AND)
 */
export async function evaluateRoutingCase(
    goldenCase: GoldenCase,
    routerFn: RoutingFunction = routeToAgent,
    agentCategoryLookup: (agentId: string) => string | undefined = defaultAgentCategoryLookup
): Promise<CaseResult> {
    const start = Date.now();
    try {
        const selection = await routerFn(goldenCase.query);
        const actualAgentId = selection.primaryAgent;
        const actualCategory = agentCategoryLookup(actualAgentId);

        const allowedAgentIds = collectExpectedAgentIds(goldenCase);
        const allowedCategories = collectExpectedCategories(goldenCase);

        let passed = true;
        let failureReason: string | undefined;

        if (allowedAgentIds.length > 0 && !allowedAgentIds.includes(actualAgentId)) {
            passed = false;
            failureReason = `expectedAgentIds=[${allowedAgentIds.join(',')}], actual=${actualAgentId}`;
        } else if (allowedCategories.length > 0 && (!actualCategory || !allowedCategories.includes(actualCategory))) {
            passed = false;
            failureReason = `expectedCategories=[${allowedCategories.join(',')}], actual=${actualCategory ?? 'unknown'}`;
        }

        return {
            caseId: goldenCase.id,
            category: goldenCase.category,
            passed,
            failureReason,
            actual: { agentId: actualAgentId, category: actualCategory, confidence: selection.confidence },
            expected: {
                agentIds: allowedAgentIds,
                categories: allowedCategories,
            },
            durationMs: Date.now() - start,
        };
    } catch (e) {
        return {
            caseId: goldenCase.id,
            category: goldenCase.category,
            passed: false,
            failureReason: `평가 중 예외: ${e instanceof Error ? e.message : String(e)}`,
            durationMs: Date.now() - start,
        };
    }
}

/**
 * 데이터셋 전체에 대해 라우팅 평가를 실행하고 요약을 반환
 */
export async function runRoutingEvaluation(
    dataset: GoldenDataset,
    routerFn: RoutingFunction = routeToAgent,
    agentCategoryLookup: (agentId: string) => string | undefined = defaultAgentCategoryLookup
): Promise<EvaluationSummary> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();
    const routingCases = dataset.cases.filter((c) => c.category === 'routing-accuracy');

    if (routingCases.length === 0) {
        logger.warn('routing-accuracy 카테고리 케이스가 없음 — 빈 결과 반환');
    }

    const results: CaseResult[] = [];
    for (const c of routingCases) {
        const result = await evaluateRoutingCase(c, routerFn, agentCategoryLookup);
        results.push(result);
        if (!result.passed) {
            logger.warn(`[FAIL] ${c.id}: ${result.failureReason}`);
        }
    }

    const passedCount = results.filter((r) => r.passed).length;
    const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
    const avgDuration = results.length > 0 ? Math.round(totalDuration / results.length) : 0;

    const summary: EvaluationSummary = {
        datasetVersion: dataset.version,
        startedAt,
        completedAt: new Date().toISOString(),
        totalCases: results.length,
        passedCases: passedCount,
        failedCases: results.length - passedCount,
        passRate: results.length > 0 ? passedCount / results.length : 0,
        passRateByCategory: computePassRateByCategory(results),
        avgDurationMs: avgDuration,
        results,
    };

    const totalMs = Date.now() - startMs;
    logger.info(
        `라우팅 평가 완료: ${passedCount}/${results.length} 통과 ` +
        `(${(summary.passRate * 100).toFixed(1)}%), 총 ${totalMs}ms`
    );
    return summary;
}

function computePassRateByCategory(results: CaseResult[]): EvaluationSummary['passRateByCategory'] {
    const acc: Partial<Record<EvaluationCategory, { total: number; passed: number; rate: number }>> = {};
    for (const r of results) {
        const bucket = acc[r.category] ?? { total: 0, passed: 0, rate: 0 };
        bucket.total++;
        if (r.passed) bucket.passed++;
        bucket.rate = bucket.total > 0 ? bucket.passed / bucket.total : 0;
        acc[r.category] = bucket;
    }
    return acc;
}

/**
 * 기본 카테고리 lookup — agent-data의 AGENTS 맵 사용
 * lazy require로 evaluator 모듈 자체는 의존성 가볍게 유지
 */
function defaultAgentCategoryLookup(agentId: string): string | undefined {
    // require로 lazy load — circular import 방지 + 테스트 시 쉽게 mock 가능
     
    const { AGENTS } = require('../agents');
    return AGENTS[agentId]?.category;
}
