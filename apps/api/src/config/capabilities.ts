/**
 * ============================================================
 * Capabilities — 멀티모달 오케스트레이터의 기능(capability) 레지스트리 (L2 SoT)
 * ============================================================
 *
 * "어떤 기능을 어느 모델이 처리하는가". Planner(LLM)는 **capability 이름만** 내고, 모델은 이 레지스트리 +
 * `capability_models`(사용자 BYOK → 전역 → 코드 기본값)가 결정적으로 정한다 — Planner 가 모델명을 고르지 않는다.
 * 텍스트 종합(text.synthesize)은 사용자가 고른 채팅 모델이 맡으므로 배정 대상이 아니다.
 *
 * 호출은 전부 LiteLLM 게이트웨이 하나(로컬 alias·외부 `<provider>/<model>` + BYOK 헤더). 예외는 게이트웨이가
 * 프록시 못 하는 커스텀 API(hasa 영상 jobs-v1)뿐 — `VIDEO_PROVIDER_ADAPTERS` 참고.
 *
 * 구 모달리티 축(config/modality.ts, 2026-09-12 v1.58.x)을 일반화한 후속 — 행 이관은 마이그레이션 118.
 *
 * @module config/capabilities
 */

export type Capability =
    | 'text.reason' | 'text.code' | 'text.synthesize' | 'text.embed'
    | 'vision.describe' | 'vision.ocr'
    | 'image.generate' | 'image.edit'
    | 'audio.transcribe' | 'audio.speech' | 'audio.analyze'
    | 'music.analyze' | 'music.generate'
    | 'video.generate' | 'video.analyze'
    | 'web.search';

export const CAPABILITIES: ReadonlyArray<Capability> = [
    'text.reason', 'text.code', 'text.synthesize', 'text.embed',
    'vision.describe', 'vision.ocr',
    'image.generate', 'image.edit',
    'audio.transcribe', 'audio.speech', 'audio.analyze',
    'music.analyze', 'music.generate',
    'video.generate', 'video.analyze',
    'web.search',
];

/** 모델 배정을 받는 capability — text.synthesize(채팅 모델)·web.search(검색 오케스트레이터)는 제외 */
export const ASSIGNABLE_CAPABILITIES: ReadonlyArray<Capability> = CAPABILITIES.filter(
    (c) => c !== 'text.synthesize' && c !== 'web.search',
);

/** Planner 가 계획에 쓸 수 있는 capability — 종합(채팅 모델 자동)·임베딩(도구용)은 서버가 거부한다 */
export const PLANNABLE_CAPABILITIES: ReadonlyArray<Capability> = CAPABILITIES.filter(
    (c) => c !== 'text.synthesize' && c !== 'text.embed',
);

/**
 * 검증된 provider 어댑터가 아직 없는 capability — 배정과 무관하게 실행 단계가 `unsupported` 로 명시 실패한다
 * (미배정 `unassigned` 와 구분). 편입 provider 5개 실측(2026-09-12)에 제공처 없음. 어댑터가 생기면 여기서 뺀다.
 */
export const UNSUPPORTED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
    'audio.analyze', 'music.analyze', 'music.generate', 'video.analyze',
]);

export const GLOBAL_CAPABILITY_SCOPE = '__global__';

/** 구 모달리티 이름 → capability (마이그레이션 118 행 이관·호환 입력 정규화) */
export const LEGACY_MODALITY_TO_CAPABILITY: Record<string, Capability> = {
    image_gen: 'image.generate',
    image_edit: 'image.edit',
    vision: 'vision.describe',
    video_gen: 'video.generate',
    stt: 'audio.transcribe',
    tts: 'audio.speech',
    embedding: 'text.embed',
};

