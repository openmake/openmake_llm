/**
 * 보안 점검 A10 — production 평문 쿠키 가드 고정.
 * NODE_ENV=production 에서 COOKIE_SECURE=false 이면 ALLOW_INSECURE_COOKIES=true(명시적 opt-out) 가 없을 때 부팅을 멈춘다.
 * 가드 자체는 env-validate.ts 에 이미 있다 — 이 테스트는 그 동작이 조용히 바뀌지 않게 고정한다.
 */
import { validateConfig } from '../env-validate';
import { DEFAULT_CONFIG } from '../env-defaults';
import type { EnvConfig } from '../env';

// 쿠키 외 production 검증(JWT_SECRET·API_KEY_PEPPER·LLM_API_KEY 경고)은 통과하도록 채운 기준 설정.
function makeConfig(overrides: Partial<EnvConfig>): EnvConfig {
    return {
        ...DEFAULT_CONFIG,
        jwtSecret: 'x'.repeat(40),
        apiKeyPepper: 'test-pepper',
        llmApiKey: 'test-llm-key',
        ...overrides,
    };
}

describe('validateConfig — production 쿠키 Secure 가드', () => {
    let warnSpy: jest.SpyInstance;
    beforeEach(() => {
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });
    afterEach(() => warnSpy.mockRestore());

    test('production + COOKIE_SECURE=false + ALLOW_INSECURE_COOKIES=false 이면 부팅을 멈춘다', () => {
        expect(() => validateConfig(makeConfig({ nodeEnv: 'production', cookieSecure: false, allowInsecureCookies: false })))
            .toThrow('COOKIE_SECURE must be true in production');
    });

    test('ALLOW_INSECURE_COOKIES=true 로 명시하면 통과하고 보안 경고를 1회 남긴다', () => {
        expect(() => validateConfig(makeConfig({ nodeEnv: 'production', cookieSecure: false, allowInsecureCookies: true })))
            .not.toThrow();
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(String(warnSpy.mock.calls[0][0])).toContain('COOKIE_SECURE=false in production with ALLOW_INSECURE_COOKIES=true');
    });

    test('COOKIE_SECURE=true 이면 통과하고 경고가 없다', () => {
        expect(() => validateConfig(makeConfig({ nodeEnv: 'production', cookieSecure: true, allowInsecureCookies: false })))
            .not.toThrow();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    test('development 는 둘 다 false 여도 통과한다', () => {
        expect(() => validateConfig(makeConfig({ nodeEnv: 'development', cookieSecure: false, allowInsecureCookies: false })))
            .not.toThrow();
        expect(warnSpy).not.toHaveBeenCalled();
    });
});
