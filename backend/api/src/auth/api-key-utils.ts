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

    // pepper 미설정 시 단순 SHA-256 (개발/테스트 환경)
    return crypto
        .createHash('sha256')
        .update(plainKey)
        .digest('hex');
}

/**
 * API Key 타이밍-세이프 검증
 * 
 * 저장된 해시와 입력 키의 해시를 constant-time 비교
 * 길이가 다르면 dummy 비교로 타이밍 정보 노출 방지
 * 
 * @param storedHash DB에 저장된 해시
 * @param incomingKey 검증할 평문 키
 * @returns 일치 여부
 */
export function verifyApiKey(storedHash: string, incomingKey: string): boolean {
    const incomingHash = hashApiKey(incomingKey);

    const bufferStored = Buffer.from(storedHash, 'utf-8');
    const bufferIncoming = Buffer.from(incomingHash, 'utf-8');

    // 길이가 다르면 dummy 비교 후 false 반환 (타이밍 공격 방지)
    if (bufferStored.length !== bufferIncoming.length) {
        const dummy = Buffer.alloc(bufferStored.length);
        crypto.timingSafeEqual(bufferStored, dummy);
        return false;
    }

    return crypto.timingSafeEqual(bufferStored, bufferIncoming);
}

/**
 * API Key 마스킹 (표시용)
 * omk_live_abcd...wxyz → omk_live_abcd****wxyz
 * 
 * @param plainKey 평문 API Key
 * @returns 마스킹된 키
 */
export function maskApiKey(plainKey: string): string {
    if (!plainKey.startsWith(API_KEY_PREFIX)) {
        return '****';
    }

    const body = plainKey.slice(API_KEY_PREFIX.length);
    if (body.length <= 8) {
        return `${API_KEY_PREFIX}${'*'.repeat(body.length)}`;
    }

    const first4 = body.slice(0, 4);
    const last4 = body.slice(-4);
    const masked = '*'.repeat(body.length - 8);

    return `${API_KEY_PREFIX}${first4}${masked}${last4}`;
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
