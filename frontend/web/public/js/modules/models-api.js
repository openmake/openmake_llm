/**
 * ============================================
 * Models API - /api/models 공유 클라이언트
 * ============================================
 * GET /api/models 호출 + 표준 응답 unwrap + default 모델 id 선택을 단일 소스로 중앙화.
 * 이전엔 developer / cluster / model-selector 가 fetch+parse 로직을 각자 중복 구현했다.
 * (settings-standalone.js 는 classic script 라 import 불가 — 미적용, 추후 모듈화 시 흡수.)
 *
 * /api/models 는 optionalAuth — 미인증에도 200. window.authFetch 가 있으면 사용(토큰 첨부),
 * 없으면 fetch 로 폴백. 표준 응답 { success, data: { models, defaultModel } } 를 벗겨 반환.
 *
 * @module modules/models-api
 */
'use strict';

/**
 * GET /api/models → 표준 응답 unwrap.
 * @returns {Promise<{models: Array, defaultModel: string}|null>} 실패/!ok 시 null
 */
export async function fetchModelsPayload() {
    try {
        const res = await (window.authFetch || fetch)('/api/models', { credentials: 'include' });
        if (!res || !res.ok) return null;
        const raw = await res.json();
        const payload = (raw && raw.data) || raw || {};
        return { models: payload.models || [], defaultModel: payload.defaultModel || '' };
    } catch (e) {
        return null;
    }
}

/**
 * payload 에서 default 모델의 full id 선택 (provider prefix 보존 — 표시 가공은 호출자 책임).
 * @param {{models: Array, defaultModel: string}|null} payload
 * @returns {string|null}
 */
export function pickDefaultModelId(payload) {
    if (!payload) return null;
    const m0 = Array.isArray(payload.models) && payload.models[0];
    const id = payload.defaultModel || (m0 && (m0.modelId || m0.id || m0.name));
    return (id && typeof id === 'string') ? id : null;
}

/**
 * /api/models 조회 후 default 모델 id 반환 (fetch + pick 단축).
 * @returns {Promise<string|null>}
 */
export async function getDefaultModelId() {
    return pickDefaultModelId(await fetchModelsPayload());
}
