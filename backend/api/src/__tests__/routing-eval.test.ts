/**
 * 모델 라우팅 자동 평가 테스트
 *
 * regex 기반 query-classifier의 분류 정확도를 자동으로 측정합니다.
 * 104개 라벨링된 평가 케이스에 대해:
 * - 전체 정확도 (strict: expected만 / lenient: acceptable 포함)
 * - QueryType별 정확도
 * - 난이도별 정확도
 * - 혼동 행렬 (confusion matrix)
 *
 * CI에서 최소 정확도 임계값 게이트로도 동작합니다.
 *
 * @module __tests__/routing-eval
 */

import { describe, it, expect } from 'bun:test';
import { classifyQuery } from '../domains/chat/pipeline/query-classifier';
import type { QueryType } from '../domains/chat/pipeline/model-selector-types';
import { ROUTING_EVAL_DATASET, type EvalCase } from './routing-eval-data';

// ═══════════════════════════════════════════
// 정확도 임계값 (CI 게이트)
// ═══════════════════════════════════════════
const MIN_STRICT_ACCURACY = 0.60;   // strict: expected만 일치
const MIN_LENIENT_ACCURACY = 0.75;  // lenient: acceptable 포함

const ALL_TYPES: QueryType[] = ['code', 'math', 'analysis', 'creative', 'vision', 'document', 'translation', 'chat', 'korean'];

interface EvalResult {
    query: string;
    expected: QueryType;
    actual: QueryType;
    acceptable: QueryType[];
    difficulty: string;
    strictPass: boolean;
    lenientPass: boolean;
    confidence: number;
}

function runEvaluation(dataset: EvalCase[]): EvalResult[] {
    return dataset.map(c => {
        const result = classifyQuery(c.query);
        const acceptable = c.acceptable ?? [];
        return {
            query: c.query,
            expected: c.expected,
            actual: result.type,
            acceptable,
            difficulty: c.difficulty,
            strictPass: result.type === c.expected,
            lenientPass: result.type === c.expected || acceptable.includes(result.type),
            confidence: result.confidence,
        };
    });
}

function printReport(results: EvalResult[]): void {
    const total = results.length;
    const strictCorrect = results.filter(r => r.strictPass).length;
    const lenientCorrect = results.filter(r => r.lenientPass).length;

    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║    모델 라우팅 분류 평가 리포트               ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  총 케이스: ${total}`);
    console.log(`║  Strict  정확도: ${strictCorrect}/${total} (${(strictCorrect / total * 100).toFixed(1)}%)`);
    console.log(`║  Lenient 정확도: ${lenientCorrect}/${total} (${(lenientCorrect / total * 100).toFixed(1)}%)`);
    console.log('╠══════════════════════════════════════════════╣');

    // QueryType별 정확도
    console.log('║  [유형별 Strict 정확도]');
    for (const type of ALL_TYPES) {
        const cases = results.filter(r => r.expected === type);
        if (cases.length === 0) continue;
        const correct = cases.filter(r => r.strictPass).length;
        const bar = '█'.repeat(Math.round(correct / cases.length * 20));
        console.log(`║    ${type.padEnd(12)} ${correct}/${cases.length} ${bar} ${(correct / cases.length * 100).toFixed(0)}%`);
    }

    // 난이도별 정확도
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  [난이도별 Strict 정확도]');
    for (const diff of ['easy', 'boundary', 'hard'] as const) {
        const cases = results.filter(r => r.difficulty === diff);
        if (cases.length === 0) continue;
        const correct = cases.filter(r => r.strictPass).length;
        console.log(`║    ${diff.padEnd(10)} ${correct}/${cases.length} (${(correct / cases.length * 100).toFixed(1)}%)`);
    }

    // 실패 케이스 목록
    const failures = results.filter(r => !r.lenientPass);
    if (failures.length > 0) {
        console.log('╠══════════════════════════════════════════════╣');
        console.log('║  [Lenient 실패 케이스]');
        for (const f of failures) {
            console.log(`║    expected=${f.expected} actual=${f.actual} q="${f.query.substring(0, 50)}..."`);
        }
    }

    // 혼동 행렬 (compact)
    console.log('╠══════════════════════════════════════════════╣');
    console.log('║  [혼동 행렬] (행=expected, 열=actual, 0 생략)');
    const usedTypes = ALL_TYPES.filter(t => results.some(r => r.expected === t || r.actual === t));
    const header = '          ' + usedTypes.map(t => t.substring(0, 4).padEnd(5)).join('');
    console.log(`║  ${header}`);
    for (const expected of usedTypes) {
        const row = usedTypes.map(actual => {
            const count = results.filter(r => r.expected === expected && r.actual === actual).length;
            return (count > 0 ? String(count) : '.').padEnd(5);
        }).join('');
        console.log(`║  ${expected.substring(0, 8).padEnd(10)}${row}`);
    }

    console.log('╚══════════════════════════════════════════════╝');
}

// ═══════════════════════════════════════════
// 테스트
// ═══════════════════════════════════════════

describe('모델 라우팅 자동 평가', () => {
    const results = runEvaluation(ROUTING_EVAL_DATASET);

    it('평가 리포트 출력', () => {
        printReport(results);
    });

    it(`Strict 정확도 >= ${(MIN_STRICT_ACCURACY * 100).toFixed(0)}%`, () => {
        const accuracy = results.filter(r => r.strictPass).length / results.length;
        expect(accuracy).toBeGreaterThanOrEqual(MIN_STRICT_ACCURACY);
    });

    it(`Lenient 정확도 >= ${(MIN_LENIENT_ACCURACY * 100).toFixed(0)}%`, () => {
        const accuracy = results.filter(r => r.lenientPass).length / results.length;
        expect(accuracy).toBeGreaterThanOrEqual(MIN_LENIENT_ACCURACY);
    });

    // QueryType별 최소 정확도 (각 유형에서 최소 50% 이상)
    for (const type of ALL_TYPES) {
        const cases = ROUTING_EVAL_DATASET.filter(c => c.expected === type);
        if (cases.length === 0) continue;

        it(`${type} 유형: Lenient 정확도 >= 50%`, () => {
            const typeResults = results.filter(r => r.expected === type);
            const accuracy = typeResults.filter(r => r.lenientPass).length / typeResults.length;
            expect(accuracy).toBeGreaterThanOrEqual(0.5);
        });
    }

    // easy 케이스는 높은 정확도 기대
    it('easy 케이스: Strict 정확도 >= 80%', () => {
        const easyResults = results.filter(r => r.difficulty === 'easy');
        const accuracy = easyResults.filter(r => r.strictPass).length / easyResults.length;
        expect(accuracy).toBeGreaterThanOrEqual(0.8);
    });
});
