/**
 * ============================================================
 * Tail 셰도우 라벨링 배치 — routing_shadow_decisions.a_was_correct 채우기
 * ============================================================
 *
 * 셰도우 행(질문 메타)을 conversation_messages 와 시간±길이 근접으로 조인해
 * (질문, 응답) 쌍을 복원하고, 'judge' role 모델(사용자 매핑 → 전역 → 로컬
 * fail-open)로 응답 정오를 판정해 라벨을 채운다. 게이트 가중치 교정(Q4)의
 * 학습 라벨 생성용 오프라인 1회성 배치 — 재실행 안전(라벨 NULL 행만 처리).
 *
 * 실행: npx ts-node apps/api/src/scripts/label-tail-shadow.ts [--dry-run] [--limit N]
 *       [--verifiable-only] [--user ID] [--no-local-fallback]
 *
 * 판정 3값: correct/incorrect → a_was_correct 기록, unsure → NULL 유지(스킵).
 * 실시간성 질문(날씨 등)·판단 불가는 unsure 로 유도해 라벨 오염을 막는다.
 *
 * `--verifiable-only`: verifiability='none' 행을 대상에서 제외한다. 게이트가
 * `isTail = errorScore≥θ AND verifiability≠'none'` 이라 none 행은 애초에 tail 이 될 수
 * 없어 캘리브레이션에 기여하지 못한다. 게다가 그 모집단은 대부분 잡담·피드백이라
 * judge 가 unsure 규칙을 지키지 못하고 incorrect 를 남발해 라벨을 오염시켰다
 * (2026-08-22 실측: 무필터 dry-run 20건 중 incorrect 12건 — 실제 오답률로 비현실적).
 *
 * `--user ID`: 해당 사용자 행만 처리. judge role 이 사용자별 매핑(BYOK)으로 외부
 * 모델에 배정된 경우, 매핑이 없는 사용자의 행은 로컬로 fail-open 되어 같은 배치에
 * 서로 다른 판정자의 라벨이 섞인다. 그걸 막는다.
 *
 * `--no-local-fallback`: judge 연속 실패 시 로컬 강등 대신 즉시 중단한다. 라벨링에서
 * 로컬 강등은 곧 '답변을 쓴 모델이 자기 답변을 채점'하는 상태로의 복귀라, 조용히
 * 이어가면 라벨 절반이 오염된 채 완료된 것처럼 보인다. 배치에선 멈추는 편이 낫다.
 *
 * @module scripts/label-tail-shadow
 */
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true } as dotenv.DotenvConfigOptions);

import { getPool } from '../data/models/unified-database';
import { judgeClientFor } from '../services/agent-task/role-client';
import { createClient, type LLMClient } from '../llm';
import { createLogger } from '../utils/logger';

const logger = createLogger('LabelTailShadow');

// ── 배치 파라미터 (이 스크립트 전용 명명 상수) ──
/** 셰도우 적재 시각 ↔ user 메시지 저장 시각 허용 오차 (초) */
const MATCH_WINDOW_SEC = 180;
/** query_length(JS length) ↔ char_length(content) 허용 오차 */
const MATCH_LEN_TOLERANCE = 5;
/** user 메시지 이후 assistant 응답 탐색 윈도우 */
const ANSWER_WINDOW = '15 minutes';
/** judge 에 보낼 질문/응답 절단 상한 (토큰 비용·컨텍스트 보호) */
const JUDGE_Q_MAX_CHARS = 3000;
const JUDGE_A_MAX_CHARS = 5000;
/** judge 호출 동시성 (외부 무료 티어 rate limit 보호) */
const CONCURRENCY = 3;
/** judge 호출 1건 타임아웃 (ms) — 외부 무료 티어 무한 hold 차단 */
const JUDGE_TIMEOUT_MS = 90_000;
/** 연속 실패 이 횟수 도달 시 로컬 default 모델로 강등 */
const FALLBACK_AFTER_CONSECUTIVE_FAILURES = 3;

interface LabelRow {
    id: number;
    user_id: string;
    question: string;
    answer: string;
}

