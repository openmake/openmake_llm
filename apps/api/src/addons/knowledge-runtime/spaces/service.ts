/**
 * Knowledge Space 서비스 — actor 해석, 프로필 한도, DTO 매핑, 삭제(tombstone)+정리 큐. 라우트는 이 함수만 부른다.
 *
 * @module addons/knowledge-runtime/spaces/service
 */
import type {
    KnowledgeScopeType, KnowledgeSpaceSummary, KnowledgeSpaceDetail, KnowledgeDocument, KnowledgeConversation,
} from '@openmake/shared-types';
import { AppError } from '../../../utils/error-handler';
import { inTransaction } from '../db';
import { enqueueJob } from '../jobs/queue';
import { actorFor, creatableScopeId, SCOPE_POLICY, type KnowledgeActor } from '../config/scope-policy';
import { getDefaultLimits } from '../config/profiles';
import { listDocumentRowsForSpace } from '../documents/repository';
import * as repo from './repository';

/** 이 Space 를 현재 actor 가 편집(이름·자료·삭제)할 수 있는가 — scope 규칙표로 판정 */
function canEditScope(actor: KnowledgeActor, scopeType: KnowledgeScopeType, scopeId: string): boolean {
    const rule = SCOPE_POLICY[scopeType];
    return !!rule && rule.canWrite(actor) && rule.scopeIdFor(actor) === scopeId;
}

function toSummary(row: repo.SpaceSummaryRow, actor: KnowledgeActor): KnowledgeSpaceSummary {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        icon: row.icon,
        scopeType: row.scope_type,
        canEdit: canEditScope(actor, row.scope_type, row.scope_id),
        documentCount: parseInt(row.document_count, 10),
        conversationCount: parseInt(row.conversation_count, 10),
        processingCount: parseInt(row.processing_count, 10),
        failedCount: parseInt(row.failed_count, 10),
        lastUsedAt: row.last_used_at,
        updatedAt: row.updated_at,
    };
}

function toDocument(row: import('../documents/repository').DocumentDetailRow): KnowledgeDocument {
    return {
        id: row.id,
        name: row.logical_name,
        mimeType: row.mime_type,
        sizeBytes: parseInt(row.source_size, 10),
        status: row.status,
        failureCode: row.failure_code,
        progress: row.progress,
        pageCount: row.page_count,
        createdAt: row.created_at,
    };
}

export async function listSpaces(userId: string): Promise<KnowledgeSpaceSummary[]> {
    const actor = await actorFor(userId);
    const rows = await repo.listSpaceRows(actor);
    return rows.map((r) => toSummary(r, actor));
}

export async function createSpace(
    userId: string,
    input: { name: string; description?: string; icon?: string; scopeType?: KnowledgeScopeType },
): Promise<KnowledgeSpaceSummary> {
    const actor = await actorFor(userId);
    const scopeType: KnowledgeScopeType = input.scopeType ?? 'user';
    const scopeId = creatableScopeId(actor, scopeType);
    if (!scopeId) throw new AppError('이 범위에 Knowledge Space 를 만들 권한이 없습니다', 403, true, 'FORBIDDEN');

    const limits = await getDefaultLimits();
    const existing = await repo.countActiveSpacesInScope(scopeType, scopeId);
    if (existing >= limits.maxSpacesPerScope) {
        throw new AppError(`Space 수 상한(${limits.maxSpacesPerScope})을 초과했습니다`, 409, true, 'SPACE_LIMIT_EXCEEDED');
    }

    const id = await repo.insertSpace({
        scopeType, scopeId, createdBy: userId,
        name: input.name, description: input.description ?? null, icon: input.icon ?? null,
    });
    const row = await repo.getSpaceSummaryRow(actor, id);
    if (!row) throw new AppError('Space 생성 직후 조회에 실패했습니다', 500, true, 'INTERNAL_ERROR');
    return toSummary(row, actor);
}

export async function getSpaceDetail(userId: string, id: string): Promise<KnowledgeSpaceDetail> {
    const actor = await actorFor(userId);
    const row = await repo.getSpaceSummaryRow(actor, id);
    if (!row) throw new AppError('Knowledge Space', 404, true, 'NOT_FOUND');
    const [docRows, convRows] = await Promise.all([
        listDocumentRowsForSpace(id),
        repo.listConversationsForSpace(id),
    ]);
    const conversations: KnowledgeConversation[] = convRows.map((c) => ({ sessionId: c.session_id, title: c.title, updatedAt: c.updated_at }));
    return { ...toSummary(row, actor), documents: docRows.map(toDocument), conversations };
}

export async function updateSpace(
    userId: string,
    id: string,
    patch: { name?: string; description?: string | null; icon?: string | null },
): Promise<KnowledgeSpaceSummary> {
    const actor = await actorFor(userId);
    const ok = await repo.updateSpaceFields(actor, id, patch);
    if (!ok) throw new AppError('Knowledge Space', 404, true, 'NOT_FOUND');
    const row = await repo.getSpaceSummaryRow(actor, id, 'write');
    if (!row) throw new AppError('Knowledge Space', 404, true, 'NOT_FOUND');
    return toSummary(row, actor);
}

/** 삭제 = tombstone + deleted_at(즉시 비노출) + 유예 후 물리 정리 작업. 한 트랜잭션. */
export async function deleteSpace(userId: string, id: string): Promise<void> {
    const actor = await actorFor(userId);
    const limits = await getDefaultLimits();
    const runAfter = new Date(Date.now() + limits.purgeAfterDays * 24 * 60 * 60 * 1000);
    await inTransaction(async (client) => {
        const ok = await repo.tombstoneSpace(client, actor, id);
        if (!ok) throw new AppError('Knowledge Space', 404, true, 'NOT_FOUND');
        await enqueueJob({ kind: 'cleanup', spaceId: id, runAfter }, client);
    });
}
