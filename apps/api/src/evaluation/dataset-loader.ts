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
import { LONG_CONTEXT_FIXTURES } from './long-context-fixtures';

const logger = createLogger('DatasetLoader');

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
    attachments: z.array(z.object({ kind: z.literal('image'), fixture: z.string().regex(/^[a-z0-9-]+\.png$/) })).min(1).optional(),
    contextFixture: z.string().min(1).optional(),
});

const goldenDatasetSchema = z.object({
    version: z.string().min(1),
    description: z.string(),
    cases: z.array(goldenCaseSchema).min(1),
});

const DEFAULT_DATASET_PATH = path.resolve(__dirname, 'golden-dataset.json');
/** 멀티모달 이미지 픽스처 디렉터리(F26.5) */
export const IMAGE_FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'images');
/** mock 평가가 건너뛰는 태그 — 첨부·실모델이 있어야 의미 있는 케이스 */
export const REAL_ONLY_TAG = 'real-only';

/** 팩이 동봉한 케이스에 붙는 태그 접두어(addon-host/pack-evals 가 `addon:<id>` 를 붙인다) */
export const ADDON_TAG_PREFIX = 'addon:';

/**
 * PURE: response 평가 대상 고르기. 팩의 **response** 케이스는 그 팩 태그(`--tag addon:<id>`)로 지목했을 때만 들어온다 —
 * 기본 실행에 섞이면 케이스 집합이 바뀌어 지연·비용 기준선 비교가 조용히 건너뛰어진다(latency-regression 은 같은 케이스 집합만 비교한다).
 * 팩의 routing 케이스는 기본 실행에 그대로 합류한다(결정적 라우터라 기준선이 없다).
 */
export function selectResponseEvalCases(cases: GoldenCase[], opts: { useReal: boolean; tag?: string }): GoldenCase[] {
    return cases.filter((c) => {
        if (!opts.useReal && c.tags?.includes(REAL_ONLY_TAG)) return false;
        if (c.category !== 'response-pattern') return true;
        if (opts.tag) return !!c.tags?.includes(opts.tag);
        return !c.tags?.some((t) => t.startsWith(ADDON_TAG_PREFIX));
    });
}

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
    // 켜진 add-on 이 동봉한 케이스 합류 (id 는 `<addonId>:<caseId>`) — Base 는 어떤 팩이 있는지 모른다.
    // 합류는 **기본 골든셋**에만 — 경로를 지정해 부른 파일은 그대로 읽는다(그 파일이 평가 대상 전부다)
    const packCases = path.resolve(filePath) === DEFAULT_DATASET_PATH ? loadPackCases() : [];
    if (packCases.length > 0) {
        const merged = goldenDatasetSchema.safeParse({ ...dataset, cases: [...dataset.cases, ...packCases] });
        if (merged.success) dataset.cases = (merged.data as GoldenDataset).cases;
        else logger.warn(`팩 eval 케이스 형식 오류 — 제외하고 진행: ${merged.error.issues[0]?.message ?? ''}`);
    }
    validateCaseSemantics(dataset);
    logger.info(`골든셋 로드 완료: v${dataset.version}, 케이스 ${dataset.cases.length}건${packCases.length > 0 ? ` (팩 ${packCases.length}건 포함)` : ''}`);
    return dataset;
}

/** 팩 케이스 로드 — add-on 이 없거나 읽기에 실패하면 빈 배열(평가를 막지 않는다). */
function loadPackCases(): GoldenCase[] {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { loadEnabledPackEvalCases } = require('../addon-host/pack-evals') as typeof import('../addon-host/pack-evals');
        return loadEnabledPackEvalCases() as unknown as GoldenCase[];
    } catch {
        return [];
    }
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

    // 첨부 픽스처(F26.5) — 파일·생성기 id 가 실제로 있어야 하고, 첨부 케이스는 real-only 여야 한다(mock 은 첨부를 못 본다)
    for (const c of dataset.cases) {
        for (const a of c.attachments ?? []) {
            if (!fs.existsSync(path.join(IMAGE_FIXTURE_DIR, a.fixture))) errors.push(`${c.id}: 이미지 픽스처 없음 ${a.fixture}`);
        }
        if (c.contextFixture && !LONG_CONTEXT_FIXTURES[c.contextFixture]) errors.push(`${c.id}: 알 수 없는 contextFixture ${c.contextFixture}`);
        if ((c.attachments?.length || c.contextFixture) && !c.tags?.includes(REAL_ONLY_TAG)) errors.push(`${c.id}: 첨부 케이스는 tags 에 ${REAL_ONLY_TAG} 필요`);
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
