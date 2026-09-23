/**
 * 수집 파이프라인 상태머신 — uploaded→validating→extracting→chunking→embedding→verifying→ready | failed.
 *
 * 원자 게시: 청크·임베딩을 쓰고 **개수 검증**(활성 index 의 임베딩 수 == 청크 수)한 뒤에야
 * 한 트랜잭션에서 version.status='ready' + document.current_version_id/status='ready' 로 올린다.
 * 부분 임베딩 성공은 절대 검색되지 않는다(검색은 v.status='ready' + 현재 버전 + 활성 index 를 함께 요구).
 * 재시작·재시도 안전: 재수집은 먼저 그 버전의 기존 청크를 (cascade) 지우므로 UNIQUE(version, sequence)가 중복 0 을 보장한다.
 *
 * @module addons/knowledge-runtime/ingestion/pipeline
 */
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../../utils/logger';
import { kdb, inTransaction } from '../db';
import { resolveSpaceProfiles } from '../config/profiles';
import { countEmbeddings, ensureActiveIndex, insertEmbeddings, type KnowledgeIndex } from '../embedding/index-manager';
import { embedTexts, type EmbedFn } from '../embedding/provider';
import { readStoredFile } from '../documents/storage';
import { chunkerFor, type ProducedChunk } from './chunker-registry';
import { parserFor, supportedMimeTypes } from './parser-registry';
import { KNOWLEDGE_RUNTIME } from '../constants';
import { FAILURE_CODES, failureCodeOf, KnowledgeIngestError, type FailureCode } from './errors';

const logger = createLogger('KnowledgeIngest');

const MARKDOWN_MIME = 'text/markdown';

/** 단계별 진행률·기본 실패 코드 */
const STAGE = {
    validating: { progress: 5, fail: FAILURE_CODES.VALIDATION },
    extracting: { progress: 20, fail: FAILURE_CODES.EXTRACTION },
    chunking: { progress: 40, fail: FAILURE_CODES.CHUNKING },
    embedding: { progress: 60, fail: FAILURE_CODES.EMBEDDING },
    verifying: { progress: 85, fail: FAILURE_CODES.VERIFICATION },
} as const;
type Stage = keyof typeof STAGE;

export interface IngestDeps {
    embed?: EmbedFn;
    ensureIndex?: () => Promise<KnowledgeIndex>;
    readFile?: (storageRef: string) => Promise<Buffer>;
}

export interface IngestResult {
    status: 'ready' | 'failed';
    failureCode?: FailureCode;
    chunkCount?: number;
}

interface VersionContext {
    id: string;
    documentId: string;
    storageRef: string;
    mimeType: string;
    sourceSize: number;
    spaceId: string;
    configProfileId: string | null;
}

async function loadContext(versionId: string): Promise<VersionContext> {
    const r = await kdb().query<{
        id: string; document_id: string; storage_ref: string; mime_type: string;
        source_size: string; space_id: string; config_profile_id: string | null;
    }>(
        `SELECT v.id, v.document_id, v.storage_ref, v.mime_type, v.source_size,
                d.space_id, s.config_profile_id
           FROM knowledge_document_versions v
           JOIN knowledge_documents d ON d.id = v.document_id
           JOIN knowledge_spaces s ON s.id = d.space_id
          WHERE v.id = $1`,
        [versionId],
    );
    const row = r.rows[0];
    if (!row) throw new Error(`수집 대상 버전 없음: ${versionId}`);
    return {
        id: row.id, documentId: row.document_id, storageRef: row.storage_ref, mimeType: row.mime_type,
        sourceSize: Number(row.source_size), spaceId: row.space_id, configProfileId: row.config_profile_id,
    };
}

async function setStage(versionId: string, stage: Stage): Promise<void> {
    await kdb().query(
        `UPDATE knowledge_document_versions SET status = $2, progress = $3, updated_at = NOW() WHERE id = $1`,
        [versionId, stage, STAGE[stage].progress],
    );
}

async function markFailed(versionId: string, code: FailureCode): Promise<void> {
    await kdb().query(
        `UPDATE knowledge_document_versions SET status = 'failed', failure_code = $2, updated_at = NOW() WHERE id = $1`,
        [versionId, code],
    );
    await kdb().query(
        `UPDATE knowledge_documents SET status = 'failed', updated_at = NOW() WHERE id = (SELECT document_id FROM knowledge_document_versions WHERE id = $1)`,
        [versionId],
    );
}

