/**
 * @module config/external-providers
 * @description 외부 LLM provider 카탈로그 — 사용자가 등록 가능한 provider 메타
 *
 * 사용자 BYO Key 등록 화면에서 노출할 provider 목록과 각 provider 의 SDK 종류,
 * 기본 base URL, 검증 endpoint 등을 정의합니다.
 *
 * 활성: 로컬 LLM (vLLM via LiteLLM, 키 불필요) + BYO key provider 4종 —
 * openrouter / ollama-cloud / nvidia (모두 OpenAI 호환 endpoint).
 * 2026-05-08 마이그레이션 018 로 openrouter 만 남겼다가, ollama 2종은 2026-07-04,
 * nvidia 는 2026-07-14 에 재도입됨 (018 은 기존 키 행 정리용 — 스키마는 유지).
 *
 * SSRF 정책: base_url 등록 시 {@link security/ssrf-guard.ts} validateOutboundUrl 로
 * localhost/사설 IP/link-local 차단 (별도 정책 추가 안 함, 기존 SSoT 재사용).
 *
 * @see apps/api/src/security/ssrf-guard.ts
 * @see db/migrations/016_external_provider_integration.sql
 */
import type { SdkType } from '../providers/i-provider';

/**
 * 사용자가 등록 가능한 외부 provider 정의 (UI 카탈로그 기반)
 */
export interface ExternalProviderCatalogEntry {
    /** 내부 식별자 — fullId prefix 와 동일 (`provider:model`의 provider 부분) */
    id: string;
    /** UI 노출명 */
    displayName: string;
    /** 사용 SDK 타입 */
    sdkType: SdkType;
    /** 기본 base URL — 사용자가 변경 가능 (custom proxy 등) */
    defaultBaseUrl: string;
    /** API 키 prefix 패턴 (UI 검증용 — 'sk-ant-' 등) */
    keyPrefixPattern?: string;
    /** 검증 endpoint (validateCredentials 에서 사용) — base_url 기준 상대 경로 */
    validatePath: string;
    /** Phase 1 시점 활성 여부 — false 면 UI 노출만, 실제 호출은 NOT_SUPPORTED */
    enabled: boolean;
    /** UI 노출 정렬 순서 (낮을수록 위) */
    sortOrder: number;
    /** 키 등록 안내 — UI 도움말 텍스트 */
    helpText: string;
    /**
     * 지원 인증 방식. Phase 1: 모두 ['api_key'].
     * Phase 2 에서 ['api_key', 'oauth'] 로 확장 가능 (OpenAI ChatGPT Plus/Pro 등).
     */
    authMethods: ReadonlyArray<'api_key' | 'oauth'>;
    /**
     * 이 provider 에 동시에 보낼 수 있는 요청 수 힌트 — 토론(전문가 병렬)·딥리서치(fan-out)처럼
     * 병렬 호출하는 모드가 무료/개발 키의 rate limit(429)에 전멸하지 않도록 실행 클라이언트가
     * 세마포어로 직렬화한다(llm/external-throttle). 미지정 시 EXTERNAL_PROVIDER_THROTTLE.DEFAULT_CONCURRENCY.
     * (2026-09-03 라이브 실측: B.AI 무료 키는 동시 2건부터 429, hasa 개발키는 5건 병렬에서 3건 429)
     */
    maxConcurrentRequests?: number;
    /**
     * OAuth 흐름 메타데이터 — authMethods 에 'oauth' 포함 시에만 활용.
     * Phase 1: 모든 entry 에서 undefined.
     */
    oauthConfig?: {
        startPath: string;
        callbackPath: string;
        clientIdEnv: string;
        scopes: string[];
    };
    /**
     * provider `/v1/models` API 가 빈 배열을 반환하거나 호출이 실패한 경우
     * 사용자가 채팅을 시작할 수 있도록 제공하는 known 모델 카탈로그.
     * No-Hardcoding 정책에 따라 model.routes.ts 의 인라인 KNOWN_MODELS 를 이 곳으로 이동.
     */
    fallbackModels?: ReadonlyArray<{
        id: string;
        displayName: string;
        capabilities: { streaming: boolean; toolCalling: boolean; vision: boolean; thinking: boolean };
        isFree?: boolean;
    }>;
}

