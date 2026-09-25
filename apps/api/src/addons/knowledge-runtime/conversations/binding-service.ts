/**
 * 대화 ↔ Space 바인딩 — 채팅 턴의 권한 근거(클라이언트 spaceId 가 아니다). 한 세션은 최대 한 Space 에 속한다.
 *
 * `resolveBoundSpace` 는 채팅 통합 에이전트가 매 턴 부르는 진입점 — 소유(session.user_id)+읽기(space accessPredicate)
 * 인가를 **한 SQL** 로 한 번에 확인한다. 인가 안 되면 null(존재를 누출하지 않는다).
 *
 * @module addons/knowledge-runtime/conversations/binding-service
 */
import type { KnowledgeBindingResponse } from '@openmake/shared-types';
import { AppError } from '../../../utils/error-handler';
import { createSession } from '../../../data/conversation-sessions';
import { kdb } from '../db';
import { actorFor, accessPredicate } from '../config/scope-policy';
import { getSpaceScopeRow, touchSpace } from '../spaces/repository';

export interface BoundSpace {
    spaceId: string;
    name: string;
    icon: string | null;
    instructions: string | null;
    configProfileId: string | null;
}

/** 소유+읽기 인가를 한 SQL 로 확인해 세션에 연결된 Space 를 돌려준다(없거나 인가 안 되면 null). */
export async function resolveBoundSpace(userId: string, sessionId: string): Promise<BoundSpace | null> {
    const actor = await actorFor(userId);
    const pred = accessPredicate(actor, 'read', 's', 3);
    const r = await kdb().query<{ id: string; name: string; icon: string | null; instructions: string | null; config_profile_id: string | null }>(
        `SELECT s.id, s.name, s.icon, s.instructions, s.config_profile_id
         FROM knowledge_conversation_bindings b
         JOIN conversation_sessions cs ON cs.id = b.session_id
         JOIN knowledge_spaces s ON s.id = b.space_id
         WHERE b.session_id = $1 AND cs.user_id = $2 AND ${pred.sql}`,
        [sessionId, userId, ...pred.params],
    );
    const row = r.rows[0];
    return row ? { spaceId: row.id, name: row.name, icon: row.icon, instructions: row.instructions, configProfileId: row.config_profile_id } : null;
}

/** 배너용 — 소유+읽기 인가된 경우만 space, 아니면 null(누출 금지). */
export async function getBinding(userId: string, sessionId: string): Promise<KnowledgeBindingResponse> {
    const bound = await resolveBoundSpace(userId, sessionId);
    return { space: bound ? { id: bound.spaceId, name: bound.name, icon: bound.icon } : null };
}

/** 새 대화를 만들어 Space 에 연결 — Space 는 읽기 가능해야 한다. 반환은 새 세션 id. */
export async function createBoundConversation(userId: string, spaceId: string): Promise<{ sessionId: string }> {
    const actor = await actorFor(userId);
    const space = await getSpaceScopeRow(actor, spaceId, 'read');
    if (!space) throw new AppError('프로젝트', 404, true, 'NOT_FOUND');
    // 기본 제목으로 만들어 일반 새 대화처럼 동작한다(첫 메시지에서 클라이언트가 제목을 갱신).
    const session = await createSession(userId);
    await kdb().query(
        `INSERT INTO knowledge_conversation_bindings (session_id, space_id, bound_by) VALUES ($1, $2, $3)`,
        [session.id, spaceId, userId],
    );
    await touchSpace(spaceId).catch(() => undefined);
    return { sessionId: session.id };
}

/** 기존(내가 소유한) 세션을 Space 에 연결 — 세션당 하나의 Space(upsert). */
export async function bindExistingConversation(userId: string, spaceId: string, sessionId: string): Promise<void> {
    const actor = await actorFor(userId);
    const space = await getSpaceScopeRow(actor, spaceId, 'read');
    if (!space) throw new AppError('프로젝트', 404, true, 'NOT_FOUND');

    const owner = await kdb().query<{ user_id: string | null }>(
        `SELECT user_id FROM conversation_sessions WHERE id = $1`,
        [sessionId],
    );
    if (!owner.rows[0] || owner.rows[0].user_id !== userId) {
        throw new AppError('대화', 404, true, 'NOT_FOUND');
    }
    await kdb().query(
        `INSERT INTO knowledge_conversation_bindings (session_id, space_id, bound_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id) DO UPDATE SET space_id = EXCLUDED.space_id, bound_by = EXCLUDED.bound_by`,
        [sessionId, spaceId, userId],
    );
    await touchSpace(spaceId).catch(() => undefined);
}

/**
 * 이 세션이 어떤 Space 에든 연결돼 있는가 — 메모리 격리 판정용(값싼 존재 확인, 권한 재확인 없음).
 * "연결돼 있으면 격리" 로 보수적으로 본다(그 대화 문맥이 전역 메모리로 새 나가지 않게).
 */
export async function sessionHasBinding(sessionId: string): Promise<boolean> {
    const r = await kdb().query(
        `SELECT 1 FROM knowledge_conversation_bindings WHERE session_id = $1 LIMIT 1`,
        [sessionId],
    );
    return (r.rowCount ?? 0) > 0;
}

/** 이 사용자의 대화 중 Space 에 연결된 세션 id 목록 — 사이드바 "최근 대화" 에서 숨길 대상. */
export async function listBoundSessionIdsForUser(userId: string): Promise<string[]> {
    const r = await kdb().query<{ session_id: string }>(
        `SELECT b.session_id
         FROM knowledge_conversation_bindings b
         JOIN conversation_sessions cs ON cs.id = b.session_id
         WHERE cs.user_id = $1`,
        [userId],
    );
    return r.rows.map((row) => row.session_id);
}

/** 연결 해제 — 내가 소유한 세션의 바인딩만 지운다. 없으면 404. */
export async function unbindConversation(userId: string, sessionId: string): Promise<void> {
    const r = await kdb().query(
        `DELETE FROM knowledge_conversation_bindings b
         USING conversation_sessions cs
         WHERE b.session_id = $1 AND cs.id = b.session_id AND cs.user_id = $2`,
        [sessionId, userId],
    );
    if ((r.rowCount ?? 0) === 0) throw new AppError('대화 연결', 404, true, 'NOT_FOUND');
}
