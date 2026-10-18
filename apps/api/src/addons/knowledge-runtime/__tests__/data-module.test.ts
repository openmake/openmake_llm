/**
 * Knowledge 데이터 의무 — Space 연결 대화는 메모리 격리 세션. 채팅 통합에서 옮겨 env 로 꺼도 지킨다(외부 검토 2026-10-18 A2).
 */
const query = jest.fn();
jest.mock('../db', () => ({ kdb: () => ({ query }) }));

import { knowledgeDataModule } from '../data-module';

describe('knowledgeDataModule.isMemoryIsolatedSession', () => {
    it('연결 행이 있으면 격리, 없으면 격리 아님', async () => {
        query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
        expect(await knowledgeDataModule.isMemoryIsolatedSession!('u1', 'sess1')).toBe(true);
        expect(await knowledgeDataModule.isMemoryIsolatedSession!('u1', 'sess2')).toBe(false);
        expect(query.mock.calls[0]).toEqual(['SELECT 1 FROM knowledge_conversation_bindings WHERE session_id = $1 LIMIT 1', ['sess1']]);
    });

    it('조회 실패는 던진다 — Base 가 격리로 처리한다', async () => {
        query.mockRejectedValueOnce(new Error('db down'));
        await expect(knowledgeDataModule.isMemoryIsolatedSession!('u1', 's')).rejects.toThrow('db down');
    });
});
