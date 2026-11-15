/**
 * Space 상세의 대화 목록 — 바인딩은 Knowledge 표에서, 제목·갱신 시각은 Base 데이터 포트에서 받는다(DB 없이 고정).
 */
jest.mock('../db', () => ({ kdb: jest.fn() }));
jest.mock('../../../runtime-ports/base-data-port', () => ({
    baseDataPort: { conversationSessions: { summaries: jest.fn() } },
}));

import * as db from '../db';
import { baseDataPort } from '../../../runtime-ports/base-data-port';
import { countConversationsBySpace, listConversationsForSpace } from '../spaces/repository';

const query = jest.fn();
const summaries = baseDataPort.conversationSessions.summaries as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    (db.kdb as jest.Mock).mockReturnValue({ query });
});

describe('listConversationsForSpace', () => {
    it('바인딩 id 로 포트에서 제목·시각을 받아 최근 갱신 순 그대로 돌려준다', async () => {
        query.mockResolvedValueOnce({ rows: [{ session_id: 's1' }, { session_id: 's2' }] });
        summaries.mockResolvedValueOnce([
            { id: 's2', title: '둘째', updatedAt: '2026-10-16T02:00:00.000Z' },
            { id: 's1', title: '첫째', updatedAt: '2026-10-16T01:00:00.000Z' },
        ]);
        await expect(listConversationsForSpace('sp1')).resolves.toEqual([
            { session_id: 's2', title: '둘째', updated_at: '2026-10-16T02:00:00.000Z' },
            { session_id: 's1', title: '첫째', updated_at: '2026-10-16T01:00:00.000Z' },
        ]);
        expect(summaries).toHaveBeenCalledWith(['s1', 's2'], { withMessagesOnly: true });
        expect(String(query.mock.calls[0][0])).not.toMatch(/conversation_sessions/);
        expect(query.mock.calls[0][1]).toEqual(['sp1']);
    });

    it('제목·갱신 시각이 없는 세션은 null 그대로(종전 JOIN 과 같다), 삭제돼 포트가 돌려주지 않은 세션은 빠진다', async () => {
        query.mockResolvedValueOnce({ rows: [{ session_id: 's1' }, { session_id: 's3' }, { session_id: 'gone' }] });
        summaries.mockResolvedValueOnce([
            { id: 's1', title: null, updatedAt: '2026-10-16T01:00:00.000Z' },
            { id: 's3', title: null, updatedAt: null },
        ]);
        await expect(listConversationsForSpace('sp1')).resolves.toEqual([
            { session_id: 's1', title: null, updated_at: '2026-10-16T01:00:00.000Z' },
            { session_id: 's3', title: null, updated_at: null },
        ]);
    });

    it('연결된 대화가 없으면 빈 목록(포트는 빈 id 목록을 받는다)', async () => {
        query.mockResolvedValueOnce({ rows: [] });
        summaries.mockResolvedValueOnce([]);
        await expect(listConversationsForSpace('sp1')).resolves.toEqual([]);
        expect(summaries).toHaveBeenCalledWith([], { withMessagesOnly: true });
    });
});

describe('countConversationsBySpace', () => {
    it('바인딩을 한 번 읽고 포트(메시지 있는 세션만)로 걸러 Space 별로 센다 — 빈·삭제된 세션은 빠진다', async () => {
        query.mockResolvedValueOnce({ rows: [
            { space_id: 'sp1', session_id: 's1' },
            { space_id: 'sp1', session_id: 'empty' },
            { space_id: 'sp2', session_id: 's2' },
            { space_id: 'sp2', session_id: 'gone' },
        ] });
        summaries.mockResolvedValueOnce([
            { id: 's2', title: null, updatedAt: null },
            { id: 's1', title: null, updatedAt: null },
        ]);
        const counts = await countConversationsBySpace(['sp1', 'sp2', 'sp3']);
        expect(counts).toEqual(new Map([['sp1', 1], ['sp2', 1], ['sp3', 0]]));
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][1]).toEqual([['sp1', 'sp2', 'sp3']]);
        expect(String(query.mock.calls[0][0])).not.toMatch(/conversation_sessions|conversation_messages/);
        expect(summaries).toHaveBeenCalledTimes(1);
        expect(summaries).toHaveBeenCalledWith(['s1', 'empty', 's2', 'gone'], { withMessagesOnly: true });
    });

    it('빈 입력이면 조회하지 않고 빈 Map', async () => {
        await expect(countConversationsBySpace([])).resolves.toEqual(new Map());
        expect(query).not.toHaveBeenCalled();
        expect(summaries).not.toHaveBeenCalled();
    });
});
