/** 웹 스트림 이어받기 커서(apps/web/lib/ws-seq.ts, F19.11) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 정적 import 하면 tsc 가 TS6059 로 거부한다 — require 로 런타임만 불러온다(ts-jest 가 변환)
interface Cursor { streamId: string | null; lastSeq: number }
type Env = { type?: string; streamId?: unknown; seq?: unknown };
const { acceptStreamEvent, cursorAfterResume, resumeCursorFields, EMPTY_STREAM_CURSOR } = require('../../../../web/lib/ws-seq') as {
    acceptStreamEvent: (c: Cursor, ev: Env) => { apply: boolean; cursor: Cursor };
    cursorAfterResume: (c: Cursor, ev: Env) => Cursor;
    resumeCursorFields: (c: Cursor) => { streamId?: string; afterSeq?: number };
    EMPTY_STREAM_CURSOR: Cursor;
};

describe('web ws-seq', () => {
    it('봉투 없는 이벤트는 그대로 적용하고 커서를 바꾸지 않는다', () => {
        expect(acceptStreamEvent(EMPTY_STREAM_CURSOR, { type: 'build_id' })).toEqual({ apply: true, cursor: EMPTY_STREAM_CURSOR });
    });

    it('같은 스트림에서 seq <= lastSeq 는 중복으로 무시, 큰 seq 는 적용·전진', () => {
        let c = acceptStreamEvent(EMPTY_STREAM_CURSOR, { streamId: 's1', seq: 1 }).cursor;
        c = acceptStreamEvent(c, { streamId: 's1', seq: 2 }).cursor;
        expect(acceptStreamEvent(c, { streamId: 's1', seq: 2 }).apply).toBe(false);
        expect(acceptStreamEvent(c, { streamId: 's1', seq: 1 }).apply).toBe(false);
        expect(acceptStreamEvent(c, { streamId: 's1', seq: 3 })).toEqual({ apply: true, cursor: { streamId: 's1', lastSeq: 3 } });
    });

    it('새 스트림(다른 streamId)은 커서를 그 이벤트로 재설정', () => {
        const c = { streamId: 's1', lastSeq: 40 };
        expect(acceptStreamEvent(c, { streamId: 's2', seq: 1 })).toEqual({ apply: true, cursor: { streamId: 's2', lastSeq: 1 } });
    });

    it('stream_resume — 같은 스트림은 afterSeq 유지(재생 이벤트 수신), 다른 스트림은 0 부터', () => {
        const c = { streamId: 's1', lastSeq: 7 };
        expect(cursorAfterResume(c, { type: 'stream_resume', streamId: 's1' })).toBe(c);
        expect(cursorAfterResume(c, { type: 'stream_resume', streamId: 's9' })).toEqual({ streamId: 's9', lastSeq: 0 });
        expect(cursorAfterResume(c, { type: 'stream_resume' })).toBe(c);
        const afterResume = cursorAfterResume(c, { type: 'stream_resume', streamId: 's1' });
        expect(acceptStreamEvent(afterResume, { streamId: 's1', seq: 8 }).apply).toBe(true);
    });

    it('resume 요청 필드 — 받은 스트림이 없으면 빈 객체', () => {
        expect(resumeCursorFields(EMPTY_STREAM_CURSOR)).toEqual({});
        expect(resumeCursorFields({ streamId: 's1', lastSeq: 5 })).toEqual({ streamId: 's1', afterSeq: 5 });
    });
});
