/**
 * 모델 × 프롬프트 variant 비교 매트릭스 (F26.1) — real 전용(nightly 옵션 NIGHTLY_EVAL_MATRIX=1).
 *
 *   npm run eval:matrix -- --real --models qwen3.8-27b --variants base,concise --limit 5
 *
 * 셀마다 response 골든셋(response-pattern)을 실모델로 돌려 통과율·TTFT p50/p95·전체 p50/p95·토큰을 모은다.
 * 가드: --real 필수, --limit(기본 OMK_EVAL_REAL_DEFAULT_LIMIT=5), 케이스 timeout·토큰 한도(real-response-generator 4중 가드 상속).
 * 모델은 로컬(LiteLLM alias)만 — 평가 ProviderRouter 에 외부 키가 없다. 결과: 콘솔 표 + logs/matrix-evaluation-*.json + eval_runs(OMK_EVAL_RECORD_DB=true).
 *
 * @module evaluation/run-matrix-evaluation
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

// .env 는 CLI 로 실행될 때만, 설정 검증을 하는 모듈 import 보다 먼저 읽는다(테스트가 runMatrix 를 import 해도 운영 env 가 새지 않게).
if (require.main === module) {
    require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
}

import { loadGoldenDataset } from './dataset-loader';
import { runResponseEvaluation, type ResponseGenerator } from './response-evaluator';
import { MATRIX_DEFAULT_VARIANTS, MATRIX_VARIANTS } from './matrix-variants';
import { parseListArg, renderMatrixTable } from './matrix-reporter';
import { buildEvalRunRecord, currentGitHash, recordEvalRuns, type CaseTiming } from './eval-run-recorder';
import type { EvalRunRecord } from '../data/repositories/eval-run-repository';
import type { GoldenDataset } from './types';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface MatrixCellGeneratorFactory {
    (cell: { model: string; variant: string }, onCaseMetrics: (m: CaseTiming) => void): ResponseGenerator;
}

/** 매트릭스 실행 코어 — 생성기 팩토리를 주입받아 테스트 가능. 셀 순서는 모델 → variant. */
export async function runMatrix(params: {
    dataset: GoldenDataset; models: string[]; variants: string[]; generatorFactory: MatrixCellGeneratorFactory; gitHash?: string | null;
}): Promise<{ matrixRunId: string; cells: EvalRunRecord[] }> {
    const unknown = params.variants.filter((v) => !MATRIX_VARIANTS[v]);
    if (unknown.length) throw new Error(`알 수 없는 variant: ${unknown.join(', ')} (가능: ${Object.keys(MATRIX_VARIANTS).join(', ')})`);
    const matrixRunId = randomUUID();
    const cells: EvalRunRecord[] = [];
    for (const model of params.models) {
        for (const variant of params.variants) {
            const timings: CaseTiming[] = [];
            const generator = params.generatorFactory({ model, variant }, (m) => timings.push(m));
            const summary = await runResponseEvaluation(params.dataset, generator);
            cells.push(buildEvalRunRecord(summary, {
                runner: 'matrix', mode: 'real', model, variant, matrixRunId, gitHash: params.gitHash ?? null,
                ...(timings.length ? { timings } : {}),
            }));
        }
    }
    return { matrixRunId, cells };
}

async function main(): Promise<void> {
    if (!process.argv.includes('--real')) {
        console.error('eval:matrix 는 실모델 전용입니다 — --real 을 명시하세요 (예: -- --real --models qwen3.8-27b --variants base,concise --limit 5)');
        process.exit(1);
    }
    const limit = Number(argValue('--limit') ?? process.env.OMK_EVAL_REAL_DEFAULT_LIMIT ?? '5');
    const models = parseListArg(argValue('--models'), [process.env.LLM_DEFAULT_MODEL ?? 'default']);
    const variants = parseListArg(argValue('--variants'), MATRIX_DEFAULT_VARIANTS);
    const raw = loadGoldenDataset(process.argv.slice(2).find((a) => a.endsWith('.json')));
    const responseCases = raw.cases.filter((c) => c.category === 'response-pattern').slice(0, limit);
    const dataset: GoldenDataset = { ...raw, cases: responseCases };
    const timeoutMs = Number(process.env.OMK_EVAL_REAL_TIMEOUT_MS ?? '60000');
    const maxTokens = Number(process.env.OMK_EVAL_REAL_MAX_TOKENS ?? '2000');
    console.log(`[matrix] 모델 ${models.join(', ')} × variant ${variants.join(', ')} × 케이스 ${responseCases.length} = 호출 ${models.length * variants.length * responseCases.length}회`);

    const { createRealResponseGenerator } = await import('./real-response-generator');
    const { matrixRunId, cells } = await runMatrix({
        dataset, models, variants, gitHash: currentGitHash(),
        generatorFactory: ({ model, variant }, onCaseMetrics) => createRealResponseGenerator({
            timeoutMs, maxTokensPerCase: maxTokens, abortOnBudgetExceed: true,
            ...(model !== 'default' ? { model } : {}),
            requestOverrides: MATRIX_VARIANTS[variant].request,
            onCaseMetrics,
        }),
    });

    console.log(`\n${renderMatrixTable(cells)}\n`);
    const logsDir = path.resolve(__dirname, '../../logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const out = path.join(logsDir, `matrix-evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify({ matrixRunId, models, variants, limit, cells }, null, 2));
    const ids = await recordEvalRuns(cells);
    console.log(`결과 저장: ${path.relative(process.cwd(), out)}${ids ? ` · eval_runs ${ids.length}행` : ''}`);
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error('[matrix-evaluation] 실패:', e);
        process.exit(1);
    });
}
