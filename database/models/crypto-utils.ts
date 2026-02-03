/**
 * #1 개선: 토큰 암호화 유틸리티
 * AES-256-GCM을 사용한 at-rest 암호화
 */

import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * 암호화 키 획득 (환경변수에서 로드)
 * 32바이트 = 256비트 키 필요
 */
function getEncryptionKey(): Buffer {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    if (key) {
        // hex 문자열이면 Buffer로 변환
        if (key.length === 64) {
            return Buffer.from(key, 'hex');
        }
        // 문자열이면 SHA-256 해시로 32바이트 키 생성
        return crypto.createHash('sha256').update(key).digest();
    }

    // 환경변수 없으면 JWT_SECRET에서 파생
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret) {
        return crypto.createHash('sha256').update(jwtSecret).digest();
    }

    // 개발 환경 폴백 (프로덕션에서는 경고)
    if (process.env.NODE_ENV === 'production') {
        console.error('[Crypto] TOKEN_ENCRYPTION_KEY 또는 JWT_SECRET이 설정되지 않았습니다!');
    }
    return crypto.createHash('sha256').update('dev-fallback-key-do-not-use-in-production').digest();
}

/**
 * 문자열 암호화
 * @returns `iv:authTag:encryptedData` 형식의 hex 문자열
 */
export function encrypt(plaintext: string): string {
    if (!plaintext) return plaintext;

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * 암호화된 문자열 복호화
 * @param ciphertext `iv:authTag:encryptedData` 형식의 hex 문자열
 */
export function decrypt(ciphertext: string): string {
    if (!ciphertext) return ciphertext;

    // 이미 암호화되지 않은 값인 경우 (마이그레이션 호환)
    if (!ciphertext.includes(':')) {
        return ciphertext;
    }

    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
        // 형식이 맞지 않으면 원본 반환 (마이그레이션 호환)
        return ciphertext;
    }

    try {
        const key = getEncryptionKey();
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedData = parts[2];

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (e) {
        // 복호화 실패 시 원본 반환 (마이그레이션 호환)
        console.warn('[Crypto] 복호화 실패 - 평문으로 간주합니다');
        return ciphertext;
    }
}
