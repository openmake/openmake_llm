/**
 * 채팅 성공 턴의 운영 측정 로그 — ws-chat-handler 에서 분리 (600줄 파일 크기 가드).
 *
 * 평문 한 줄(하위호환 grep: "[ChatMetrics]" 로 추출 후 컬럼 파싱)과 구조화 meta
 * (집계/대시보드용 — 성공/에러 통일 스키마 event=chat_llm_call)를 함께 남긴다.
 *
 * @module sockets/chat-metrics-log
 */
import type { createLogger } from '../utils/logger';

export interface ChatSuccessMetrics {
    /**
     * 실제로 답한 모델 — 요청 모델이 아니다(외부 provider 폴백 시 갈린다).
     * 모델 미지정 요청(자동 선택)에서 undefined 가 될 수 있어 기존 표기를 그대로 둔다.
     */
    model: string | undefined;
    ttfbMs: number;
    generationMs: number;
    totalMs: number;
    tokens: number;
    /** toFixed(2) 문자열 — 평문 로그 표기를 그대로 쓴다. */
    tokensPerSec: string;
    routingMeta?: { fastPath?: boolean; agentBypass?: boolean; summaryCacheHit?: boolean };
}

export function logChatSuccessMetrics(
    log: ReturnType<typeof createLogger>,
    m: ChatSuccessMetrics,
): void {
    const rm = m.routingMeta;
    log.info(
        `[ChatMetrics] ttfb=${m.ttfbMs}ms fp=${rm?.fastPath ? 'Y' : 'N'} `
        + `agent_bypass=${rm?.agentBypass ? 'Y' : 'N'} cache_hit=${rm?.summaryCacheHit ? 'Y' : 'N'} `
        + `tokens=${m.tokens} tps=${m.tokensPerSec} total=${m.totalMs}ms model=${m.model}`,
        {
            event: 'chat_llm_call',
            status: 'success',
            model: m.model,
            ttft_ms: m.ttfbMs,
            ttlt_ms: m.generationMs,
            total_ms: m.totalMs,
            tokens: m.tokens,
            tps: Number(m.tokensPerSec),
            fast_path: !!rm?.fastPath,
            agent_bypass: !!rm?.agentBypass,
            summary_cache_hit: !!rm?.summaryCacheHit,
        },
    );
}
