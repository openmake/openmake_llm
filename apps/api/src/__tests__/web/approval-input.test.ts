/**
 * 승인·질문 카드의 입력 판정(apps/web/lib/approval-input) — Enter 전송, 자동 승인 뒤 남길 카드, 작업 상태 번역 키.
 */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
export {};
interface KeyLike { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number }
interface Card { approvalId: string }
const { shouldSubmitOnEnter, keepStillPending, taskStatusLabelKey } = require('../../../../web/lib/approval-input') as {
    shouldSubmitOnEnter: (e: KeyLike, opts?: { multiline?: boolean }) => boolean;
    keepStillPending: <T extends Card>(cards: T[], pending: Card[] | null | undefined) => T[];
    taskStatusLabelKey: (status: string) => string | null;
};

describe('shouldSubmitOnEnter', () => {
    it('Enter 는 전송한다', () => {
        expect(shouldSubmitOnEnter({ key: 'Enter' })).toBe(true);
    });
    it('다른 키는 전송하지 않는다', () => {
        expect(shouldSubmitOnEnter({ key: 'a' })).toBe(false);
    });
    it('한글 조합 중의 Enter 는 전송하지 않는다(조합 확정용) — WebKit 의 keyCode 229 포함', () => {
        expect(shouldSubmitOnEnter({ key: 'Enter', isComposing: true })).toBe(false);
        expect(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 })).toBe(false);
    });
    it('여러 줄 입력란에서는 Shift+Enter 가 줄바꿈이다', () => {
        expect(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true }, { multiline: true })).toBe(false);
        expect(shouldSubmitOnEnter({ key: 'Enter' }, { multiline: true })).toBe(true);
    });
});

describe('keepStillPending — 자동 승인 뒤에도 서버에 남은 승인만 화면에 남긴다', () => {
    const cards = [{ approvalId: 'a' }, { approvalId: 'b' }, { approvalId: 'c' }];
    it('서버 대기 목록에 있는 카드만 남긴다(계속 묻는 호출)', () => {
        expect(keepStillPending(cards, [{ approvalId: 'b' }])).toEqual([{ approvalId: 'b' }]);
    });
    it('대기 목록이 비면 모두 지운다', () => {
        expect(keepStillPending(cards, [])).toEqual([]);
    });
    it('대기 목록을 못 받았으면 그대로 둔다(승인할 곳을 지우지 않는다)', () => {
        expect(keepStillPending(cards, null)).toBe(cards);
    });
});

describe('taskStatusLabelKey', () => {
    it('아는 상태는 번역 키로, 모르는 상태는 null(원값 표시)', () => {
        for (const s of ['pending', 'queued', 'running', 'paused', 'completed', 'failed', 'cancelled']) {
            expect(taskStatusLabelKey(s)).toBe(`statusRaw.${s}`);
        }
        expect(taskStatusLabelKey('weird')).toBeNull();
    });
});
