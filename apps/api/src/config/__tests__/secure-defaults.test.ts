/**
 * W3 secure/stable-by-default — 명시 'true'/'false' 가 우선하고, 미설정이면 운영(production)만 prodDefault.
 */
import { boolEnvDefault, isProductionEnv } from '../secure-defaults';
import { DEFAULT_CONFIG } from '../env-defaults';

describe('boolEnvDefault', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    afterEach(() => { process.env.NODE_ENV = originalNodeEnv; });

    it('명시 true/false 는 NODE_ENV 와 무관하다(대소문자·공백 무시)', () => {
        for (const nodeEnv of ['production', 'test', 'development']) {
            process.env.NODE_ENV = nodeEnv;
            expect(boolEnvDefault('true', false)).toBe(true);
            expect(boolEnvDefault(' TRUE ', false)).toBe(true);
            expect(boolEnvDefault('false', true)).toBe(false);
            expect(boolEnvDefault('False', true, true)).toBe(false);
        }
    });

    it('미설정·빈 문자열·다른 값 + production → prodDefault', () => {
        process.env.NODE_ENV = 'production';
        expect(isProductionEnv()).toBe(true);
        expect(boolEnvDefault(undefined, true)).toBe(true);
        expect(boolEnvDefault('', true)).toBe(true);
        expect(boolEnvDefault('yes', true)).toBe(true);
        expect(boolEnvDefault(undefined, false, true)).toBe(false);
    });

    it('미설정 + test → devDefault(기본 false)', () => {
        process.env.NODE_ENV = 'test';
        expect(isProductionEnv()).toBe(false);
        expect(boolEnvDefault(undefined, true)).toBe(false);
        expect(boolEnvDefault('', true)).toBe(false);
        expect(boolEnvDefault(undefined, true, true)).toBe(true);
    });

    it('NODE_ENV 는 호출 시점에 읽는다', () => {
        process.env.NODE_ENV = 'test';
        expect(boolEnvDefault(undefined, true)).toBe(false);
        process.env.NODE_ENV = 'production';
        expect(boolEnvDefault(undefined, true)).toBe(true);
    });
});

describe('DEFAULT_CONFIG.trustedProxies (W3 S7)', () => {
    it('기본은 loopback 만 — 사설망·링크로컬 주소의 X-Forwarded-For 는 믿지 않는다', () => {
        expect(DEFAULT_CONFIG.trustedProxies).toEqual(['loopback']);
    });
});
