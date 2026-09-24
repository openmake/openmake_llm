/**
 * Knowledge 문서 서비스 — 업로드(검증·중복·저장·수집 큐)·삭제·재시도. Space 인가를 먼저 확인하고 한도는 프로필에서 읽는다.
 *
 * @module addons/knowledge-runtime/documents/service
 */
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { KnowledgeDocument } from '@openmake/shared-types';
import { AppError } from '../../../utils/error-handler';
import { inTransaction } from '../db';
import { enqueueJob } from '../jobs/queue';
import { actorFor } from '../config/scope-policy';
import { resolveSpaceProfiles, getDefaultLimits } from '../config/profiles';
import { getSpaceScopeRow, touchSpace } from '../spaces/repository';
import { contentHash, storeOriginal } from './storage';
import * as repo from './repository';

/** 확장자 → MIME 룩업(if-체인 금지). 브라우저가 generic octet-stream 을 보낼 때 보정. */
const EXT_TO_MIME: Readonly<Record<string, string>> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
};

export interface UploadFile {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
}

/** 업로드 파일의 유효 MIME 을 정한다 — 신고 MIME 이 허용되면 그대로, 아니면 확장자로 보정. 허용 목록 밖이면 null. */
function resolveMime(file: UploadFile, allowed: readonly string[]): string | null {
    const allowSet = new Set(allowed);
    if (allowSet.has(file.mimetype)) return file.mimetype;
    const ext = path.extname(file.originalname).toLowerCase();
    const mapped = EXT_TO_MIME[ext];
    return mapped && allowSet.has(mapped) ? mapped : null;
}

/** 쓰기 가능한 Space 해석 — 없으면 404(존재하지만 읽기전용이면 여전히 404, 누출 방지). */
async function requireWritableSpace(userId: string, spaceId: string) {
    const actor = await actorFor(userId);
    const space = await getSpaceScopeRow(actor, spaceId, 'write');
    if (!space) throw new AppError('Knowledge Space', 404, true, 'NOT_FOUND');
    return space;
}

export async function uploadDocument(userId: string, spaceId: string, file: UploadFile): Promise<KnowledgeDocument> {
    const space = await requireWritableSpace(userId, spaceId);
    const profiles = await resolveSpaceProfiles(space.config_profile_id);
    const { limits, chunker } = profiles;

    // ① MIME 검증(신고값 → 확장자 보정) ② 크기 ③ 문서 수 상한
    const mime = resolveMime(file, limits.allowedMimeTypes);
    if (!mime) throw new AppError('지원하지 않는 파일 형식입니다', 415, true, 'FAILED_VALIDATION');
    if (file.size > limits.maxFileBytes) {
        throw new AppError(`파일이 상한(${limits.maxFileBytes} bytes)을 초과했습니다`, 413, true, 'PAYLOAD_TOO_LARGE');
    }
    const liveCount = await repo.countLiveDocuments(spaceId);
    if (liveCount >= limits.maxDocumentsPerSpace) {
        throw new AppError(`문서 수 상한(${limits.maxDocumentsPerSpace})을 초과했습니다`, 409, true, 'DOCUMENT_LIMIT_EXCEEDED');
    }

    // ④ 내용 해시로 중복 판정(파일명 아님) → 409
    const hash = contentHash(file.buffer);
    if (await repo.hasLiveHash(spaceId, hash)) {
        throw new AppError('같은 내용의 문서가 이미 있습니다', 409, true, 'DUPLICATE_DOCUMENT');
    }

    // ⑤ 원본을 비공개 디렉터리에 저장 → 문서+버전 삽입+수집 큐를 한 트랜잭션에
    const logicalName = path.basename(file.originalname) || 'document';
    const documentId = randomUUID();
    const versionId = randomUUID();
    const storageRef = await storeOriginal(spaceId, versionId, file.buffer);
    await inTransaction(async (client) => {
        await repo.insertDocumentWithVersion(client, documentId, versionId, {
            spaceId, createdBy: userId, logicalName, contentHash: hash, mimeType: mime,
            originalFilename: logicalName, storageRef, sourceSize: file.size, chunkerProfileId: chunker.id,
        });
        await enqueueJob({ kind: 'ingest', documentVersionId: versionId }, client);
    });
    await touchSpace(spaceId).catch(() => undefined);

    return {
        id: documentId, name: logicalName, mimeType: mime, sizeBytes: file.size,
        status: 'uploaded', failureCode: null, progress: 0, pageCount: null,
        createdAt: new Date().toISOString(),
    };
}

export async function deleteDocument(userId: string, spaceId: string, documentId: string): Promise<void> {
    await requireWritableSpace(userId, spaceId);
    const limits = await getDefaultLimits();
    const runAfter = new Date(Date.now() + limits.purgeAfterDays * 24 * 60 * 60 * 1000);
    await inTransaction(async (client) => {
        const ok = await repo.softDeleteDocument(client, spaceId, documentId);
        if (!ok) throw new AppError('문서', 404, true, 'NOT_FOUND');
        await enqueueJob({ kind: 'cleanup', spaceId, runAfter }, client);
    });
}

export async function retryDocument(userId: string, spaceId: string, documentId: string): Promise<void> {
    await requireWritableSpace(userId, spaceId);
    const target = await repo.getRetryTarget(spaceId, documentId);
    if (!target) throw new AppError('문서', 404, true, 'NOT_FOUND');
    if (target.status !== 'failed') {
        throw new AppError('실패한 문서만 재시도할 수 있습니다', 409, true, 'NOT_RETRYABLE');
    }
    await inTransaction(async (client) => {
        await repo.resetVersionForRetry(client, target.documentId, target.versionId);
        await enqueueJob({ kind: 'ingest', documentVersionId: target.versionId }, client);
    });
}
