/**
 * 프롬프트·도구 스키마 예산 게이트 CLI (F26.8 CI 층, ci.yml Gate 7).
 *
 * 사용법:
 *   npm run eval:budget                      # 기준선 대비 비교, 초과 시 exit 1
 *   npm run eval:budget -- --update-baseline # 현재 값을 기준선으로 저장(같은 PR 에 포함해 리뷰로 드러낸다)
 *
 * env: OMK_EVAL_BUDGET_DRIFT_PCT(기본 10) · OMK_EVAL_PROMPT_BUDGET_CHARS(정적 prefix 절대 상한, 선택)
 *      · OMK_EVAL_TOOL_SCHEMA_BUDGET_BYTES(상시 노출 도구 스키마 절대 상한, 선택)
 *
 * @module evaluation/run-budget-evaluation
 */
import * as fs from 'fs';
import * as path from 'path';

// .env 를 읽지 않는다 — 운영 플래그(오케스트레이션·디자인 등)가 프롬프트 문구를 바꾸면 로컬 기준선과 CI 측정이
// 어긋나 거짓 실패가 난다. 설정 검증에 필요한 값만 오프라인 평가용 고정값으로 채운다(인증·DB 에 쓰이지 않음).
process.env.NODE_ENV ??= 'test';
process.env.JWT_SECRET ??= 'omk-eval-budget-offline-placeholder-secret-000';

import { compareBudget, renderBudgetTable, type BudgetBaseline } from './budget-evaluation';
import { measureBudget } from './budget-contexts';

const BASELINE_PATH = path.join(__dirname, 'baselines', 'budget-baseline.json');
const LOGS_DIR = path.join(__dirname, '../../logs');

function optionalNumber(v: string | undefined): number | undefined {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
    const update = process.argv.includes('--update-baseline');
    const current = await measureBudget();
    if (update) {
        const baseline: BudgetBaseline = { ...current, updatedAt: new Date().toISOString() };
        fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
        console.log(`기준선 갱신: ${BASELINE_PATH}`);
        return;
    }
    const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as BudgetBaseline : null;
    const limits = {
        driftPct: optionalNumber(process.env.OMK_EVAL_BUDGET_DRIFT_PCT) ?? 10,
        maxStaticChars: optionalNumber(process.env.OMK_EVAL_PROMPT_BUDGET_CHARS),
        maxToolSchemaBytes: optionalNumber(process.env.OMK_EVAL_TOOL_SCHEMA_BUDGET_BYTES),
    };
    const { rows, ok } = compareBudget(current, baseline, limits);
    console.log(renderBudgetTable(rows));
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const out = path.join(LOGS_DIR, `budget-evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(out, JSON.stringify({ ok, limits, baselineUpdatedAt: baseline?.updatedAt ?? null, rows }, null, 2));
    console.log(`\n결과: ${ok ? '통과' : '실패'} (허용 증가율 ${limits.driftPct}%) → ${path.relative(process.cwd(), out)}`);
    if (!ok) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('[budget-evaluation] 실패:', e);
    process.exit(1);
});
