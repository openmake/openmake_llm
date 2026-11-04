/**
 * 모델 × 프롬프트 variant 비교 매트릭스 (F26.1) — real 전용(nightly 옵션 NIGHTLY_EVAL_MATRIX=1).
 *
 *   npm run eval:matrix -- --real --models qwen3.8-27b --variants base,concise --limit 5
 *
 * 셀마다 response 골든셋(response-pattern)을 실모델로 돌려 통과율·TTFT p50/p95·전체 p50/p95·토큰을 모은다.
 * 가드: --real 필수, --limit(기본 OMK_EVAL_REAL_DEFAULT_LIMIT=5), 케이스 timeout·토큰 한도(real-response-generator 4중 가드 상속).
 * 전환 게이트(S2): `--gate <후보> [--incumbent <현행>]` — 같은 실행의 현행 셀과 비교해 미달이면 exit 1 (model-switch-gate.ts).
 *   npm run eval:matrix -- --real --models qwen3.8-27b,<후보> --gate <후보> --limit 30
 * 잡음 하한(RSI-A): `--repeat N`(기본 1) 이면 셀마다 같은 케이스를 N회 돌려 케이스별 통과 횟수(caseRuns)를 결과 JSON 에 남기고,
 *   전환 게이트는 N≥2 일 때 짝검정 구간으로 하락을 판정한다(paired-comparison.ts). 호출 수가 N배다.
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

import { loadGoldenDataset, selectResponseEvalCases } from './dataset-loader';
import { runResponseEvaluation, type ResponseGenerator } from './response-evaluator';
import { MATRIX_DEFAULT_VARIANTS, MATRIX_VARIANTS } from './matrix-variants';
import { parseListArg, renderMatrixTable } from './matrix-reporter';
import { judgeModelSwitch, modelSwitchThresholds, renderModelSwitchVerdict, type CaseRuns } from './model-switch-gate';
import { buildEvalRunRecord, currentGitHash, recordEvalRuns, type CaseTiming } from './eval-run-recorder';
import type { EvalRunRecord } from '../data/repositories/eval-run-repository';
import type { EvaluationSummary, GoldenDataset } from './types';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

export interface MatrixCellGeneratorFactory {
    (cell: { model: string; variant: string }, onCaseMetrics: (m: CaseTiming) => void): ResponseGenerator;
}

/** 셀 기록 — repeat≥2 일 때만 케이스별 반복 결과를 싣는다(eval_runs 에는 들어가지 않는다: insert 는 열을 골라 쓴다) */
export type MatrixCell = EvalRunRecord & { caseRuns?: CaseRuns };

/** PURE: N회 실행 요약을 하나로 — 판정 수·통과 수는 합, 결과는 이어 붙인다 */
function mergeSummaries(runs: EvaluationSummary[]): EvaluationSummary {
    if (runs.length === 1) return runs[0];
    const results = runs.flatMap((r) => r.results);
    const passedCases = results.filter((r) => r.passed).length;
    return {
        ...runs[0], completedAt: runs[runs.length - 1].completedAt, results,
        totalCases: results.length, passedCases, failedCases: results.length - passedCases,
        passRate: results.length ? passedCases / results.length : 0,
        avgDurationMs: results.length ? Math.round(results.reduce((n, r) => n + r.durationMs, 0) / results.length) : 0,
    };
}