const JUDGE_SYSTEM = [
    '너는 AI 어시스턴트 답변의 정확성 판정자다.',
    '사용자 질문과 어시스턴트 답변을 보고, 답변이 사실적·논리적으로 올바른지 판정하라.',
    '판정 규칙 (엄격 적용):',
    '- correct: 답변이 질문에 사실적·논리적으로 올바르게 응답함.',
    '- incorrect: 답변 **자체 안에서** 명백한 결함이 확인될 때만 — 계산/추론 오류, 자기모순, 질문 취지 오해, 요청 작업 수행 실패 선언.',
    '- unsure: 다음은 전부 unsure 다 —',
    '  ① 잡담·인사·피드백·지시 등 정오 개념이 없는 발화',
    '  ② 주관적/창작/의견 질문',
    '  ③ 실시간·최신 정보 질문(날씨·시세·현직 인물 등). 특히 답변이 [출처 N]/URL 등 검색 결과를 인용했다면 너의 내부 지식이 오래돼 상충해 보여도 검증 불가로 unsure 처리하라. 너의 지식 기준으로 최신 사실을 틀렸다고 단정하지 마라.',
    '  ④ 그 외 확신이 없는 모든 경우.',
    '반드시 JSON 한 줄로만 답하라: {"verdict":"correct"} 또는 {"verdict":"incorrect"} 또는 {"verdict":"unsure"}',
].join('\n');

type Verdict = 'correct' | 'incorrect' | 'unsure';

async function judgeOne(client: LLMClient, row: LabelRow, think: boolean): Promise<Verdict | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
    try {
        const user = [
            `[질문]\n${row.question.slice(0, JUDGE_Q_MAX_CHARS)}`,
            `[답변]\n${row.answer.slice(0, JUDGE_A_MAX_CHARS)}`,
        ].join('\n\n');
        const r = await client.chat(
            [{ role: 'system', content: JUDGE_SYSTEM }, { role: 'user', content: user }],
            undefined, undefined, { think, signal: controller.signal },
        );
        const m = (r.content ?? '').match(/"verdict"\s*:\s*"(correct|incorrect|unsure)"/);
        return m ? (m[1] as Verdict) : null;
    } finally {
        clearTimeout(timer);
    }
}

