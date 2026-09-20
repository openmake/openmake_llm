/**
 * 모델 프로필 — 모델마다 다른 값의 단일 선언 테이블 (오픈웨이트 전환 S2, 2026-09-19).
 *
 * 모델을 바꿀 때 손대던 곳이 다섯 군데였다: capability 프리셋(model-defaults) · reasoning 강도(reasoning-effort) ·
 * 샘플링 프리셋(llm-parameters) · 도구 strict(llm-parameters) · 프롬프트 이미지 상한(runtime-limits).
 * 이제 그 값은 여기 한 항목이고, 위 모듈들은 이 테이블을 읽는 해석기다(함수 시그니처·동작은 그대로).
 * **새 모델 도입 = 항목 추가**(또는 배포 없이 env `LLM_MODEL_PROFILES_JSON`) → `eval:matrix` 통과 → 전환.
 *
 * 키 규칙은 종전과 같다 — 소문자 접두어 startsWith-longest. 로컬 모델은 bare 키(`qwen3.8-27b`),
 * 외부 모델은 provider 한정 키(`bai:glm-5.3`)이고 서로 새어 나가지 않는다(로컬 `qwen3.8` 의 xhigh 가
 * 외부의 같은 이름 모델에 나가던 선례). 외부 모델 항목에는 **실측한 값만** 적는다 — 휴리스틱 금지.
 * 적지 않은 필드는 전역 기본값(env)을 따른다.
 *
 * @module config/model-profiles
 */

/** 추론 강도 사다리 — 낮은 것부터 (config/reasoning-effort.ts 가 재수출) */
export const REASONING_EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh'] as const;
export type ReasoningEffort = typeof REASONING_EFFORT_LADDER[number];

export interface ModelCapabilities {
    toolCalling: boolean;
    thinking: boolean;
    vision: boolean;
    streaming: boolean;
}

export interface SamplingValues {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    presence_penalty?: number;
    repeat_penalty?: number;
}

export interface ModelLicense {
    /** SPDX id 또는 라이선스 이름 */
    id: string;
    /** false 면 최종 사용자 대상 서비스에 쓸 수 없다 — 카탈로그에서 비가용 처리 (config/local-models.ts) */
    commercialUse: boolean;
}

export interface ModelProfile {
    /** 실측으로 확정한 능력. 없으면 부팅 프로브·FALLBACK 으로 해석 (config/model-defaults.ts) */
    capabilities?: ModelCapabilities;
    /** 모델이 받는 reasoning_effort 값. 없으면 OpenAI 표준 3단 */
    reasoningEfforts?: readonly ReasoningEffort[];
    /** thinking ON/OFF 별 권장 샘플링. 없으면 전역 프리셋(LOCAL_SAMPLING_PRESETS) */
    sampling?: { thinking?: SamplingValues; instruct?: SamplingValues };
    /** 도구 정의에 strict 를 채울지. 없으면 전역 플래그(LLM_LOCAL_TOOL_STRICT) */
    toolStrict?: boolean;
    /** 요청당 프롬프트 이미지 상한(서빙 `--limit-mm-per-prompt` 와 짝). 없으면 전역(LLM_PROMPT_IMAGE_CAP) */
    maxPromptImages?: number;
    /** 가중치 라이선스 — 적지 않으면 제한 없음으로 본다 */
    license?: ModelLicense;
}

