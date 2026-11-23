/**
 * 모델 상태 기반 라우팅(config/model-health-routing) 안내 문구.
 *
 * @module prompts/routing-notices
 */

const MODEL_UNHEALTHY: Readonly<Record<string, string>> = {
    ko: '선택한 모델이 최근 오류가 잦거나 응답이 매우 느려, 이번 답변은 다른 모델로 합니다.',
    en: 'The selected model has recently been failing often or responding very slowly, so another model answers this time.',
};

/** model_fallback 이벤트 문구 — 확정된 모델이 비정상이라 대체 모델로 바꿨을 때. */
export function getModelUnhealthyFallbackMessage(lang?: string): string {
    return MODEL_UNHEALTHY[lang === 'ko' ? 'ko' : 'en'];
}
