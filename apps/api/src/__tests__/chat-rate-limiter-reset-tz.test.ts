/**
 * 일일 채팅 한도 초기화 시각 — 서비스 대상이 한국 사용자라 UTC 자정(한국 09:00)이 아니라
 * CHAT_DAILY_RESET_TZ(기본 Asia/Seoul)의 다음 자정에 초기화돼야 한다.
 */
jest.mock('../data/models/unified-database', () => ({ getPool: jest.fn() }));
jest.mock('../data/user-manager', () => ({ isAdminRole: (r: string) => r === 'admin' }));

import { getNextResetMidnight } from '../middlewares/chat-rate-limiter';

const at = (iso: string) => new Date(iso).getTime();

describe('getNextResetMidnight — 일일 한도 초기화 시각', () => {
    const saved = process.env.CHAT_DAILY_RESET_TZ;
    afterEach(() => {
        if (saved === undefined) delete process.env.CHAT_DAILY_RESET_TZ;
        else process.env.CHAT_DAILY_RESET_TZ = saved;
    });

    test('Asia/Seoul — 한국 낮 12시면 그날 한국 자정(15:00Z)', () => {
        expect(getNextResetMidnight(at('2026-10-14T03:00:00Z'), 'Asia/Seoul')).toBe(at('2026-10-14T15:00:00Z'));
    });

    test('Asia/Seoul — UTC 로는 전날이지만 한국은 이미 다음 날(00:30)이면 다음 한국 자정', () => {
        const now = at('2026-10-14T15:30:00Z'); // 한국 10-15 00:30
        const seoul = getNextResetMidnight(now, 'Asia/Seoul');
        expect(seoul).toBe(at('2026-10-15T15:00:00Z'));
        // UTC 기준과 다르다 — 이전 동작(UTC 자정)이면 10-15T00:00Z 였다
        expect(seoul).not.toBe(getNextResetMidnight(now, 'UTC'));
        expect(getNextResetMidnight(now, 'UTC')).toBe(at('2026-10-15T00:00:00Z'));
    });

    test('환경변수가 없으면 Asia/Seoul 이 기본', () => {
        delete process.env.CHAT_DAILY_RESET_TZ;
        expect(getNextResetMidnight(at('2026-10-14T03:00:00Z'))).toBe(at('2026-10-14T15:00:00Z'));
    });

    test('환경변수로 TZ 를 바꿀 수 있다', () => {
        process.env.CHAT_DAILY_RESET_TZ = 'UTC';
        expect(getNextResetMidnight(at('2026-10-14T03:00:00Z'))).toBe(at('2026-10-15T00:00:00Z'));
    });

    test('잘못된 TZ 는 경고 후 UTC 자정으로 폴백', () => {
        expect(getNextResetMidnight(at('2026-10-14T15:30:00Z'), 'Not/A_Zone')).toBe(at('2026-10-15T00:00:00Z'));
    });

    test('DST 가 있는 TZ 도 그 지역 자정을 맞춘다(America/New_York)', () => {
        // DST 시작 전(EST, -5): 03-07 22:00 → 03-08 00:00 EST
        expect(getNextResetMidnight(at('2026-03-08T03:00:00Z'), 'America/New_York')).toBe(at('2026-03-08T05:00:00Z'));
        // DST 시작 당일(EDT, -4): 03-08 08:00 → 03-09 00:00 EDT
        expect(getNextResetMidnight(at('2026-03-08T12:00:00Z'), 'America/New_York')).toBe(at('2026-03-09T04:00:00Z'));
    });
});
