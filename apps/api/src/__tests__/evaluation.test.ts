/**
 * Evaluation Pipeline 단위 테스트
 * - 데이터셋 로더 검증
 * - 라우팅 평가기 동작 (mock router)
 */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { loadGoldenDataset, filterCasesByCategory, filterCasesByTag } from '../evaluation/dataset-loader';
import { evaluateRoutingCase, runRoutingEvaluation, type RoutingFunction } from '../evaluation/router-evaluator';
import type { GoldenCase, GoldenDataset } from '../evaluation/types';

const validDataset: GoldenDataset = {
    version: '0.0.1-test',
    description: 'Unit test fixture',
    cases: [
        {
            id: 'rt-1',
            category: 'routing-accuracy',
            query: 'write Python code',
            expectedAgentId: 'software-engineer',
            language: 'en',
            tags: ['coding'],
        },
        {
            id: 'rt-2',
            category: 'routing-accuracy',
            query: '마케팅 캠페인 기획',
            expectedCategory: 'marketing',
            language: 'ko',
            tags: ['marketing'],
        },
    ],
};

function writeTempDataset(data: unknown): string {
    const tmpFile = path.join(os.tmpdir(), `eval-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(tmpFile, JSON.stringify(data), 'utf-8');
    return tmpFile;
}

describe('dataset-loader', () => {
    it('유효한 골든셋 JSON을 파싱하여 반환', () => {
        const file = writeTempDataset(validDataset);
        const loaded = loadGoldenDataset(file);
        expect(loaded.version).toBe('0.0.1-test');
        expect(loaded.cases.length).toBe(2);
        fs.unlinkSync(file);
    });

    it('파일이 없으면 명확한 에러 throw', () => {
        expect(() => loadGoldenDataset('/nonexistent/path.json')).toThrow(/찾을 수 없습니다/);
    });

    it('스키마 위반 시 검증 에러 throw (필수 필드 누락)', () => {
        const file = writeTempDataset({ version: '1.0', cases: [] });
        expect(() => loadGoldenDataset(file)).toThrow(/검증 실패/);
        fs.unlinkSync(file);
    });

    it('routing-accuracy 케이스에 expectedAgentId/expectedCategory 둘 다 없으면 의미 검증 실패', () => {
        const file = writeTempDataset({
            version: '1.0',
            description: 'invalid',
            cases: [{ id: 'bad-1', category: 'routing-accuracy', query: 'test' }],
        });
        expect(() => loadGoldenDataset(file)).toThrow(/expectedAgentId.*expectedCategory/);
        fs.unlinkSync(file);
    });

    it('카테고리별 필터링', () => {
        const filtered = filterCasesByCategory(validDataset, 'routing-accuracy');
        expect(filtered.length).toBe(2);
        const empty = filterCasesByCategory(validDataset, 'response-pattern');
        expect(empty.length).toBe(0);
    });

    it('태그별 필터링', () => {
        const coding = filterCasesByTag(validDataset, 'coding');
        expect(coding.length).toBe(1);
        expect(coding[0].id).toBe('rt-1');
    });
});

describe('router-evaluator', () => {
    const mockRouter: RoutingFunction = jest.fn(async (message: string) => {
        // 단순한 mock: 'python'/'code' 포함 → software-engineer, '마케팅'/'marketing' → marketer
        if (/python|code/i.test(message)) {
            return { primaryAgent: 'software-engineer', confidence: 0.9 };
        }
        if (/마케팅|marketing/i.test(message)) {
            return { primaryAgent: 'marketer', confidence: 0.8 };
        }
        return { primaryAgent: 'general', confidence: 0.3 };
    });

    const mockCategoryLookup = (agentId: string): string | undefined => {
        const map: Record<string, string> = {
            'software-engineer': 'technology',
            'marketer': 'marketing',
            'general': 'general',
        };
        return map[agentId];
    };

    it('expectedAgentId 일치 → passed=true', async () => {
        const c: GoldenCase = {
            id: 'a', category: 'routing-accuracy', query: 'write python',
            expectedAgentId: 'software-engineer',
        };
        const result = await evaluateRoutingCase(c, mockRouter, mockCategoryLookup);
        expect(result.passed).toBe(true);
        expect(result.failureReason).toBeUndefined();
    });

    it('expectedAgentId 불일치 → passed=false, 명확한 reason', async () => {
        const c: GoldenCase = {
            id: 'b', category: 'routing-accuracy', query: 'random text',
            expectedAgentId: 'software-engineer',
        };
        const result = await evaluateRoutingCase(c, mockRouter, mockCategoryLookup);
        expect(result.passed).toBe(false);
        expect(result.failureReason).toContain('software-engineer');
        expect(result.failureReason).toContain('general');
    });

    it('expectedCategory 일치 → passed=true (마케팅 케이스)', async () => {
        const c: GoldenCase = {
            id: 'c', category: 'routing-accuracy', query: '마케팅 캠페인',
            expectedCategory: 'marketing',
        };
        const result = await evaluateRoutingCase(c, mockRouter, mockCategoryLookup);
        expect(result.passed).toBe(true);
    });

    it('라우터 throw 시 passed=false, 예외 메시지 캡처', async () => {
        const failingRouter: RoutingFunction = jest.fn(async () => {
            throw new Error('연결 실패');
        });
        const c: GoldenCase = {
            id: 'd', category: 'routing-accuracy', query: 'test',
            expectedAgentId: 'software-engineer',
        };
        const result = await evaluateRoutingCase(c, failingRouter, mockCategoryLookup);
        expect(result.passed).toBe(false);
        expect(result.failureReason).toContain('연결 실패');
    });

    it('runRoutingEvaluation: 전체 데이터셋 평가 + 요약 메트릭 산출', async () => {
        const summary = await runRoutingEvaluation(validDataset, mockRouter, mockCategoryLookup);
        expect(summary.totalCases).toBe(2);
        expect(summary.passedCases).toBe(2);
        expect(summary.failedCases).toBe(0);
        expect(summary.passRate).toBe(1);
        expect(summary.passRateByCategory['routing-accuracy']?.total).toBe(2);
        expect(summary.passRateByCategory['routing-accuracy']?.passed).toBe(2);
        expect(summary.results.length).toBe(2);
        expect(summary.startedAt).toBeTruthy();
        expect(summary.completedAt).toBeTruthy();
    });

    it('runRoutingEvaluation: 실패 케이스 메트릭 정확 반영', async () => {
        const mixedDataset: GoldenDataset = {
            version: 'mix',
            description: '혼합',
            cases: [
                { id: 'pass-1', category: 'routing-accuracy', query: 'python', expectedAgentId: 'software-engineer' },
                { id: 'fail-1', category: 'routing-accuracy', query: 'python', expectedAgentId: 'designer' },
            ],
        };
        const summary = await runRoutingEvaluation(mixedDataset, mockRouter, mockCategoryLookup);
        expect(summary.passedCases).toBe(1);
        expect(summary.failedCases).toBe(1);
        expect(summary.passRate).toBe(0.5);
    });

    it('routing-accuracy 케이스가 없으면 빈 결과 반환', async () => {
        const emptyDataset: GoldenDataset = {
            version: 'empty',
            description: 'no routing cases',
            cases: [
                { id: 'rp-1', category: 'response-pattern', query: 'test', mustContain: ['hello'] },
            ],
        };
        const summary = await runRoutingEvaluation(emptyDataset, mockRouter, mockCategoryLookup);
        expect(summary.totalCases).toBe(0);
        expect(summary.passRate).toBe(0);
    });
});

describe('실제 골든셋 파일 무결성', () => {
    it('apps/api/src/evaluation/golden-dataset.json 로드 성공', () => {
        const dataset = loadGoldenDataset();
        expect(dataset.version).toBeTruthy();
        expect(dataset.cases.length).toBeGreaterThan(0);
        // routing-accuracy 케이스가 적어도 1개 있어야 함
        expect(filterCasesByCategory(dataset, 'routing-accuracy').length).toBeGreaterThan(0);
    });
});
