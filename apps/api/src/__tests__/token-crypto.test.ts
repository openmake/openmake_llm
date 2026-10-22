/**
 * token-crypto.test.ts
 * AES-256-GCM OAuth 토큰 암호화/복호화 유틸리티 테스트
 */

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    })
}));

// 유효한 32바이트(64자리 hex) 테스트 키
const TEST_KEY = 'a'.repeat(64); // 'aaa...aaa' 64자

describe('encryptToken / decryptToken', () => {
    beforeEach(() => {
        // 각 테스트마다 환경변수 초기화
        delete process.env.TOKEN_ENCRYPTION_KEY;
        // 모듈 캐시 초기화 (키 경고 플래그 재설정)
        jest.resetModules();
    });

    test('키 없으면 평문 그대로 반환 (no-op)', async () => {
        delete process.env.TOKEN_ENCRYPTION_KEY;
        const { encryptToken } = await import('../utils/token-crypto');
        expect(encryptToken('my-secret-token')).toBe('my-secret-token');
    });

    test('빈 문자열 입력 → 빈 문자열 반환', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
        const { encryptToken, decryptToken } = await import('../utils/token-crypto');
        expect(encryptToken('')).toBe('');
        expect(decryptToken('')).toBe('');
    });

    test('암호화 후 복호화하면 원문과 동일', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
        const { encryptToken, decryptToken } = await import('../utils/token-crypto');

        const original = 'ya29.secret-oauth-access-token';
        const encrypted = encryptToken(original);

        expect(encrypted).not.toBe(original);
        expect(encrypted.startsWith('v1:')).toBe(true);

        const decrypted = decryptToken(encrypted);
        expect(decrypted).toBe(original);
    });

    test('동일 평문도 매번 다른 암호문 생성 (random IV)', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
        const { encryptToken } = await import('../utils/token-crypto');

        const token = 'same-token';
        const enc1 = encryptToken(token);
        const enc2 = encryptToken(token);
        expect(enc1).not.toBe(enc2); // IV가 달라야 함
    });

    test('v1: prefix 없는 평문은 복호화 없이 그대로 반환 (하위 호환)', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
        const { decryptToken } = await import('../utils/token-crypto');

        const legacy = 'legacy-plain-token';
        expect(decryptToken(legacy)).toBe(legacy);
    });

    test('잘못된 포맷(파트 수 부족) → 원본값 반환', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
        const { decryptToken } = await import('../utils/token-crypto');

        const malformed = 'v1:onlyonepart';
        expect(decryptToken(malformed)).toBe(malformed);
    });

    test('키 길이가 64자 아니면 암호화 no-op', async () => {
        process.env.TOKEN_ENCRYPTION_KEY = 'tooshort';
        const { encryptToken } = await import('../utils/token-crypto');

        const token = 'my-token';
        expect(encryptToken(token)).toBe(token); // 키 오류 시 평문 반환
    });

    test('_internals 상수 노출 확인', async () => {
        const { _internals } = await import('../utils/token-crypto');
        expect(_internals.ALGORITHM).toBe('aes-256-gcm');
        expect(_internals.KEY_LENGTH).toBe(32);
        expect(_internals.IV_LENGTH).toBe(12);
        expect(_internals.TAG_LENGTH).toBe(16);
        expect(_internals.ENCRYPTED_PREFIX).toBe('v1:');
    });
});

describe('isDecryptionFailure', () => {
    test('복호화되지 않은 암호문(v1: 잔존)을 실패로 판별한다', async () => {
        const { isDecryptionFailure } = await import('../utils/token-crypto');
        expect(isDecryptionFailure('v1:abc:def:ghi')).toBe(true);
        expect(isDecryptionFailure('v1:')).toBe(true);
    });

    test('평문은 실패가 아니다', async () => {
        const { isDecryptionFailure } = await import('../utils/token-crypto');
        expect(isDecryptionFailure('sk-plain-key')).toBe(false);
        expect(isDecryptionFailure('')).toBe(false);
    });

    test('정상 복호화 왕복은 실패로 판별되지 않는다', async () => {
        const { encryptToken, decryptToken, isDecryptionFailure } = await import('../utils/token-crypto');
        const plain = decryptToken(encryptToken('my-secret'));
        expect(plain).toBe('my-secret');
        expect(isDecryptionFailure(plain)).toBe(false);
    });

    test('손상된 암호문은 decryptToken 이 그대로 돌려주고(fail-open) 실패로 판별된다', async () => {
        const { decryptToken, isDecryptionFailure } = await import('../utils/token-crypto');
        const broken = 'v1:not-a-valid-ciphertext';
        const out = decryptToken(broken);
        expect(out).toBe(broken);              // fail-open 동작 자체를 고정
        expect(isDecryptionFailure(out)).toBe(true);
    });
});

describe('비-dev 환경 실패(S9)', () => {
    beforeEach(() => {
        process.env.NODE_ENV = 'staging';
        process.env.TOKEN_ENCRYPTION_KEY = TEST_KEY;
        jest.resetModules();
    });

    afterEach(() => {
        process.env.NODE_ENV = 'test';
    });

    test('변조된 암호문은 TokenCryptoError', async () => {
        const m = await import('../utils/token-crypto');
        const enc = m.encryptToken('s');
        // 태그 마지막 바이트를 바꾼다(이미 00 이면 ff 로 — 1/256 확률의 우연 일치 방지)
        const bad = enc.slice(0, -2) + (enc.endsWith('00') ? 'ff' : '00');
        expect(() => m.decryptToken(bad)).toThrow(m.TokenCryptoError);
    });

    test('파트 수가 틀린 v1: 값은 TokenCryptoError', async () => {
        const m = await import('../utils/token-crypto');
        expect(() => m.decryptToken('v1:abc')).toThrow(m.TokenCryptoError);
    });

    test('레거시 평문은 그대로', async () => {
        const m = await import('../utils/token-crypto');
        expect(m.decryptToken('plain')).toBe('plain');
    });

    test('NODE_ENV=test 면 종전처럼 입력을 돌려준다', async () => {
        process.env.NODE_ENV = 'test';
        jest.resetModules();
        const m = await import('../utils/token-crypto');
        expect(m.decryptToken('v1:abc')).toBe('v1:abc');
    });
});
