/**
 * ============================================================
 * Capabilities — 멀티모달 오케스트레이터의 기능(capability) 레지스트리 (L2 SoT)
 * ============================================================
 *
 * "어떤 기능을 어느 모델이 처리하는가". Planner(LLM)는 **capability 이름만** 내고, 모델은 이 레지스트리 +
 * `model_assignments`(사용자 BYOK → 전역 → 코드 기본값)가 결정적으로 정한다 — Planner 가 모델명을 고르지 않는다.
 * 텍스트 종합(text.synthesize)은 사용자가 고른 채팅 모델이 맡으므로 배정 대상이 아니다.
 *
 * 호출은 전부 LiteLLM 게이트웨이 하나(로컬 alias·외부 `<provider>/<model>` + BYOK 헤더). 예외는 게이트웨이가
 * 프록시 못 하는 커스텀 API 하나 — hasa 영상 jobs-v1(video-runtime add-on 이 `describeProviderSupport().direct` 로 선언).
 * 이미지·음악·영상 **전용** 규칙(어댑터·기본값·부정 표현)은 각 runtime add-on 이 갖는다(P10) — 여기엔 공통 한도·ID·호환 alias 만.
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
 * (미배정 `unassigned` 와 구분). 어댑터가 생기면 여기서 뺀다.
 * (music.generate 는 2026-09-22 DGX ACE-Step 으로, audio.analyze·music.analyze·video.analyze 는
 *  네이티브 콘텐츠 파트(input_audio·video_url) 분석 실행기가 붙어 2026-09-25 빠졌다 — 현재 비어 있다.)
 */
export const UNSUPPORTED_CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([]);

export const GLOBAL_CAPABILITY_SCOPE = '__global__';

/** 구 모달리티 이름 → capability (마이그레이션 118 행 이관·호환 입력 정규화) */
const LEGACY_MODALITY_TO_CAPABILITY: Record<string, Capability> = {
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
    // ⚠️ 음악만 게이트웨이의 pass-through 경로다 — ACE-Step 이 `message.audio` 를 배열로 주는데
    // LiteLLM 의 Message 타입은 단일 객체를 기대해 일반 model_list 라우트에선 역직렬화가 500 난다.
    'music.generate': '/music/v1/chat/completions',
    'video.generate': '/v1/videos',
    'video.analyze': '/v1/chat/completions',
    'web.search': '',
};

/**
 * 코드 기본값 — 전역 DB 행이 없을 때. 로컬 alias 는 LiteLLM `model_name` 과 일치해야 한다.
 * 없는 capability 는 "미배정"(조용한 폴백 금지 — Planner 가 요구하면 명시 실패).
 */
/**
 * env 로 코드 기본값을 덮거나 **끈다** — 미설정이면 코드값, 빈 문자열(`KEY=`)·`none` 이면 기본값 없음(=미배정 → 명시 실패).
 * `fallback` 을 생략하면 코드 기본값 자체가 없어 env 로만 켤 수 있다(image.generate — 2026-09-18).
 */
