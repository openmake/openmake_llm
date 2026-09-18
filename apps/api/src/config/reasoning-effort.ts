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

import { REASONING_EFFORT_LADDER, resolveModelProfile, resetModelProfileCache, type ReasoningEffort } from './model-profiles';

/** 강도 사다리 — 낮은 것부터. 정규화 시 인접값 탐색 기준. */
export { REASONING_EFFORT_LADDER };
export type { ReasoningEffort };

/** 지원 목록 미상 모델의 보수적 기본값 — OpenAI 표준 3단만 가정(xhigh 는 벤더 확장). */
const FALLBACK_SUPPORTED: readonly ReasoningEffort[] = ['low', 'medium', 'high'];

/** 테스트 훅 — env 변경 후 캐시 리셋. 모델별 지원 목록은 모델 프로필(config/model-profiles.ts)이 가진다. */
export function resetReasoningEffortCache(): void {
    resetModelProfileCache();
}

/**
 * 모델이 받는 강도 목록 (미등록 모델은 보수적 기본값).
 *
 * `providerId` 가 로컬이 아니면 **provider 한정 키**(`"<providerId>:<model prefix>"`, 예 `"bai:glm-5.3"`)만
 * 찾고, 없으면 OpenAI 표준 3단으로 폴백한다 — 로컬용 bare prefix(`qwen3.8` → xhigh 포함)가
 * 외부의 같은 이름 모델(B.AI `qwen3.8-flash`)에 새어 나가 검증되지 않은 값(xhigh)을 보내지 않게.
 * (2026-09-03 라이브: B.AI glm/qwen 은 low·medium·high 를 모두 200 으로 받는다.)
 */
export function supportedEfforts(modelId: string | undefined, providerId?: string): readonly ReasoningEffort[] {
    return resolveModelProfile(modelId, providerId).reasoningEfforts ?? FALLBACK_SUPPORTED;
}

/**
 * 요청 강도를 대상 모델이 받는 값으로 정규화.
 * 미지원이면 사다리에서 가장 가까운 값으로 대체하고, 거리가 같으면 **상위**를 택한다
 * (사용자가 '높음'을 고른 의도를 낮추지 않는다 — qwen3.8 의 high → xhigh).
 */
export function normalizeEffort(
    modelId: string | undefined,
    requested: ReasoningEffort,
    providerId?: string,
): ReasoningEffort {
    const supported = supportedEfforts(modelId, providerId);
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
