/**
 * K08 리포트 조립 — 평가 파트들을 EvalReport 로 모은다(IO 없음, report.ts 가 출력·저장).
 *
 * @module addons/knowledge-runtime/evaluation/report-assembler
 */
import { CORPUS } from './fixtures/corpus';
import { redactDbUrl, type EvalReport } from './report';
import type { GateEvaluation } from './gates';
import type { RetrievalEvalResult } from './retrieval-eval';
import type { RestartEvalResult } from './restart-eval';
import type { LlmEvalResult } from './llm-eval';
import type { SeedContext } from './seeding';
import type { EvalDataset } from './types';

interface ShellInput {
    opts: { dbUrl: string; withLlm: boolean };
    dataset: EvalDataset;
    ctx: SeedContext;
    retrieval: RetrievalEvalResult;
    restart: RestartEvalResult;
    llm?: LlmEvalResult;
    metrics: Record<string, number | null>;
    gateEval: GateEvaluation;
    runtimeMs: { retrieval: number; llm: number; total: number };
}

/** teardown 을 제외한 리포트 본체 */
export function buildReportShell(input: ShellInput): Omit<EvalReport, 'teardown'> {
    const byCategory: Record<string, number> = {};
    for (const c of input.dataset.cases) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;

    const ingestionDocs = CORPUS.map((d) => {
        const seeded = input.ctx.docs[d.key];
        return { key: d.key, status: seeded?.status ?? 'missing', failureCode: seeded?.failureCode ?? null };
    });
    const scannedDetected = ingestionDocs.some((d) => d.failureCode === 'SCANNED_PDF_UNSUPPORTED');

    return {
        version: input.dataset.version,
        generatedAt: new Date().toISOString(),
        mode: input.opts.withLlm ? 'retrieval+llm' : 'retrieval',
        db: redactDbUrl(input.opts.dbUrl),
        dataset: { version: input.dataset.version, total: input.dataset.cases.length, byCategory },
        ingestion: { docs: ingestionDocs, scannedDetected },
        metrics: input.metrics,
        gates: input.gateEval.results,
        blockingFailures: input.gateEval.blockingFailures,
        qualityFailures: input.gateEval.qualityFailures,
        restart: {
            duplicateChunksAfterRetry: input.restart.duplicateChunksAfterRetry,
            embeddingMismatches: input.restart.embeddingMismatches,
            cases: input.restart.perCase,
        },
        ...(input.llm ? { llm: { counters: input.llm.counters, perCase: input.llm.perCase } } : {}),
        runtimeMs: input.runtimeMs,
    };
}

export function finalizeReport(shell: Omit<EvalReport, 'teardown'>, teardown: { leftovers: number; detail: Record<string, number> }): EvalReport {
    return { ...shell, teardown };
}
