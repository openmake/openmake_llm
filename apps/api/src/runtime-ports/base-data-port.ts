/**
 * Base 데이터 포트 — add-on 이 Base 소유 테이블(대화 세션·마이그레이션 기록)을 읽는 문 (설계 3차 §3 C2, 로드맵 작업 7).
 *
 * add-on 소스는 Base 테이블 이름을 SQL 로 쓰지 않는다(`__tests__/addons-no-base-table-sql.test.ts`). 대신 이 포트를 부른다.
 * actor 를 받는 함수는 **그 actor 의 것만** 돌려준다 — 세션은 user actor 만 소유하므로 org·system actor 는 빈 목록·false.
 * `ownerOf`·`summaries` 는 인가를 하지 않는다 — 호출부가 이미 상위 자원(예: add-on 의 작업공간)으로 인가를 끝낸 경우에만 쓴다.
 * 같은 DB·같은 풀의 **코드 경계**이며 물리 SQL 권한 격리를 뜻하지 않는다.
 *
 * @module runtime-ports/base-data-port
 */
import type { Actor } from '@openmake/plugin-contracts';
import { getSessionOwnerId, getSessionSummaries, listSessionIdsByOwner } from '../data/conversation-session-lookup';
import { isMigrationApplied } from '../data/migrations/runner';
import { getPool } from '../data/models/unified-database';
import { getUserExtensionNames } from '../data/user-extension-lookup';

export interface ConversationSessionSummary {
    id: string;
    title: string | null;
    /** ISO 8601 — `conversation_sessions.updated_at` 은 NOT NULL 이 아니라 null 일 수 있다 */
    updatedAt: string | null;
}

export interface ConversationSessionsPort {
    /** 이 actor 가 소유한 세션 id — user actor 만 소유한다 */
    listIdsForUser(actor: Actor): Promise<string[]>;
    /** 세션이 있고 이 actor(user) 소유인가 */
    exists(actor: Actor, sessionId: string): Promise<boolean>;
    /** 세션 소유자 id(익명·없는 세션은 null) — 인가 없음 */
    ownerOf(sessionId: string): Promise<string | null>;
    /** 세션 제목·갱신 시각(최근 갱신 순, 없는 id 는 빠짐) — 인가 없음 */
    summaries(sessionIds: readonly string[]): Promise<ConversationSessionSummary[]>;
}

export interface MigrationRecordsPort {
    /** 이 version(예: `addon:<id>:NNN`)이 적용 기록에 있는가 — 조회 실패(표 없음·DB 오류)는 던진다 */
    isApplied(version: string): Promise<boolean>;
}

export interface UserExtensionsPort {
    /** 확장 id → 이름(없는 id 는 빠짐) — 인가 없음: 호출부가 상위 자원으로 인가한 id 만 넘긴다 */
    namesByIds(ids: readonly string[]): Promise<Map<string, string>>;
}

export interface BaseDataPort {
    conversationSessions: ConversationSessionsPort;
    migrations: MigrationRecordsPort;
    userExtensions: UserExtensionsPort;
}

export const baseDataPort: BaseDataPort = {
    conversationSessions: {
        async listIdsForUser(actor) {
            return actor.kind === 'user' ? listSessionIdsByOwner(actor.userId) : [];
        },
        async exists(actor, sessionId) {
            if (actor.kind !== 'user') return false;
            return (await getSessionOwnerId(sessionId)) === actor.userId;
        },
        async ownerOf(sessionId) {
            return (await getSessionOwnerId(sessionId)) ?? null;
        },
        async summaries(sessionIds) {
            if (sessionIds.length === 0) return [];
            const rows = await getSessionSummaries(sessionIds);
            return rows.map((row) => ({ id: row.id, title: row.title, updatedAt: row.updated_at?.toISOString() ?? null }));
        },
    },
    migrations: {
        async isApplied(version) {
            return isMigrationApplied(getPool(), version);
        },
    },
    userExtensions: {
        async namesByIds(ids) {
            return getUserExtensionNames([...new Set(ids)]);
        },
    },
};
