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
    /** 병렬 위임 의도(SPAWN_INTENT_PATTERNS) — 110. 미지정=false(토글 셰도우 등). */
    spawnIntent?: boolean;
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
/** 질의 프리뷰 상한 — 문구 튜닝 반례 진단에 필요한 최소 길이만 저장(087). */
const QUERY_PREVIEW_MAX_CHARS = 80;

export function recordOrchestrationDispatch(params: {
    requestId?: string;
    userId?: string;
    queryLength: number;
    telemetry: OrchestrationTelemetry;
    /** 같은 턴의 사용자 수동 토글 — 의도 패턴 재현율 측정용. */
    userMode: 'discussion' | 'deep-research' | 'none';
    /**
     * 질의 원문 — 앞 QUERY_PREVIEW_MAX_CHARS 자만 저장한다(087).
     * "노출됐는데 모델이 호출하지 않은" 반례를 봐야 도구 description 을 근거 기반으로
     * 고칠 수 있다(측정만으로는 무엇을 고칠지 알 수 없음). 보존은 db-retention 이 30일로 제한.
     */
    message?: string;
}): void {
    const { requestId, userId, queryLength, telemetry, userMode, message } = params;
    const preview = message?.trim()
        ? message.trim().slice(0, QUERY_PREVIEW_MAX_CHARS)
        : null;
    void (async () => {
        try {
            const pool = getPool();
            if (!pool) return;
            await pool.query(
                `INSERT INTO orchestration_dispatch_decisions
                   (request_id, user_id, query_length, discussion_intent, task_delegate_intent,
                    tools_exposed, tool_called, tool_success, user_mode, query_preview, spawn_intent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
                    preview,
                    telemetry.spawnIntent ?? false,
                ],
            );
        } catch (e) {
            logger.warn('오케스트레이션 셰도우 적재 실패 (무시):', e instanceof Error ? e.message : e);
        }
    })();
}
