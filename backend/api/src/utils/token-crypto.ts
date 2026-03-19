/**
 * @module utils/token-crypto
 * @description OAuth 토큰 AES-256-GCM 암호화/복호화 유틸리티
 *
 * external_connections 테이블의 access_token/refresh_token을
 * 애플리케이션 레벨에서 암호화하여 DB 유출 시 토큰 노출을 방지합니다.
 *
 * 암호화 포맷: `v1:${iv_hex}:${ciphertext_hex}:${tag_hex}`
 * - v1: prefix로 암호화 여부를 감지 (하위 호환: prefix 없으면 평문으로 반환)
 * - TOKEN_ENCRYPTION_KEY 미설정 시 no-op (개발환경 호환)
 *
 * 키 생성 방법: openssl rand -hex 32
 */
import crypto from 'node:crypto';
import { createLogger } from './logger';

const logger = createLogger('TokenCrypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits (GCM 권장)
const TAG_LENGTH = 16; // 128 bits
const ENCRYPTED_PREFIX = 'v1:';

let _keyWarningLogged = false;

function getKey(): Buffer | null {
    const hexKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!hexKey) {
        if (!_keyWarningLogged) {
            logger.warn(
                'TOKEN_ENCRYPTION_KEY 환경 변수가 설정되지 않았습니다. ' +
                'OAuth 토큰이 평문으로 저장됩니다. ' +
                '프로덕션 환경에서는 반드시 설정하세요. (openssl rand -hex 32)'
            );
            _keyWarningLogged = true;
        }
        return null;
    }
    if (hexKey.length !== 64) {
        logger.error(
            `TOKEN_ENCRYPTION_KEY 길이가 올바르지 않습니다. ` +
            `64자리 hex 문자열(32 bytes)이어야 합니다. 현재: ${hexKey.length}자. ` +
            `토큰 암호화를 건너뜁니다.`
        );
        return null;
    }
    return Buffer.from(hexKey, 'hex');
}

/**
 * 토큰을 AES-256-GCM으로 암호화합니다.
 * TOKEN_ENCRYPTION_KEY가 없으면 원문을 그대로 반환합니다 (no-op).
 */
export function encryptToken(plaintext: string): string {
    if (!plaintext) return plaintext;

    const key = getKey();
    if (!key) return plaintext; // no-op fallback (개발환경 또는 키 미설정)

    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();
        return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
    } catch (err) {
        logger.error('토큰 암호화 실패:', err);
        return plaintext; // 암호화 실패 시 평문으로 fallback
    }
}

/**
 * 암호화된 토큰을 복호화합니다.
 * v1: prefix가 없으면 레거시 평문 토큰으로 간주하고 그대로 반환합니다.
 * TOKEN_ENCRYPTION_KEY가 없으면 값을 그대로 반환합니다.
 */
export function decryptToken(value: string): string {
    if (!value) return value;

    // v1: prefix가 없으면 레거시 평문 토큰 (하위 호환)
    if (!value.startsWith(ENCRYPTED_PREFIX)) return value;

    const key = getKey();
    if (!key) {
        // 키가 없으면 복호화 불가 - 암호화된 값을 그대로 반환
        logger.warn('TOKEN_ENCRYPTION_KEY 없이 암호화된 토큰을 읽으려 했습니다.');
        return value;
    }

    try {
        const parts = value.slice(ENCRYPTED_PREFIX.length).split(':');
        if (parts.length !== 3) {
            logger.error('암호화 토큰 포맷 오류: 파트 수가 맞지 않습니다.');
            return value;
        }
        const [ivHex, ctHex, tagHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const ct = Buffer.from(ctHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');

        if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
            logger.error('암호화 토큰 포맷 오류: IV 또는 태그 길이 불일치.');
            return value;
        }

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch (err) {
        logger.error('토큰 복호화 실패 (GCM 인증 실패 또는 데이터 손상):', err);
        return value; // 복호화 실패 시 원본값 반환
    }
}

// 내부 상수 노출 (테스트용)
export const _internals = {
    ALGORITHM,
    KEY_LENGTH,
    IV_LENGTH,
    TAG_LENGTH,
    ENCRYPTED_PREFIX
} as const;
