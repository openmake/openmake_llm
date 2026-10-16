/**
 * Space 상세의 대화 목록 — 바인딩은 Knowledge 표에서, 제목·갱신 시각은 Base 데이터 포트에서 받는다(DB 없이 고정).
 */
jest.mock('../db', () => ({ kdb: jest.fn() }));
jest.mock('../../../runtime-ports/base-data-port', () => ({
    baseDataPort: { conversationSessions: { summaries: jest.fn() } },
}));

import * as db from '../db';
import { baseDataPort } from '../../../runtime-ports/base-data-port';
import { listConversationsForSpace } from '../spaces/repository';

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
        expect(summaries).toHaveBeenCalledWith(['s1', 's2']);
        expect(String(query.mock.calls[0][0])).not.toMatch(/conversation_sessions/);
        expect(query.mock.calls[0][1]).toEqual(['sp1']);
    });

    it('제목이 없는 세션은 빈 문자열, 삭제돼 포트가 돌려주지 않은 세션은 빠진다', async () => {
        query.mockResolvedValueOnce({ rows: [{ session_id: 's1' }, { session_id: 'gone' }] });
        summaries.mockResolvedValueOnce([{ id: 's1', title: null, updatedAt: '2026-10-16T01:00:00.000Z' }]);
        await expect(listConversationsForSpace('sp1')).resolves.toEqual([
            { session_id: 's1', title: '', updated_at: '2026-10-16T01:00:00.000Z' },
        ]);
    });

    it('연결된 대화가 없으면 빈 목록(포트는 빈 id 목록을 받는다)', async () => {
        query.mockResolvedValueOnce({ rows: [] });
        summaries.mockResolvedValueOnce([]);
        await expect(listConversationsForSpace('sp1')).resolves.toEqual([]);
        expect(summaries).toHaveBeenCalledWith([]);
    });
});
