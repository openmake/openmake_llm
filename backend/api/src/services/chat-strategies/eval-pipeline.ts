/**
 * ============================================================
 * Eval Pipeline — 에이전트 응답 품질 평가 파이프라인
 * ============================================================
 *
 * Harness Engineering 원칙 (Verify):
 * 에이전트 응답을 다차원(정확성, 완전성, 관련성, 안전성)으로 평가하여
 * 품질 점수를 산출하고, 개선 포인트를 식별합니다.
 *
 * 규칙 기반 경량 평가자를 체인으로 실행하여 비용 없이 품질을 측정합니다.
 *
 * @module services/chat-strategies/eval-pipeline
 */

import { EVAL_PIPELINE } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('EvalPipeline');

// ============================================
// 타입 정의
// ============================================

/** 평가 차원 */
export type EvalDimension = 'correctness' | 'completeness' | 'relevance' | 'safety';

/** 개별 평가 결과 */
export interface Evaluation {
    dimension: EvalDimension;
    score: number; // 0.0 ~ 1.0
    reason: string;
    evaluator: string;
}

/** 평가자 입력 */
export interface EvaluatorInput {
    query: string;
    response: string;
    queryType?: string;
}

/** 평가자 인터페이스 */
export interface Evaluator {
    readonly name: string;
    evaluate(input: EvaluatorInput): Evaluation | null;
}

/** 파이프라인 최종 결과 */
export interface EvalResult {
    scores: Partial<Record<EvalDimension, number>>;
    compositeScore: number;
    evaluations: Evaluation[];
    evaluatorCount: number;
}

// ============================================
// 규칙 기반 평가자 구현
// ============================================

/**
 * 응답 완전성 평가자
 *
 * 응답 길이가 적절한 범위에 있는지 측정합니다.
 * 너무 짧으면 불완전, 너무 길면 장황한 응답으로 판단합니다.
 */
class CompletenessEvaluator implements Evaluator {
    readonly name = 'CompletenessEvaluator';

    evaluate({ response }: EvaluatorInput): Evaluation {
        const len = response.trim().length;
        const minLen = EVAL_PIPELINE.MIN_RESPONSE_LENGTH;
        const idealMin = EVAL_PIPELINE.COMPLETENESS_IDEAL_MIN;
        const warnMax = EVAL_PIPELINE.COMPLETENESS_WARN_MAX;

        let score: number;
        let reason: string;

        if (len < minLen) {
            score = 0.2;
            reason = `응답이 매우 짧음 (${len}자 < ${minLen}자)`;
        } else if (len < idealMin) {
            // minLen ~ idealMin 사이를 선형 보간
            score = 0.2 + 0.6 * ((len - minLen) / (idealMin - minLen));
            reason = `응답이 다소 짧음 (${len}자)`;
        } else if (len <= warnMax) {
            score = 1.0;
            reason = `적절한 응답 길이 (${len}자)`;
        } else {
            // warnMax 초과 시 점진적 감점
            score = Math.max(0.5, 1.0 - (len - warnMax) / warnMax);
            reason = `응답이 매우 김 (${len}자 > ${warnMax}자)`;
        }

        return { dimension: 'completeness', score: round(score), reason, evaluator: this.name };
    }
}

/**
 * 코드 블록 유효성 평가자
 *
 * 코드 블록(```)이 올바르게 열고 닫혔는지 확인합니다.
 * 코드가 없는 응답에서는 null을 반환하여 평가를 스킵합니다.
 */
class CodeBlockEvaluator implements Evaluator {
    readonly name = 'CodeBlockEvaluator';

