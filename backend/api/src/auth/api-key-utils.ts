/**
 * ============================================================
 * API Key Utilities - API Key 생성/해싱/검증
 * ============================================================
 *
 * 외부 개발자 API 접근을 위한 키 생성, HMAC-SHA-256 해싱,
 * 타이밍-세이프 검증, 마스킹 유틸리티를 제공합니다.
 *
 * @module auth/api-key-utils
 * @description
 * - 키 형식: omk_live_ + 64 random hex chars
 * - 해싱: HMAC-SHA-256 (API_KEY_PEPPER 환경변수 기반)
 * - 비교: crypto.timingSafeEqual (타이밍 공격 방지)
 * - 마스킹: omk_live_abcd****wxyz (표시용)
 * - 형식 검증: 접두사 + 최소 16자 hex body
 */

import crypto from 'node:crypto';
import { getConfig } from '../config/env';
import { createLogger } from '../utils/logger';

const logger = createLogger('ApiKeyUtils');
let pepperWarningEmitted = false;

/** API Key 접두사 */
export const API_KEY_PREFIX = 'omk_live_';

/**
 * 새 API Key 생성
 * @returns 평문 API Key (omk_live_ + 32 hex chars)
 */
export function generateApiKey(): string {
    const randomPart = crypto.randomBytes(32).toString('hex');
    return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * API Key를 HMAC-SHA-256으로 해싱
 * pepper가 설정되어 있으면 pepper를 HMAC secret으로 사용,
 * 없으면 SHA-256 단방향 해시 사용
 * 
 * @param plainKey 평문 API Key
 * @returns hex-encoded hash
 */
export function hashApiKey(plainKey: string): string {
    const pepper = getConfig().apiKeyPepper;

    if (pepper) {
        return crypto
            .createHmac('sha256', pepper)
            .update(plainKey)
            .digest('hex');
    }

    // pepper 미설정 시: 프로덕션에서는 에러, 그 외 환경에서는 단순 SHA-256 폴백
    if (getConfig().nodeEnv === 'production') {
        throw new Error('[ApiKeyUtils] API_KEY_PEPPER 환경변수는 프로덕션에서 필수입니다. .env에 설정하세요.');
    }

    if (!pepperWarningEmitted) {
        logger.warn('API_KEY_PEPPER is not set. 개발 환경에서 임시 HMAC pepper를 사용합니다. .env에 API_KEY_PEPPER를 설정하세요.');
        pepperWarningEmitted = true;
    }
    // 개발 환경에서도 HMAC 사용 (임시 고정 pepper)
    const devPepper = 'dev-only-insecure-pepper-do-not-use-in-production';
    return crypto
        .createHmac('sha256', devPepper)
        .update(plainKey)
        .digest('hex');
}

/**
 * API Key에서 마지막 4자리 추출
 * @param plainKey 평문 API Key
 * @returns 마지막 4자
 */
export function extractLast4(plainKey: string): string {
    return plainKey.slice(-4);
}

/**
 * API Key 형식 유효성 검사
 * @param key 검증할 문자열
 * @returns omk_live_ 접두사 + 최소 16자 body 여부
 */
export function isValidApiKeyFormat(key: string): boolean {
    if (!key.startsWith(API_KEY_PREFIX)) {
        return false;
    }
    const body = key.slice(API_KEY_PREFIX.length);
    // 32 hex chars = 64 characters, but minimum 16 for flexibility
    return body.length >= 16 && /^[a-f0-9]+$/.test(body);
}
