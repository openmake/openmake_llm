/**
 * 도구 선택 평가 CLI (F26.2).
 *
 *   npm run eval:tools                              # mock(CI Gate 8) — 결정적 노출 판정, LLM 비용 0
 *   npm run eval:tools -- --real --limit 10         # real(nightly) — 모델 첫 턴 tool_calls 관찰(dry-run, 도구 미실행)
 *
 * mock 은 .env 를 읽지 않고 도구 노출에 영향을 주는 운영 플래그 프로필(아래 MOCK_PROFILE_ENV)을 고정한다 — 로컬 .env 차이로
 * CI 와 결과가 갈리지 않게. 명시한 환경변수가 있으면 그 값이 우선한다.
 * 임계: OMK_EVAL_TOOL_THRESHOLD(기본 mock 0.97 — v1.0.0 기준선 39/40 · real 0.7). real 가드: --limit(기본 OMK_EVAL_REAL_DEFAULT_LIMIT=5)·케이스 timeout.
 *
 * @module evaluation/run-tool-selection-evaluation
 */
import * as fs from 'fs';
import * as path from 'path';

const useReal = process.argv.includes('--real');

/** mock 운영 플래그 프로필 — 운영 .env 에서 도구 노출에 영향을 주는 값(2026-09-17 기준) */
const MOCK_PROFILE_ENV: Readonly<Record<string, string>> = {
    ORCHESTRATION_AUTO_DISPATCH: 'true',
    REPORT_PIPELINE_ENABLED: 'true',
};

if (useReal) {
    require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
} else {
    process.env.NODE_ENV ??= 'test';
    process.env.JWT_SECRET ??= 'omk-eval-tools-offline-placeholder-secret-0000';
    for (const [k, v] of Object.entries(MOCK_PROFILE_ENV)) process.env[k] ??= v;
}

import type { EvaluationSummary } from './types';

const LOGS_DIR = path.join(__dirname, '../../logs');
const MOCK_THRESHOLD_DEFAULT = 0.97;
const REAL_THRESHOLD_DEFAULT = 0.7;

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
    const { loadToolSelectionDataset, runToolSelectionEvaluation } = await import('./tool-selection-evaluator');
    const datasetPath = process.argv.slice(2).find((a) => a.endsWith('.json'));
    const dataset = loadToolSelectionDataset(datasetPath);
    const threshold = process.env.OMK_EVAL_TOOL_THRESHOLD !== undefined
        ? Number(process.env.OMK_EVAL_TOOL_THRESHOLD)
        : (useReal ? REAL_THRESHOLD_DEFAULT : MOCK_THRESHOLD_DEFAULT);

    let summary: EvaluationSummary;
    if (useReal) {
        const limit = Number(argValue('--limit') ?? process.env.OMK_EVAL_REAL_DEFAULT_LIMIT ?? '5');
        const timeoutMs = Number(process.env.OMK_EVAL_REAL_TIMEOUT_MS ?? '60000');
        const { createRealToolCallObserver } = await import('./real-tool-call-observer');
        summary = await runToolSelectionEvaluation({ ...dataset, cases: dataset.cases.slice(0, limit) }, { mode: 'real', observe: createRealToolCallObserver({ timeoutMs }) });
    } else {
        summary = await runToolSelectionEvaluation(dataset, { mode: 'mock' });
    }

    console.log(`\n도구 선택 평가 (${useReal ? 'real' : 'mock'}) — v${summary.datasetVersion}: ${summary.passedCases}/${summary.totalCases} (${(summary.passRate * 100).toFixed(1)}%)`);
    for (const r of summary.results.filter((x) => !x.passed)) console.log(`  ✗ ${r.caseId}: ${r.failureReason}`);
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const out = path.join(LOGS_DIR, `tool-selection-evaluation-${useReal ? 'real' : 'mock'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify({ mode: useReal ? 'real' : 'mock', threshold, ...summary }, null, 2));
    const ok = summary.passRate >= threshold;
    console.log(`결과: ${ok ? '통과' : '실패'} (임계 ${(threshold * 100).toFixed(0)}%) → ${path.relative(process.cwd(), out)}`);
    if (!ok) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('[tool-selection-evaluation] 실패:', e);
    process.exit(1);
});
