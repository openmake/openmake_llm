/**
 * ============================================================
 * Dataset Loader — 골든셋 JSON 로드 및 검증
 * ============================================================
 *
 * @module evaluation/dataset-loader
 */
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { createLogger } from '../utils/logger';
import type { GoldenDataset, GoldenCase, EvaluationCategory } from './types';

const logger = createLogger('DatasetLoader');

const EVALUATION_CATEGORIES: EvaluationCategory[] = [
    'routing-accuracy',
    'topic-classification',
    'response-pattern',
];

const goldenCaseSchema = z.object({
    id: z.string().min(1),
    category: z.enum(['routing-accuracy', 'topic-classification', 'response-pattern']),
    query: z.string().min(1),
    expectedAgentId: z.string().optional(),
    expectedAgentIds: z.array(z.string().min(1)).min(1).optional(),
    expectedCategory: z.string().optional(),
    expectedCategories: z.array(z.string().min(1)).min(1).optional(),
    mustContain: z.array(z.string()).optional(),
    mustContainAny: z.array(z.string().min(1)).min(1).optional(),
    mustNotContain: z.array(z.string()).optional(),
    language: z.string().optional(),
    tags: z.array(z.string()).optional(),
});

const goldenDatasetSchema = z.object({
    version: z.string().min(1),
    description: z.string(),
    cases: z.array(goldenCaseSchema).min(1),
});

const DEFAULT_DATASET_PATH = path.resolve(__dirname, 'golden-dataset.json');

/**
 * 골든셋 JSON 파일을 로드하고 Zod로 검증합니다.
 * 검증 실패 시 명확한 에러 throw — CI에서 즉시 감지 가능.
 */
export function loadGoldenDataset(filePath: string = DEFAULT_DATASET_PATH): GoldenDataset {
    if (!fs.existsSync(filePath)) {
        throw new Error(`골든셋 파일을 찾을 수 없습니다: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);

    const result = goldenDatasetSchema.safeParse(parsed);
    if (!result.success) {
        const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`골든셋 검증 실패 (${filePath}):\n${issues}`);
    }

    const dataset = result.data as GoldenDataset;
    validateCaseSemantics(dataset);
    logger.info(`골든셋 로드 완료: v${dataset.version}, 케이스 ${dataset.cases.length}건`);
    return dataset;
}

/**
 * 카테고리별 의미적 제약 검증
 * - routing-accuracy: expectedAgentId 또는 expectedCategory 중 하나 필수
 * - response-pattern: mustContain / mustContainAny / mustNotContain 중 하나 필수
 */
function validateCaseSemantics(dataset: GoldenDataset): void {
    const errors: string[] = [];

    for (const c of dataset.cases) {
        if (c.category === 'routing-accuracy') {
            const hasAgent = !!c.expectedAgentId || (!!c.expectedAgentIds && c.expectedAgentIds.length > 0);
            const hasCategory = !!c.expectedCategory || (!!c.expectedCategories && c.expectedCategories.length > 0);
            if (!hasAgent && !hasCategory) {
                errors.push(`${c.id}: routing-accuracy 카테고리는 expectedAgentId(s) 또는 expectedCategory(s) 필요`);
            }
        }
        if (c.category === 'response-pattern' && !c.mustContain?.length && !c.mustContainAny?.length && !c.mustNotContain?.length) {
            errors.push(`${c.id}: response-pattern 카테고리는 mustContain, mustContainAny 또는 mustNotContain 필요`);
        }
    }

    if (errors.length > 0) {
        throw new Error(`골든셋 의미 검증 실패:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    }
}

/**
 * 카테고리별 케이스 필터링 (CLI/테스트 편의)
 */
export function filterCasesByCategory(
    dataset: GoldenDataset,
    category: EvaluationCategory
): GoldenCase[] {
    return dataset.cases.filter((c) => c.category === category);
}

/**
 * 태그별 케이스 필터링
 */
export function filterCasesByTag(dataset: GoldenDataset, tag: string): GoldenCase[] {
    return dataset.cases.filter((c) => c.tags?.includes(tag));
}

export const SUPPORTED_CATEGORIES = EVALUATION_CATEGORIES;