/** capability 가 쓰는 LiteLLM OpenAI 호환 엔드포인트 (게이트웨이 base 뒤). text.* 는 chat/completions */
export const CAPABILITY_ENDPOINT: Record<Capability, string> = {
    'text.reason': '/v1/chat/completions',
    'text.code': '/v1/chat/completions',
    'text.synthesize': '/v1/chat/completions',
    'text.embed': '/v1/embeddings',
    'vision.describe': '/v1/chat/completions',
    'vision.ocr': '/v1/chat/completions',
    'image.generate': '/v1/images/generations',
    'image.edit': '/v1/images/edits',
    'audio.transcribe': '/v1/audio/transcriptions',
    'audio.speech': '/v1/audio/speech',
    'audio.analyze': '/v1/chat/completions',
    'music.analyze': '/v1/chat/completions',
    'music.generate': '/v1/audio/speech',
    'video.generate': '/v1/videos',
    'video.analyze': '/v1/chat/completions',
    'web.search': '',
};

/**
 * 코드 기본값 — 전역 DB 행이 없을 때. 로컬 alias 는 LiteLLM `model_name` 과 일치해야 한다.
 * 없는 capability 는 "미배정"(조용한 폴백 금지 — Planner 가 요구하면 명시 실패).
 */
export const CAPABILITY_DEFAULTS: Partial<Record<Capability, string>> = {
    'text.reason': process.env.CAPABILITY_DEFAULT_TEXT_REASON || 'local-llm:qwen3.8-27b',
    'text.code': process.env.CAPABILITY_DEFAULT_TEXT_CODE || 'local-llm:qwen3.8-27b',
    'text.embed': process.env.CAPABILITY_DEFAULT_TEXT_EMBED || 'local-llm:bge-m3',
    'vision.describe': process.env.CAPABILITY_DEFAULT_VISION_DESCRIBE || 'local-llm:qwen3.8-27b',
    'vision.ocr': process.env.CAPABILITY_DEFAULT_VISION_OCR || 'local-llm:qwen3.8-27b',
    'image.generate': process.env.CAPABILITY_DEFAULT_IMAGE_GENERATE || 'local-llm:flux2-klein',
};

/** 사람이 읽는 라벨(ko) — Planner 프롬프트·UI 안내 공용 (i18n 은 프론트가 별도 보유) */
export const CAPABILITY_LABELS_KO: Record<Capability, string> = {
    'text.reason': '텍스트 추론·분석',
    'text.code': '코드 작성·분석',
    'text.synthesize': '최종 답변 종합(채팅 모델)',
    'text.embed': '임베딩',
    'vision.describe': '이미지 이해·설명',
    'vision.ocr': '이미지 문자 인식(OCR)',
    'image.generate': '이미지 생성',
    'image.edit': '이미지 편집',
    'audio.transcribe': '음성 인식(STT)',
    'audio.speech': '음성 합성(TTS)',
    'audio.analyze': '오디오 분석',
    'music.analyze': '음악 분석',
    'music.generate': '음악 생성',
    'video.generate': '영상 생성',
    'video.analyze': '영상 이해',
    'web.search': '웹 검색',
};

/** Planner 가 각 capability 를 언제 쓰는지 — 프롬프트에 그대로 싣는 한 줄 설명 */
export const CAPABILITY_PLANNER_HINTS: Record<Capability, string> = {
    'text.reason': '일반 질문·설명·분석. 대부분의 텍스트 질문은 이것 하나면 된다',
    'text.code': '코드 작성·수정·리뷰가 주된 요청일 때',
    'text.synthesize': '(자동) 여러 작업 결과를 최종 답변으로 종합 — 직접 계획하지 말 것',
    'text.embed': '(도구용) 사용하지 말 것',
    'vision.describe': '첨부 이미지의 내용을 이해·묘사해야 할 때',
    'vision.ocr': '첨부 이미지의 글자·표·코드를 그대로 읽어야 할 때',
    'image.generate': '새 이미지를 그려/만들어 달라고 할 때',
    'image.edit': '기존 이미지(첨부 또는 직전 생성)를 수정·변형해 달라고 할 때 — refs 로 원본 지정',
    'audio.transcribe': '첨부 오디오/영상의 말을 글로 옮겨야 할 때',
    'audio.speech': '텍스트를 음성으로 읽어 달라고 할 때',
    'audio.analyze': '오디오의 분위기·특징(전사 외)을 분석해야 할 때',
    'music.analyze': '음악의 장르·템포·분위기를 분석해야 할 때',
    'music.generate': '음악을 만들어 달라고 할 때',
    'video.generate': '짧은 영상을 만들어 달라고 할 때',
    'video.analyze': '첨부 영상의 장면을 이해해야 할 때',
    'web.search': '최신 정보·사실 확인·외부 자료가 필요할 때',
};