/**
 * 기본 프로필. 값의 근거·실측 이력:
 *  - qwen3.8-27b: vLLM `--reasoning-parser qwen3 --tool-call-parser qwen3_coder --limit-mm-per-prompt image=8`,
 *    thinking·toolCalling·vision 라이브 실측(2026-09-02). reasoning_effort `high` 는 400 — xhigh/medium/low 만.
 *  - qwen3.6-35b-a3b: 구 기본 모델. low~xhigh 모두 200(2026-08-23).
 *  - gpt-3.5-turbo: LiteLLM 의 OpenAI 호환 alias → qwen3.8-27b. 능력은 라우팅 대상과 같게 둔다
 *    (vision:false 면 실제 모델은 받는 이미지 요청을 앱이 400 으로 거절한다, 2026-09-03 정정).
 *  - hasa:* (2026-09-20, `npm run eval:probe` 실측): qwen2.5-vl-72b 는 도구 호출·비전 가능, 추론 필드 없음(종전 카탈로그의
 *    toolCalling:false 는 낡은 값). gpt-oss 는 low/medium/high 만 받고 xhigh 를 400 으로 거절.
 *  - nvidia:nvidia/nemotron-3.5-lightning (2026-09-20 프로브): low~xhigh 전부 200 — 표준 3단 폴백이면 xhigh 요청이 high 로 깎인다.
 *    같은 날 kimi-k3·gemma-4-31b 는 목록엔 있으나 60~120초 무응답이라 재지 못했다(모델별 가용성 문제, 키는 정상).
 *  - bai:glm-5.3: 항상 사고 모델 — low/high/max 만 받고 medium 을 400 으로 거절(2026-09-03). 사다리에 max 는 없다.
 */
