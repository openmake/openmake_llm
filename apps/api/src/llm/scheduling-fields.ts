/**
 * 로컬 vLLM 요청에 싣는 스케줄링 필드(`cache_salt`·`priority`) — PR-13. 둘 다 플래그 기본 OFF.
 * 외부 provider(quotaExempt) 요청에는 싣지 않는다 — 모르는 필드를 거절하는 provider 가 있다.
 *
 * @module llm/scheduling-fields
 */
import crypto from 'crypto';
import { LLM_CACHE_SALT_HEX_CHARS, LLM_REQUEST_PRIORITY, type LlmPrefixCacheSaltMode } from '../config/llm-priority';
import type { LlmRequestClass } from './request-metrics';

export interface SchedulingFieldsInput {
    saltMode: LlmPrefixCacheSaltMode;
    priorityEnabled: boolean;
    /** 외부 provider 요청이면 아무것도 싣지 않는다 */
    external: boolean;
    userId?: string | null;
    requestClass?: LlmRequestClass;
    /** salt HMAC 키(API_KEY_PEPPER) — 비어 있으면 salt 를 싣지 않는다(추측 가능한 salt 는 격리가 아니다) */
    saltKey: string;
}

/** PURE: 켜진 필드만 담은 객체(없으면 빈 객체) */
export function buildSchedulingFields(p: SchedulingFieldsInput): Record<string, unknown> {
    if (p.external) return {};
    const out: Record<string, unknown> = {};
    if (p.saltMode === 'user' && p.userId && p.saltKey) {
        out.cache_salt = crypto.createHmac('sha256', p.saltKey).update(String(p.userId)).digest('hex').slice(0, LLM_CACHE_SALT_HEX_CHARS);
    }
    if (p.priorityEnabled) {
        out.priority = LLM_REQUEST_PRIORITY[p.requestClass ?? 'unspecified'];
    }
    return out;
}

/** PURE: reasoning extra_body 와 스케줄링 필드를 합친다(둘 다 비면 undefined — 종전 호출 형태 유지) */
export function mergeExtraBody(
    base: Record<string, unknown> | undefined,
    fields: Record<string, unknown>,
): Record<string, unknown> | undefined {
    if (Object.keys(fields).length === 0) return base;
    return { ...(base ?? {}), ...fields };
}