/** 청크를 원자적으로 교체 — 기존 청크(및 cascade 임베딩)를 지우고 새로 넣는다 */
async function replaceChunks(versionId: string, chunks: ProducedChunk[]): Promise<void> {
    await inTransaction(async (client) => {
        await client.query(`DELETE FROM knowledge_chunks WHERE document_version_id = $1`, [versionId]);
        for (const c of chunks) {
            await client.query(
                `INSERT INTO knowledge_chunks
                   (id, document_version_id, sequence, content, content_hash, token_count, page_start, page_end, char_start, char_end, heading_path)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [randomUUID(), versionId, c.sequence, c.content, c.contentHash, c.tokenCount,
                    c.pageStart ?? null, c.pageEnd ?? null, c.charStart, c.charEnd, c.headingPath ?? null],
            );
        }
    });
}

/**
 * 한 버전을 수집한다. 실패는 상태 전이로 남기고 예외를 던지지 않는다(worker 가 결과로 재시도 판단).
 */
export async function ingestVersion(versionId: string, deps: IngestDeps = {}): Promise<IngestResult> {
    const embed = deps.embed ?? embedTexts;
    const ensureIndex = deps.ensureIndex ?? ensureActiveIndex;
    const readFile = deps.readFile ?? readStoredFile;
    let stage: Stage = 'validating';
    try {
        const ctx = await loadContext(versionId);
        const profiles = await resolveSpaceProfiles(ctx.configProfileId);

        // ── validating ──
        stage = 'validating';
        await setStage(versionId, stage);
        const parser = parserFor(ctx.mimeType);
        if (!parser || !supportedMimeTypes().includes(ctx.mimeType) || !profiles.limits.allowedMimeTypes.includes(ctx.mimeType)) {
            throw new KnowledgeIngestError(FAILURE_CODES.VALIDATION, `지원하지 않는 형식: ${ctx.mimeType}`);
        }
        if (ctx.sourceSize > profiles.limits.maxFileBytes) {
            throw new KnowledgeIngestError(FAILURE_CODES.VALIDATION, `파일이 너무 큽니다 (${ctx.sourceSize} > ${profiles.limits.maxFileBytes})`);
        }
        const buffer = await readFile(ctx.storageRef);

        // ── extracting ──
        stage = 'extracting';
        await setStage(versionId, stage);
        const parsed = await parser.parse(buffer, {
            minCharsPerPdfPage: profiles.limits.minCharsPerPdfPage,
            timeoutMs: KNOWLEDGE_RUNTIME.EXTRACT_TIMEOUT_MS,
        });
        await kdb().query(
            `UPDATE knowledge_document_versions
                SET parser_id = $2, parser_version = $3, extracted_chars = $4, page_count = $5, updated_at = NOW()
              WHERE id = $1`,
            [versionId, parsed.parserId, parsed.parserVersion, parsed.text.length, parsed.pageCount ?? null],
        );

        // ── chunking ──
        stage = 'chunking';
        await setStage(versionId, stage);
        const strategy = chunkerFor(profiles.chunker.strategy);
        if (!strategy) throw new KnowledgeIngestError(FAILURE_CODES.CHUNKING, `알 수 없는 청커 전략: ${profiles.chunker.strategy}`);
        const chunks = strategy.chunk({
            text: parsed.text, profile: profiles.chunker, pages: parsed.pages, markdown: ctx.mimeType === MARKDOWN_MIME,
        });
        await replaceChunks(versionId, chunks);

        // ── embedding ──
        stage = 'embedding';
        await setStage(versionId, stage);
        const index = await ensureIndex();
        const chunkRows = (await kdb().query<{ id: string; content: string }>(
            `SELECT id, content FROM knowledge_chunks WHERE document_version_id = $1 ORDER BY sequence`,
            [versionId],
        )).rows;
        const vectors = chunkRows.length > 0 ? await embed(chunkRows.map((r) => r.content)) : [];
        if (vectors.length !== chunkRows.length) {
            throw new KnowledgeIngestError(FAILURE_CODES.EMBEDDING, `임베딩 개수 불일치 (${vectors.length} vs ${chunkRows.length})`);
        }
        if (chunkRows.length > 0) {
            await inTransaction(async (client) => {
                await insertEmbeddings(client, index.id, chunkRows.map((r, i) => ({ chunkId: r.id, vector: vectors[i] })));
            });
        }

        // ── verifying ──
        stage = 'verifying';
        await setStage(versionId, stage);
        const embedded = await countEmbeddings(index.id, chunkRows.map((r) => r.id));
        if (embedded !== chunkRows.length) {
            throw new KnowledgeIngestError(FAILURE_CODES.VERIFICATION, `임베딩 검증 실패 (${embedded}/${chunkRows.length})`);
        }

        // ── 원자 게시 ──
        await inTransaction(async (client) => {
            await client.query(
                `UPDATE knowledge_document_versions SET status = 'ready', chunker_profile_id = $2, progress = 100, failure_code = NULL, updated_at = NOW() WHERE id = $1`,
                [versionId, profiles.chunker.id],
            );
            await client.query(
                `UPDATE knowledge_documents SET current_version_id = $2, status = 'ready', updated_at = NOW() WHERE id = $1`,
                [ctx.documentId, versionId],
            );
        });
        logger.info(`수집 완료: version=${versionId} chunks=${chunkRows.length}`);
        return { status: 'ready', chunkCount: chunkRows.length };
    } catch (err) {
        const code = failureCodeOf(err, STAGE[stage].fail);
        logger.warn(`수집 실패: version=${versionId} stage=${stage} code=${code} — ${err instanceof Error ? err.message : String(err)}`);
        await markFailed(versionId, code).catch((e) => logger.warn('실패 상태 기록 실패(무시):', e));
        return { status: 'failed', failureCode: code };
    }
}
