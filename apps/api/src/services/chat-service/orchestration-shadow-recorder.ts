/**
 * ============================================================
 * Orchestration Shadow Recorder — orchestration_dispatch_decisions 적재
 * ============================================================
 *
 * 오케스트레이션 자동 배정(Stage 1)의 관측 계층(Stage 2): 의도 프리필터 노출
 * 대비 실제 호출률, 사용자 토글과의 상관을 fire-and-forget 로 DB 에 적재한다.
 * 실행 경로를 바꾸지 않으며 절대 채팅 흐름을 차단하지 않는다(모든 에러 무시).
 * (tail-shadow-recorder 와 동일 패턴)
 *
 * @module services/chat-service/orchestration-shadow-recorder
 */
import { getPool } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';

const logger = createLogger('OrchestrationShadow');

/** 외부 스트림이 ctx 에 되돌려주는 오케스트레이션 텔레메트리. */
export interface OrchestrationTelemetry {
    discussionIntent: boolean;
    taskDelegateIntent: boolean;
    /** 이 턴에 노출된 오케스트레이션 도구 이름들 (미노출 = 빈 배열) */
    exposed: string[];
    /** 모델이 실제 호출한 도구 (미호출 = undefined — 모델 재량 직접 답변) */
    called?: string;
    /** 호출 결과 성공 여부 (도구 결과가 'Error' 로 시작하지 않음) */
    success?: boolean;
}

/**
 * 배정 결정을 적재한다 (fire-and-forget — await 하지 말 것).
 * 의도 미매칭·미노출 턴은 호출부가 걸러서 관측 노이즈를 줄인다
 * (전수 적재가 필요해지면 호출부 게이트만 제거하면 된다).
 */
export function recordOrchestrationDispatch(params: {
    requestId?: string;
    userId?: string;
    queryLength: number;
    telemetry: OrchestrationTelemetry;
    /** 같은 턴의 사용자 수동 토글 — 의도 패턴 재현율 측정용. */
    userMode: 'discussion' | 'deep-research' | 'none';
}): void {
    const { requestId, userId, queryLength, telemetry, userMode } = params;
    void (async () => {
        try {
            const pool = getPool();
            if (!pool) return;
            await pool.query(
                `INSERT INTO orchestration_dispatch_decisions
                   (request_id, user_id, query_length, discussion_intent, task_delegate_intent,
                    tools_exposed, tool_called, tool_success, user_mode)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    requestId ?? null,
                    userId && userId !== 'guest' ? userId : null,
                    queryLength,
                    telemetry.discussionIntent,
                    telemetry.taskDelegateIntent,
                    telemetry.exposed,
                    telemetry.called ?? null,
                    telemetry.success ?? null,
                    userMode,
                ],
            );
        } catch (e) {
            logger.warn('오케스트레이션 셰도우 적재 실패 (무시):', e instanceof Error ? e.message : e);
        }
    })();
}
