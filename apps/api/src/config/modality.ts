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
    /** vision 브리지(첨부 이미지 → 텍스트) 1회 호출 타임아웃 ms */
    VISION_BRIDGE_TIMEOUT_MS: parseInt(process.env.MODALITY_VISION_TIMEOUT_MS || '90000', 10),
    /** vision 브리지에 넘길 이미지 상한(초과분은 건너뛰고 안내) — vLLM --limit-mm-per-prompt 와 같은 8 */
    VISION_BRIDGE_MAX_IMAGES: parseInt(process.env.MODALITY_VISION_MAX_IMAGES || '8', 10),
    /** vision 브리지 응답 max_tokens */
    VISION_BRIDGE_MAX_TOKENS: parseInt(process.env.MODALITY_VISION_MAX_TOKENS || '1500', 10),
    /** TTS 1회 타임아웃 ms · 입력 글자 상한 */
    TTS_TIMEOUT_MS: parseInt(process.env.MODALITY_TTS_TIMEOUT_MS || '120000', 10),
    TTS_MAX_CHARS: parseInt(process.env.MODALITY_TTS_MAX_CHARS || '4000', 10),
    /** STT 1회 타임아웃 ms · 오디오 바이트 상한(OpenAI 규격 25MB) */
    STT_TIMEOUT_MS: parseInt(process.env.MODALITY_STT_TIMEOUT_MS || '180000', 10),
    STT_MAX_BYTES: parseInt(process.env.MODALITY_STT_MAX_BYTES || String(25 * 1024 * 1024), 10),
    /** 영상 생성 — 제출 타임아웃 · 한 도구 호출 안에서 완료를 기다리는 상한 · 폴링 간격 */
    VIDEO_SUBMIT_TIMEOUT_MS: parseInt(process.env.MODALITY_VIDEO_SUBMIT_TIMEOUT_MS || '60000', 10),
    VIDEO_WAIT_MS: parseInt(process.env.MODALITY_VIDEO_WAIT_MS || '300000', 10),
    VIDEO_POLL_INTERVAL_MS: parseInt(process.env.MODALITY_VIDEO_POLL_INTERVAL_MS || '10000', 10),
    VIDEO_DOWNLOAD_TIMEOUT_MS: parseInt(process.env.MODALITY_VIDEO_DOWNLOAD_TIMEOUT_MS || '120000', 10),
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

/** TTS 응답 형식 화이트리스트 (OpenAI audio/speech 규격) */
export const TTS_ALLOWED_FORMATS: ReadonlySet<string> = new Set(['mp3', 'wav', 'opus', 'aac', 'flac']);
export const TTS_DEFAULT_FORMAT = 'mp3';
export const TTS_DEFAULT_VOICE = 'alloy';
/**
 * provider 별 모달리티 기본 params — 배정 params(사용자 입력) 가 없을 때 적용. 실측 규격 차이를 흡수한다
 * (hasa melotts-ko: voice 는 `KR` 만, 형식은 `wav` 만 — 2026-09-12). 우선순위: 도구 인자 > 배정 params > 이 표 > 전역 기본.
 */
export const PROVIDER_MODALITY_PARAM_DEFAULTS: Record<string, Partial<Record<Modality, Record<string, string>>>> = {
    hasa: { tts: { voice: 'KR', format: 'wav' } },
};
export function providerParamDefaults(providerId: string, modality: Modality): Record<string, string> {
    return PROVIDER_MODALITY_PARAM_DEFAULTS[providerId]?.[modality] ?? {};
}
/** STT 입력으로 허용하는 오디오 확장자 */
export const STT_ALLOWED_EXTS: ReadonlySet<string> = new Set(['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'webm', 'mp4']);
/** 영상 생성 기본 인자 (OpenAI videos 규격 — provider 가 다르면 params 로 덮어쓴다) */
export const VIDEO_GEN_DEFAULT_SECONDS = '4';
export const VIDEO_GEN_DEFAULT_SIZE = '720x1280';
/**
 * 영상 생성 provider 어댑터 — OpenAI `/v1/videos` 규격이 아닌 provider(hasa: `POST /videos/generations`
 * → `GET /jobs/{id}` → `artifact_url`)는 LiteLLM 이 프록시하지 못한다(1.89.4 pass-through 는 클라이언트
 * 헤더를 전달하지 못해 사용자 BYOK 를 실을 수 없고, hasa 는 `Authorization: Bearer` 만 받는다 — 2026-09-12 실측).
 * 사용자별 키로 쓰기 위해 이 부류만 **앱이 직결**(SSRF 고정 fetch, 문서화된 예외 — chatgpt OAuth 와 같은 부류)한다.
 * 이미지·오디오·비전·OpenAI 규격 영상은 그대로 게이트웨이 하나다.
 */
export interface VideoProviderAdapter {
    kind: 'openai-videos' | 'jobs-v1';
    /** jobs-v1: 제출·상태 경로 (provider base 뒤) — `{id}` 치환 */
    submitPath?: string;
    statusPath?: string;
    /** 상태 응답에서 산출물 URL 필드(base 상대 경로면 base 를 붙인다) */
    artifactField?: string;
    doneStatuses?: readonly string[];
    failStatuses?: readonly string[];
}
export const VIDEO_PROVIDER_ADAPTERS: Record<string, VideoProviderAdapter> = {
    hasa: {
        kind: 'jobs-v1',
        submitPath: '/videos/generations',
        statusPath: '/jobs/{id}',
        artifactField: 'artifact_url',
        doneStatuses: ['COMPLETED', 'DONE', 'SUCCEEDED'],
        failStatuses: ['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'],
    },
};
export function videoAdapterFor(providerId: string): VideoProviderAdapter {
    return VIDEO_PROVIDER_ADAPTERS[providerId] ?? { kind: 'openai-videos' };
}

export const VIDEO_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'error']);
export const VIDEO_DONE_STATUSES: ReadonlySet<string> = new Set(['completed', 'succeeded']);

/**
 * 모달리티 도구의 채팅 노출 게이트 — 상시 노출 금지(도구폭주·prefix cache 원칙), 의도 턴에만.
 * ChatService 가 메시지에 패턴이 맞으면 해당 도구를 강제 포함한다(카카오·web_search 강제 포함과 같은 선례).
 */
export const MODALITY_TOOL_INTENT_GATES: ReadonlyArray<{ tool: string; patterns: readonly RegExp[] }> = [
    { tool: 'text_to_speech', patterns: [/(음성|목소리|오디오|소리)(으로|로)\s*(읽|만들|바꿔|변환|들려)/, /읽어\s*줘/, /낭독/, /\btts\b/i, /text[- ]to[- ]speech/i, /read (it|this|that) (aloud|out loud)/i, /\bvoice\s*(over|version)/i] },
    { tool: 'transcribe_audio', patterns: [/(받아|옮겨)\s*(써|적)/, /전사/, /(음성|오디오|녹음)[^\n]{0,10}(텍스트|글|자막)/, /\bstt\b/i, /transcri(be|ption)/i, /speech[- ]to[- ]text/i] },
    { tool: 'generate_video', patterns: [/(영상|비디오|동영상)[^\n]{0,12}(만들|생성|제작|그려)/, /\bvideo\b[^\n]{0,20}(generat|creat|make|render)/i, /(generat|creat|make)[^\n]{0,20}\bvideo\b/i] },
    { tool: 'get_video', patterns: [/(영상|비디오|동영상)[^\n]{0,12}(상태|확인|됐|완료|다 됐|어디)/, /video[^\n]{0,20}(status|ready|done|finished)/i, /get_video/i] },
];

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
