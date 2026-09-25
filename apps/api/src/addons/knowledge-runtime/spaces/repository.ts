/**
 * Knowledge Space 리포지토리 — raw SQL 만. 인가는 항상 `accessPredicate` 를 SQL WHERE 로 넣는다
 * (가져온 뒤 거르지 않는다). 서비스가 actor·프로필·DTO·오류를 조립한다.
 *
 * @module addons/knowledge-runtime/spaces/repository
 */
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { KnowledgeScopeType } from '@openmake/shared-types';
import { kdb } from '../db';
import { accessPredicate, type KnowledgeActor } from '../config/scope-policy';

export interface SpaceScopeRow {
    id: string;
    scope_type: KnowledgeScopeType;
    scope_id: string;
    config_profile_id: string | null;
}

export interface SpaceSummaryRow extends SpaceScopeRow {
    name: string;
    description: string | null;
    icon: string | null;
    instructions: string | null;
    last_used_at: string | null;
    updated_at: string;
    document_count: string;
    processing_count: string;
    failed_count: string;
    conversation_count: string;
}

/** 요약 카운트 SELECT 목록 — 목록·상세가 공유. deleted/삭제 문서는 세지 않는다. */
const SUMMARY_COLUMNS = `
    s.id, s.name, s.description, s.icon, s.instructions, s.scope_type, s.scope_id, s.last_used_at, s.updated_at,
    (SELECT COUNT(*) FROM knowledge_documents d WHERE d.space_id = s.id AND d.deleted_at IS NULL AND d.status <> 'deleted') AS document_count,
    (SELECT COUNT(*) FROM knowledge_documents d WHERE d.space_id = s.id AND d.deleted_at IS NULL AND d.status = 'processing') AS processing_count,
    (SELECT COUNT(*) FROM knowledge_documents d WHERE d.space_id = s.id AND d.deleted_at IS NULL AND d.status = 'failed') AS failed_count,
    (SELECT COUNT(*) FROM knowledge_conversation_bindings b WHERE b.space_id = s.id) AS conversation_count`;

/** 접근 가능한 Space 요약 목록(최근 사용 순) */
export async function listSpaceRows(actor: KnowledgeActor): Promise<SpaceSummaryRow[]> {
    const pred = accessPredicate(actor, 'read', 's', 1);
    const r = await kdb().query<SpaceSummaryRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM knowledge_spaces s WHERE ${pred.sql}
         ORDER BY COALESCE(s.last_used_at, s.updated_at) DESC`,
        pred.params,
    );
    return r.rows;
}

/** 접근 가능한 단일 Space 요약 — 없으면 null */
export async function getSpaceSummaryRow(actor: KnowledgeActor, id: string, mode: 'read' | 'write' = 'read'): Promise<SpaceSummaryRow | null> {
    const pred = accessPredicate(actor, mode, 's', 2);
    const r = await kdb().query<SpaceSummaryRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM knowledge_spaces s WHERE s.id = $1 AND ${pred.sql}`,
        [id, ...pred.params],
    );
    return r.rows[0] ?? null;
}

/** 인가된(read|write) Space 의 scope·프로필 행 — 문서/바인딩 서비스가 공유. 없으면 null */
export async function getSpaceScopeRow(actor: KnowledgeActor, id: string, mode: 'read' | 'write'): Promise<SpaceScopeRow | null> {
    const pred = accessPredicate(actor, mode, 's', 2);
    const r = await kdb().query<SpaceScopeRow>(
        `SELECT s.id, s.scope_type, s.scope_id, s.config_profile_id FROM knowledge_spaces s WHERE s.id = $1 AND ${pred.sql}`,
        [id, ...pred.params],
    );
    return r.rows[0] ?? null;
}

/** 이 scope 의 활성 Space 수 — maxSpacesPerScope 검사용 */
export async function countActiveSpacesInScope(scopeType: KnowledgeScopeType, scopeId: string): Promise<number> {
    const r = await kdb().query<{ n: string }>(
        `SELECT COUNT(*) AS n FROM knowledge_spaces WHERE scope_type = $1 AND scope_id = $2 AND deleted_at IS NULL AND status = 'active'`,
        [scopeType, scopeId],
    );
    return parseInt(r.rows[0]?.n ?? '0', 10);
}

export interface InsertSpaceInput {
    scopeType: KnowledgeScopeType;
    scopeId: string;
    createdBy: string;
    name: string;
    description: string | null;
    icon: string | null;
    instructions: string | null;
}

/** Space 생성 — 생성한 id 를 돌려준다. config_profile_id 는 비워 두고 해석 시 기본 프로필을 쓴다. */
export async function insertSpace(input: InsertSpaceInput): Promise<string> {
    const id = randomUUID();
    await kdb().query(
        `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, description, icon, instructions, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')`,
        [id, input.scopeType, input.scopeId, input.createdBy, input.name, input.description, input.icon, input.instructions],
    );
    return id;
}

/** 쓰기 가능한 Space 필드 갱신 — 갱신된 행 없으면 false(권한/부재). patch 에 준 필드만 SET. */
export async function updateSpaceFields(
    actor: KnowledgeActor,
    id: string,
    patch: { name?: string; description?: string | null; icon?: string | null; instructions?: string | null },
): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    if (patch.name !== undefined) { params.push(patch.name); sets.push(`name = $${params.length}`); }
    if (patch.description !== undefined) { params.push(patch.description); sets.push(`description = $${params.length}`); }
    if (patch.icon !== undefined) { params.push(patch.icon); sets.push(`icon = $${params.length}`); }
    if (patch.instructions !== undefined) { params.push(patch.instructions); sets.push(`instructions = $${params.length}`); }
    if (sets.length === 0) return false;
    const pred = accessPredicate(actor, 'write', 'knowledge_spaces', params.length + 1);
    const r = await kdb().query(
        `UPDATE knowledge_spaces SET ${sets.join(', ')}, updated_at = NOW()
         WHERE id = $1 AND ${pred.sql} RETURNING id`,
        [...params, ...pred.params],
    );
    return (r.rowCount ?? 0) > 0;
}

/** tombstone 전이(트랜잭션 안) — 쓰기 가능하고 아직 살아있는 Space 만. 성공 시 true. */
export async function tombstoneSpace(client: PoolClient, actor: KnowledgeActor, id: string): Promise<boolean> {
    const pred = accessPredicate(actor, 'write', 'knowledge_spaces', 2);
    const r = await client.query(
        `UPDATE knowledge_spaces SET status = 'tombstoned', deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND ${pred.sql} RETURNING id`,
        [id, ...pred.params],
    );
    return (r.rowCount ?? 0) > 0;
}

/** last_used_at 갱신(바인딩·새 대화 시) — 인가는 호출부가 이미 확인했다. */
export async function touchSpace(id: string): Promise<void> {
    await kdb().query(`UPDATE knowledge_spaces SET last_used_at = NOW() WHERE id = $1`, [id]);
}

export interface SpaceConversationRow { session_id: string; title: string; updated_at: string }

/** Space 에 연결된 대화 목록(최근 갱신 순) — 인가는 호출부가 Space 로 이미 확인했다. */
export async function listConversationsForSpace(spaceId: string): Promise<SpaceConversationRow[]> {
    const r = await kdb().query<SpaceConversationRow>(
        `SELECT b.session_id, cs.title, cs.updated_at
         FROM knowledge_conversation_bindings b
         JOIN conversation_sessions cs ON cs.id = b.session_id
         WHERE b.space_id = $1
         ORDER BY cs.updated_at DESC`,
        [spaceId],
    );
    return r.rows;
}
