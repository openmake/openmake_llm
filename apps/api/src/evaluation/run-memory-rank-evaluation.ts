/**
 * 메모리 주입 순서 평가 CLI.
 *
 *   npm run eval:memory-rank                        # mock — golden-memory-rank.json 을 최신순·순위 방식으로 채점(운영 상한과 그 1/2·1/4)
 *   npm run eval:memory-rank -- --verbose           # 목표별 결과까지
 *   npm run eval:memory-rank -- --max-tokens 1000   # 토큰 상한 하나만, 목표별로
 *   npm run eval:memory-rank -- --golden <파일>
 *
 * LLM·DB 를 쓰지 않는다. 어느 상한에서든 순위 방식의 recall 이 최신순보다 낮으면 종료 코드 1
 * (순위 방식이 기본 켜짐이므로, 규칙을 바꿔 최신순보다 나빠지면 걸린다).
 *
 * @module evaluation/run-memory-rank-evaluation
 */
import './load-env';
import { loadMemoryRankGolden, runMemoryRankGolden, MEMORY_RANK_CAP_RATIOS } from './memory-rank-evaluator';
import { USER_CONTEXT_LIMITS } from '../config/runtime-limits';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function main(): boolean {
    const golden = loadMemoryRankGolden(argValue('--golden'));
    const only = argValue('--max-tokens');
    // 메모리 84건은 운영 상한에서 거의 다 실린다 — 상한이 실제로 자르는 조건(메모리가 2배·4배 많은 사용자에 해당)도 함께 잰다.
    const caps = only ? [Number(only)] : MEMORY_RANK_CAP_RATIOS.map((r) => Math.floor(USER_CONTEXT_LIMITS.MAX_MEMORY_TOKENS * r));
    console.log(`\n메모리 주입 순서 평가 (mock) — v${golden.version}, 메모리 ${golden.memories.length}건 · 목표 ${golden.goals.length}개`);
    let ok = true;
    for (const maxTokens of caps) {
        const s = runMemoryRankGolden(golden, { maxTokens });
        console.log(`\n[상한 ${s.maxTokens}토큰]`);
        console.log(`  최신순   : recall ${pct(s.recall.recency)} · 상시 선호 ${pct(s.alwaysRecall.recency)} · 실린 메모리 ${s.injected.recency}건`);
        console.log(`  순위 방식: recall ${pct(s.recall.ranked)} · 상시 선호 ${pct(s.alwaysRecall.ranked)} · 실린 메모리 평균 ${s.injected.ranked.toFixed(1)}건`);
        console.log(`  목표별: 순위 방식 우세 ${s.wins} · 같음 ${s.ties} · 최신순 우세 ${s.losses}`);
        if (process.argv.includes('--verbose') || only) {
            for (const g of s.goals) {
                const mark = g.rankedHit.length > g.recencyHit.length ? '+' : g.rankedHit.length < g.recencyHit.length ? '-' : '=';
                console.log(`  ${mark} ${g.goalId}: 최신순 ${g.recencyHit.length}/${g.expected} · 순위 ${g.rankedHit.length}/${g.expected}${g.rankedMissed.length ? ` (놓침: ${g.rankedMissed.join(', ')})` : ''}`);
            }
        }
        if (s.recall.ranked < s.recall.recency) ok = false;
    }
    return ok;
}

try {
    const ok = main();
    console.log(`\n결과: ${ok ? '통과' : '실패 (순위 방식의 recall 이 최신순보다 낮은 조건이 있다)'}`);
    process.exit(ok ? 0 : 1);
} catch (e) {
    console.error('[memory-rank-evaluation] 실패:', e);
    process.exit(1);
}
