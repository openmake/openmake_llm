/**
 * LLM 요청 셰도우 계측 (F06.2 G0, 158) — 모델·요청 클래스별 TTFT·총 시간·토큰·종료 사유·오류를 1건당 1행 남긴다.
 * 품질·비용 라우팅 도입 전에 "어느 모델이 느리고 자주 실패하나" 를 재기 위한 데이터다(라우팅 정책은 없다 — measure-first).
 * fire-and-forget·fail-open: 기록 실패가 LLM 호출에 영향을 주지 않는다.
 *
 * @module llm/request-metrics
 */
import { LLM_REQUEST_METRICS } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';

const logger = createLogger('LlmRequestMetrics');

/** 요청 클래스 — 우선순위 부여(PR-13)와 계측이 같은 분류를 쓴다 */
export const LLM_REQUEST_CLASSES = ['interactive', 'agent_turn', 'fanout', 'background', 'unspecified'] as const;
export type LlmRequestClass = (typeof LLM_REQUEST_CLASSES)[number];

export interface LlmRequestMetric {
    model: string;
    providerId: string;
    requestClass?: LlmRequestClass;
    userId?: string | null;
    ttftMs?: number | null;
    totalMs: number;
    promptTokens?: number | null;
    completionTokens?: number | null;
    finishReason?: string | null;
    errorCode?: string | null;
    costOwner?: 'user' | 'server' | 'local' | null;
}

/** PURE: 오류 → 짧은 코드(원문 메시지·비밀값을 저장하지 않는다) */
export function classifyLlmError(err: unknown): string {
    if (!err) return 'unknown';
    const e = err as { name?: string; code?: string; status?: number; message?: string };
    if (e.name === 'AbortError' || e.message === 'ABORTED' || /aborted/i.test(e.message ?? '')) return 'aborted';
    if (/timed? ?out|timeout/i.test(e.message ?? '') || e.code === 'ETIMEDOUT') return 'timeout';
    if (typeof e.status === 'number') return `http_${e.status}`;
    if (typeof e.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(e.code)) return e.code.toLowerCase();
    if (e.name && /^[A-Za-z]{2,40}$/.test(e.name)) return e.name.slice(0, LLM_REQUEST_METRICS.ERROR_CODE_MAX_CHARS);
    return 'unknown';
}

let warned = false;

export function recordLlmRequestMetric(m: LlmRequestMetric): void {
    if (!LLM_REQUEST_METRICS.ENABLED) return;
    void (async () => {
        try {
            const { getPool } = await import('../data/models/unified-database');
            await getPool().query(
                `INSERT INTO llm_request_metrics (model, provider_id, request_class, user_id, ttft_ms, total_ms, prompt_tokens, completion_tokens, finish_reason, error_code, cost_owner)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [m.model, m.providerId, m.requestClass ?? 'unspecified', m.userId ?? null,
                    m.ttftMs === null || m.ttftMs === undefined ? null : Math.max(0, Math.round(m.ttftMs)),
                    Math.max(0, Math.round(m.totalMs)), m.promptTokens ?? null, m.completionTokens ?? null,
                    m.finishReason ?? null, m.errorCode ? m.errorCode.slice(0, LLM_REQUEST_METRICS.ERROR_CODE_MAX_CHARS) : null, m.costOwner ?? null],
            );
        } catch (e) {
            if (!warned) {
                warned = true;
                logger.warn(`기록 실패(무시, 이후 생략): ${e instanceof Error ? e.message : e}`);
            }
        }
    })();
}
