/**
 * ============================================================
 * Tool Result Truncation Recorder — tool_result_truncations 적재 (G3, 2026-08-08)
 * ============================================================
 *
 * MAX_TOOL_RESULT_CHARS 단순 절단의 발생률·절단 폭 셰도우 계측 (measure-first).
 * chunk→병렬요약 등 긴 결과 처리 도입 판단은 이 데이터가 게이트다.
 * 실행 경로를 바꾸지 않으며 절대 도구 흐름을 차단하지 않는다(모든 에러 무시).
 * (orchestration-shadow-recorder 와 동일 패턴 — fire-and-forget, await 금지)
 *
 * 집계 예시 (판단 게이트):
 *   SELECT tool_name, COUNT(*) total, COUNT(*) FILTER (WHERE truncated) cut,
 *          ROUND(AVG(raw_chars) FILTER (WHERE truncated)) avg_raw
 *   FROM tool_result_truncations GROUP BY 1 ORDER BY cut DESC;
 *
 * @module services/tool-result-truncation-recorder
 */
import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('TruncationShadow');

/**
 * 도구 결과 길이/절단 여부를 적재한다 (fire-and-forget — await 하지 말 것).
 * 전 도구 호출을 적재한다 (절단률의 분모 확보 — 절단 건만 적재하면 비율을 못 구함).
 */
export function recordToolResultTruncation(params: {
    /** 절단 적용 경로: 채팅 도구 루프 | 에이전트 작업 */
    path: 'chat' | 'agent_task';
    toolName: string;
    /** 절단 전 원본 문자 수 */
    rawChars: number;
    /** 적용된 캡 (MAX_TOOL_RESULT_CHARS) */
    capChars: number;
}): void {
    const { path, toolName, rawChars, capChars } = params;
    void (async () => {
        try {
            const pool = getPool();
            if (!pool) return;
            await pool.query(
                `INSERT INTO tool_result_truncations (path, tool_name, raw_chars, cap_chars, truncated)
                 VALUES ($1, $2, $3, $4, $5)`,
                [path, toolName, rawChars, capChars, rawChars > capChars],
            );
        } catch (e) {
            // 계측 실패는 본 흐름에 영향 없음 — 디버그 수준으로만 남긴다.
            logger.debug(`절단 계측 적재 실패(무시): ${e instanceof Error ? e.message : e}`);
        }
    })();
}