    evaluate({ response }: EvaluatorInput): Evaluation | null {
        const fences = (response.match(/```/g) || []).length;
        if (fences === 0) return null;

        const isBalanced = fences % 2 === 0;
        return {
            dimension: 'correctness',
            score: isBalanced ? 1.0 : 0.3,
            reason: isBalanced
                ? `코드 블록 ${fences / 2}개 정상 닫힘`
                : `코드 블록 짝이 맞지 않음 (fence ${fences}개)`,
            evaluator: this.name,
        };
    }
}

/**
 * 안전성 패턴 평가자
 *
 * 응답에 개인정보(전화번호, 주민번호 등)나 비밀번호가 노출되었는지 검사합니다.
 */
class SafetyPatternEvaluator implements Evaluator {
    readonly name = 'SafetyPatternEvaluator';

    evaluate({ response }: EvaluatorInput): Evaluation {
        for (const pattern of EVAL_PIPELINE.SAFETY_BANNED_PATTERNS) {
            // RegExp는 stateful이므로 새 인스턴스로 테스트
            const re = new RegExp(pattern.source, pattern.flags);
            if (re.test(response)) {
                return {
                    dimension: 'safety',
                    score: 0.0,
                    reason: `금지 패턴 감지: ${pattern.source.substring(0, 30)}`,
                    evaluator: this.name,
                };
            }
        }
        return {
            dimension: 'safety',
            score: 1.0,
            reason: '안전성 패턴 미검출',
            evaluator: this.name,
        };
    }
}

/**
 * 관련성 평가자
 *
 * 사용자 쿼리의 핵심 키워드가 응답에 포함되었는지 측정합니다.
 * 단순 키워드 매칭 기반의 경량 평가입니다.
 */
class RelevanceEvaluator implements Evaluator {
    readonly name = 'RelevanceEvaluator';

    evaluate({ query, response }: EvaluatorInput): Evaluation {
        // 쿼리에서 의미 있는 단어 추출 (2글자 이상)
        const queryWords = query
            .replace(/[^\w가-힣]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 2);

        if (queryWords.length === 0) {
            return { dimension: 'relevance', score: 1.0, reason: '쿼리 키워드 없음 (평가 스킵)', evaluator: this.name };
        }

        const responseLower = response.toLowerCase();
        let matchCount = 0;
        for (const word of queryWords) {
            if (responseLower.includes(word.toLowerCase())) {
                matchCount++;
            }
        }

        const score = matchCount / queryWords.length;
        return {
            dimension: 'relevance',
            score: round(score),
            reason: `쿼리 키워드 ${matchCount}/${queryWords.length}개 매칭`,
            evaluator: this.name,
        };
    }
}

/**
 * 인용/출처 평가자 (보너스)
 *
 * 응답에 출처 인용이 포함되어 있으면 정확성 점수에 보너스를 부여합니다.
 * 인용이 없어도 감점하지 않습니다 (null 반환).
 */
class CitationEvaluator implements Evaluator {
    readonly name = 'CitationEvaluator';

    evaluate({ response }: EvaluatorInput): Evaluation | null {
        const hasCitation = EVAL_PIPELINE.CITATION_PATTERNS.some(pattern => {
            const re = new RegExp(pattern.source, pattern.flags);
            return re.test(response);
        });

        if (!hasCitation) return null;

        return {
            dimension: 'correctness',
            score: 1.0,
            reason: '출처/인용 포함',
            evaluator: this.name,
        };
    }
}

// ============================================
// EvalPipeline 클래스
// ============================================

/**
 * 규칙 기반 평가자 체인을 실행하여 응답 품질을 측정합니다.
 *
 * 사용법:
 * ```
 * const result = EvalPipeline.evaluate({ query, response });
 * ```
 */
export class EvalPipeline {
    private static readonly evaluators: Evaluator[] = [
        new CompletenessEvaluator(),
        new CodeBlockEvaluator(),
        new SafetyPatternEvaluator(),
        new RelevanceEvaluator(),
        new CitationEvaluator(),
    ];

    /**
     * 모든 평가자를 실행하여 종합 평가 결과를 반환합니다.
     */
    static evaluate(input: EvaluatorInput): EvalResult {
        const evaluations: Evaluation[] = [];

        for (const evaluator of this.evaluators) {
            try {
                const result = evaluator.evaluate(input);
                if (result !== null) {
                    evaluations.push(result);
                }
            } catch (e) {
                logger.warn(`평가자 ${evaluator.name} 실패 (무시):`, e instanceof Error ? e.message : e);
            }
        }

        // 차원별 평균 점수 계산
        const scores = this.aggregateByDimension(evaluations);

        // 종합 점수: 모든 차원 점수의 평균
        const dimensionScores = Object.values(scores);
        const compositeScore = dimensionScores.length > 0
            ? round(dimensionScores.reduce((sum, s) => sum + s, 0) / dimensionScores.length)
            : 0;

        logger.info(
            `📊 Eval: composite=${compositeScore}, ` +
            Object.entries(scores).map(([d, s]) => `${d}=${s}`).join(', ') +
            ` (${evaluations.length}개 평가)`
        );

        return {
            scores,
            compositeScore,
            evaluations,
            evaluatorCount: evaluations.length,
        };
    }

    /**
     * 차원별로 평가 결과를 집계합니다.
     * 동일 차원에 여러 평가가 있으면 평균을 냅니다.
     */
    private static aggregateByDimension(evaluations: Evaluation[]): Partial<Record<EvalDimension, number>> {
        const grouped = new Map<EvalDimension, number[]>();

        for (const ev of evaluations) {
            const existing = grouped.get(ev.dimension) || [];
            existing.push(ev.score);
            grouped.set(ev.dimension, existing);
        }

        const result: Partial<Record<EvalDimension, number>> = {};
        for (const [dimension, scores] of grouped) {
            result[dimension] = round(scores.reduce((sum, s) => sum + s, 0) / scores.length);
        }

        return result;
    }
}

/** 소수점 2자리로 반올림 */
function round(value: number): number {
    return Math.round(value * 100) / 100;
}
