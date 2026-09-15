/**
 * 범위 메모리 메타데이터 규칙(126) — 민감 패턴·TTL·출처별 신뢰도.
 */
import { isSensitiveMemory, expiresAtFromTtlDays, MEMORY_CONFIDENCE_BY_SOURCE, MEMORY_METADATA } from '../memory-metadata';

describe('isSensitiveMemory', () => {
    it('자격증명·개인식별 패턴을 잡는다', () => {
        expect(isSensitiveMemory('내 비밀번호는 hunter2 야')).toBe(true);
        expect(isSensitiveMemory('API key 는 sk-abcdefghijklmnopqrstuvwxyz')).toBe(true);
        expect(isSensitiveMemory('브리지 키 omk_live_478eb4b31b6')).toBe(true);
        expect(isSensitiveMemory('주민번호 900101-1234567')).toBe(true);
        expect(isSensitiveMemory('카드 1234-5678-9012-3456 로 결제')).toBe(true);
    });
    it('일반 선호·사실은 통과한다', () => {
        expect(isSensitiveMemory('나는 파이썬과 간결한 답변을 선호한다')).toBe(false);
        expect(isSensitiveMemory('회사 이름은 OpenMake 이고 서울에 있다')).toBe(false);
        expect(isSensitiveMemory('토큰 절약을 위해 짧게 답해줘')).toBe(false);
    });
});

describe('expiresAtFromTtlDays', () => {
    const now = new Date('2026-09-16T00:00:00Z');
    it('일수 → 만료 시각', () => {
        expect(expiresAtFromTtlDays(90, now)?.toISOString()).toBe('2026-12-15T00:00:00.000Z');
    });
    it('미지정·0·음수·NaN·상한 초과는 무기한(null)', () => {
        expect(expiresAtFromTtlDays(undefined, now)).toBeNull();
        expect(expiresAtFromTtlDays(0, now)).toBeNull();
        expect(expiresAtFromTtlDays(-1, now)).toBeNull();
        expect(expiresAtFromTtlDays(Number.NaN, now)).toBeNull();
        expect(expiresAtFromTtlDays(MEMORY_METADATA.MAX_TTL_DAYS + 1, now)).toBeNull();
    });
});

describe('출처별 신뢰도', () => {
    it('explicit > batch > candidate', () => {
        expect(MEMORY_CONFIDENCE_BY_SOURCE.explicit).toBeGreaterThan(MEMORY_CONFIDENCE_BY_SOURCE.batch);
        expect(MEMORY_CONFIDENCE_BY_SOURCE.batch).toBeGreaterThan(MEMORY_CONFIDENCE_BY_SOURCE.candidate);
    });
});
