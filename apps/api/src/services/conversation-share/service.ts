/**
 * 대화 읽기 전용 공유 — snapshot·인가 서비스 (설계 §4~7).
 *
 * - 미리보기: 저장된 메시지만 일관된 snapshot(REPEATABLE READ)에서 읽어 문서를 만들고 서버에 보관한다.
 * - 게시: 클라이언트가 보낸 본문이 아니라 **보관한 미리보기 그대로** 옮긴다. 세션 행을 잠가 같은 세션의 게시·해제를
 *   직렬화하고, 소유권·org 멤버십·revision 을 다시 확인한다.
 * - 조회: 공유 레코드와 멤버십만 읽는다(원본 live join 없음). org 는 열람자·소유자 멤버 행을 FOR KEY SHARE 로 잠가
 *   탈퇴 commit 이후 시작된 조회를 항상 거절한다. 감사 기록이 commit 된 뒤에만 본문을 돌려준다.
 * - 엄격한 소유권: 관리자·조직 관리자도 남의 대화를 게시·수정하지 못한다. 관리자 조회 우회도 없다.
 *
 * @module services/conversation-share/service
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type {
    ConversationShareDocumentV1,
    ConversationSharePreviewRequest,
    ConversationSharePreviewResponse,
    ConversationShareRevokeResponse,
    ConversationShareState,
    ConversationShareStatusResponse,
    ConversationShareVisibility,
    SharedConversationView,
} from '@openmake/shared-types';
import { CONVERSATION_SHARE } from '../../config/conversation-share';
import type { ConversationShareRepository, ConversationShareRow, OwnedSessionRow, ShareTx } from '../../data/repositories/conversation-share-repository';
import { buildConversationShareDocument, measureConversationShareDocument } from './document';

export type ConversationShareErrorCode = 'NOT_FOUND' | 'INVALID' | 'EMPTY' | 'TOO_LARGE' | 'PREVIEW_STALE';

export class ConversationShareError extends Error {
    constructor(readonly code: ConversationShareErrorCode, message: string = code) {
        super(message);
        this.name = 'ConversationShareError';
    }
}

const VISIBILITIES: readonly ConversationShareVisibility[] = ['private', 'authenticated', 'link', 'org'];

/** 타이밍 공격 방어 — 기존 공유와 같은 규칙. 기대값이 없으면 항상 거절. */
export function safeTokenEqual(provided: string | undefined, expected: string | null | undefined): boolean {
    if (!expected || typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

/** 같은 origin 의 공유 페이지 경로 — 토큰은 소유자 응답에만 실린다. */
export function sharePath(shareId: string, token: string | null): string {
    return `/shared/conversation/${shareId}${token ? `?token=${token}` : ''}`;
}

export function allowedVisibilities(orgCount: number): ConversationShareVisibility[] {
    return orgCount > 0 ? [...VISIBILITIES] : VISIBILITIES.filter((v) => v !== 'org');
}

export type ShareAccessReason =
    | 'owner' | 'authenticated' | 'token' | 'member'
    | 'login_required' | 'not_owner' | 'token_mismatch' | 'not_member' | 'owner_not_member' | 'unknown_scope' | 'not_found';

/**
 * PURE 조회 인가 행렬(설계 §6). org 는 소유자도 멤버여야 하고(fail-closed), 토큰·관리자로 우회할 수 없다.
 * ownerIsMember·viewerIsMember 는 호출측이 같은 transaction 에서 잠근 현재 멤버십이다.
 */
export function decideShareAccess(p: {
    visibility: ConversationShareVisibility;
    ownerId: string;
    viewerId: string | null;
    tokenOk: boolean;
    ownerIsMember: boolean;
    viewerIsMember: boolean;
}): { allowed: boolean; reason: ShareAccessReason } {
    const isOwner = p.viewerId !== null && p.viewerId === p.ownerId;
    switch (p.visibility) {
        case 'private':
            if (isOwner) return { allowed: true, reason: 'owner' };
            return { allowed: false, reason: p.viewerId === null ? 'login_required' : 'not_owner' };
        case 'authenticated':
            return p.viewerId !== null ? { allowed: true, reason: 'authenticated' } : { allowed: false, reason: 'login_required' };
        case 'link':
            if (isOwner) return { allowed: true, reason: 'owner' };
            return p.tokenOk ? { allowed: true, reason: 'token' } : { allowed: false, reason: 'token_mismatch' };
        case 'org':
            if (p.viewerId === null) return { allowed: false, reason: 'login_required' };
            if (!p.ownerIsMember) return { allowed: false, reason: 'owner_not_member' };
            return p.viewerIsMember ? { allowed: true, reason: 'member' } : { allowed: false, reason: 'not_member' };
        default:
            return { allowed: false, reason: 'unknown_scope' };
    }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toState(row: ConversationShareRow): ConversationShareState {
    return {
        shareId: row.share_id,
        visibility: row.visibility,
        orgId: row.org_id,
        revision: Number(row.revision),
        capturedAt: new Date(row.snapshot_captured_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        path: sharePath(row.share_id, row.share_token),
    };
}

function assertOwned(session: OwnedSessionRow | undefined, ownerId: string): asserts session is OwnedSessionRow {
    if (!session || session.user_id === null || session.user_id !== ownerId) throw new ConversationShareError('NOT_FOUND');
}

function normalizeScope(input: ConversationSharePreviewRequest): { visibility: ConversationShareVisibility; orgId: string | null } {
    const visibility = input.visibility ?? 'private';
    if (!VISIBILITIES.includes(visibility)) throw new ConversationShareError('INVALID', 'visibility');
    if (visibility === 'org') {
        if (!input.orgId) throw new ConversationShareError('INVALID', 'orgId required');
        return { visibility, orgId: input.orgId };
    }
    if (input.orgId !== undefined) throw new ConversationShareError('INVALID', 'orgId not allowed');
    return { visibility, orgId: null };
}

export type ShareReadResult = { allowed: true; view: SharedConversationView } | { allowed: false };

export class ConversationShareService {
    constructor(private readonly repo: ConversationShareRepository) {}

    /** 공유 상태 + 서버가 계산한 선택지. */
    async status(ownerId: string, sessionId: string): Promise<ConversationShareStatusResponse> {
        assertOwned(await this.repo.getSession(sessionId), ownerId);
        const [row, organizations] = await Promise.all([
            this.repo.getShareBySession(sessionId),
            this.repo.listMemberOrganizations(ownerId),
        ]);
        return {
            share: row ? toState(row) : null,
            capabilities: { canShare: true, allowedVisibilities: allowedVisibilities(organizations.length), organizations },
        };
    }

    async preview(ownerId: string, sessionId: string, input: ConversationSharePreviewRequest): Promise<ConversationSharePreviewResponse> {
        const scope = normalizeScope(input);
        return this.repo.transaction(async (tx) => {
            await tx.repeatableRead();
            const session = await tx.getSession(sessionId);
            assertOwned(session, ownerId);
            if (scope.orgId) await this.requireOwnerMember(tx, scope.orgId, ownerId);

            const messages = await tx.loadMessages(sessionId, CONVERSATION_SHARE.MAX_MESSAGES + 1);
            if (messages.length > CONVERSATION_SHARE.MAX_MESSAGES) throw new ConversationShareError('TOO_LARGE', 'messages');
            const document = buildConversationShareDocument(session.title, messages);
            if (document.messages.length === 0) throw new ConversationShareError('EMPTY');
            if (measureConversationShareDocument(document) > CONVERSATION_SHARE.MAX_DOCUMENT_BYTES) {
                throw new ConversationShareError('TOO_LARGE', 'bytes');
            }

            const existing = await tx.getShareBySession(sessionId);
            const row = await tx.replacePreview({
                previewId: randomUUID(), sessionId, ownerUserId: ownerId, visibility: scope.visibility, orgId: scope.orgId,
                snapshot: document, ttlMs: CONVERSATION_SHARE.PREVIEW_TTL_MS, baseRevision: existing ? Number(existing.revision) : 0,
            });
            return {
                previewId: row.preview_id,
                document,
                capturedAt: new Date(row.captured_at).toISOString(),
                expiresAt: new Date(row.expires_at).toISOString(),
                visibility: row.visibility,
                orgId: row.org_id,
                baseRevision: Number(row.base_revision),
            };
        }, 'preview');
    }

    /** 확인한 미리보기를 게시 — 미리보기 삭제·공유 저장·감사가 한 transaction. */
    async publish(ownerId: string, sessionId: string, previewId: string): Promise<ConversationShareState> {
        return this.repo.transaction(async (tx) => {
            assertOwned(await tx.lockSession(sessionId), ownerId);
            const preview = UUID_RE.test(previewId) ? await tx.lockPreview(previewId) : undefined;
            if (!preview || preview.expired || preview.session_id !== sessionId || preview.owner_user_id !== ownerId) {
                throw new ConversationShareError('PREVIEW_STALE');
            }
            if (preview.org_id) await this.requireOwnerMember(tx, preview.org_id, ownerId);

            const existing = await tx.getShareBySession(sessionId, true);
            if ((existing ? Number(existing.revision) : 0) !== Number(preview.base_revision)) {
                throw new ConversationShareError('PREVIEW_STALE', 'revision');
            }
            const shareToken = preview.visibility !== 'link'
                ? null
                : existing?.visibility === 'link' && existing.share_token
                    ? existing.share_token
                    : randomBytes(CONVERSATION_SHARE.TOKEN_BYTES).toString('base64url');
            const fields = {
                visibility: preview.visibility, orgId: preview.org_id, shareToken,
                snapshot: preview.snapshot, capturedAt: new Date(preview.captured_at),
            };
            const row = existing
                ? await tx.replaceShare({ shareId: existing.share_id, ...fields })
                : await tx.insertShare({ shareId: randomUUID(), sessionId, ownerUserId: ownerId, ...fields });
            await tx.deletePreviewsForSession(sessionId);
            await tx.audit({
                action: existing ? 'conversation_share.update' : 'conversation_share.create',
                userId: ownerId,
                shareId: row.share_id,
                details: {
                    scopeBefore: existing?.visibility ?? null, scopeAfter: row.visibility, orgId: row.org_id,
                    revision: Number(row.revision), result: 'success',
                },
            });
            return toState(row);
        }, 'publish');
    }

    /** 멱등 해제 — 공유와 그 세션의 draft 를 함께 지운다(옛 draft 로 다시 게시 불가). */
    async revoke(ownerId: string, sessionId: string): Promise<ConversationShareRevokeResponse> {
        return this.repo.transaction(async (tx) => {
            assertOwned(await tx.lockSession(sessionId), ownerId);
            const existing = await tx.getShareBySession(sessionId, true);
            await tx.deletePreviewsForSession(sessionId);
            if (!existing) return { unshared: false };
            await tx.deleteShare(existing.share_id);
            await tx.audit({
                action: 'conversation_share.revoke',
                userId: ownerId,
                shareId: existing.share_id,
                details: {
                    scopeBefore: existing.visibility, scopeAfter: null, orgId: existing.org_id,
                    revision: Number(existing.revision), result: 'success',
                },
            });
            return { unshared: true };
        }, 'revoke');
    }

    /** 공유본 조회 — 허용·거절 모두 감사하고, commit 이후에만 본문을 돌려준다. 거절 사유는 호출측에 구별해 주지 않는다. */
    async read(viewerId: string | null, shareId: string, token: string | undefined): Promise<ShareReadResult> {
        return this.repo.transaction(async (tx) => {
            const validId = UUID_RE.test(shareId);
            const row = validId ? await tx.getShareById(shareId) : undefined;
            if (!row) {
                await tx.audit({
                    action: 'conversation_share.view', userId: viewerId, shareId: validId ? shareId : null,
                    details: { result: 'denied', reason: 'not_found' },
                });
                return { allowed: false } as const;
            }

            let ownerIsMember = false;
            let viewerIsMember = false;
            if (row.visibility === 'org' && row.org_id && viewerId !== null) {
                const members = await tx.lockMembers(row.org_id, [row.owner_user_id, viewerId]);
                ownerIsMember = members.has(row.owner_user_id);
                viewerIsMember = members.has(viewerId);
            }
            const decision = decideShareAccess({
                visibility: row.visibility, ownerId: row.owner_user_id, viewerId,
                tokenOk: row.visibility === 'link' && safeTokenEqual(token, row.share_token),
                ownerIsMember, viewerIsMember,
            });
            await tx.audit({
                action: 'conversation_share.view', userId: viewerId, shareId: row.share_id,
                details: {
                    scopeAfter: row.visibility, orgId: row.org_id, revision: Number(row.revision),
                    result: decision.allowed ? 'allowed' : 'denied', reason: decision.reason,
                },
            });
            if (!decision.allowed) return { allowed: false } as const;
            return {
                allowed: true,
                view: {
                    shareId: row.share_id,
                    visibility: row.visibility,
                    capturedAt: new Date(row.snapshot_captured_at).toISOString(),
                    updatedAt: new Date(row.updated_at).toISOString(),
                    document: row.snapshot as ConversationShareDocumentV1,
                },
            } as const;
        }, 'read');
    }

    private async requireOwnerMember(tx: ShareTx, orgId: string, ownerId: string): Promise<void> {
        const members = await tx.lockMembers(orgId, [ownerId]);
        if (!members.has(ownerId)) throw new ConversationShareError('NOT_FOUND', 'organization');
    }
}
