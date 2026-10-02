/** 채팅 자동 스크롤 판정(apps/web/lib/chat-scroll.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
const { isNearBottom, STICK_THRESHOLD_PX } = require('../../../../web/lib/chat-scroll') as {
    isNearBottom: (m: { scrollTop: number; clientHeight: number; scrollHeight: number }, thresholdPx?: number) => boolean;
    STICK_THRESHOLD_PX: number;
};

describe('isNearBottom — 사용자가 맨 아래 근처에 있을 때만 따라간다', () => {
    const at = (scrollTop: number) => ({ scrollTop, clientHeight: 600, scrollHeight: 2000 });

    it('맨 아래면 따라간다', () => {
        expect(isNearBottom(at(1400))).toBe(true);
    });
    it('임계 안쪽(조금 올린 정도)이면 따라간다', () => {
        expect(isNearBottom(at(1400 - STICK_THRESHOLD_PX))).toBe(true);
    });
    it('임계보다 더 올렸으면(과거 대화를 읽는 중) 따라가지 않는다', () => {
        expect(isNearBottom(at(1400 - STICK_THRESHOLD_PX - 1))).toBe(false);
        expect(isNearBottom(at(0))).toBe(false);
    });
    it('내용이 화면보다 짧으면(스크롤 없음) 따라간다', () => {
        expect(isNearBottom({ scrollTop: 0, clientHeight: 600, scrollHeight: 300 })).toBe(true);
    });
    it('소수점 스크롤 위치(확대·고해상도)에서도 맨 아래를 맨 아래로 본다', () => {
        expect(isNearBottom({ scrollTop: 1399.5, clientHeight: 600, scrollHeight: 2000 })).toBe(true);
    });
});
