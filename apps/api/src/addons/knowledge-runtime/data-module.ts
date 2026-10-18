/**
 * Knowledge add-on 의 데이터 의무 — 꺼져 있어도 호스트가 불러온다(addon-host/data-data.ts). 런타임 없이 SQL 만 쓴다.
 *
 * Space 에 연결된 대화는 메모리 격리 세션이다 — 그 대화의 사용자 메시지를 전역 user_memories 로 쓰지 않는다(일반 채팅으로의
 * 간접 누출 방지). 종전에는 채팅 통합의 보호 훅이라 env(ADDON_BUILTIN_DISABLED)로 끄면 통합째 빠져 격리가 풀렸다
 * (외부 검토 2026-10-18 A2). 데이터 의무로 옮겨 켜짐과 무관하게 지킨다. 판정 실패는 Base 가 격리로 처리한다.
 *
 * @module addons/knowledge-runtime/data-module
 */
import type { AddonDataModule } from '../../runtime-ports/addon-data';
import { kdb } from './db';

export const knowledgeDataModule: AddonDataModule = {
    async isMemoryIsolatedSession(_userId, sessionId) {
        const r = await kdb().query('SELECT 1 FROM knowledge_conversation_bindings WHERE session_id = $1 LIMIT 1', [sessionId]);
        return (r.rowCount ?? 0) > 0;
    },
};
