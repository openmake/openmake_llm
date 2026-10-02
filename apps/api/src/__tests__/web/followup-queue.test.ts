/** 답변 중 후속 메시지 대기열(apps/web/lib/followup-queue.ts) — 순수 함수라 api Jest 에서 검증한다. */
// apps/api tsconfig rootDir 밖 파일이라 require 로 런타임만 불러온다(ts-jest 가 변환)
interface Item { id: string; text: string }
const { enqueueFollowup, removeFollowup, nextFollowup, canQueueFollowup, FOLLOWUP_QUEUE_MAX } = require('../../../../web/lib/followup-queue') as {
    enqueueFollowup: (q: Item[], text: string, id: string) => { queue: Item[]; accepted: boolean };
    removeFollowup: (q: Item[], id: string) => Item[];
    nextFollowup: (q: Item[], end: 'done' | 'aborted' | 'error' | 'disconnected') => Item | null;
    canQueueFollowup: (s: { isGenerating: boolean; text: string; hasAttachments: boolean; agentTaskMode: boolean }) => boolean;
    FOLLOWUP_QUEUE_MAX: number;
};

describe('enqueueFollowup', () => {
    it('뒤에 붙이고, 앞뒤 공백은 뗀다', () => {
        const a = enqueueFollowup([], '  첫 번째  ', 'a');
        const b = enqueueFollowup(a.queue, '두 번째', 'b');
        expect(b).toEqual({ accepted: true, queue: [{ id: 'a', text: '첫 번째' }, { id: 'b', text: '두 번째' }] });
    });
    it('빈 메시지는 받지 않는다', () => {
        expect(enqueueFollowup([], '   ', 'a')).toEqual({ accepted: false, queue: [] });
    });
    it('상한을 넘으면 받지 않고 대기열은 그대로다', () => {
        let q: Item[] = [];
        for (let i = 0; i < FOLLOWUP_QUEUE_MAX; i++) q = enqueueFollowup(q, `m${i}`, `id${i}`).queue;
        const over = enqueueFollowup(q, '넘침', 'x');
        expect(over.accepted).toBe(false);
        expect(over.queue).toHaveLength(FOLLOWUP_QUEUE_MAX);
    });
    it('원본 배열을 바꾸지 않는다', () => {
        const q: Item[] = [];
        enqueueFollowup(q, 'a', 'a');
        expect(q).toEqual([]);
    });
});

describe('removeFollowup', () => {
    it('해당 항목만 뺀다', () => {
        expect(removeFollowup([{ id: 'a', text: '1' }, { id: 'b', text: '2' }], 'a')).toEqual([{ id: 'b', text: '2' }]);
    });
});

describe('nextFollowup — 답변이 끝난 방식에 따라 다음에 보낼 항목', () => {
    const q = [{ id: 'a', text: '1' }, { id: 'b', text: '2' }];
    it('정상 종료면 맨 앞 항목', () => {
        expect(nextFollowup(q, 'done')).toEqual({ id: 'a', text: '1' });
    });
    it('사용자가 정지했거나, 오류·연결 끊김으로 끝났으면 자동으로 보내지 않는다', () => {
        expect(nextFollowup(q, 'aborted')).toBeNull();
        expect(nextFollowup(q, 'error')).toBeNull();
        expect(nextFollowup(q, 'disconnected')).toBeNull();
    });
    it('비어 있으면 없음', () => {
        expect(nextFollowup([], 'done')).toBeNull();
    });
});

describe('canQueueFollowup — 답변 중에 대기시킬 수 있는 입력인가', () => {
    const base = { isGenerating: true, text: '다음 질문', hasAttachments: false, agentTaskMode: false };
    it('답변 중 + 텍스트만 있으면 가능', () => {
        expect(canQueueFollowup(base)).toBe(true);
    });
    it('답변 중이 아니면 대기열이 아니라 바로 보낸다', () => {
        expect(canQueueFollowup({ ...base, isGenerating: false })).toBe(false);
    });
    it('빈 입력·첨부가 있는 입력·에이전트 작업 모드는 대기시키지 않는다', () => {
        expect(canQueueFollowup({ ...base, text: '  ' })).toBe(false);
        expect(canQueueFollowup({ ...base, hasAttachments: true })).toBe(false);
        expect(canQueueFollowup({ ...base, agentTaskMode: true })).toBe(false);
    });
});
