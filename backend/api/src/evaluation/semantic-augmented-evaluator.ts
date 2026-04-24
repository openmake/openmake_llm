/**
 * ============================================================
 * Semantic Augmented Evaluator — strict + relaxed 이중 평가
 * ============================================================
 *
 * 두 메트릭을 함께 보고 (Gemini 권고):
 * - top1-strict: 키워드 라우터의 top-1 결과가 expected에 포함 (절대 정확도)
 * - top3-relaxed: semantic 라우터의 top-3에 expected가 포함 (문맥 이해 유연성)
 *
 * 두 지표가 함께 있으면 "키워드는 틀렸지만 semantic은 맞춤" 같은
 * 차이를 명확히 시각화할 수 있어 Semantic Router 통합의 가치를 정량화함.
 *
 * @module evaluation/semantic-augmented-evaluator
 */
import { createLogger } from '../utils/logger';
import { routeToAgent } from '../agents';
import type { AgentCandidate } from '../agents/semantic-router';
import type { GoldenCase, GoldenDataset } from './types';

const logger = createLogger('SemanticAugmentedEvaluator');

export type RoutingFunction = typeof routeToAgent;
export type SemanticCandidatesFunction = (message: string, topK: number) => Promise<AgentCandidate[]>;
export type AgentCategoryLookup = (agentId: string) => string | undefined;

/** 단일 케이스의 strict + relaxed 결과 */
export interface AugmentedCaseResult {
    caseId: string;
    /** 키워드 라우터가 예상 정답에 일치 (top-1) */
    keywordStrict: boolean;
    /** semantic top-3 후보 안에 예상 정답이 포함 */
    semanticRelaxed: boolean;
    keywordAgentId: string;
    semanticTopAgentIds: string[];
    expectedAgentIds: string[];
    /** semantic이 strict에서 잡지 못한 정답을 추가로 잡았는가 (가치 입증) */
    semanticAddedValue: boolean;
    durationMs: number;
}

/** 데이터셋 전체 augmented 결과 */
export interface AugmentedSummary {
    datasetVersion: string;
    startedAt: string;
    completedAt: string;
    totalCases: number;
    /** 키워드 라우터 절대 정확도 (top-1) */
    strictPassRate: number;
    /** semantic top-3 유연 정확도 */
    relaxedPassRate: number;
    /** semantic이 추가로 잡은 비율 (relaxed - strict 의 일부) */
    semanticUpliftRate: number;
    /** strict 통과 케이스 수 */
    strictPassCount: number;
    /** relaxed 통과 케이스 수 */
    relaxedPassCount: number;
    /** semantic이 새로 잡은 케이스 수 */
    semanticUpliftCount: number;
    avgDurationMs: number;
    results: AugmentedCaseResult[];
}

function collectExpectedAgentIds(c: GoldenCase): string[] {
    const set = new Set<string>();
    if (c.expectedAgentId) set.add(c.expectedAgentId);
    if (c.expectedAgentIds) c.expectedAgentIds.forEach((id) => set.add(id));
    return Array.from(set);
}

/**
 * 단일 케이스의 strict + relaxed 평가
 */
export async function evaluateAugmentedCase(
    goldenCase: GoldenCase,
    routerFn: RoutingFunction,
    semanticFn: SemanticCandidatesFunction,
    topK: number = 3
): Promise<AugmentedCaseResult> {
    const start = Date.now();
    const expectedAgentIds = collectExpectedAgentIds(goldenCase);
    const expectedSet = new Set(expectedAgentIds);

    const [routingSelection, semanticCandidates] = await Promise.all([
        routerFn(goldenCase.query),
        semanticFn(goldenCase.query, topK).catch((err): AgentCandidate[] => {
            logger.warn(`semantic 호출 실패 (빈 후보 사용): ${err instanceof Error ? err.message : err}`);
            return [];
        }),
    ]);

    const keywordAgentId = routingSelection.primaryAgent;
    const semanticTopAgentIds = semanticCandidates.map((c) => c.agentId);

    const keywordStrict = expectedSet.size > 0 && expectedSet.has(keywordAgentId);
    const semanticRelaxed =
        expectedSet.size > 0 && semanticTopAgentIds.some((id) => expectedSet.has(id));

    return {
        caseId: goldenCase.id,
        keywordStrict,
        semanticRelaxed,
        keywordAgentId,
        semanticTopAgentIds,
        expectedAgentIds,
        semanticAddedValue: !keywordStrict && semanticRelaxed,
        durationMs: Date.now() - start,
    };
}

/**
 * 전체 데이터셋에 대한 augmented 평가
 *
 * routing-accuracy 카테고리 + expectedAgentId(s) 있는 케이스만 대상
 * (semantic은 agentId 기반이라 expectedCategory만 있는 케이스는 측정 불가)
 */
export async function runAugmentedEvaluation(
    dataset: GoldenDataset,
    semanticFn: SemanticCandidatesFunction,
    routerFn: RoutingFunction = routeToAgent,
    topK: number = 3
): Promise<AugmentedSummary> {
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    const cases = dataset.cases.filter(
        (c) => c.category === 'routing-accuracy' && collectExpectedAgentIds(c).length > 0
    );

    if (cases.length === 0) {
        logger.warn('augmented 평가 대상 케이스 없음 (expectedAgentId(s) 필요)');
    }

    const results: AugmentedCaseResult[] = [];
    for (const c of cases) {
        const r = await evaluateAugmentedCase(c, routerFn, semanticFn, topK);
        results.push(r);
    }

    const strictPass = results.filter((r) => r.keywordStrict).length;
    const relaxedPass = results.filter((r) => r.semanticRelaxed).length;
    const uplift = results.filter((r) => r.semanticAddedValue).length;
    const total = results.length;
    const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);

    const summary: AugmentedSummary = {
        datasetVersion: dataset.version,
        startedAt,
        completedAt: new Date().toISOString(),
        totalCases: total,
        strictPassRate: total > 0 ? strictPass / total : 0,
        relaxedPassRate: total > 0 ? relaxedPass / total : 0,
        semanticUpliftRate: total > 0 ? uplift / total : 0,
        strictPassCount: strictPass,
        relaxedPassCount: relaxedPass,
        semanticUpliftCount: uplift,
        avgDurationMs: total > 0 ? Math.round(totalDuration / total) : 0,
        results,
    };

    const totalMs = Date.now() - startMs;
    logger.info(
        `Augmented 평가 완료: strict ${strictPass}/${total} (${(summary.strictPassRate * 100).toFixed(1)}%), ` +
        `relaxed ${relaxedPass}/${total} (${(summary.relaxedPassRate * 100).toFixed(1)}%), ` +
        `semantic uplift ${uplift}건, 총 ${totalMs}ms`
    );
    return summary;
}
