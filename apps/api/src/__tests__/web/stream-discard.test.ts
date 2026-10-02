/** 버린 대화의 스트림 걸러내기(apps/web/lib/stream-discard.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {}; // 모듈로 만들어 다른 테스트 파일의 전역 타입 이름과 겹치지 않게 한다
interface State { discarded: string | null; pending: boolean }
const { EMPTY_DISCARD, discardOnReset, filterStreamEvent, discardOnSend } = require('../../../../web/lib/stream-discard') as {
    EMPTY_DISCARD: State;
    discardOnReset: (s: State, wasGenerating: boolean, activeStreamId: string | null) => State;
    filterStreamEvent: (s: State, streamId: unknown) => { drop: boolean; state: State };
    discardOnSend: (s: State) => State;
};

describe('stream-discard', () => {
    it('생성 중이 아니면 대화를 지워도 아무것도 버리지 않는다', () => {
        expect(discardOnReset(EMPTY_DISCARD, false, 's1')).toEqual(EMPTY_DISCARD);
    });
    it('생성 중에 대화를 지우면 그 스트림의 뒤 이벤트를 모두 버린다(종료 이벤트 포함)', () => {
        const s = discardOnReset(EMPTY_DISCARD, true, 's1');
        expect(filterStreamEvent(s, 's1').drop).toBe(true);
        expect(filterStreamEvent(s, 's1').drop).toBe(true);
    });
    it('버린 뒤 새로 보낸 요청의 스트림은 받는다', () => {
        const s = discardOnSend(discardOnReset(EMPTY_DISCARD, true, 's1'));
        expect(filterStreamEvent(s, 's2').drop).toBe(false);
        expect(filterStreamEvent(s, 's1').drop).toBe(true); // 늦게 온 옛 스트림 이벤트
    });
    it('첫 이벤트가 오기 전에 지웠으면 다음에 처음 오는 스트림을 버린다', () => {
        const s = discardOnReset(EMPTY_DISCARD, true, null);
        const first = filterStreamEvent(s, 's1');
        expect(first.drop).toBe(true);
        expect(filterStreamEvent(first.state, 's1').drop).toBe(true);
        expect(filterStreamEvent(first.state, 's2').drop).toBe(false);
    });
    it('스트림 id 가 없는 이벤트(연결 메타 등)는 버리지 않는다', () => {
        const s = discardOnReset(EMPTY_DISCARD, true, 's1');
        expect(filterStreamEvent(s, undefined).drop).toBe(false);
    });
});
