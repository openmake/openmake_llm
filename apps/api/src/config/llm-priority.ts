/**
 * 로컬 vLLM 요청 우선순위·prefix cache 격리 (F04.6·F06.3, UX·게이트웨이 PR-13).
 *
 * - `priority` 는 vLLM `--scheduling-policy priority` 에서만 의미가 있다(값이 작을수록 먼저). DGX 가 이 정책으로
 *   뜨기 전에는 켜도 스케줄 순서가 바뀌지 않는다 — 켜는 스위치는 system_settings `LLM_PRIORITY_ENABLED`.
 * - `cache_salt` 는 같은 salt 끼리만 prefix cache 를 공유하게 한다(사용자 간 캐시 타이밍 추론 차단). 사용자별로
 *   나누면 공용 시스템 프롬프트 prefix 도 사용자마다 따로 쌓여 첫 토큰 지연이 늘 수 있다 — 켜기 전 TTFT 를 잴 것.
 *
 * @module config/llm-priority
 */
import type { LlmRequestClass } from '../llm/request-metrics';

/** 요청 클래스 → vLLM priority(작을수록 먼저). 사용자가 화면에서 기다리는 채팅이 가장 앞선다 */
export const LLM_REQUEST_PRIORITY: Record<LlmRequestClass, number> = {
    interactive: 0,
    agent_turn: 1,
    unspecified: 1,
    fanout: 2,
    background: 3,
};

export const LLM_PREFIX_CACHE_SALT_MODES = ['off', 'user'] as const;
export type LlmPrefixCacheSaltMode = (typeof LLM_PREFIX_CACHE_SALT_MODES)[number];

/** HMAC-SHA256 hex 앞부분 길이 — 원 userId 를 추론 서버에 싣지 않으면서 충돌은 무시할 수준 */
export const LLM_CACHE_SALT_HEX_CHARS = 32;
