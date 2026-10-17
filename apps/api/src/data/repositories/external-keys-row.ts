/**
 * @module data/repositories/external-keys-row
 * @description external-keys-repo 의 타입·DB 행 매핑·key prefix 헬퍼 (external-keys-repo.ts 에서 분리)
 */
/**
 * 키 prefix 길이 — UI 표시용 처음 N글자
 */
export const KEY_PREFIX_LENGTH = 12;

/** DB key_prefix 컬럼 상한 (VARCHAR(16), 마이그레이션 016) — 초과 시 INSERT 실패 */
export const KEY_PREFIX_COLUMN_MAX = 16;

/**
 * 외부 provider SDK 종류. anthropic direct 어댑터 폐기(2026-08-23)로 1종만 남았다.
 * DB CHECK 는 아직 구 값('anthropic')을 허용한다 — 코드 참조 제거 후 다음 배포에서 좁힌다
 * (2단계 배포 원칙). 폐기 시점 기준 해당 sdk_type 행은 0건.
 */
export type ExternalSdkType = 'openai-compatible';

/**
 * 키 인증 방식 (마이그레이션 082).
 * - 'api_key': encrypted_key = 평문 API 키 암호화 (기존 동작)
 * - 'oauth':   encrypted_key = OAuth 세션 JSON 암호화 (ChatGPT 디바이스 플로우)
 */
export type ExternalAuthMethod = 'api_key' | 'oauth';

/**
 * 평문 API 키를 받지 않는 안전 조회 결과 (UI/일반 로직용)
 */
export interface ExternalApiKeyRow {
    id: number;
    userId: string;
    providerId: string;
    sdkType: ExternalSdkType;
    authMethod: ExternalAuthMethod;
    displayName: string;
    baseUrl: string | null;
    keyPrefix: string;
    /** OAuth 계정 식별자 (auth_method='oauth' 전용, 복호화 없이 노출 가능) */
    oauthAccountId: string | null;
    /** OAuth access token 만료 시각 (auth_method='oauth' 전용) */
    oauthExpiresAt: Date | null;
    isActive: boolean;
    lastValidatedAt: Date | null;
    lastValidationOk: boolean | null;
    lastValidationError: string | null;
    lastUsedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface UpsertExternalApiKeyInput {
    userId: string;
    providerId: string;
    sdkType: ExternalSdkType;
    displayName: string;
    baseUrl?: string | null;
    /** 평문 API 키 또는 OAuth 세션 JSON — repo 내부에서 즉시 암호화, 평문 보관 금지 */
    apiKey: string;
    /** 인증 방식 — 미지정 시 'api_key' */
    authMethod?: ExternalAuthMethod;
    /** OAuth 계정 식별자 (authMethod='oauth' 시) */
    oauthAccountId?: string | null;
    /** OAuth access token 만료 시각 (authMethod='oauth' 시) */
    oauthExpiresAt?: Date | null;
}

export interface DbRow {
    id: number;
    user_id: string;
    provider_id: string;
    sdk_type: ExternalSdkType;
    auth_method: ExternalAuthMethod;
    display_name: string;
    base_url: string | null;
    encrypted_key: string;
    key_prefix: string;
    oauth_account_id: string | null;
    oauth_expires_at: Date | null;
    is_active: boolean;
    last_validated_at: Date | null;
    last_validation_ok: boolean | null;
    last_validation_error: string | null;
    last_used_at: Date | null;
    created_at: Date;
    updated_at: Date;
    [key: string]: unknown;
}

export function buildKeyPrefix(plaintext: string): string {
    if (plaintext.length <= KEY_PREFIX_LENGTH) {
        return plaintext;
    }
    return `${plaintext.slice(0, KEY_PREFIX_LENGTH)}...`;
}

export function toRow(row: DbRow): ExternalApiKeyRow {
    return {
        id: row.id,
        userId: row.user_id,
        providerId: row.provider_id,
        sdkType: row.sdk_type,
        authMethod: row.auth_method ?? 'api_key',
        displayName: row.display_name,
        baseUrl: row.base_url,
        keyPrefix: row.key_prefix,
        oauthAccountId: row.oauth_account_id ?? null,
        oauthExpiresAt: row.oauth_expires_at ?? null,
        isActive: row.is_active,
        lastValidatedAt: row.last_validated_at,
        lastValidationOk: row.last_validation_ok,
        lastValidationError: row.last_validation_error,
        lastUsedAt: row.last_used_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
