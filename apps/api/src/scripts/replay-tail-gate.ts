/**
 * ============================================================
 * Tail 게이트 오프라인 리플레이 — 가중치·θ 후보 비교
 * ============================================================
 *
 * 셰도우 행에서 복원한 (질문, 라벨) 셋에 후보 가중치/θ 조합으로 게이트를
 * 재평가해 tail 선택률과 라벨 정밀도(선택된 것 중 실제 오답 비율)를 비교한다.
 * 실행 경로 무변경 — 분석 전용. 라벨은 LLM-judge 산(노이즈 있음)이므로
 * 정밀도는 방향 판단용으로만 쓴다(가중치 '증가' 근거 사용 금지).
 *
 * 실행: npx ts-node apps/api/src/scripts/replay-tail-gate.ts
 *
 * @module scripts/replay-tail-gate
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true } as dotenv.DotenvConfigOptions);

import { getPool } from '../data/models/unified-database';
import { classifyQuery } from '../chat/query-classifier';
import { assessErrorLikelihood, type ErrorLikelihoodWeights } from '../chat/error-likelihood-assessor';
import { classifyVerifiability } from '../chat/verifiability-classifier';
import { ERROR_LIKELIHOOD_WEIGHTS } from '../config/routing-config';

// 라벨 복원 조인 파라미터 — label-tail-shadow.ts 와 동일 기준
const MATCH_WINDOW_SEC = 180;
const MATCH_LEN_TOLERANCE = 5;

interface ReplayRow {
    id: number;
    question: string;
    was_correct: boolean | null;
}

type Weights = ErrorLikelihoodWeights;

/** 후보 조합 — LOW_CONFIDENCE 강등(Q4: fail 60.6% ≈ baseline 54.2%) × θ 스윕 */
const CANDIDATES: Array<{ name: string; weights: Weights; theta: number }> = [
    { name: 'current (LC .15, θ.55)', weights: ERROR_LIKELIHOOD_WEIGHTS, theta: 0.55 },
    { name: 'LC→.05, θ.55', weights: { ...ERROR_LIKELIHOOD_WEIGHTS, LOW_CONFIDENCE: 0.05 }, theta: 0.55 },
    { name: 'LC→.05, θ.50', weights: { ...ERROR_LIKELIHOOD_WEIGHTS, LOW_CONFIDENCE: 0.05 }, theta: 0.50 },
    { name: 'LC→.05, θ.45', weights: { ...ERROR_LIKELIHOOD_WEIGHTS, LOW_CONFIDENCE: 0.05 }, theta: 0.45 },
    { name: 'LC→0,   θ.50', weights: { ...ERROR_LIKELIHOOD_WEIGHTS, LOW_CONFIDENCE: 0 }, theta: 0.50 },
    { name: 'LC→0,   θ.45', weights: { ...ERROR_LIKELIHOOD_WEIGHTS, LOW_CONFIDENCE: 0 }, theta: 0.45 },
];

async function main(): Promise<void> {
    const pool = getPool();
    const { rows } = await pool.query<ReplayRow>(
        `SELECT r.id, um.content AS question, r.a_was_correct AS was_correct
         FROM routing_shadow_decisions r
         JOIN LATERAL (
             SELECT m.content FROM conversation_messages m
             JOIN conversation_sessions s ON s.id = m.session_id
             WHERE s.user_id = r.user_id AND m.role = 'user'
               AND abs(extract(epoch FROM (m.created_at - r.created_at))) < $1
               AND abs(char_length(m.content) - r.query_length) <= $2
             ORDER BY abs(char_length(m.content) - r.query_length),
                      abs(extract(epoch FROM (m.created_at - r.created_at)))
             LIMIT 1
         ) um ON true
         WHERE r.user_id IS NOT NULL AND char_length(um.content) > 0
         ORDER BY r.id`,
        [MATCH_WINDOW_SEC, MATCH_LEN_TOLERANCE],
    );

    const labeled = rows.filter((r) => r.was_correct !== null);
    const baselineFail = labeled.filter((r) => r.was_correct === false).length / Math.max(1, labeled.length);
    console.log(`복원 ${rows.length}건 (라벨 ${labeled.length}건, baseline fail ${(baselineFail * 100).toFixed(1)}%)\n`);
    console.log('config                     | tail_n | tail_% | labeled_tail | tail_fail_% (정밀도)');
    console.log('---------------------------+--------+--------+--------------+---------------------');

    for (const c of CANDIDATES) {
        let tailN = 0;
        let labeledTail = 0;
        let labeledTailFail = 0;
        for (const r of rows) {
            const cls = classifyQuery(r.question);
            const { score } = assessErrorLikelihood(r.question, cls, c.weights);
            const verif = classifyVerifiability(r.question, cls);
            const isTail = score >= c.theta && verif !== 'none';
            if (!isTail) continue;
            tailN++;
            if (r.was_correct !== null) {
                labeledTail++;
                if (r.was_correct === false) labeledTailFail++;
            }
        }
        const pct = ((tailN / rows.length) * 100).toFixed(1).padStart(5);
        const prec = labeledTail > 0 ? ((labeledTailFail / labeledTail) * 100).toFixed(1) + '%' : 'n/a';
        console.log(
            `${c.name.padEnd(26)} | ${String(tailN).padStart(6)} | ${pct}% | ${String(labeledTail).padStart(12)} | ${prec}`,
        );
    }
    await pool.end();
}

main().then(() => process.exit(0)).catch((e) => {
    console.error('리플레이 실패:', e);
    process.exit(1);
});