function envDefault(name: string, fallback?: string): string | undefined {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    const v = raw.trim();
    return v === '' || v.toLowerCase() === 'none' ? undefined : v;
}
export const CAPABILITY_DEFAULTS: Partial<Record<Capability, string>> = {
    'text.reason': envDefault('CAPABILITY_DEFAULT_TEXT_REASON', 'local-llm:qwen3.8-27b'),
    'text.code': envDefault('CAPABILITY_DEFAULT_TEXT_CODE', 'local-llm:qwen3.8-27b'),
    'text.embed': envDefault('CAPABILITY_DEFAULT_TEXT_EMBED', 'local-llm:bge-m3'),
    'vision.describe': envDefault('CAPABILITY_DEFAULT_VISION_DESCRIBE', 'local-llm:qwen3.8-27b'),
    'vision.ocr': envDefault('CAPABILITY_DEFAULT_VISION_OCR', 'local-llm:qwen3.8-27b'),
    // image.generate 는 코드 기본값 없음(2026-09-18) — 종전 로컬 기본값이 비상업 라이선스(최종 사용자와의 직접
    // 상호작용 금지)라 제거했다. 쓰려면 라이선스를 확인한 뒤 env 나 model_assignments 로 명시 배정한다.
    'image.generate': envDefault('CAPABILITY_DEFAULT_IMAGE_GENERATE'),
    // music.generate — DGX ACE-Step 1.5(MIT, 생성 음악 상업 이용 허용). 다른 로컬 capability 와 같이 LiteLLM alias 다
    // (게이트웨이에 그 이름이 없으면 호출이 명시 실패한다 — 끄려면 `CAPABILITY_DEFAULT_MUSIC_GENERATE=`).
    'music.generate': envDefault('CAPABILITY_DEFAULT_MUSIC_GENERATE', 'local-llm:acestep-v15-xl-turbo'),
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
    'music.generate': '노래·배경음악을 만들어 달라고 할 때 (가사는 input.lyrics, 길이는 input.duration)',
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
    /** 산출물 내려받기 상한 — hasa 파일 서버가 3.7MB 를 173s 에 준 실측(2026-09-12)이 있어 넉넉히 둔다(TASK_TIMEOUT 안). */
    VIDEO_DOWNLOAD_TIMEOUT_MS: parseInt(process.env.CAPABILITY_VIDEO_DOWNLOAD_TIMEOUT_MS || '600000', 10),
    /** 완성 산출물 내려받기 시도 횟수 — hasa 가 전송 중 연결을 끊는 실측(`terminated`, 2026-09-12)에 대비 */
    VIDEO_DOWNLOAD_ATTEMPTS: parseInt(process.env.CAPABILITY_VIDEO_DOWNLOAD_ATTEMPTS || '2', 10),
    /** 음악 생성 — ACE-Step 은 생성이 끝날 때까지 응답을 잡고 있으므로(동기) 이 값이 곧 완료 대기 상한이다.
     *  넘으면 실패 — 영상과 달리 job 을 다음 턴으로 넘기지 않는다. */
    MUSIC_WAIT_MS: parseInt(process.env.CAPABILITY_MUSIC_WAIT_MS || '300000', 10),
    MUSIC_LYRICS_MAX_CHARS: parseInt(process.env.CAPABILITY_MUSIC_LYRICS_MAX_CHARS || '4000', 10),
    /** audio.analyze·music.analyze·video.analyze — 네이티브 콘텐츠 파트를 chat/completions 로 보내는 비스트림 1회. */
    MEDIA_ANALYZE_TIMEOUT_MS: parseInt(process.env.CAPABILITY_MEDIA_ANALYZE_TIMEOUT_MS || '180000', 10),
    MEDIA_ANALYZE_MAX_TOKENS: parseInt(process.env.CAPABILITY_MEDIA_ANALYZE_MAX_TOKENS || '1500', 10),
    /** 오디오(음악 포함) 입력 상한 — 전사(STT_MAX_BYTES 25MB)와 같은 급으로 둔다. */
    MEDIA_ANALYZE_AUDIO_MAX_BYTES: parseInt(process.env.CAPABILITY_MEDIA_ANALYZE_AUDIO_MAX_BYTES || String(25 * 1024 * 1024), 10),
    /** 영상 입력 상한 — base64 로 프롬프트에 실리므로 오케스트레이터 JSON 상한(24MB) 안에 둔다. */
    MEDIA_ANALYZE_VIDEO_MAX_BYTES: parseInt(process.env.CAPABILITY_MEDIA_ANALYZE_VIDEO_MAX_BYTES || String(16 * 1024 * 1024), 10),
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

export const TTS_ALLOWED_FORMATS: ReadonlySet<string> = new Set(['mp3', 'wav', 'opus', 'aac', 'flac']);
export const TTS_DEFAULT_FORMAT = 'mp3';
export const TTS_DEFAULT_VOICE = 'alloy';
export const STT_ALLOWED_EXTS: ReadonlySet<string> = new Set(['mp3', 'wav', 'm4a', 'ogg', 'opus', 'flac', 'webm', 'mp4']);
/**
 * audio.analyze 의 `input_audio.format` — OpenAI 호환 오디오 콘텐츠 파트는 mime 이 아니라 형식 문자열을 요구한다.
 * mime → format 룩업(if-chain 금지). 모르면 기본값.
 */
export const AUDIO_ANALYZE_FORMATS: Record<string, string> = {
    'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
    'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/flac': 'flac', 'audio/webm': 'webm',
};
export const AUDIO_ANALYZE_DEFAULT_FORMAT = 'wav';
/** 기존 결과를 묻는 발화 — 이것까지 맞아야 보정한다("다 됐어·완성·보여줘·어떻게 됐·결과·진행"). 언어 공통이라 모든 job capability 가 쓴다 */
export const JOB_RESULT_INTENT_PATTERN = /다\s*됐|됐어|됐나|완성|끝났|보여|어떻게\s*됐|진행|결과|받아|확인|(is it|are they)\s+(done|ready|finished)|show\s+(me\s+)?(it|the)|status/i;
/** 새 생성·설명 요청은 보정 금지 — Planner 판단(simple/새 생성)을 그대로 둔다. 언어 공통 */
export const JOB_NOT_FOLLOWUP_PATTERN = /만들어|생성|제작|새로|다시\s*(만|그)|설명|원리|뭐야|이란|란\s|무엇|어떻게\s*(하|만)|(make|create|generate|explain|what is|how to)/i;
/** Planner 가 사용자가 말한 비율을 `size` 로 옮길 때 쓰는 값 */
export const VIDEO_GEN_ASPECT_SIZES = { landscape: '1280x720', portrait: '720x1280', square: '720x720' } as const;
/**
 * 사용자 원문에 적힌 영상·음악 길이 — 원문에 있으면 계획값보다 우선한다(결정적 보정). 실측(2026-09-22, hasa nemotron-super-120b):
 * 스키마에 인자 키를 선언한 뒤에도 "8초"·"6-second" 를 2/2 누락했다. 음악도 같다 — qwen3.8-27b Planner 가 music.generate 6건 중
 * 5건에서 duration 을 비워 전부 기본 30초가 됐다(2026-09-23). 길이는 여러 개면 가장 큰 값(장면 전환 시각 < 전체 길이).
 * 그룹: 1 = 분, 2 = 분 뒤의 초("3분 30초"), 3 = 초만.
 * 음표 길이인 "8분 음표"·"8분 리듬"·"4분의 3박자" 는 시간이 아니다 — 곡 설계서가 8분(480초) 곡이 된 결함(2026-09-24).
 */
export const MEDIA_DURATION_PATTERN = /(\d+(?:\.\d+)?)\s*(?:분(?!\s*(?:음표|쉼표|음|리듬|박|의))|-?\s*min(?:ute)?s?\b)(?:\s*(\d+(?:\.\d+)?)\s*(?:초|-?\s*sec(?:ond)?s?\b))?|(\d+(?:\.\d+)?)\s*(?:초|秒|-?\s*sec(?:ond)?s?\b)/gi;

/**
 * provider 별 capability params 기본값 — 배정 params 가 없을 때. 실측 규격 차이 흡수
 * (hasa melotts-ko: voice `KR`·형식 `wav` 만 — 2026-09-12). 우선순위: 계획 인자 > 배정 params > 이 표 > 전역 기본.
 */
const PROVIDER_CAPABILITY_PARAM_DEFAULTS: Record<string, Partial<Record<Capability, Record<string, string>>>> = {
    hasa: { 'audio.speech': { voice: 'KR', format: 'wav' } },
};
export function providerParamDefaults(providerId: string, capability: Capability): Record<string, string> {
    return PROVIDER_CAPABILITY_PARAM_DEFAULTS[providerId]?.[capability] ?? {};
}

/**
 * Planner 가 가사 자리에 앞 작업 참조를 적는 경우("REFS:t1"·"(lyrics from t1)" — 2026-09-22~23 실측 2건)를 가려내는 길이 상한.
 * 이보다 짧고 다른 작업 id 를 담은 lyrics 는 가사가 아니라 참조로 보고 refs 로 옮긴다(그대로 두면 그 문자열을 노래한다).
 */
export const PLAN_LYRICS_REF_MAX_CHARS = 60;

/**
 * 계획 인자에 "대화에 이미 있는 텍스트를 쓴다"를 적는 표시 (2026-09-26).
 * Planner 가 사용자 메시지·직전 답변의 긴 텍스트(가사 등)를 계획 JSON 에 옮겨 적으면 출력 상한(PLANNER_MAX_TOKENS)과
 * 시간 상한(PLANNER_TIMEOUT_MS)을 넘겨 계획 자체가 실패한다(697자 가사 → 로컬 27B 15초 초과, 라이브 재현). 원문 대신 이 표시만
 * 적게 하고, 실행기가 ExecContext 의 userMessage·recentAssistantMessages 에서 원문을 찾는다.
 */
export const PLAN_CONVERSATION_TEXT_MARKER = 'CONVERSATION';

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
    /**
     * Planner 호출 타임아웃 ms (초과 시 fail-open → 종전 경로). 이 시간만큼 답변 시작이 늦어진다.
     * 15초 근거(2026-09-12~15 orchestrator_runs 234건 성공분): 최대 local qwen3.8-27b 9,966ms · chatgpt 9,955ms,
     * bai p95 5,248ms(이상치 1건 22.9s 는 이제 fail-open). 느린 모델을 배정했다면 env 로 늘린다.
     */
    PLANNER_TIMEOUT_MS: parseInt(process.env.ORCHESTRATOR_PLANNER_TIMEOUT_MS || '15000', 10),
    /**
     * Planner 출력 상한 토큰. 400 은 multi 계획(설계서·스타일 프롬프트를 instruction 에 옮겨 적는 경우)이 988자에서 잘려
     * 재시도까지 전부 실패하고 fallback 으로 떨어졌다(2026-09-24 음악 요청 2회 실측). 800 은 외부 planner 실측 속도
     * (약 90~120 tok/s)로 시간 상한 15초 안에 든다.
     */
    PLANNER_MAX_TOKENS: parseInt(process.env.ORCHESTRATOR_PLANNER_MAX_TOKENS || '800', 10),
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
    /**
     * 실행기에 넘기는 최근 답변 수·답변당 상한(아티팩트 표시는 같은 대화의 최신 내용으로 펼친다).
     * PLAN_CONVERSATION_TEXT_MARKER 로 "직전 답변의 텍스트"를 가리킨 작업이 원문을 찾는 곳이다.
     */
    EXEC_RECENT_ASSISTANT_MESSAGES: parseInt(process.env.ORCHESTRATOR_EXEC_RECENT_ASSISTANT_MESSAGES || '3', 10),
    EXEC_RECENT_MESSAGE_MAX_CHARS: parseInt(process.env.ORCHESTRATOR_EXEC_RECENT_MESSAGE_MAX_CHARS || '12000', 10),
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
