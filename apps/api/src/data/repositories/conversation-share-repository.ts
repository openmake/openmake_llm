/**
 * @module data/repositories/conversation-share-repository
 * @description 대화 읽기 전용 공유(198) — `conversation_shares`·`conversation_share_previews`.
 *
 * 원자 연산(미리보기·게시·해제·조회 인가)은 `transaction()` 이 주는 한 연결(`ShareTx`)에서만 실행한다.
 * 감사 INSERT 도 같은 연결로 해서 공유 변경과 감사가 함께 commit/rollback 된다. 재시도는 SQL 한 문장이 아니라
 * transaction 전체 단위다(deadlock·직렬화 실패 포함 — retry-wrapper 정책).
 *
 * 잠금 순서(탈퇴 trigger 와 고리가 생기지 않게): 세션 → 미리보기 → 조직 멤버(FOR KEY SHARE) → 공유 행.
 */
import type { Pool } from 'pg';
import type { ConversationShareVisibility } from '@openmake/shared-types';
import type { AuditAction } from '../../config/audit-actions';
import { BaseRepository } from './base-repository';
import { withRetry, withTransaction, type TransactionClient } from '../retry-wrapper';

export interface ConversationShareRow {
    share_id: string;
    session_id: string;
    owner_user_id: string;
    visibility: ConversationShareVisibility;
    org_id: string | null;
    share_token: string | null;
    snapshot: unknown;
    snapshot_captured_at: Date;
    /** BIGINT — pg 는 문자열로 돌려준다 */
    revision: string;
    created_at: Date;
    updated_at: Date;
}

export interface ConversationSharePreviewRow {
    preview_id: string;
    session_id: string;
    owner_user_id: string;
    visibility: ConversationShareVisibility;
    org_id: string | null;
    snapshot: unknown;
    captured_at: Date;
    expires_at: Date;
    base_revision: string;
}

export interface OwnedSessionRow {
    id: string;
    user_id: string | null;
    title: string | null;
}

export interface ShareAuditEntry {
    action: Extract<AuditAction, `conversation_share.${string}`>;
    userId: string | null;
    shareId: string | null;
    details: Record<string, unknown>;
}

/** 한 transaction 연결 위의 연산. 밖으로 새지 않게 transaction() 콜백 안에서만 쓴다. */
export class ShareTx {
    constructor(private readonly client: TransactionClient) {}

    private async rows<T>(sql: string, params: unknown[]): Promise<T[]> {
        const r = await this.client.query(sql, params);
        return r.rows as T[];
    }

    /** 미리보기 일관성 — BEGIN 직후 첫 문장으로만 부른다. */
    async repeatableRead(): Promise<void> {
        await this.client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    }

    async getSession(sessionId: string): Promise<OwnedSessionRow | undefined> {
        return (await this.rows<OwnedSessionRow>(
            'SELECT id, user_id, title FROM conversation_sessions WHERE id = $1', [sessionId]))[0];
    }

    /** 같은 세션의 게시·해제를 직렬화한다. */
    async lockSession(sessionId: string): Promise<OwnedSessionRow | undefined> {
        return (await this.rows<OwnedSessionRow>(
            'SELECT id, user_id, title FROM conversation_sessions WHERE id = $1 FOR UPDATE', [sessionId]))[0];
    }

    /** 저장된 user·assistant 메시지를 (created_at, id) 순으로 limit 개까지. role·content 만 읽는다. */
    async loadMessages(sessionId: string, limit: number): Promise<Array<{ role: string; content: string }>> {
        return this.rows(
            `SELECT role, content FROM conversation_messages
              WHERE session_id = $1 AND role IN ('user', 'assistant')
              ORDER BY created_at ASC, id ASC LIMIT $2`,
            [sessionId, limit],
        );
    }

    /**
     * 현재 멤버인 사용자 ID — 행을 FOR KEY SHARE 로 잠가 이 transaction 이 끝날 때까지 탈퇴(DELETE)를 기다리게 한다.
     * 역할 변경(비키 UPDATE)은 막지 않는다.
     */
    async lockMembers(orgId: string, userIds: readonly string[]): Promise<Set<string>> {
        const unique = [...new Set(userIds)];
        const r = await this.rows<{ user_id: string }>(
            `SELECT user_id FROM organization_members
              WHERE org_id = $1 AND user_id = ANY($2::text[])
              ORDER BY user_id FOR KEY SHARE`,
            [orgId, unique],
        );
        return new Set(r.map((x) => x.user_id));
    }

