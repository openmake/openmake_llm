/** 실시간 작업 화면 폴링 판단(apps/web/lib/live-view.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {}; // 모듈로 만들어 다른 테스트 파일의 전역 타입 이름과 겹치지 않게 한다
type PollInput = { status: string | undefined; visible: boolean; eligible: boolean | null };
const { nextLivePollDelay, frameAgeSeconds, LIVE_RUNNING_STATUSES } = require('../../../../web/lib/live-view') as {
    nextLivePollDelay: (s: PollInput) => number | null;
    frameAgeSeconds: (at: number, now: number) => number | null;
    LIVE_RUNNING_STATUSES: readonly string[];
};

describe('nextLivePollDelay', () => {
    it('실행 중이고 탭이 보이면 1초 뒤 다시 부른다', () => {
        expect(nextLivePollDelay({ status: 'running', visible: true, eligible: true })).toBe(1000);
    });
    it('일시정지도 실행 중으로 본다', () => {
        expect(nextLivePollDelay({ status: 'paused', visible: true, eligible: true })).toBe(1000);
        expect(LIVE_RUNNING_STATUSES).toEqual(['running', 'paused']);
    });
    it('끝난 작업은 멈춘다', () => {
        expect(nextLivePollDelay({ status: 'completed', visible: true, eligible: true })).toBeNull();
        expect(nextLivePollDelay({ status: undefined, visible: true, eligible: true })).toBeNull();
    });
    it('탭이 가려지면 멈춘다', () => {
        expect(nextLivePollDelay({ status: 'running', visible: false, eligible: true })).toBeNull();
    });
    it('대상이 아니면 멈춘다', () => {
        expect(nextLivePollDelay({ status: 'running', visible: true, eligible: false })).toBeNull();
    });
    it('대상인지 아직 모르면 실행 중일 때 계속 부른다', () => {
        expect(nextLivePollDelay({ status: 'running', visible: true, eligible: null })).toBe(1000);
    });
});

describe('frameAgeSeconds', () => {
    it('3초 미만이면 null(지금으로 본다)', () => {
        expect(frameAgeSeconds(1000, 3500)).toBeNull();
    });
    it('몇 초 전인지 정수로', () => {
        expect(frameAgeSeconds(1000, 11000)).toBe(10);
    });
});