/** capability 별 호출 상한 — 호출부가 명명 상수로 읽는다 */
export const CAPABILITY_LIMITS = {
    IMAGE_GEN_TIMEOUT_MS: parseInt(process.env.CAPABILITY_IMAGE_GEN_TIMEOUT_MS || process.env.MODALITY_IMAGE_GEN_TIMEOUT_MS || '180000', 10),
    IMAGE_EDIT_MAX_INPUT_BYTES: parseInt(process.env.CAPABILITY_IMAGE_EDIT_MAX_INPUT_BYTES || String(8 * 1024 * 1024), 10),
    VISION_TIMEOUT_MS: parseInt(process.env.CAPABILITY_VISION_TIMEOUT_MS || '90000', 10),
    VISION_MAX_IMAGES: parseInt(process.env.CAPABILITY_VISION_MAX_IMAGES || '8', 10),
    VISION_MAX_TOKENS: parseInt(process.env.CAPABILITY_VISION_MAX_TOKENS || '1500', 10),
    TEXT_TIMEOUT_MS: parseInt(process.env.CAPABILITY_TEXT_TIMEOUT_MS || '180000', 10),
    TEXT_MAX_TOKENS: parseInt(process.env.CAPABILITY_TEXT_MAX_TOKENS || '4000', 10),
    TTS_TIMEOUT_MS: parseInt(process.env.CAPABILITY_TTS_TIMEOUT_MS || '120000', 10),
    TTS_MAX_CHARS: parseInt(process.env.CAPABILITY_TTS_MAX_CHARS || '4000', 10),
    STT_TIMEOUT_MS: parseInt(process.env.CAPABILITY_STT_TIMEOUT_MS || '180000', 10),
    STT_MAX_BYTES: parseInt(process.env.CAPABILITY_STT_MAX_BYTES || String(25 * 1024 * 1024), 10),
    VIDEO_SUBMIT_TIMEOUT_MS: parseInt(process.env.CAPABILITY_VIDEO_SUBMIT_TIMEOUT_MS || '60000', 10),
    VIDEO_WAIT_MS: parseInt(process.env.CAPABILITY_VIDEO_WAIT_MS || '300000', 10),
    VIDEO_POLL_INTERVAL_MS: parseInt(process.env.CAPABILITY_VIDEO_POLL_INTERVAL_MS || '10000', 10),
    VIDEO_DOWNLOAD_TIMEOUT_MS: parseInt(process.env.CAPABILITY_VIDEO_DOWNLOAD_TIMEOUT_MS || '120000', 10),
    /** params JSONB 허용 키 — capability 별 화이트리스트 */
    PARAM_KEYS: {
        'text.reason': ['temperature'], 'text.code': ['temperature'], 'text.synthesize': [], 'text.embed': ['dimensions'],
        'vision.describe': ['detail'], 'vision.ocr': ['detail'],
        'image.generate': ['size', 'quality', 'style'], 'image.edit': ['size'],
        'audio.transcribe': ['language'], 'audio.speech': ['voice', 'format'], 'audio.analyze': [],
        'music.analyze': [], 'music.generate': ['duration'],
        'video.generate': ['size', 'seconds'], 'video.analyze': [],
        'web.search': [],
    } as Record<Capability, readonly string[]>,
    PARAM_VALUE_MAX_CHARS: 64,
    FULL_ID_MAX_CHARS: 200,
    GLOBAL_CACHE_TTL_MS: 60_000,
} as const;

/** 이미지 생성 허용 size (OpenAI images 규격) */
export const IMAGE_GEN_ALLOWED_SIZES: ReadonlySet<string> = new Set(['1024x1024', '768x1024', '1024x768', '512x512']);
export const IMAGE_GEN_DEFAULT_SIZE = '1024x1024';
export const TTS_ALLOWED_FORMATS: ReadonlySet<string> = new Set(['mp3', 'wav', 'opus', 'aac', 'flac']);
export const TTS_DEFAULT_FORMAT = 'mp3';
export const TTS_DEFAULT_VOICE = 'alloy';
export const STT_ALLOWED_EXTS: ReadonlySet<string> = new Set(['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'webm', 'mp4']);
export const VIDEO_GEN_DEFAULT_SECONDS = '4';
export const VIDEO_GEN_DEFAULT_SIZE = '720x1280';
export const VIDEO_TERMINAL_STATUSES: ReadonlySet<string> = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'canceled', 'error']);
export const VIDEO_DONE_STATUSES: ReadonlySet<string> = new Set(['completed', 'succeeded']);