async function main(): Promise<void> {
    const dryRun = process.argv.includes('--dry-run');
    const verifiableOnly = process.argv.includes('--verifiable-only');
    const noLocalFallback = process.argv.includes('--no-local-fallback');
    // 판정은 조건부 규칙('검색 인용 실시간 답변은 unsure' 등)을 지켜야 하는 작업이라
    // 추론 깊이가 결과를 가를 수 있다. 기본 off 는 로컬 qwen 의 thinking 폭주 방지 관성.
    // ⚠️ chatgpt(OAuth) role 경로에는 효과가 없다 — ProviderRoleClient.chat 이 think 를
    //    provider 요청에 싣지 않고, Codex 백엔드의 GPT-5 계열은 서버측에서 기본 추론한다
    //    (2026-08-22 실측: 동일 30행 off/on 27행 동일 판정). 로컬/openai-compatible 전용.
    const think = process.argv.includes('--think');
    const limitArg = process.argv.indexOf('--limit');
    const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) || 0 : 0;
    const userArg = process.argv.indexOf('--user');
    const onlyUserId = userArg >= 0 ? String(process.argv[userArg + 1] ?? '').trim() : '';

    const pool = getPool();
    const { rows } = await pool.query<LabelRow>(
        `SELECT r.id, r.user_id, um.content AS question, am.content AS answer
         FROM routing_shadow_decisions r
         JOIN LATERAL (
             SELECT m.session_id, m.content, m.created_at
             FROM conversation_messages m
             JOIN conversation_sessions s ON s.id = m.session_id
             WHERE s.user_id = r.user_id AND m.role = 'user'
               AND abs(extract(epoch FROM (m.created_at - r.created_at))) < $1
               AND abs(char_length(m.content) - r.query_length) <= $2
             ORDER BY abs(char_length(m.content) - r.query_length),
                      abs(extract(epoch FROM (m.created_at - r.created_at)))
             LIMIT 1
         ) um ON true
         JOIN LATERAL (
             SELECT m2.content
             FROM conversation_messages m2
             WHERE m2.session_id = um.session_id AND m2.role = 'assistant'
               AND m2.created_at >= um.created_at
               AND m2.created_at < um.created_at + $3::interval
             ORDER BY m2.created_at
             LIMIT 1
         ) am ON true
         WHERE r.user_id IS NOT NULL
           AND r.a_was_correct IS NULL
           AND char_length(um.content) > 0
           AND char_length(am.content) > 0
           ${verifiableOnly ? "AND r.verifiability <> 'none'" : ''}
           ${onlyUserId ? 'AND r.user_id = $4' : ''}
         ORDER BY r.id
         ${limit > 0 ? 'LIMIT ' + limit : ''}`,
        onlyUserId
            ? [MATCH_WINDOW_SEC, MATCH_LEN_TOLERANCE, ANSWER_WINDOW, onlyUserId]
            : [MATCH_WINDOW_SEC, MATCH_LEN_TOLERANCE, ANSWER_WINDOW],
    );

    logger.info(
        `라벨링 대상 ${rows.length}건 (dry-run=${dryRun}, verifiable-only=${verifiableOnly}` +
        `, user=${onlyUserId || 'all'}, no-local-fallback=${noLocalFallback}, think=${think})`,
    );
    if (rows.length === 0) {
        logger.info('처리할 행 없음 — 종료');
        return;
    }

    // judge 클라이언트: user 별 1회 해석 캐시 (BYOK 매핑 반영)
    const judgeCache = new Map<string, LLMClient>();
    const localFallback = createClient({});
    let consecutiveFailures = 0;
    let degradedToLocal = false;

    const stats = { correct: 0, incorrect: 0, unsure: 0, parse_fail: 0, error: 0 };

    const work = [...rows];
    const worker = async (): Promise<void> => {
        for (;;) {
            const row = work.shift();
            if (!row) return;
            let client: LLMClient;
            if (degradedToLocal) {
                client = localFallback;
            } else {
                let cached = judgeCache.get(row.user_id);
                if (!cached) {
                    cached = await judgeClientFor(row.user_id);
                    judgeCache.set(row.user_id, cached);
                }
                client = cached;
            }
            try {
                const verdict = await judgeOne(client, row, think);
                consecutiveFailures = 0;
                if (verdict === null) {
                    stats.parse_fail++;
                } else {
                    stats[verdict]++;
                    if (verdict !== 'unsure' && !dryRun) {
                        await pool.query(
                            'UPDATE routing_shadow_decisions SET a_was_correct = $1 WHERE id = $2',
                            [verdict === 'correct', row.id],
                        );
                    }
                }
                logger.info(`#${row.id} → ${verdict ?? 'parse_fail'}`);
            } catch (e) {
                stats.error++;
                consecutiveFailures++;
                logger.warn(`#${row.id} judge 실패 (${consecutiveFailures}연속): ${e instanceof Error ? e.message : e}`);
                if (!degradedToLocal && consecutiveFailures >= FALLBACK_AFTER_CONSECUTIVE_FAILURES) {
                    if (noLocalFallback) {
                        // 로컬 강등 = 피판정 모델로의 복귀. 라벨 오염을 남기느니 중단한다.
                        logger.error(`연속 실패 ${consecutiveFailures}회 — --no-local-fallback 이므로 중단`);
                        work.length = 0;
                        return;
                    }
                    degradedToLocal = true;
                    logger.warn(`연속 실패 ${consecutiveFailures}회 — 로컬 default 모델로 강등`);
                }
            }
        }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    logger.info(
        `완료 — correct=${stats.correct} incorrect=${stats.incorrect} unsure=${stats.unsure} ` +
        `parse_fail=${stats.parse_fail} error=${stats.error} (기록 대상=${stats.correct + stats.incorrect}${dryRun ? ', dry-run 미기록' : ''})`,
    );
    await pool.end();
}

main().then(() => {
    // LLM 클라이언트 keep-alive 소켓이 이벤트 루프를 붙잡아 자연 종료가 안 됨 — 명시 종료.
    process.exit(0);
}).catch((e) => {
    logger.error('배치 실패:', e);
    process.exit(1);
});
