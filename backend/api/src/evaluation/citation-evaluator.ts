/**
 * ============================================================
 * Citation Evaluator — Deep Research 인용 커버리지 평가 (A3 토대)
 * ============================================================
 *
 * 결정적 fixture 코퍼스를 순회하며 `verifyCitations`를 적용하고,
 *   (1) fixture 기대값 대비 회귀를 검출하고
 *   (2) 코퍼스 전체의 mean coverage / invalid-rate / skip 수를 집계한다.
 *
 * 런타임(report-generator)과 **동일한 측정 함수**를 공유하므로,
 * 이 평가가 통과하면 런타임 인용 측정도 동일하게 동작함이 보장된다.
 *
 * @module evaluation/citation-evaluator
 */

import { verifyCitations } from '../services/deep-research/citation-verifier';

/** fixture 단일 케이스 */
export interface CitationFixtureCase {
    id: string;
    sourceCount: number;
    report: string;
    expected: {
        totalClaims?: number;
        citedClaims?: number;
        /** 소수 4자리 반올림한 기대 커버리지 */
        coverageRounded?: number;
        invalidCount?: number;
        skipped?: boolean;
    };
}

export interface CitationFixtureDataset {
    version: string;
    description: string;
    cases: CitationFixtureCase[];
}

/** 단일 케이스 평가 결과 */
export interface CitationCaseResult {
    caseId: string;
    passed: boolean;
    failureReason?: string;
    coverage: number | null;
    invalidCount: number;
    skipped: boolean;
}

/** 코퍼스 전체 요약 */
export interface CitationEvalSummary {
    datasetVersion: string;
    totalCases: number;
    regressionFailures: number;
    /** 측정된(skipped 아닌) 케이스의 평균 커버리지 */
    meanCoverage: number | null;
    /** 측정된 케이스 중 invalid 인용을 가진 케이스 비율 */
    invalidRate: number | null;
    skippedCount: number;
    results: CitationCaseResult[];
}

function round4(n: number): number {
    return Math.round(n * 10000) / 10000;
}

/**
 * fixture 코퍼스에 대해 인용 평가 실행 (회귀 검출 + 집계)
 */
export function runCitationEvaluation(dataset: CitationFixtureDataset): CitationEvalSummary {
    const results: CitationCaseResult[] = [];
    let regressionFailures = 0;
    const coverages: number[] = [];
    let invalidCaseCount = 0;
    let skippedCount = 0;

    for (const c of dataset.cases) {
        const r = verifyCitations(c.report, c.sourceCount);
        const exp = c.expected;
        const reasons: string[] = [];

        if (exp.skipped !== undefined && r.skipped !== exp.skipped) {
            reasons.push(`skipped: ${r.skipped} ≠ ${exp.skipped}`);
        }
        if (!r.skipped) {
            if (exp.totalClaims !== undefined && r.totalClaims !== exp.totalClaims) {
                reasons.push(`totalClaims: ${r.totalClaims} ≠ ${exp.totalClaims}`);
            }
            if (exp.citedClaims !== undefined && r.citedClaims !== exp.citedClaims) {
                reasons.push(`citedClaims: ${r.citedClaims} ≠ ${exp.citedClaims}`);
            }
            if (exp.coverageRounded !== undefined && r.coverage !== null
                && round4(r.coverage) !== exp.coverageRounded) {
                reasons.push(`coverage: ${round4(r.coverage)} ≠ ${exp.coverageRounded}`);
            }
            if (exp.invalidCount !== undefined && r.invalidCitations.length !== exp.invalidCount) {
                reasons.push(`invalidCount: ${r.invalidCitations.length} ≠ ${exp.invalidCount}`);
            }
        }

        const passed = reasons.length === 0;
        if (!passed) regressionFailures++;

        if (r.skipped) {
            skippedCount++;
        } else {
            if (r.coverage !== null) coverages.push(r.coverage);
            if (r.invalidCitations.length > 0) invalidCaseCount++;
        }

        results.push({
            caseId: c.id,
            passed,
            failureReason: passed ? undefined : reasons.join('; '),
            coverage: r.coverage,
            invalidCount: r.invalidCitations.length,
            skipped: r.skipped,
        });
    }

    const measured = coverages.length;
    return {
        datasetVersion: dataset.version,
        totalCases: dataset.cases.length,
        regressionFailures,
        meanCoverage: measured > 0 ? round4(coverages.reduce((a, b) => a + b, 0) / measured) : null,
        invalidRate: measured > 0 ? round4(invalidCaseCount / measured) : null,
        skippedCount,
        results,
    };
}
