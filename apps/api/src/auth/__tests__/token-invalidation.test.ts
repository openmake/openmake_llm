/**
 * 토큰 무효화 판정(A2 기반) — users.tokens_valid_after(마이그레이션 194) 이전에 발급된 토큰을 거부한다.
 * 열이 NULL(기본값)이면 어떤 토큰도 거부하지 않는다 — 기존 토큰 영향 없음.
 */
import { isIssuedBeforeInvalidation } from '../token-invalidation';

const VALID_AFTER_ISO = '2026-10-25T06:00:00.000Z';
const VALID_AFTER_SEC = Date.parse(VALID_AFTER_ISO) / 1000;

describe('isIssuedBeforeInvalidation', () => {
    it('tokens_valid_after 가 NULL/undefined 면 false — iat 가 없어도 거부하지 않는다', () => {
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC - 100, null)).toBe(false);
        expect(isIssuedBeforeInvalidation(undefined, null)).toBe(false);
        expect(isIssuedBeforeInvalidation(undefined, undefined)).toBe(false);
    });

    it('tokens_valid_after 가 있는데 iat 가 없으면 true(거부)', () => {
        expect(isIssuedBeforeInvalidation(undefined, VALID_AFTER_ISO)).toBe(true);
    });

    it('경계값: iat*1000 < valid_after 면 true, 같거나 뒤면 false', () => {
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC - 1, VALID_AFTER_ISO)).toBe(true);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC, VALID_AFTER_ISO)).toBe(false);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC + 1, VALID_AFTER_ISO)).toBe(false);
    });

    it('Date 객체도 받는다(pg TIMESTAMPTZ 기본 파싱)', () => {
        const at = new Date(VALID_AFTER_ISO);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC - 1, at)).toBe(true);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC, at)).toBe(false);
    });

    it('tokens_valid_after 가 있는데 시각으로 읽히지 않으면 true(거부, fail-closed)', () => {
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC + 1000, 'not-a-date')).toBe(true);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC + 1000, new Date('invalid'))).toBe(true);
    });
});
