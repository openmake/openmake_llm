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