/**
 * provider 별 capability params 기본값 — 배정 params 가 없을 때. 실측 규격 차이 흡수
 * (hasa melotts-ko: voice `KR`·형식 `wav` 만 — 2026-09-12). 우선순위: 계획 인자 > 배정 params > 이 표 > 전역 기본.
 */
export const PROVIDER_CAPABILITY_PARAM_DEFAULTS: Record<string, Partial<Record<Capability, Record<string, string>>>> = {
    hasa: { 'audio.speech': { voice: 'KR', format: 'wav' } },
};
export function providerParamDefaults(providerId: string, capability: Capability): Record<string, string> {
    return PROVIDER_CAPABILITY_PARAM_DEFAULTS[providerId]?.[capability] ?? {};
}

/**
 * 영상 생성 provider 어댑터 — OpenAI `/v1/videos` 가 아닌 커스텀 API(hasa: `POST /videos/generations` → `GET /jobs/{id}`
 * → `artifact_url`)는 LiteLLM 이 프록시하지 못하고 hasa 는 `Authorization: Bearer` 만 받아 사용자 키를 게이트웨이로 실을
 * 수 없다(2026-09-12 실측) → 이 부류만 앱이 BYOK 로 provider 직결(SSRF 고정 fetch). 문서화된 예외.
 */
export interface VideoProviderAdapter {
    kind: 'openai-videos' | 'jobs-v1';
    submitPath?: string;
    statusPath?: string;
    artifactField?: string;
    doneStatuses?: readonly string[];
    failStatuses?: readonly string[];
}
export const VIDEO_PROVIDER_ADAPTERS: Record<string, VideoProviderAdapter> = {
    hasa: {
        kind: 'jobs-v1', submitPath: '/videos/generations', statusPath: '/jobs/{id}', artifactField: 'artifact_url',
        doneStatuses: ['COMPLETED', 'DONE', 'SUCCEEDED'], failStatuses: ['FAILED', 'ERROR', 'CANCELLED', 'CANCELED'],
    },
};
export function videoAdapterFor(providerId: string): VideoProviderAdapter {
    return VIDEO_PROVIDER_ADAPTERS[providerId] ?? { kind: 'openai-videos' };
}

/** 이미지 편집 어댑터 — hasa Qwen-Image-Edit 는 `/v1/images/generations` JSON `reference`(dataURL), LiteLLM 통과 */
export interface ImageEditProviderAdapter { kind: 'openai-edits' | 'generations-reference' }
export const IMAGE_EDIT_PROVIDER_ADAPTERS: Record<string, ImageEditProviderAdapter> = {
    hasa: { kind: 'generations-reference' },
};
export function imageEditAdapterFor(providerId: string): ImageEditProviderAdapter {
    return IMAGE_EDIT_PROVIDER_ADAPTERS[providerId] ?? { kind: 'openai-edits' };
}

export function isCapability(value: string): value is Capability {
    return (CAPABILITIES as readonly string[]).includes(value);
}

/** 구 모달리티 이름도 받아 capability 로 정규화 (API 호환 입력). 모르면 null */
export function normalizeCapability(value: string): Capability | null {
    if (isCapability(value)) return value;
    return LEGACY_MODALITY_TO_CAPABILITY[value] ?? null;
}

/** params 를 화이트리스트 키·문자열 값으로 정제 — 저장 직전 1곳에서만 호출 */
export function sanitizeCapabilityParams(capability: Capability, input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object') return {};
    const allowed = CAPABILITY_LIMITS.PARAM_KEYS[capability];
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        if (!allowed.includes(k)) continue;
        if (typeof v !== 'string' && typeof v !== 'number') continue;
        const s = String(v).trim();
        if (!s || s.length > CAPABILITY_LIMITS.PARAM_VALUE_MAX_CHARS) continue;
        out[k] = s;
    }
    return out;
}

