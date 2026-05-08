/**
 * @module config/external-providers
 * @description 외부 LLM provider 카탈로그 — 사용자가 등록 가능한 provider 메타
 *
 * 사용자 BYO Key 등록 화면에서 노출할 provider 목록과 각 provider 의 SDK 종류,
 * 기본 base URL, 검증 endpoint 등을 정의합니다.
 *
 * 활성: ollama (로컬, 키 불필요) + openrouter (BYO key, OpenAI 호환 endpoint).
 * 다른 외부 provider 는 2026-05-08 마이그레이션 018 로 카탈로그에서 제외됨.
 *
 * SSRF 정책: base_url 등록 시 {@link security/ssrf-guard.ts} validateOutboundUrl 로
 * localhost/사설 IP/link-local 차단 (별도 정책 추가 안 함, 기존 SSoT 재사용).
 *
 * @see backend/api/src/security/ssrf-guard.ts
 * @see services/database/migrations/016_external_provider_integration.sql
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
 *   3. defaultBaseUrl 은 https:// 가 표준 — Ollama 등 http:// 는 사용자 입력으로 수정
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
 * 활성화된(enabled=true) provider 목록만 반환 — UI 의 사용 가능 카탈로그
 */
export function getEnabledProviders(): ExternalProviderCatalogEntry[] {
    return EXTERNAL_PROVIDER_CATALOG.filter((entry) => entry.enabled).slice().sort(
        (a, b) => a.sortOrder - b.sortOrder,
    );
}
