/**
 * ============================================================
 * Modality — 모달리티별 모델 배정 레지스트리 (L2 SoT)
 * ============================================================
 *
 * "어떤 입출력을 어느 모델이 처리하는가"의 축. "역할&모델"(config/model-roles —
 * 누가 텍스트 LLM 을 쓰는가)과 **별개**이며 텍스트 생성은 여기 넣지 않는다.
 *
 * 호출은 전부 LiteLLM 게이트웨이 하나로만 간다 — 로컬 모델은 게이트웨이 alias,
 * 외부 provider 는 `LLM_GATEWAY_PROVIDERS` 에 편입된 것만 배정 가능(direct provider 거부).
 *
 * 저장은 L3 `modality_models`(scope='__global__' | user_id) — 해석 우선순위
 * 사용자 오버라이드 → 전역 DB → 이 파일의 코드 기본값. env 계층은 두지 않는다
 * (구 `IMAGE_GEN_MODEL` 은 부팅 1회 시더로만 읽고 다음 배포에서 제거).
 *
 * @module config/modality
 */

/** 모달리티 목록 — DB CHECK(117_modality_models.sql)와 정합 유지할 것 */
export type Modality = 'image_gen' | 'image_edit' | 'vision' | 'video_gen' | 'stt' | 'tts' | 'embedding';

export const MODALITIES: ReadonlyArray<Modality> = [
    'image_gen', 'image_edit', 'vision', 'video_gen', 'stt', 'tts', 'embedding',
];

/** 사용자 오버라이드(BYOK)를 허용하는 모달리티 — 전부 허용. 제한이 필요해지면 여기서 뺀다. */
export const USER_ASSIGNABLE_MODALITIES: ReadonlyArray<Modality> = MODALITIES;

export const GLOBAL_MODALITY_SCOPE = '__global__';

/** 모달리티가 쓰는 LiteLLM OpenAI 호환 엔드포인트 (게이트웨이 base 뒤에 붙는 경로) */
export const MODALITY_ENDPOINT: Record<Modality, string> = {
    image_gen: '/v1/images/generations',
    image_edit: '/v1/images/edits',
    vision: '/v1/chat/completions',
    video_gen: '/v1/videos',
    stt: '/v1/audio/transcriptions',
    tts: '/v1/audio/speech',
    embedding: '/v1/embeddings',
};

/**
 * 코드 기본값 — 전역 DB 행이 없을 때. 로컬 alias 는 LiteLLM `litellm.config.yaml` 의
 * model_name 과 일치해야 한다(scripts/vllm/litellm.config.yaml 참조본).
 * 값이 없는 모달리티는 "미배정" — 도구가 안내 메시지로 거절한다(조용한 폴백 금지).
 */
export const MODALITY_DEFAULTS: Partial<Record<Modality, string>> = {
    image_gen: process.env.MODALITY_DEFAULT_IMAGE_GEN || 'local-llm:flux2-klein',
    embedding: process.env.MODALITY_DEFAULT_EMBEDDING || 'local-llm:bge-m3',
};

/** 모달리티별 호출 상한 — 호출부가 명명 상수로 읽는다(인라인 리터럴 금지) */
export const MODALITY_LIMITS = {
    /** 이미지 생성 1건 타임아웃 ms (디퓨전 1장 수십 초). 구 IMAGE_GEN_TIMEOUT_MS 승계. */
    IMAGE_GEN_TIMEOUT_MS: parseInt(process.env.MODALITY_IMAGE_GEN_TIMEOUT_MS || process.env.IMAGE_GEN_TIMEOUT_MS || '180000', 10),
    /** params JSONB 허용 키 — 모달리티별 화이트리스트(모르는 키는 저장 시 버린다) */
    PARAM_KEYS: {
        image_gen: ['size', 'quality', 'style'],
        image_edit: ['size'],
        vision: ['detail'],
        video_gen: ['size', 'seconds'],
        stt: ['language'],
        tts: ['voice', 'format'],
        embedding: ['dimensions'],
    } as Record<Modality, readonly string[]>,
    /** params 값 문자열 길이 상한 */
    PARAM_VALUE_MAX_CHARS: 64,
    /** fullId 길이 상한 (역할 배정과 동일) */
    FULL_ID_MAX_CHARS: 200,
    /** 전역 행 캐시 TTL ms (역할 해석기와 동일 60s, 같은 프로세스 변경은 즉시 무효화) */
    GLOBAL_CACHE_TTL_MS: 60_000,
} as const;

/** 이미지 생성 허용 size 화이트리스트 (OpenAI images API 형식) */
export const IMAGE_GEN_ALLOWED_SIZES: ReadonlySet<string> = new Set(['1024x1024', '768x1024', '1024x768', '512x512']);
export const IMAGE_GEN_DEFAULT_SIZE = '1024x1024';

export function isModality(value: string): value is Modality {
    return (MODALITIES as readonly string[]).includes(value);
}

/** params 를 화이트리스트 키·문자열 값으로 정제 — 저장 직전 1곳에서만 호출 */
export function sanitizeModalityParams(modality: Modality, input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object') return {};
    const allowed = MODALITY_LIMITS.PARAM_KEYS[modality];
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (!allowed.includes(k)) continue;
        if (typeof v !== 'string' && typeof v !== 'number') continue;
        const s = String(v).trim();
        if (!s || s.length > MODALITY_LIMITS.PARAM_VALUE_MAX_CHARS) continue;
        out[k] = s;
    }
    return out;
}