/** 오케스트레이터 상한·게이트 */
export const ORCHESTRATOR = {
    /** 기능 게이트 — false 면 Planner 를 돌리지 않고 종전 단일 경로 */
    ENABLED: process.env.ORCHESTRATOR_ENABLED !== 'false',
    /** Planner 호출 타임아웃 ms (초과 시 fail-open → 종전 경로) */
    PLANNER_TIMEOUT_MS: parseInt(process.env.ORCHESTRATOR_PLANNER_TIMEOUT_MS || '20000', 10),
    PLANNER_MAX_TOKENS: parseInt(process.env.ORCHESTRATOR_PLANNER_MAX_TOKENS || '400', 10),
    /** 계획 검증 실패 시 Planner 재시도 횟수 */
    PLANNER_RETRIES: parseInt(process.env.ORCHESTRATOR_PLANNER_RETRIES || '1', 10),
    /** 계획당 작업 수 상한 · 레벨당 병렬 상한 */
    MAX_TASKS: parseInt(process.env.ORCHESTRATOR_MAX_TASKS || '6', 10),
    MAX_PARALLEL: parseInt(process.env.ORCHESTRATOR_MAX_PARALLEL || '4', 10),
    /** 작업 하나의 상한 ms (capability 별 타임아웃보다 큰 안전망) */
    TASK_TIMEOUT_MS: parseInt(process.env.ORCHESTRATOR_TASK_TIMEOUT_MS || '600000', 10),
    /** Planner 재시도를 포함한 전체 계획 deadline ms (개별 시도 타임아웃과 별개) */
    PLANNER_TOTAL_DEADLINE_MS: parseInt(process.env.ORCHESTRATOR_PLANNER_TOTAL_DEADLINE_MS || '30000', 10),
    /** 한 턴의 실행(모든 레벨) 전체 deadline ms */
    TURN_DEADLINE_MS: parseInt(process.env.ORCHESTRATOR_TURN_DEADLINE_MS || '900000', 10),
    /** 프로세스 전체 동시 실행 작업 상한(provider 세마포어와 별개의 총량 상한) */
    GLOBAL_MAX_INFLIGHT: parseInt(process.env.ORCHESTRATOR_GLOBAL_MAX_INFLIGHT || '8', 10),
    /** Planner 에 넘기는 직전 대화 턴 수·메시지 절단 */
    PLANNER_HISTORY_TURNS: parseInt(process.env.ORCHESTRATOR_PLANNER_HISTORY_TURNS || '2', 10),
    PLANNER_MESSAGE_MAX_CHARS: parseInt(process.env.ORCHESTRATOR_PLANNER_MESSAGE_MAX_CHARS || '4000', 10),
    /** 종합 모델에 넘기는 작업 결과 텍스트 상한(작업당) */
    RESULT_MAX_CHARS: parseInt(process.env.ORCHESTRATOR_RESULT_MAX_CHARS || '12000', 10),
    /** 미완료 비동기 작업(영상) 을 Planner 첨부 목록에 싣는 조회 창(시간)·개수 */
    JOB_LOOKBACK_HOURS: parseInt(process.env.ORCHESTRATOR_JOB_LOOKBACK_HOURS || '24', 10),
    JOB_MAX_LISTED: parseInt(process.env.ORCHESTRATOR_JOB_MAX_LISTED || '3', 10),
    /** 셰도우 기록(orchestrator_runs) */
    SHADOW_ENABLED: process.env.ORCHESTRATOR_SHADOW_ENABLED !== 'false',
} as const;

/** /generated 미디어 보존 스윕 (사용자 결정: /generated 유지 + TTL 정리, reports/ 제외) */
export const GENERATED_MEDIA_RETENTION = {
    TTL_MS: parseInt(process.env.GENERATED_MEDIA_TTL_MS || String(30 * 24 * 60 * 60 * 1000), 10),
    /** 정리에서 제외할 하위 디렉토리(예약 리포트 게시) */
    EXCLUDED_DIRS: ['reports'] as readonly string[],
} as const;
