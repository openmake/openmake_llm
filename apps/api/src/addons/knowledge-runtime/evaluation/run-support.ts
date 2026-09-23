/**
 * K08 러너 본체 — 시딩 → 검색 평가 → 재시작/중복 → (선택)LLM → 게이트 판정 → 리포트 → 정리.
 * env(DATABASE_URL=K01) 가 고정된 뒤 호출된다. 예외가 나도 teardown 을 반드시 돈다.
 *
 * @module addons/knowledge-runtime/evaluation/run-support
 */
import { mean, rate, round4 } from './metrics';
import { evaluateGates } from './gates';
import { seed } from './seeding';
import { runRetrievalEval } from './retrieval-eval';
import { runRestartEval } from './restart-eval';
import { runLlmEval } from './llm-eval';
import { buildReportShell, finalizeReport } from './report-assembler';
import { printSummary, writeReport, redactDbUrl, type EvalReport } from './report';
import type { EvalProfile, EvalDataset } from './types';

export interface BuildAndReportOpts {
    dbUrl: string;
    withLlm: boolean;
    llmSubset: number;
    outPath: string;
    profile: EvalProfile;
    dataset: EvalDataset;
}

/** 전체 실행 — exit code 를 돌려준다(0=통과, 1=blocking 실패 또는 정리 잔여). */
export async function buildAndReport(opts: BuildAndReportOpts): Promise<number> {
    const { profile, dataset } = opts;
    const prefix = `${profile.run.syntheticPrefix}-${Date.now().toString(36)}`;
    process.stdout.write(`\n[K08] 시딩 시작 — prefix=${prefix}, DB=${redactDbUrl(opts.dbUrl).host}:${redactDbUrl(opts.dbUrl).port}\n`);

    const ctx = await seed(prefix);
    process.stdout.write(`[K08] 시딩 완료 — 문서 ${Object.keys(ctx.docs).length}건 수집\n`);

    let report: EvalReport | null = null;
    try {
        const t0 = Date.now();
        process.stdout.write('[K08] 검색 수준 평가(실 임베딩)…\n');
        const retrieval = await runRetrievalEval(dataset, ctx);
        const tRetrieval = Date.now() - t0;

        process.stdout.write('[K08] 재시작/중복 평가…\n');
        const restart = await runRestartEval(dataset, ctx);

        let llm = undefined;
        let tLlm = 0;
        if (opts.withLlm) {
            process.stdout.write(`[K08] --real-llm(순차, subset=${opts.llmSubset || 'all'})…\n`);
            const l0 = Date.now();
            llm = await runLlmEval(retrieval.perCase, opts.llmSubset);
            tLlm = Date.now() - l0;
        }

        // ── 지표 집계 ──
        const recallMean = mean(retrieval.counters.recallSamples);
        const noAnswer = rate(retrieval.counters.noAnswerHandled, retrieval.counters.noAnswerTotal);
        const injRetrieved = rate(
            retrieval.counters.injectionRetrievedSamples.filter(Boolean).length,
            retrieval.counters.injectionRetrievedSamples.length,
        );
        const llmRefusal = llm ? rate(llm.counters.unanswerableRefusalHandled, llm.counters.unanswerableTotal) : null;

        const gateValues: Record<string, number | null> = {
            unauthorizedRetrieval: retrieval.counters.unauthorizedRetrieval,
            deletedDocRetrieval: retrieval.counters.deletedDocRetrieval,
            citationIntegrityMismatch: retrieval.counters.citationIntegrityMismatch,
            duplicateChunksAfterRetry: restart.duplicateChunksAfterRetry,
            recallAt5: recallMean === null ? null : round4(recallMean),
            noAnswerHandled: noAnswer === null ? null : round4(noAnswer),
            llmCitationMismatch: llm ? llm.counters.citationMismatch : null,
            llmInjectionEscalation: llm ? llm.counters.injectionEscalation : null,
            llmUnanswerableRefusal: llmRefusal === null ? null : round4(llmRefusal),
        };
        const present: Record<string, boolean> = {
            llmCitationMismatch: !!llm, llmInjectionEscalation: !!llm, llmUnanswerableRefusal: !!llm,
        };
        const gateEval = evaluateGates(profile, gateValues, present);

        const metrics: Record<string, number | null> = {
            recallAt5: gateValues.recallAt5,
            noAnswerHandledRate: gateValues.noAnswerHandled,
            injectionRetrievedRate: injRetrieved === null ? null : round4(injRetrieved),
            unauthorizedRetrieval: retrieval.counters.unauthorizedRetrieval,
            deletedDocRetrieval: retrieval.counters.deletedDocRetrieval,
            citationIntegrityMismatch: retrieval.counters.citationIntegrityMismatch,
            duplicateChunksAfterRetry: restart.duplicateChunksAfterRetry,
            embeddingMismatches: restart.embeddingMismatches,
            ...(llm ? {
                llmCitationMismatch: llm.counters.citationMismatch,
                llmInjectionEscalation: llm.counters.injectionEscalation,
                llmUnanswerableRefusal: gateValues.llmUnanswerableRefusal,
            } : {}),
        };

        const teardown = await ctx.teardown();

        report = finalizeReport(buildReportShell({
            opts, dataset, ctx, retrieval, restart, llm, metrics, gateEval,
            runtimeMs: { retrieval: tRetrieval, llm: tLlm, total: tRetrieval + tLlm },
        }), teardown);

        writeReport(report, opts.outPath);
        printSummary(report, ctx.docs);
        process.stdout.write(`[K08] 리포트: ${opts.outPath}\n`);

        const teardownFail = teardown.leftovers > 0;
        if (teardownFail) process.stderr.write(`❌ 정리 잔여 ${teardown.leftovers}건 — ${JSON.stringify(teardown.detail)}\n`);
        return gateEval.blockingFailures > 0 || teardownFail ? 1 : 0;
    } catch (err) {
        // 평가 도중 실패해도 합성 데이터는 반드시 지운다
        process.stderr.write(`[K08] 평가 중 오류 — 정리 시도: ${err instanceof Error ? err.message : String(err)}\n`);
        await ctx.teardown().catch((e) => process.stderr.write(`[K08] 정리도 실패: ${String(e)}\n`));
        throw err;
    }
}
