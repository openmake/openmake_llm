/**
 * 비교 매트릭스 결과 표 (F26.1) — PURE. 셀 요약을 모델(행) × variant(열) 마크다운 표로.
 *
 * @module evaluation/matrix-reporter
 */
import type { EvalRunRecord } from '../data/repositories/eval-run-repository';

function pct(n: number): string {
    return `${(n * 100).toFixed(1)}%`;
}

function ms(n: number | null | undefined): string {
    return n === null || n === undefined ? '—' : `${(n / 1000).toFixed(1)}s`;
}

/** 셀 한 칸 — "통과율 · TTFT p50 · 전체 p95" */
export function formatMatrixCell(r: Pick<EvalRunRecord, 'passRate' | 'passedCases' | 'totalCases' | 'ttftP50Ms' | 'totalP95Ms'>): string {
    return `${pct(r.passRate)} (${r.passedCases}/${r.totalCases}) · TTFT ${ms(r.ttftP50Ms)} · p95 ${ms(r.totalP95Ms)}`;
}

export function renderMatrixTable(cells: EvalRunRecord[]): string {
    const models = [...new Set(cells.map((c) => c.model ?? '(default)'))];
    const variants = [...new Set(cells.map((c) => c.variant ?? 'base'))];
    const header = `| 모델 \\ variant | ${variants.join(' | ')} |`;
    const sep = `|---|${variants.map(() => '---').join('|')}|`;
    const rows = models.map((m) => {
        const cols = variants.map((v) => {
            const cell = cells.find((c) => (c.model ?? '(default)') === m && (c.variant ?? 'base') === v);
            return cell ? formatMatrixCell(cell) : '—';
        });
        return `| ${m} | ${cols.join(' | ')} |`;
    });
    return [header, sep, ...rows].join('\n');
}

/** PURE: CLI 목록 인자 파싱 — 쉼표 구분, 공백 제거, 중복 제거. */
export function parseListArg(raw: string | undefined, fallback: readonly string[]): string[] {
    const xs = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    return xs.length ? [...new Set(xs)] : [...fallback];
}
