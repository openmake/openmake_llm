/**
 * 추론 강도(reasoning effort) 정책 — 모델별 지원값 차이 흡수.
 *
 * vLLM 은 모델 chat_template 이 선언한 값만 받는다. 실측(2026-08-23, DGX 라이브):
 *   - qwen3.6-35b-a3b : low / medium / high / xhigh 모두 200
 *   - qwen3.8-27b     : high 를 **400 거절** ("Supported types are xhigh (default), medium, and low")
 * 사용자 UI 는 모델과 무관한 3단(낮음·보통·높음)을 노출하고, 서버가 대상 모델이 받는
 * 값으로 정규화한다 — 모델을 바꿔도 UI·프론트 계약은 그대로다.
 *
 * @module config/reasoning-effort
 */

/** 강도 사다리 — 낮은 것부터. 정규화 시 인접값 탐색 기준. */
export const REASONING_EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh'] as const;

export type ReasoningEffort = typeof REASONING_EFFORT_LADDER[number];

/** 지원 목록 미상 모델의 보수적 기본값 — OpenAI 표준 3단만 가정(xhigh 는 벤더 확장). */
const FALLBACK_SUPPORTED: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

/**
 * 모델 id 접두어 → 지원 강도 목록. `matchCapabilityPreset` 과 동일한
 * startsWith-longest 규칙을 쓴다(중간 substring 오매칭 배제).
 * env `LLM_REASONING_EFFORTS_JSON` 으로 통째 override 가능 — 새 모델 도입 시 배포 없이 대응.
 */
const DEFAULT_MODEL_EFFORTS: Readonly<Record<string, readonly ReasoningEffort[]>> = {
    'qwen3.6': ['low', 'medium', 'high', 'xhigh'],
    // 실측 거절값(high)을 제외 — 사용자가 '높음'을 고르면 아래 정규화가 xhigh 로 올린다.
    'qwen3.8': ['low', 'medium', 'xhigh'],
};

let _cached: Readonly<Record<string, readonly ReasoningEffort[]>> | null = null;

function isEffort(v: unknown): v is ReasoningEffort {
    return typeof v === 'string' && (REASONING_EFFORT_LADDER as readonly string[]).includes(v);
}

function getModelEfforts(): Readonly<Record<string, readonly ReasoningEffort[]>> {
    if (_cached) return _cached;
    const raw = process.env.LLM_REASONING_EFFORTS_JSON;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const out: Record<string, readonly ReasoningEffort[]> = {};
            for (const [prefix, list] of Object.entries(parsed)) {
                if (Array.isArray(list) && list.every(isEffort) && list.length > 0) {
                    out[prefix.toLowerCase()] = list as ReasoningEffort[];
                }
            }
            if (Object.keys(out).length > 0) {
                _cached = out;
                return _cached;
            }
        } catch { /* 형식 오류는 기본값으로 폴백 */ }
    }
    _cached = DEFAULT_MODEL_EFFORTS;
    return _cached;
}

/** 테스트 훅 — env 변경 후 캐시 리셋. */
export function resetReasoningEffortCache(): void {
    _cached = null;
}

/** 모델이 받는 강도 목록 (미등록 모델은 보수적 기본값). */
export function supportedEfforts(modelId: string | undefined): readonly ReasoningEffort[] {
    if (!modelId) return FALLBACK_SUPPORTED;
    const lower = modelId.toLowerCase();
    let best: readonly ReasoningEffort[] | null = null;
    let bestLen = -1;
    for (const [prefix, list] of Object.entries(getModelEfforts())) {
        if (lower.startsWith(prefix) && prefix.length > bestLen) {
            best = list;
            bestLen = prefix.length;
        }
    }
    return best ?? FALLBACK_SUPPORTED;
}

/**
 * 요청 강도를 대상 모델이 받는 값으로 정규화.
 * 미지원이면 사다리에서 가장 가까운 값으로 대체하고, 거리가 같으면 **상위**를 택한다
 * (사용자가 '높음'을 고른 의도를 낮추지 않는다 — qwen3.8 의 high → xhigh).
 */
export function normalizeEffort(
    modelId: string | undefined,
    requested: ReasoningEffort,
): ReasoningEffort {
    const supported = supportedEfforts(modelId);
    if (supported.includes(requested)) return requested;
    const want = REASONING_EFFORT_LADDER.indexOf(requested);
    let best = supported[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const cand of supported) {
        const d = Math.abs(REASONING_EFFORT_LADDER.indexOf(cand) - want);
        // 거리가 같으면 사다리 상위(더 강한 추론)를 선호 — `<=` 로 뒤쪽(상위) 우선.
        if (d <= bestScore) {
            bestScore = d;
            best = cand;
        }
    }
    return best;
}
