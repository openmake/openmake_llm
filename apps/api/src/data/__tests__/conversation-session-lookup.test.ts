/**
 * 대화 세션 요약 조회(Base 데이터 포트 conversationSessions.summaries 의 쿼리) — DB 는 쓰지 않고 풀을 mock 한다.
 * withMessagesOnly 를 켜면 일반 대화 목록(getSessionsByUserId)과 같은 규칙으로 메시지 0건 세션을 뺀다.
 */
const query = jest.fn();
jest.mock('../models/unified-database', () => ({ getPool: () => ({ query }) }));

import { getSessionSummaries } from '../conversation-session-lookup';

beforeEach(() => {
    jest.clearAllMocks();
    query.mockResolvedValue({ rows: [] });
});

describe('getSessionSummaries', () => {
    it('옵션 없이는 메시지 유무 조건이 없다', async () => {
        await getSessionSummaries(['s1']);
        expect(String(query.mock.calls[0][0])).not.toMatch(/EXISTS/);
        expect(query.mock.calls[0][1]).toEqual([['s1']]);
    });

    it('withMessagesOnly 면 메시지가 있는 세션만 고른다', async () => {
        await getSessionSummaries(['s1'], { withMessagesOnly: true });
        const sql = String(query.mock.calls[0][0]);
        expect(sql).toMatch(/AND EXISTS \(SELECT 1 FROM conversation_messages m WHERE m\.session_id = cs\.id\)/);
        expect(sql).toMatch(/ORDER BY cs\.updated_at DESC/);
        expect(query.mock.calls[0][1]).toEqual([['s1']]);
    });
});