/**
 * 외부 LLM provider 카탈로그.
 *
 * 모든 provider 는 OpenAI Chat Completions 호환 endpoint 또는 Anthropic
 * 네이티브 SDK 로 호출됩니다. 각 entry 의 `id` 는 fullId prefix
 * (`<provider_id>:<model_id>`) 와 동일하며, DB 의 (user_id, provider_id) UNIQUE
 * 제약으로 사용자당 1개 키만 등록 가능합니다.
 *
 * 추가 시 체크리스트:
 *   1. provider_id 를 services/chat-service/provider-gate.ts 의
 *      KNOWN_FULLID_PREFIXES 에도 등록
 *   2. sdk_type 은 'openai-compatible' 만 허용 (anthropic direct 는 2026-08-23 폐기)
 *   3. defaultBaseUrl 은 https:// 가 표준 — 로컬 vLLM 등 http:// 는 사용자 입력으로 수정
 */
export const EXTERNAL_PROVIDER_CATALOG: ReadonlyArray<ExternalProviderCatalogEntry> = [
    {
        id: 'openrouter',
        displayName: 'OpenRouter',
        sdkType: 'openai-compatible',
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        keyPrefixPattern: 'sk-or-',
        validatePath: '/models',
        enabled: true,
        sortOrder: 20,
        helpText:
            'OpenRouter (https://openrouter.ai/keys)의 통합 API 키를 입력하세요. ' +
            '300+ 모델(GPT, Claude, Gemini, Llama 등)을 단일 endpoint 로 라우팅합니다. ' +
            '모델 ID 는 "openai/gpt-5", "anthropic/claude-opus-4.5", "google/gemini-2.5-pro" 등 ' +
            'OpenRouter 의 namespaced 형식을 그대로 사용합니다.',
        authMethods: ['api_key'] as const,
        fallbackModels: [
            { id: 'openai/gpt-5',                      displayName: 'GPT-5',                       isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: false } },
            { id: 'anthropic/claude-opus-4.5',         displayName: 'Claude Opus 4.5',             isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: true } },
            { id: 'anthropic/claude-sonnet-4.6',       displayName: 'Claude Sonnet 4.6',           isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: true } },
            { id: 'google/gemini-2.5-pro',             displayName: 'Gemini 2.5 Pro (via OR)',     isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: false } },
            { id: 'meta-llama/llama-3.3-70b-instruct', displayName: 'Llama 3.3 70B',               isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false } },
            { id: 'deepseek/deepseek-r1',              displayName: 'DeepSeek R1',                 isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: true } },
        ],
    },
    {
        id: 'chatgpt',
        displayName: 'ChatGPT (구독 로그인)',
        sdkType: 'openai-compatible',
        // Codex 백엔드 upstream — 실제 요청 조립은 ChatGPTOAuthProvider 의 transport 가 담당.
        // api_key 등록 경로가 아니므로 사용자가 base_url 을 입력하지 않는다 (informational).
        defaultBaseUrl: 'https://chatgpt.com/backend-api/codex',
        validatePath: '/models',
        enabled: true,
        sortOrder: 25,
        helpText:
            'ChatGPT Plus/Pro 구독 계정으로 로그인하여 Codex 지원 GPT 모델을 사용합니다. ' +
            'API 키가 아닌 OAuth 디바이스 로그인 방식입니다 — "로그인" 버튼을 누르고 ' +
            '표시되는 코드를 OpenAI 인증 페이지에 입력하세요. ' +
            '⚠️ 비공식 통합: 반드시 본인 계정만 사용해야 하며, OpenAI 정책 변경 시 ' +
            '중단될 수 있습니다.',
        authMethods: ['oauth'] as const,
        // Codex 카탈로그 조회 실패 시 폴백 — 계정 플랜에 따라 실제 목록은 다를 수 있음.
        fallbackModels: [
            { id: 'gpt-5.4',      displayName: 'GPT-5.4 (ChatGPT)',      isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true, thinking: true } },
            { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini (ChatGPT)', isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true, thinking: true } },
        ],
    },
    {
        id: 'ollama-cloud',
        displayName: 'Ollama Cloud',
        sdkType: 'openai-compatible',
        defaultBaseUrl: 'https://ollama.com/v1',
        validatePath: '/models',
        enabled: true,
        sortOrder: 40,
        helpText:
            'Ollama Cloud (https://ollama.com/settings/keys) 의 API 키를 입력하세요. ' +
            '클라우드 호스팅 대형 모델을 OpenAI 호환 API 로 사용합니다. ' +
            '모델 ID 는 "deepseek-v3.1:671b-cloud" 처럼 :cloud 태그 형식입니다.',
        authMethods: ['api_key'] as const,
        fallbackModels: [
            { id: 'deepseek-v3.1:671b-cloud', displayName: 'DeepSeek V3.1 671B (Cloud)', isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: true } },
            { id: 'gpt-oss:120b-cloud',       displayName: 'GPT-OSS 120B (Cloud)',       isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: true } },
            { id: 'qwen3-coder:480b-cloud',   displayName: 'Qwen3 Coder 480B (Cloud)',   isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false } },
        ],
    },
    {
        id: 'nvidia',
        displayName: 'NVIDIA NIM',
        sdkType: 'openai-compatible',
        defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
        keyPrefixPattern: 'nvapi-',
        validatePath: '/models',
        enabled: true,
        sortOrder: 50,
        helpText:
            'NVIDIA NIM (https://build.nvidia.com) 의 API 키(nvapi- 로 시작)를 입력하세요. ' +
            'NVIDIA GPU 클라우드가 서빙하는 오픈소스 모델(Llama, Qwen, Nemotron 등)을 ' +
            'OpenAI 호환 API 로 사용합니다. 모델 ID 는 "meta/llama-3.3-70b-instruct" 형식입니다. ' +
            '주의: NVIDIA 의 모델 목록 API 는 인증이 없어 키 유효성은 첫 채팅에서 확인됩니다.',
        authMethods: ['api_key'] as const,
        fallbackModels: [
            { id: 'meta/llama-3.3-70b-instruct',             displayName: 'Llama 3.3 70B',        isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false } },
            { id: 'meta/llama-4-maverick-17b-128e-instruct', displayName: 'Llama 4 Maverick 17B', isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: false } },
            { id: 'qwen/qwen3-next-80b-a3b-instruct',        displayName: 'Qwen3 Next 80B A3B',   isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false } },
            { id: 'mistralai/mistral-nemotron',              displayName: 'Mistral Nemotron',     isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: false } },
        ],
    },
    {
        id: 'hasa',
        displayName: 'Open AI Service Hub (HASA)',
        sdkType: 'openai-compatible',
        maxConcurrentRequests: 2,
        defaultBaseUrl: 'https://open.hasa.re.kr/v1',
        keyPrefixPattern: 'sk-',
        validatePath: '/models',
        enabled: true,
        sortOrder: 60,
        helpText:
            'Open AI Service Hub (https://open.hasa.re.kr) 의 개발키(sk-dev-*) 또는 운영키(sk-ops-*)를 입력하세요. ' +
            '공공 GPU 팜이 서빙하는 오픈소스·국산 모델(Qwen3 Coder, EXAONE, HyperCLOVA X, Kanana 등)을 ' +
            'OpenAI 호환 API 로 사용합니다. 모델 ID 는 "qwen3-coder" 처럼 접두사 없는 형식입니다. ' +
            '주의: 모델 목록 API 는 인증이 없어 키 유효성은 첫 채팅에서 확인됩니다. ' +
            '개발키는 분당 요청·일일 토큰 한도가 낮아(초과 시 429) 체험·검증 용도입니다.',
        authMethods: ['api_key'] as const,
        // 2026-09-02 공개 카탈로그(/api/catalog) 기준 — 개발키 허용 + 채팅 모달리티만 수록.
        fallbackModels: [
            { id: 'qwen3-coder',          displayName: 'Qwen3 Coder 30B A3B',  isFree: true, capabilities: { streaming: true, toolCalling: true,  vision: false, thinking: false } },
            { id: 'exaone-4.0-32b',       displayName: 'EXAONE 4.0 32B',       isFree: true, capabilities: { streaming: true, toolCalling: true,  vision: false, thinking: false } },
            { id: 'llama-3.3-70b',        displayName: 'Llama 3.3 70B',        isFree: true, capabilities: { streaming: true, toolCalling: true,  vision: false, thinking: false } },
            { id: 'gpt-oss-20b',          displayName: 'GPT-OSS 20B',          isFree: true, capabilities: { streaming: true, toolCalling: true,  vision: false, thinking: true  } },
            { id: 'gpt-oss-120b',         displayName: 'GPT-OSS 120B',         isFree: true, capabilities: { streaming: true, toolCalling: true,  vision: false, thinking: true  } },
            { id: 'hyperclovax-seed-32b', displayName: 'HyperCLOVA X SEED 32B', isFree: true, capabilities: { streaming: true, toolCalling: false, vision: false, thinking: true  } },
            { id: 'kanana-2-30b-a3b',     displayName: 'Kanana 2 30B A3B',     isFree: true, capabilities: { streaming: true, toolCalling: false, vision: false, thinking: false } },
            { id: 'qwen2.5-vl-72b',       displayName: 'Qwen2.5 VL 72B',       isFree: true, capabilities: { streaming: true, toolCalling: false, vision: true,  thinking: false } },
        ],
    },
    {
        id: 'bai',
        displayName: 'B.AI',
        sdkType: 'openai-compatible',
        maxConcurrentRequests: 1,
        defaultBaseUrl: 'https://api.b.ai/v1',
        keyPrefixPattern: 'sk-',
        validatePath: '/models',
        enabled: true,
        sortOrder: 70,
        helpText:
            'B.AI (https://docs.b.ai/llmservice/api/) 의 API 키(sk-*)를 입력하세요. OpenAI 호환 API 로 ' +
            'GPT·Claude·Gemini·DeepSeek·Qwen·GLM 등을 크레딧 과금으로 제공합니다. ' +
            '무료 표시(isFree) 모델은 2026-09-04 실측 기준 크레딧 잔액 0 인 키로도 호출되는 것만 남겼습니다 — ' +
            '그 외 모델은 예치(deposit)·크레딧이 필요해 403/400 이 납니다. 모델 ID 는 "qwen3.8-flash" 처럼 접두사 없는 형식입니다. ' +
            '연속 호출 시 429 가 잦으니 병렬 사용은 피하세요.',
        authMethods: ['api_key'] as const,
        // 2026-09-02 실측(무료 키·잔액 0): 45개 중 5개만 200. tools 는 5개 전부, vision 은 qwen3.8-flash·
        // glm-5.3-flash·deepseek-v4-flash-vision-exp 만(32px 이상 이미지), 5개 전부 reasoning_content 반환.
        // 2026-09-04 재실측: deepseek-v4-flash·vision-exp 는 B.AI 측이 유료로 전환 — 빈 프롬프트도
        //   400 "credit insufficient balance: balance=0 required=18"(insufficient_user_quota). capability 는
        //   실측값이라 항목은 남기고 isFree 만 내린다(무료 목록은 B.AI 정책에 따라 수시로 바뀐다).
        fallbackModels: [
            { id: 'qwen3.8-flash',                displayName: 'Qwen3.8 Flash',                 isFree: true, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: true } },
            { id: 'glm-5.3-flash',                displayName: 'GLM 5.3 Flash',                 isFree: true, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: true } },
            { id: 'deepseek-v4-flash',            displayName: 'DeepSeek V4 Flash',             isFree: false, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: true } },
            { id: 'deepseek-v4-flash-vision-exp', displayName: 'DeepSeek V4 Flash Vision (exp)', isFree: false, capabilities: { streaming: true, toolCalling: true, vision: true,  thinking: true } },
            { id: 'hy3',                          displayName: 'Hunyuan 3',                     isFree: true, capabilities: { streaming: true, toolCalling: true, vision: false, thinking: true } },
        ],
    },
] as const;

/**
 * provider id 로 카탈로그 항목 조회
 */
export function getProviderCatalogEntry(
    providerId: string,
): ExternalProviderCatalogEntry | undefined {
    return EXTERNAL_PROVIDER_CATALOG.find((entry) => entry.id === providerId);
}

/**
 * admin system-settings 에서 관리하는 외부 provider 키 → providerId 매핑.
 * 해당 설정 키 저장/삭제 시 "관리자 본인"의 user_external_api_keys(BYOK) 행으로 연동된다
 * (admin-system-settings.routes 의 syncAdminProviderKey). 런타임 키 해석은 기존 사용자별
 * BYOK 경로 그대로라, 다른 사용자가 이 키로 비용을 발생시킬 수 없다.
 */
export const ADMIN_SYNCED_PROVIDER_KEYS: Readonly<Record<string, string>> = {
    OPENROUTER_API_KEY: 'openrouter',
    OLLAMA_CLOUD_API_KEY: 'ollama-cloud',
    NVIDIA_API_KEY: 'nvidia',
};

