/**
 * 팩 검증 실행 (오픈웨이트 전환 S3) — "이 팩은 이 모델에서 검증됨" 을 만드는 러너. real 전용.
 *
 *   npm run eval:packs -- --real --models qwen3.8-27b [--packs industry-pack] [--limit 10]
 *
 * 켜진 add-on 이 동봉한 response 케이스(`addon:<id>` 태그)를 모델마다 실모델로 돌려 (팩 × 모델) 통과율을 낸다.
 * 결과는 `eval_runs`(runner=`pack`, variant=`addon:<id>`)에 남고(OMK_EVAL_RECORD_DB=true), 관리 화면의 "검증된 모델" 이 그 행을 읽는다.
 * 케이스는 순차로 보낸다 — 운영 vLLM 은 새 요청 여러 개가 한 스텝에 prefill 될 때 죽은 선례가 있다(2026-09-19).
 *
 * @module evaluation/run-pack-evaluation
 */
import * as path from 'path';

if (require.main === module) {
    require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
}

import { ADDON_TAG_PREFIX, loadGoldenDataset, selectResponseEvalCases } from './dataset-loader';
import { runResponseEvaluation, type ResponseGenerator } from './response-evaluator';
import { parseListArg } from './matrix-reporter';
import { buildEvalRunRecord, currentGitHash, recordEvalRuns, type CaseTiming } from './eval-run-recorder';
import { PACK_EVAL_RUNNER, packVerifyMinPassRate } from '../config/pack-verification';
import type { EvalRunRecord } from '../data/repositories/eval-run-repository';
import type { GoldenCase, GoldenDataset } from './types';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

/** PURE: response 케이스를 팩 태그별로 묶는다 — 태그가 곧 팩 id 다 */
export function groupPackResponseCases(cases: GoldenCase[]): Map<string, GoldenCase[]> {
    const out = new Map<string, GoldenCase[]>();
    for (const c of cases) {
        if (c.category !== 'response-pattern') continue;
        for (const t of c.tags ?? []) {
            if (!t.startsWith(ADDON_TAG_PREFIX)) continue;
            out.set(t, [...(out.get(t) ?? []), c]);
        }
    }
    return out;
}

export async function runPackEvaluation(params: {
    dataset: GoldenDataset; models: string[]; packTags?: string[]; limit: number; gitHash?: string | null;
    generatorFactory: (model: string, onCaseMetrics: (m: CaseTiming) => void) => ResponseGenerator;
}): Promise<EvalRunRecord[]> {
    const groups = groupPackResponseCases(params.dataset.cases);
    const tags = params.packTags?.length ? params.packTags : [...groups.keys()];
    const records: EvalRunRecord[] = [];
    for (const tag of tags) {
        const cases = selectResponseEvalCases(groups.get(tag) ?? [], { useReal: true, tag }).slice(0, params.limit);
        if (cases.length === 0) continue;
        for (const model of params.models) {
            const timings: CaseTiming[] = [];
            const summary = await runResponseEvaluation({ ...params.dataset, cases }, params.generatorFactory(model, (m) => timings.push(m)));
            records.push(buildEvalRunRecord(summary, {
                runner: PACK_EVAL_RUNNER, mode: 'real', model, variant: tag, gitHash: params.gitHash ?? null,
                ...(timings.length ? { timings } : {}),
            }));
        }
    }
    return records;
}

async function main(): Promise<void> {
    if (!process.argv.includes('--real')) {
        console.error('eval:packs 는 실모델 전용입니다 — --real 을 명시하세요 (예: -- --real --models qwen3.8-27b)');
        process.exit(1);
    }
    const models = parseListArg(argValue('--models'), [process.env.LLM_DEFAULT_MODEL ?? 'default']);
    const packTags = parseListArg(argValue('--packs'), []).map((id) => (id.startsWith(ADDON_TAG_PREFIX) ? id : `${ADDON_TAG_PREFIX}${id}`));
    const limit = Number(argValue('--limit') ?? process.env.OMK_EVAL_PACK_DEFAULT_LIMIT ?? '10');
    const timeoutMs = Number(process.env.OMK_EVAL_REAL_TIMEOUT_MS ?? '60000');
    const maxTokens = Number(process.env.OMK_EVAL_REAL_MAX_TOKENS ?? '2000');

    const { createRealResponseGenerator } = await import('./real-response-generator');
    const records = await runPackEvaluation({
        dataset: loadGoldenDataset(), models, packTags, limit, gitHash: currentGitHash(),
        generatorFactory: (model, onCaseMetrics) => createRealResponseGenerator({
            timeoutMs, maxTokensPerCase: maxTokens, abortOnBudgetExceed: true,
            ...(model !== 'default' ? { model } : {}), onCaseMetrics,
        }),
    });
    if (records.length === 0) {
        console.log('[packs] response eval 케이스를 동봉한 켜진 add-on 이 없습니다 — 할 일이 없습니다');
        return;
    }
    const min = packVerifyMinPassRate();
    for (const r of records) {
        const verdict = r.passRate >= min ? '검증됨' : '미달';
        console.log(`[packs] ${r.variant} × ${r.model}: ${(r.passRate * 100).toFixed(1)}% (${r.passedCases}/${r.totalCases}) — ${verdict} (하한 ${(min * 100).toFixed(0)}%)`);
    }
    const ids = await recordEvalRuns(records);
    console.log(ids ? `eval_runs ${ids.length}행 기록` : 'eval_runs 기록 안 함 — 관리 화면에 반영하려면 OMK_EVAL_RECORD_DB=true');
    if (records.some((r) => r.passRate < min)) process.exit(1);
}

if (require.main === module) {
    main().then(() => process.exit(0)).catch((e) => {
        console.error('[pack-evaluation] 실패:', e);
        process.exit(1);
    });
}
