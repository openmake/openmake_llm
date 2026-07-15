/**
 * @module config/role-model-filter
 * @description 역할별 모델 배정 드롭다운에 노출할 모델 필터 (No-Hardcoding L2).
 *
 * 역할 배정(설정 > 역할 모델, 커스텀 에이전트 model)에서 실제로 역할을 수행할 수
 * 있는 모델만 노출하기 위한 필터. 컴포저/기본 모델 선택에는 적용하지 않는다.
 *
 * 필터 3축:
 *   ① 채팅 불가 모델 제외 — 임베딩/이미지/음성 등 (id 패턴, ROLE_MODEL_EXCLUDE_PATTERNS)
 *   ② 파라미터 20B 이하 제외 — id/name 에서 `<N>b` 파싱 (ROLE_MODEL_MIN_PARAMS_B),
 *      파싱 불가(프론티어 모델 gpt/claude/deepseek-v3 등)는 대형으로 간주해 유지
 *   ③ (등록 키 사용 가능 + 실제 호출 가능 여부는 model.routes 목록 소스와
 *      assignment 시점 probe 가 담당 — 이 파일은 정적 필터만)
 */

/** 역할 배정 허용 최소 파라미터 (B, 십억). env override. */
export const ROLE_MODEL_MIN_PARAMS_B = Number(process.env.ROLE_MODEL_MIN_PARAMS_B) || 20;

/**
 * 채팅/역할 수행이 불가능한 모델 id 패턴 (소문자 substring 매칭).
 * 임베딩·이미지·음성·리랭커 등 — 어떤 역할도 수행 불가.
 */
export const ROLE_MODEL_EXCLUDE_PATTERNS: readonly string[] = (
    process.env.ROLE_MODEL_EXCLUDE_PATTERNS
        ? process.env.ROLE_MODEL_EXCLUDE_PATTERNS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
        : ['bge', 'embed', 'embedding', 'rerank', 'flux', 'sdxl', 'stable-diffusion',
           'dall-e', 'dalle', 'whisper', 'tts', 'clip', 'nemoretriever', 'nv-embed']
);

/**
 * 모델 id/name 에서 파라미터 수(B, 십억)를 파싱. 없으면 null.
 * `<숫자>b` 패턴을 모두 찾아 최댓값 반환 — 예: 'qwen3.6-35b-a3b' → 35 (총 파라미터 우선).
 * 버전 번호(3.1, 5.2 등 'b' 미접미)는 매칭되지 않는다.
 */
export function parseModelParamsB(idOrName: string): number | null {
    const matches = idOrName.toLowerCase().matchAll(/(\d+(?:\.\d+)?)\s*b\b/g);
    let max: number | null = null;
    for (const m of matches) {
        const n = parseFloat(m[1]);
        if (Number.isFinite(n) && (max === null || n > max)) max = n;
    }
    return max;
}

/**
 * 역할 배정에 노출할 모델인지 판정.
 * @param model modelId(fullId)·name·capabilities 를 가진 목록 항목
 */
export function isRoleAssignableModel(model: {
    modelId: string;
    name?: string;
    capabilities?: { streaming?: boolean; toolCalling?: boolean; vision?: boolean };
}): boolean {
    const hay = `${model.modelId} ${model.name ?? ''}`.toLowerCase();

    // ① 채팅 불가 모델(임베딩/이미지/음성 등) 제외
    if (ROLE_MODEL_EXCLUDE_PATTERNS.some((p) => hay.includes(p))) return false;

    // ② 20B 이하 제외 (파싱 불가 = 대형 프론티어 모델로 간주해 유지)
    const params = parseModelParamsB(hay);
    if (params !== null && params <= ROLE_MODEL_MIN_PARAMS_B) return false;

    return true;
}
