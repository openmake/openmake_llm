/**
 * 프롬프트 규칙 제거(ablation) 실험의 순수 부분 — 시스템 프롬프트에서 규칙 묶음을 빼는 함수와 결과 요약.
 *
 * 수작업 규칙이 실제로 도움이 되는지는 규칙 유무로 재 봐야 안다(RuleEvolve, arXiv 2610.00650: 범용 규칙은 무규칙보다
 * 나쁜 경우가 많고, 절차·예산류 지시는 순효과가 음수였다). 실행기는 run-prompt-ablation.ts.
 *
 * @module evaluation/prompt-ablation
 */

/**
 * PURE: 프롬프트에서 패턴(대소문자 무시 부분 문자열)에 맞는 규칙을 통째로 뺀다.
 * 규칙 = `- ` 로 시작하는 줄과 그 뒤에 들여쓰기로 이어지는 줄. 글머리표가 아닌 줄은 건드리지 않는다.
 * 어떤 규칙에도 맞지 않는 패턴은 던진다 — 빼지 못했는데 뺀 조건으로 측정되는 일을 막는다.
 */
export function ablatePrompt(prompt: string, dropPatterns: readonly string[]): string {
    if (dropPatterns.length === 0) return prompt;
    const lines = prompt.split('\n');
    const out: string[] = [];
    const matched = new Set<string>();
    for (let i = 0; i < lines.length;) {
        if (!lines[i].startsWith('- ')) { out.push(lines[i++]); continue; }
        let end = i + 1;
        while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
        const rule = lines.slice(i, end).join('\n').toLowerCase();
        const hit = dropPatterns.find((p) => rule.includes(p.toLowerCase()));
        if (hit) matched.add(hit); else out.push(...lines.slice(i, end));
        i = end;
    }
    const unused = dropPatterns.filter((p) => !matched.has(p));
    if (unused.length > 0) throw new Error(`프롬프트의 어떤 규칙에도 맞지 않는 패턴: ${unused.join(', ')}`);
    return out.join('\n');
}

/**
 * PURE: 돌릴 과제 고르기 — only(id 목록)로 지목한 과제만 묶음의 순서대로 남기고, 그 뒤에 limit(앞에서 N개)을 적용한다.
 * 묶음에 없는 id 는 던진다 — 오타로 아무것도 돌지 않는 일을 막는다.
 */
export function selectCases<T extends { id: string }>(cases: readonly T[], opts: { only?: readonly string[]; limit?: number }): T[] {
    const unknown = (opts.only ?? []).filter((id) => !cases.some((c) => c.id === id));
    if (unknown.length > 0) throw new Error(`--only 에 맞는 과제가 없습니다: ${unknown.join(', ')}`);
    const picked = opts.only ? cases.filter((c) => opts.only?.includes(c.id)) : [...cases];
    return picked.slice(0, opts.limit ?? picked.length);
}

/** 실험 실행 한 건의 결과 */
export interface AblationRun {
    variant: string;
    caseId: string;
    taskId: string;
    status: string;
    processPassed: boolean;
    rootFailures: string[];
    turns: number;
    totalTokens: number;
    toolCalls: number;
    durationMs: number;
}

export interface AblationVariantSummary {
    variant: string;
    runs: number;
    completedRate: number;
    processPassRate: number;
    meanTokens: number;
    meanTurns: number;
    meanToolCalls: number;
}

/** PURE: 조건별 요약 — 완료율, 과정 검사 통과율, 평균 토큰·턴·도구 호출. */
export function summarizeAblation(runs: readonly AblationRun[]): AblationVariantSummary[] {
    const variants = [...new Set(runs.map((r) => r.variant))];
    const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return variants.map((variant) => {
        const rs = runs.filter((r) => r.variant === variant);
        return {
            variant, runs: rs.length,
            completedRate: mean(rs.map((r) => (r.status === 'completed' ? 1 : 0))),
            processPassRate: mean(rs.map((r) => (r.processPassed ? 1 : 0))),
            meanTokens: mean(rs.map((r) => r.totalTokens)),
            meanTurns: mean(rs.map((r) => r.turns)),
            meanToolCalls: mean(rs.map((r) => r.toolCalls)),
        };
    });
}

/**
 * PURE: 과제 묶음 관문 — 기준 조건(첫 조건)의 완료율·과정 통과율이 임계 이상인지. 야간 회귀 감시용(run-prompt-ablation --gate).
 * 실행이 없으면 실패다 — 돌지 않은 평가가 통과로 보이지 않게.
 */
export function gateAgentTaskSuite(
    summary: readonly AblationVariantSummary[],
    thresholds: { completed: number; process: number },
): { ok: boolean; failures: string[] } {
    const base = summary[0];
    if (!base || base.runs === 0) return { ok: false, failures: ['실행된 과제가 없습니다'] };
    const failures: string[] = [];
    const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
    if (base.completedRate < thresholds.completed) failures.push(`완료율 ${pct(base.completedRate)} < 임계 ${pct(thresholds.completed)}`);
    if (base.processPassRate < thresholds.process) failures.push(`과정 검사 통과율 ${pct(base.processPassRate)} < 임계 ${pct(thresholds.process)}`);
    return { ok: failures.length === 0, failures };
}