    async getShareBySession(sessionId: string, forUpdate = false): Promise<ConversationShareRow | undefined> {
        return (await this.rows<ConversationShareRow>(
            `SELECT * FROM conversation_shares WHERE session_id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [sessionId]))[0];
    }

    async getShareById(shareId: string): Promise<ConversationShareRow | undefined> {
        return (await this.rows<ConversationShareRow>('SELECT * FROM conversation_shares WHERE share_id = $1', [shareId]))[0];
    }

    /** 세션당 한 건 — 다시 만들면 이전 draft 를 새 ID 로 교체한다. */
    async replacePreview(p: {
        previewId: string; sessionId: string; ownerUserId: string; visibility: ConversationShareVisibility;
        orgId: string | null; snapshot: unknown; ttlMs: number; baseRevision: number;
    }): Promise<ConversationSharePreviewRow> {
        return (await this.rows<ConversationSharePreviewRow>(
            `INSERT INTO conversation_share_previews
                (preview_id, session_id, owner_user_id, visibility, org_id, snapshot, captured_at, expires_at, base_revision)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW() + ($7::bigint * INTERVAL '1 millisecond'), $8)
             ON CONFLICT (session_id) DO UPDATE SET
                preview_id = EXCLUDED.preview_id, owner_user_id = EXCLUDED.owner_user_id,
                visibility = EXCLUDED.visibility, org_id = EXCLUDED.org_id, snapshot = EXCLUDED.snapshot,
                captured_at = EXCLUDED.captured_at, expires_at = EXCLUDED.expires_at, base_revision = EXCLUDED.base_revision
             RETURNING *`,
            [p.previewId, p.sessionId, p.ownerUserId, p.visibility, p.orgId, JSON.stringify(p.snapshot), p.ttlMs, p.baseRevision],
        ))[0]!;
    }

    /** 미리보기 + 만료 여부(DB 시계 기준). */
    async lockPreview(previewId: string): Promise<(ConversationSharePreviewRow & { expired: boolean }) | undefined> {
        return (await this.rows<ConversationSharePreviewRow & { expired: boolean }>(
            'SELECT *, expires_at <= NOW() AS expired FROM conversation_share_previews WHERE preview_id = $1 FOR UPDATE',
            [previewId],
        ))[0];
    }

    async deletePreviewsForSession(sessionId: string): Promise<void> {
        await this.client.query('DELETE FROM conversation_share_previews WHERE session_id = $1', [sessionId]);
    }

    async insertShare(p: {
        shareId: string; sessionId: string; ownerUserId: string; visibility: ConversationShareVisibility;
        orgId: string | null; shareToken: string | null; snapshot: unknown; capturedAt: Date;
    }): Promise<ConversationShareRow> {
        return (await this.rows<ConversationShareRow>(
            `INSERT INTO conversation_shares
                (share_id, session_id, owner_user_id, visibility, org_id, share_token, snapshot, snapshot_captured_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING *`,
            [p.shareId, p.sessionId, p.ownerUserId, p.visibility, p.orgId, p.shareToken, JSON.stringify(p.snapshot), p.capturedAt],
        ))[0]!;
    }

    async replaceShare(p: {
        shareId: string; visibility: ConversationShareVisibility; orgId: string | null;
        shareToken: string | null; snapshot: unknown; capturedAt: Date;
    }): Promise<ConversationShareRow> {
        return (await this.rows<ConversationShareRow>(
            `UPDATE conversation_shares
                SET visibility = $2, org_id = $3, share_token = $4, snapshot = $5::jsonb, snapshot_captured_at = $6,
                    revision = revision + 1, updated_at = NOW()
              WHERE share_id = $1 RETURNING *`,
            [p.shareId, p.visibility, p.orgId, p.shareToken, JSON.stringify(p.snapshot), p.capturedAt],
        ))[0]!;
    }

    async deleteShare(shareId: string): Promise<void> {
        await this.client.query('DELETE FROM conversation_shares WHERE share_id = $1', [shareId]);
    }

    /** 감사 — 같은 연결. 문서·제목·본문·토큰·URL 은 넣지 않는다(details 는 호출측 allowlist). */
    async audit(e: ShareAuditEntry): Promise<void> {
        await this.client.query(
            `INSERT INTO audit_logs (action, user_id, resource_type, resource_id, details)
             VALUES ($1, $2, 'conversation_share', $3, $4::jsonb)`,
            [e.action, e.userId, e.shareId, JSON.stringify(e.details)],
        );
    }
}

export class ConversationShareRepository extends BaseRepository {
    constructor(pool: Pool) {
        super(pool);
    }

    /** transaction 전체를 한 단위로 재시도한다. */
    transaction<T>(fn: (tx: ShareTx) => Promise<T>, operation: string): Promise<T> {
        return withRetry(
            () => withTransaction(this.pool as unknown as { connect: () => Promise<TransactionClient> }, (client) => fn(new ShareTx(client))),
            { operation: `conversation_share.${operation}` },
        );
    }

    /** 사용자가 현재 속한 조직(이름순) — 공유 범위 선택지. */
    async listMemberOrganizations(userId: string): Promise<Array<{ orgId: string; name: string }>> {
        const r = await this.query<{ id: string; name: string }>(
            `SELECT o.id, o.name FROM organization_members m JOIN organizations o ON o.id = m.org_id
              WHERE m.user_id = $1 ORDER BY o.name ASC, o.id ASC`,
            [userId],
        );
        return r.rows.map((x) => ({ orgId: x.id, name: x.name }));
    }

    async getSession(sessionId: string): Promise<OwnedSessionRow | undefined> {
        const r = await this.query<OwnedSessionRow>('SELECT id, user_id, title FROM conversation_sessions WHERE id = $1', [sessionId]);
        return r.rows[0];
    }

    async getShareBySession(sessionId: string): Promise<ConversationShareRow | undefined> {
        const r = await this.query<ConversationShareRow>('SELECT * FROM conversation_shares WHERE session_id = $1', [sessionId]);
        return r.rows[0];
    }
}
