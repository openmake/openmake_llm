/**
 * K08 리포트 — 기계 판독 JSON + 콘솔 요약. 비밀값은 절대 싣지 않는다(DB 는 host:port 만).
 *
 * @module addons/knowledge-runtime/evaluation/report
 */
import * as fs from 'node:fs';
import type { GateResult } from './gates';
import type { RestartEvalResult } from './restart-eval';
import type { LlmEvalResult, LlmCaseResult } from './llm-eval';
import type { SeededDoc } from './seeding';

export interface EvalReport {
    version: string;
    generatedAt: string;
    mode: string;
    db: { host: string; port: string };
    dataset: { version: string; total: number; byCategory: Record<string, number> };
    ingestion: { docs: Array<{ key: string; status: string; failureCode: string | null }>; scannedDetected: boolean };
    metrics: Record<string, number | null>;
    gates: GateResult[];
    blockingFailures: number;
    qualityFailures: number;
    restart: { duplicateChunksAfterRetry: number; embeddingMismatches: number; cases: RestartEvalResult['perCase'] };
    llm?: { counters: LlmEvalResult['counters']; perCase: LlmCaseResult[] };
    teardown: { leftovers: number; detail: Record<string, number> };
    runtimeMs: { retrieval: number; llm: number; total: number };
}

/** postgres URL 에서 host:port 만 추출(자격증명 제거) */
export function redactDbUrl(url: string): { host: string; port: string } {
    try {
        const u = new URL(url);
        return { host: u.hostname, port: u.port || '5432' };
    } catch {
        return { host: 'unknown', port: 'unknown' };
    }
}

export function writeReport(report: EvalReport, outPath: string): void {
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function printSummary(report: EvalReport, docsByKey: Record<string, SeededDoc>): void {
    const log = (s: string): void => { process.stdout.write(`${s}\n`); };
    log('');
    log('════════ K08 Knowledge Space 평가 요약 ════════');
    log(`  모드: ${report.mode}  |  DB: ${report.db.host}:${report.db.port}  |  데이터셋 v${report.dataset.version} (${report.dataset.total} 케이스)`);
    log(`  분포: ${JSON.stringify(report.dataset.byCategory)}`);
    log('');
    log('── 수집 ──');
    const scanned = report.ingestion.docs.find((d) => d.failureCode);
    log(`  준비된 문서 ${report.ingestion.docs.length}건, 스캔본 PDF 감지: ${report.ingestion.scannedDetected ? 'YES' : 'NO'}`
        + (scanned ? ` (${scanned.key}=${scanned.failureCode})` : ''));
    void docsByKey;
    log('');
    log('── 지표 ──');
    for (const [k, v] of Object.entries(report.metrics)) {
        log(`  ${k.padEnd(28)} ${v === null ? 'n/a' : v}`);
    }
    log('');
    log('── 게이트 ──');
    for (const g of report.gates) {
        const mark = g.skipped ? '⏭' : (g.pass ? '✅' : '❌');
        const tag = g.blocking ? '[BLOCKING]' : '[quality] ';
        log(`  ${mark} ${tag} ${g.name.padEnd(26)} 값=${g.value === null ? 'n/a' : g.value} (기준 ${g.bound})`);
    }
    log('');
    log('── 재시작/중복 ──');
    log(`  중복 청크(재시도 후): ${report.restart.duplicateChunksAfterRetry}  |  임베딩 불일치: ${report.restart.embeddingMismatches}  (${report.restart.cases.length} 케이스)`);
    if (report.llm) {
        const c = report.llm.counters;
        log('');
        log('── --real-llm ──');
        log(`  평가 ${c.evaluated}건(오류 ${c.errors})  |  인용 불일치 ${c.citationMismatch}  |  인젝션 탈취 ${c.injectionEscalation}`
            + `  |  비답변 거절 ${c.unanswerableRefusalHandled}/${c.unanswerableTotal}`);
        for (const p of report.llm.perCase.filter((x) => x.injectionEscalated || !x.ok)) {
            log(`  ⚠️ ${p.caseId} [${p.category}] escalated=${p.injectionEscalated} err=${p.error ?? '-'}`);
        }
    }
    log('');
    log(`── 정리: 잔여 ${report.teardown.leftovers} (${JSON.stringify(report.teardown.detail)})`);
    log(`── 런타임: 검색 ${(report.runtimeMs.retrieval / 1000).toFixed(1)}s · LLM ${(report.runtimeMs.llm / 1000).toFixed(1)}s · 총 ${(report.runtimeMs.total / 1000).toFixed(1)}s`);
    log('');
    if (report.blockingFailures > 0) log(`❌ BLOCKING 게이트 ${report.blockingFailures}건 실패`);
    else log('✅ 모든 BLOCKING 게이트 통과');
    if (report.qualityFailures > 0) log(`⚠️  품질 목표 ${report.qualityFailures}건 미달(비차단)`);
    log('');
}
