/**
 * 모델 기본값 — 로컬 모델 capability 프리셋 (기본 채팅 qwen3.8-27b, 2026-09-02 교체)
 *
 * @module config/model-defaults
 */

import { resolveModelProfile, type ModelCapabilities } from './model-profiles';

/**
 * 보수적 기본 capabilities — 프리셋 미매칭 모델의 게이팅/표시 기본값 (SoT).
 */
/** 모델 가용성/자격 프로브 공통 상수 — 과금·부하 최소화를 위한 1토큰 최소 호출 */
export const MODEL_PROBE = {
    /**
     * 프로브(가용성·역할 배정 검증·로컬 도구/thinking 프로브) 1회 출력 상한.
     * ⚠️ 1 로 두면 B.AI 가 `max_tokens must be greater than 2` 400 을 돌려줘 가용성 프로브는
     * 영구 '보류', 역할 배정은 항상 거절됐다(2026-09-08 라이브 — 같은 모델이 채팅에선 정상).
     * 8 은 실측(B.AI·NVIDIA·hasa) 전부 200 이고 비용 차이는 무시할 수준.
     */
    MAX_TOKENS: 8,
} as const;

export const FALLBACK_CAPABILITIES: ModelCapabilities = {
    toolCalling: false,
    thinking: false,
    vision: false,
    streaming: true,
};

/**
 * modelId → 모델 프로필(config/model-profiles.ts)의 capabilities (lowercase + startsWith-longest).
 * 매칭 없으면 null — 기본값은 호출자가 결정한다.
 *
 * `exact-우선 → prefix-longest` 는 `pure prefix-longest` 와 동치이므로 단일 규칙으로 통일.
 * `startsWith` 는 `includes` 와 달리 중간-substring 오매칭(게이팅 over-grant)을 배제하면서
 * suffixed variant(예: ':cloud', '-instruct')는 동일하게 커버한다.
 */
export function matchCapabilityPreset(modelId: string): ModelCapabilities | null {
    return resolveModelProfile(modelId).capabilities ?? null;
}

/**
 * ============================================================
 * 로컬 모델 능력 해석 (SoT)
 * ============================================================
 *
 * 배경: 능력을 **모델명 접두어 프리셋**으로만 판정하다 보니, 프리셋에 없는 모델로 교체하면
 * `FALLBACK_CAPABILITIES`(toolCalling=false)로 떨어져 채팅의 MCP 도구가 통째로 사라졌다.
 * 에러가 아니라 조용한 축소라 알아채기 어렵다(코드 주석에 과거 사고가 기록돼 있다).
 *
 * 해석 순서 (앞이 이길수록 신뢰도 높음):
 *   ① env `LLM_MODEL_CAPABILITIES_JSON` — 운영자 명시 override (배포 없이 대응)
 *   ② 모델 프로필(`config/model-profiles.ts`)의 capabilities — 실측으로 확정한 값
 *   ③ 부팅 프로브 실측 (`probedCapabilities`, 현재 toolCalling 만) — 미등록 모델 안전망
 *   ④ `FALLBACK_CAPABILITIES` — 전부 보수적 false
 *
 * vision·thinking 은 프로브 비용/신뢰도 문제로 실측하지 않는다(이미지 필요, reasoning 은
 * 출력 형식 의존). 이 둘은 ①②만 반영되며 미상이면 보수적으로 꺼진 채 남는다 —
 * 잘못 켜면 400 이지만, 꺼져 있으면 기능 축소에 그친다.
 */
interface ProbedCapabilities {
    toolCalling?: boolean;
}

let _capsOverride: Readonly<Record<string, Partial<ModelCapabilities>>> | null = null;

/** 테스트 훅 — env 변경 후 캐시 리셋. */
export function resetCapabilityOverrideCache(): void {
    _capsOverride = null;
}

function getCapabilityOverrides(): Readonly<Record<string, Partial<ModelCapabilities>>> {
    if (_capsOverride) return _capsOverride;
    const raw = process.env.LLM_MODEL_CAPABILITIES_JSON;
    const out: Record<string, Partial<ModelCapabilities>> = {};
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
            for (const [prefix, caps] of Object.entries(parsed)) {
                const picked: Partial<ModelCapabilities> = {};
                for (const k of ['toolCalling', 'thinking', 'vision', 'streaming'] as const) {
                    if (typeof caps?.[k] === 'boolean') picked[k] = caps[k] as boolean;
                }
                if (Object.keys(picked).length > 0) out[prefix.toLowerCase()] = picked;
            }
        } catch { /* 형식 오류는 무시 — 프리셋/프로브로 진행 */ }
    }
    _capsOverride = out;
    return _capsOverride;
}

/** override 접두어 매칭 — 프리셋과 동일한 startsWith-longest 규칙. */
function matchOverride(modelId: string): Partial<ModelCapabilities> | null {
    const lower = modelId.toLowerCase();
    let best: Partial<ModelCapabilities> | null = null;
    let bestLen = -1;
    for (const [prefix, caps] of Object.entries(getCapabilityOverrides())) {
        if (lower.startsWith(prefix) && prefix.length > bestLen) {
            best = caps;
            bestLen = prefix.length;
        }
    }
    return best;
}

/**
 * 로컬 모델의 최종 능력. 위 해석 순서를 한 곳에서 적용한다.
 * @param probed 부팅 프로브 실측치 (`LocalModelEntry.probedCapabilities`)
 */
export function resolveLocalCapabilities(
    modelId: string,
    probed?: ProbedCapabilities,
): ModelCapabilities {
    const preset = matchCapabilityPreset(modelId);
    const base: ModelCapabilities = preset
        ? { ...preset }
        : {
            ...FALLBACK_CAPABILITIES,
            // 프리셋 미등록 — 실측이 있으면 그것으로 도구 지원을 결정한다(조용한 무력화 차단).
            ...(probed?.toolCalling !== undefined ? { toolCalling: probed.toolCalling } : {}),
        };
    const override = matchOverride(modelId);
    return override ? { ...base, ...override } : base;
}
