/**
 * Space 지침·메모리 주입 정책의 코드측 폴백 기본값 — 정책값의 SoT 는 `knowledge_profiles.limits` 데이터이고,
 * 이 상수는 프로필 행에 키가 없을 때만 쓰는 명명 기본값이다(구 시드 DB·테스트 호환, No-Hardcoding: 인라인 리터럴 금지).
 *
 * @module addons/knowledge-runtime/config/injection
 */
import type { LimitsProfile } from './profiles';

export const KNOWLEDGE_INJECTION_DEFAULTS = {
    /** Space 지침 주입 토큰 예산(head-truncate) */
    maxInstructionTokens: Number(process.env.KNOWLEDGE_MAX_INSTRUCTION_TOKENS) || 2000,
    /** Space 당 메모리 항목 수 상한 */
    maxMemoryItems: Number(process.env.KNOWLEDGE_MAX_MEMORY_ITEMS) || 100,
    /** 메모리 1건 문자 수 상한 */
    maxMemoryCharsPerItem: Number(process.env.KNOWLEDGE_MAX_MEMORY_CHARS) || 2000,
    /** 메모리 주입 토큰 예산(최신 항목부터 채운다) */
    maxMemoryTokens: Number(process.env.KNOWLEDGE_MAX_MEMORY_TOKENS) || 1500,
} as const;

export interface InjectionLimits {
    maxInstructionTokens: number;
    maxMemoryItems: number;
    maxMemoryCharsPerItem: number;
    maxMemoryTokens: number;
}

/** limits 프로필에서 주입 정책값을 뽑되, 없는 키는 명명 기본값으로 폴백한다. */
export function resolveInjectionLimits(limits: LimitsProfile): InjectionLimits {
    const d = KNOWLEDGE_INJECTION_DEFAULTS;
    const pos = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
    return {
        maxInstructionTokens: pos(limits.maxInstructionTokens, d.maxInstructionTokens),
        maxMemoryItems: pos(limits.maxMemoryItems, d.maxMemoryItems),
        maxMemoryCharsPerItem: pos(limits.maxMemoryCharsPerItem, d.maxMemoryCharsPerItem),
        maxMemoryTokens: pos(limits.maxMemoryTokens, d.maxMemoryTokens),
    };
}
