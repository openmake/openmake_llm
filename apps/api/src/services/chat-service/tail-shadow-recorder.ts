/**
 * ============================================================
 * Tail Shadow Recorder — routing_shadow_decisions 적재
 * ============================================================
 *
 * Tail 게이트 결정을 fire-and-forget 로 DB 에 적재한다. 셰도우 모드 전용:
 * 실행 경로를 바꾸지 않고 분포만 관측한다. 절대 채팅 흐름을 차단하지 않는다(모든 에러 무시).
 *
 * @module services/chat-service/tail-shadow-recorder
 */
import { getPool } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import type { TailDecision } from '../../chat/tail-gate';

const logger = createLogger('TailShadowRecorder');

/**
 * 셰도우 게이트 결정을 적재한다 (fire-and-forget — await 하지 말 것).
 */
export function recordTailShadow(params: {
    requestId?: string;
    userId?: string;
    queryLength: number;
    decision: TailDecision;
}): void {
    const { requestId, userId, queryLength, decision } = params;
    void (async () => {
        try {
            const pool = getPool();
            if (!pool) return;
            await pool.query(
                `INSERT INTO routing_shadow_decisions
                   (request_id, user_id, query_type, confidence, query_length,
                    error_score, error_signals, verifiability, is_tail, would_route_to)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    requestId ?? null,
                    userId && userId !== 'guest' ? userId : null,
                    decision.queryType,
                    decision.confidence,
                    queryLength,
                    decision.errorScore,
                    JSON.stringify(decision.errorSignals),
                    decision.verifiability,
                    decision.isTail,
                    decision.wouldRouteTo,
                ],
            );
        } catch (e) {
            logger.warn('tail 셰도우 적재 실패 (무시):', e instanceof Error ? e.message : e);
        }
    })();
}
