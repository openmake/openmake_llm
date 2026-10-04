/**
 * 접기 뒤 회상 평가 CLI.
 *
 *   npm run eval:compaction                     # mock — 골든 각본(golden-compaction.json)을 접기·인계 요약에 통과시켜 채점
 *   npm run eval:compaction -- --golden <파일>   # 다른 각본 묶음으로
 *
 * LLM·DB 를 쓰지 않는다(다른 mock 평가처럼 설정 검증용 JWT_SECRET 만 있으면 된다 — CI 는 전역 env 로 준다).
 * "무엇을 했고 결과가 어땠나"(required) 사실이 하나라도 사라지면 종료 코드 1.
 * 본문 속 내용(content)의 잔존율은 참고용으로만 낸다.
 *
 * @module evaluation/run-compaction-evaluation
 */
import './load-env';
import { loadCompactionGolden, runCompactionGolden } from './compaction-recall-evaluator';

function argValue(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const pct = (t: { kept: number; total: number }): string => (t.total === 0 ? '-' : `${t.kept}/${t.total} (${Math.round((t.kept / t.total) * 100)}%)`);

function main(): boolean {
    const golden = loadCompactionGolden(argValue('--golden'));
    const summary = runCompactionGolden(golden);
    console.log(`\n접기 뒤 회상 평가 (mock) — v${summary.version}, 각본 ${golden.scenarios.length}개`);
    for (const p of summary.policies) {
        console.log(`  [${p.policy}] 사라진 턴 ${p.vanishedTurns} · 한 일과 성패 ${pct(p.required)} · 본문 내용 ${pct(p.content)} (참고)`);
    }
    for (const f of summary.failures) console.log(`  ✗ ${f.id}: ${f.reason}`);
    return summary.failures.length === 0;
}

try {
    const ok = main();
    console.log(`결과: ${ok ? '통과' : '실패'}`);
    process.exit(ok ? 0 : 1);
} catch (e) {
    console.error('[compaction-evaluation] 실패:', e);
    process.exit(1);
}
