/**
 * @module config/external-providers
 * @description 외부 LLM provider 카탈로그 — 사용자가 등록 가능한 provider 메타
 *
 * 사용자 BYO Key 등록 화면에서 노출할 provider 목록과 각 provider 의 SDK 종류,
 * 기본 base URL, 검증 endpoint 등을 정의합니다.
 *
 * 활성: 로컬 LLM (vLLM via LiteLLM, 키 불필요) + openrouter (BYO key, OpenAI 호환 endpoint).
 * 다른 외부 provider 는 2026-05-08 마이그레이션 018 로 카탈로그에서 제외됨.
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
 *   2. sdk_type 은 'anthropic' | 'openai-compatible' 만 허용 (DB CHECK 제약)
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
        id: 'ollama-local',
        displayName: 'Ollama (Local)',
        sdkType: 'openai-compatible',
        // Ollama 의 OpenAI 호환 endpoint 는 /v1. 실제 주소는 사용자가 base URL 로 입력
        // (예: http://192.168.x.x:11434/v1). LAN IP 는 SSRF 가드에 걸리므로 운영자가
        // .env SSRF_ALLOWED_HOSTS 에 해당 호스트를 등록해야 함 (fail-closed opt-in).
        defaultBaseUrl: 'http://localhost:11434/v1',
        validatePath: '/models',
        enabled: true,
        sortOrder: 30,
        helpText:
            '자체 서빙 중인 Ollama 서버의 OpenAI 호환 endpoint 를 입력하세요 ' +
            '(예: http://<서버IP>:11434/v1). Ollama 는 API 키가 없으므로 임의 문자열 ' +
            '8자 이상(예: ollama-no-key)을 입력하면 됩니다. LAN/사설 IP 는 서버 .env 의 ' +
            'SSRF_ALLOWED_HOSTS 허용목록 등록이 필요합니다. 모델 목록은 해당 서버에 ' +
            'pull 되어 있는 모델이 자동 표시됩니다.',
        authMethods: ['api_key'] as const,
        // 로컬 Ollama 는 설치 모델이 전부 — /v1/models 실패 시 보여줄 공통 모델이 없음
        fallbackModels: [],
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
] as const;

/**
 * provider id 로 카탈로그 항목 조회
 */
export function getProviderCatalogEntry(
    providerId: string,
): ExternalProviderCatalogEntry | undefined {
    return EXTERNAL_PROVIDER_CATALOG.find((entry) => entry.id === providerId);
}

