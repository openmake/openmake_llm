/**
 * @module config/external-providers
 * @description 외부 LLM provider 카탈로그 — 사용자가 등록 가능한 provider 메타
 *
 * 사용자 BYO Key 등록 화면에서 노출할 provider 목록과 각 provider 의 SDK 종류,
 * 기본 base URL, 검증 endpoint 등을 정의합니다.
 *
 * Phase 1 활성: ollama (로컬, 키 불필요)
 * Phase 3 활성: anthropic
 * Phase 4 활성: openai-compatible (Groq, OpenRouter, Together 등)
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
}

/**
 * Phase 1 시점 카탈로그.
 *
 * - `enabled: false` 인 항목은 UI 에 "Coming Soon" 으로 노출하거나 숨길 수 있음.
 * - openai-compatible 은 동적 등록(사용자가 임의 base_url 입력)이므로 단일
 *   엔트리로 표현하되 UI 에서 다중 instance(Groq, OpenRouter 등)를 허용.
 */
export const EXTERNAL_PROVIDER_CATALOG: ReadonlyArray<ExternalProviderCatalogEntry> = [
    {
        id: 'anthropic',
        displayName: 'Anthropic Claude',
        sdkType: 'anthropic',
        defaultBaseUrl: 'https://api.anthropic.com',
        keyPrefixPattern: 'sk-ant-',
        validatePath: '/v1/models',
        enabled: false, // Phase 3 에서 true 로 전환
        sortOrder: 10,
        helpText:
            'Anthropic Console (https://console.anthropic.com)에서 발급한 API 키를 입력하세요. ' +
            '사용량은 본 서비스가 아닌 Anthropic 계정으로 청구됩니다.',
    },
    {
        id: 'openai-compatible',
        displayName: 'OpenAI Compatible',
        sdkType: 'openai-compatible',
        defaultBaseUrl: 'https://api.groq.com/openai/v1',
        validatePath: '/models',
        enabled: false, // Phase 4 에서 true 로 전환
        sortOrder: 20,
        helpText:
            'OpenAI Chat Completions 호환 endpoint(Groq, OpenRouter, Together, vLLM 등)의 ' +
            'base URL 과 API 키를 입력하세요. localhost / 사설 IP / link-local 주소는 차단됩니다.',
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