const DEFAULT_MODEL_PROFILES: Readonly<Record<string, ModelProfile>> = {
    'gemma4': {
        capabilities: { toolCalling: true, thinking: true, vision: true, streaming: true },
    },
    'qwen3.6': {
        capabilities: { toolCalling: true, thinking: true, vision: false, streaming: true },
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
    'qwen3.6-35b-a3b': {
        capabilities: { toolCalling: true, thinking: true, vision: true, streaming: true },
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
    'qwen3.8': {
        reasoningEfforts: ['low', 'medium', 'xhigh'],
    },
    'qwen3.8-27b': {
        capabilities: { toolCalling: true, thinking: true, vision: true, streaming: true },
        reasoningEfforts: ['low', 'medium', 'xhigh'],
        maxPromptImages: 8,
        license: { id: 'Apache-2.0', commercialUse: true },
    },
    'gpt-3.5-turbo': {
        capabilities: { toolCalling: true, thinking: true, vision: true, streaming: true },
    },
    'bai:glm-5.3': {
        reasoningEfforts: ['low', 'high'],
    },
    'hasa:qwen2.5-vl-72b': {
        capabilities: { toolCalling: true, thinking: false, vision: true, streaming: true },
    },
    'nvidia:nvidia/nemotron-3.5-lightning': {
        capabilities: { toolCalling: true, thinking: true, vision: false, streaming: true },
        reasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
    'hasa:gpt-oss': {
        reasoningEfforts: ['low', 'medium', 'high'],
    },
};

const CAPABILITY_KEYS = ['toolCalling', 'thinking', 'vision', 'streaming'] as const;
const SAMPLING_KEYS = ['temperature', 'top_p', 'top_k', 'presence_penalty', 'repeat_penalty'] as const;

function isEffort(v: unknown): v is ReasoningEffort {
    return typeof v === 'string' && (REASONING_EFFORT_LADDER as readonly string[]).includes(v);
}

function pickSampling(raw: unknown): SamplingValues | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const out: SamplingValues = {};
    for (const k of SAMPLING_KEYS) {
        const v = (raw as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** PURE: env JSON 한 항목을 검증해 프로필 조각으로 — 형식이 틀린 필드는 버린다(항목 전체를 버리지 않는다) */
function parseProfile(raw: unknown): ModelProfile {
    const out: ModelProfile = {};
    if (!raw || typeof raw !== 'object') return out;
    const r = raw as Record<string, unknown>;
    const caps = r.capabilities as Record<string, unknown> | undefined;
    if (caps && CAPABILITY_KEYS.every(k => typeof caps[k] === 'boolean')) {
        out.capabilities = Object.fromEntries(CAPABILITY_KEYS.map(k => [k, caps[k]])) as unknown as ModelCapabilities;
    }
    if (Array.isArray(r.reasoningEfforts) && r.reasoningEfforts.length > 0 && r.reasoningEfforts.every(isEffort)) {
        out.reasoningEfforts = r.reasoningEfforts as ReasoningEffort[];
    }
    const sampling = r.sampling as Record<string, unknown> | undefined;
    if (sampling && typeof sampling === 'object') {
        const thinking = pickSampling(sampling.thinking);
        const instruct = pickSampling(sampling.instruct);
        if (thinking || instruct) out.sampling = { ...(thinking && { thinking }), ...(instruct && { instruct }) };
    }
    if (typeof r.toolStrict === 'boolean') out.toolStrict = r.toolStrict;
    if (typeof r.maxPromptImages === 'number' && Number.isInteger(r.maxPromptImages) && r.maxPromptImages >= 0) {
        out.maxPromptImages = r.maxPromptImages;
    }
    const license = r.license as Record<string, unknown> | undefined;
    if (license && typeof license.id === 'string' && typeof license.commercialUse === 'boolean') {
        out.license = { id: license.id, commercialUse: license.commercialUse };
    }
    return out;
}

let _cached: Readonly<Record<string, ModelProfile>> | null = null;

/**
 * 기본값 위에 env 를 **항목 단위·필드 단위로 merge** 한다 — env 가 기본 항목을 지우지 못한다
 * (2026-09-04: pm2 가 물고 있던 옛 env JSON 이 통째 대체로 `bai:glm-5.3` 을 지워 B.AI 400).
 * 구 env `LLM_REASONING_EFFORTS_JSON`(접두어 → 강도 목록)도 계속 읽는다.
 */
function getProfiles(): Readonly<Record<string, ModelProfile>> {
    if (_cached) return _cached;
    const merged: Record<string, ModelProfile> = { ...DEFAULT_MODEL_PROFILES };
    const mergeEntry = (prefix: string, part: ModelProfile): void => {
        if (Object.keys(part).length === 0) return;
        const key = prefix.toLowerCase();
        merged[key] = { ...(merged[key] ?? {}), ...part };
    };
    const legacy = process.env.LLM_REASONING_EFFORTS_JSON;
    if (legacy) {
        try {
            for (const [prefix, list] of Object.entries(JSON.parse(legacy) as Record<string, unknown>)) {
                mergeEntry(prefix, parseProfile({ reasoningEfforts: list }));
            }
        } catch { /* 형식 오류는 기본값으로 */ }
    }
    const raw = process.env.LLM_MODEL_PROFILES_JSON;
    if (raw) {
        try {
            for (const [prefix, entry] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
                mergeEntry(prefix, parseProfile(entry));
            }
        } catch { /* 형식 오류는 기본값으로 */ }
    }
    _cached = merged;
    return _cached;
}

/** 테스트 훅 — env 변경 후 캐시 리셋 */
export function resetModelProfileCache(): void {
    _cached = null;
}

/**
 * 모델 id 에 걸리는 프로필을 **필드별로** 해석한다 — 필드마다 그 필드를 가진 가장 긴 접두어 항목이 이긴다.
 * (`qwen3.8` 이 강도만, `qwen3.8-27b` 가 능력까지 적어도 둘이 자연스럽게 겹친다.)
 * `providerId` 가 로컬이 아니면 provider 한정 키만, 로컬이면 bare 키만 본다.
 */
export function resolveModelProfile(modelId: string | undefined, providerId?: string): ModelProfile {
    if (!modelId) return {};
    const external = !!providerId && providerId !== 'local-llm';
    const lower = (external ? `${providerId}:${modelId}` : modelId).toLowerCase();
    const matches = Object.entries(getProfiles())
        .filter(([prefix]) => external === prefix.includes(':') && lower.startsWith(prefix))
        .sort((a, b) => a[0].length - b[0].length);
    return Object.assign({}, ...matches.map(([, profile]) => profile)) as ModelProfile;
}

/**
 * 가중치 라이선스 때문에 이 배포에서 쓸 수 없는 모델이면 사유를, 아니면 null.
 * 비상업 라이선스 모델은 기본 차단이고, 내부 평가용 배포만 env `MODEL_NONCOMMERCIAL_ALLOWED=true` 로 연다
 * (2026-09-18: 비상업 라이선스 이미지 모델이 운영 서비스에 올라가 있던 것을 사후에 발견해 제거한 선례).
 */
export function licenseBlockReason(modelId: string, providerId?: string): string | null {
    const license = resolveModelProfile(modelId, providerId).license;
    if (!license || license.commercialUse) return null;
    if (process.env.MODEL_NONCOMMERCIAL_ALLOWED === 'true') return null;
    return `license: ${license.id} 는 상업적 사용 불가`;
}