/** 매트릭스 실행 코어 — 생성기 팩토리를 주입받아 테스트 가능. 셀 순서는 모델 → variant. repeat(기본 1)회 같은 케이스를 돈다. */
export async function runMatrix(params: {
    dataset: GoldenDataset; models: string[]; variants: string[]; generatorFactory: MatrixCellGeneratorFactory; gitHash?: string | null; repeat?: number;
}): Promise<{ matrixRunId: string; cells: MatrixCell[] }> {
    const repeat = params.repeat ?? 1;
    if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`--repeat 는 1 이상의 정수여야 합니다: ${params.repeat}`);
    const unknown = params.variants.filter((v) => !MATRIX_VARIANTS[v]);
    if (unknown.length) throw new Error(`알 수 없는 variant: ${unknown.join(', ')} (가능: ${Object.keys(MATRIX_VARIANTS).join(', ')})`);
    const matrixRunId = randomUUID();
    const cells: MatrixCell[] = [];
    for (const model of params.models) {
        for (const variant of params.variants) {
            const timings: CaseTiming[] = [];
            const generator = params.generatorFactory({ model, variant }, (m) => timings.push(m));
            const runs: EvaluationSummary[] = [];
            for (let i = 0; i < repeat; i++) runs.push(await runResponseEvaluation(params.dataset, generator));
            const summary = mergeSummaries(runs);
            const record: MatrixCell = buildEvalRunRecord(summary, {
                runner: 'matrix', mode: 'real', model, variant, matrixRunId, gitHash: params.gitHash ?? null,
                ...(timings.length ? { timings } : {}),
            });
            if (repeat > 1) {
                const passes: Record<string, number> = {};
                for (const r of summary.results) passes[r.caseId] = (passes[r.caseId] ?? 0) + (r.passed ? 1 : 0);
                record.caseRuns = { repeat, passes };
            }
            cells.push(record);
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
    const repeat = Number(argValue('--repeat') ?? '1');
    const gateCandidate = argValue('--gate');
    // 현행 미지정이면 운영 기본 모델 — 후보와 같으면(=기본 모델 자체를 검증) 절대 하한만 본다
    const defaultIncumbent = process.env.LLM_DEFAULT_MODEL && process.env.LLM_DEFAULT_MODEL !== gateCandidate ? process.env.LLM_DEFAULT_MODEL : undefined;
    const gateIncumbent = argValue('--incumbent') ?? defaultIncumbent;
    if (gateCandidate && gateIncumbent && !models.includes(gateIncumbent)) models.unshift(gateIncumbent);
    if (gateCandidate && !models.includes(gateCandidate)) models.push(gateCandidate);
    const raw = loadGoldenDataset(process.argv.slice(2).find((a) => a.endsWith('.json')));
    // 팩의 response 케이스는 `--tag addon:<id>` 로 지목했을 때만(dataset-loader.selectResponseEvalCases)
    const tag = argValue('--tag');
    const responseCases = selectResponseEvalCases(raw.cases, { useReal: true, ...(tag ? { tag } : {}) })
        .filter((c) => c.category === 'response-pattern').slice(0, limit);
    const dataset: GoldenDataset = { ...raw, cases: responseCases };
    const timeoutMs = Number(process.env.OMK_EVAL_REAL_TIMEOUT_MS ?? '60000');
    const maxTokens = Number(process.env.OMK_EVAL_REAL_MAX_TOKENS ?? '2000');
    console.log(`[matrix] 모델 ${models.join(', ')} × variant ${variants.join(', ')} × 케이스 ${responseCases.length}${repeat > 1 ? ` × 반복 ${repeat}` : ''} = 호출 ${models.length * variants.length * responseCases.length * repeat}회`);

    const { createRealResponseGenerator } = await import('./real-response-generator');
    const { matrixRunId, cells } = await runMatrix({
        dataset, models, variants, repeat, gitHash: currentGitHash(),
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
    const verdict = gateCandidate ? judgeModelSwitch(cells, { candidate: gateCandidate, incumbent: gateIncumbent ?? null }, modelSwitchThresholds()) : null;
    fs.writeFileSync(out, JSON.stringify({ matrixRunId, models, variants, limit, ...(repeat > 1 ? { repeat } : {}), cells, ...(verdict ? { gate: verdict } : {}) }, null, 2));
    const ids = await recordEvalRuns(cells);
    console.log(`결과 저장: ${path.relative(process.cwd(), out)}${ids ? ` · eval_runs ${ids.length}행` : ''}`);
    if (verdict) {
        console.log(`\n${renderModelSwitchVerdict(verdict)}`);
        if (!verdict.ok) process.exit(1);
    }
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error('[matrix-evaluation] 실패:', e);
        process.exit(1);
    });
}
