/**
 * 토큰 무효화 판정(A2 기반) — users.tokens_valid_after(마이그레이션 194) 이전에 발급된 토큰을 거부한다.
 * 열이 NULL(기본값)이면 어떤 토큰도 거부하지 않는다 — 기존 토큰 영향 없음.
 * 비교는 초 단위다(JWT iat 정밀도) — 무효화와 같은 초에 발급된 토큰은 통과한다.
 */
import * as jwt from 'jsonwebtoken';
import { isIssuedBeforeInvalidation } from '../token-invalidation';
import { generateToken } from '../auth-core';

// generateToken 의 fire-and-forget 수명주기 훅 — 테스트에서는 아무것도 띄우지 않는다
jest.mock('../../runtime-ports/tool-runtime', () => ({
    getToolRuntime: () => ({ onUserLogin: jest.fn() }),
}));

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

    it('경계값(정각): iat 가 무효화 시각의 초보다 앞이면 true, 같거나 뒤면 false', () => {
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC - 1, VALID_AFTER_ISO)).toBe(true);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC, VALID_AFTER_ISO)).toBe(false);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC + 1, VALID_AFTER_ISO)).toBe(false);
    });

    it('경계값(초 미만): 무효화가 06:00:00.500 이면 iat 06:00:00 은 통과, 05:59:59 는 거부', () => {
        const mid = '2026-10-25T06:00:00.500Z';
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC, mid)).toBe(false);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC - 1, mid)).toBe(true);
        expect(isIssuedBeforeInvalidation(VALID_AFTER_SEC, new Date(mid))).toBe(false);
    });

    it('무효화 직후 같은 초에 발급한 토큰은 통과한다(비밀번호 변경 뒤 이 기기 재발급)', () => {
        jest.useFakeTimers({ now: new Date('2026-10-25T06:00:00.700Z') });
        try {
            const validAfter = new Date(); // user-manager changePassword 와 같은 ms 시각
            jest.setSystemTime(new Date('2026-10-25T06:00:00.900Z'));
            const token = generateToken({ id: 'u1', email: 'same-second@example.com', role: 'user', created_at: validAfter.toISOString(), is_active: true });
            const iat = (jwt.decode(token) as { iat: number }).iat;
            expect(iat).toBe(VALID_AFTER_SEC);
            expect(isIssuedBeforeInvalidation(iat, validAfter)).toBe(false);
        } finally {
            jest.useRealTimers();
        }
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
