/**
 * BLACKLIST_FAIL_MODE 기본값(보안 점검 A7) — 미설정이면 NODE_ENV=production 은 'safe'(거부), 그 밖은 'open'(통과).
 * 명시값은 환경과 무관하게 그대로 쓴다.
 */
import { envSchema, resolveBlacklistFailMode } from '../env.schema';

describe('resolveBlacklistFailMode', () => {
    it('미설정 + production → safe', () => {
        expect(resolveBlacklistFailMode(undefined, 'production')).toBe('safe');
    });
    it('미설정 + development → open', () => {
        expect(resolveBlacklistFailMode(undefined, 'development')).toBe('open');
    });
    it('미설정 + test·NODE_ENV 없음 → open', () => {
        expect(resolveBlacklistFailMode(undefined, 'test')).toBe('open');
        expect(resolveBlacklistFailMode(undefined, undefined)).toBe('open');
    });
    it('명시값은 그대로 — production 에서 open, development 에서 safe', () => {
        expect(resolveBlacklistFailMode('open', 'production')).toBe('open');
        expect(resolveBlacklistFailMode('safe', 'development')).toBe('safe');
    });
});

describe('envSchema BLACKLIST_FAIL_MODE', () => {
    it('미설정이면 스키마는 기본값을 넣지 않는다(파생은 resolveBlacklistFailMode)', () => {
        const parsed = envSchema.safeParse({ NODE_ENV: 'development' });
        expect(parsed.success).toBe(true);
        expect(parsed.success && parsed.data.BLACKLIST_FAIL_MODE).toBeUndefined();
    });
    it('허용 밖 값은 거부', () => {
        expect(envSchema.safeParse({ NODE_ENV: 'development', BLACKLIST_FAIL_MODE: 'maybe' }).success).toBe(false);
    });
});
