/**
 * K08 시딩 — 합성 사용자·조직·Space·세션을 고유 접두사로 만들고 코퍼스를 실 파이프라인으로 수집한다.
 * 대상 DB 는 K01 복제본뿐이다(러너가 DATABASE_URL 을 K01 로 고정한 뒤 이 모듈을 로드한다 → kdb()=getPool()=K01).
 * teardown 은 만든 것(사용자·조직·Space·세션·임베딩 index·원본 파일)을 전부 지우고 잔여 0 을 검증한다.
 *
 * @module addons/knowledge-runtime/evaluation/seeding
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kdb } from '../db';
import { clearOrgMembershipCache } from '../../../services/org/membership-cache';
import * as spaces from '../spaces/service';
import * as documents from '../documents/service';
import * as binding from '../conversations/binding-service';
import { KnowledgeWorker } from '../jobs/worker';
import { clearEmbeddingProviderCache } from '../embedding/provider';
import { contentHash, storeOriginal } from '../documents/storage';
import { enqueueJob } from '../jobs/queue';
import { CORPUS, SPACES, PERSONAS, ORGS } from './fixtures/corpus';
import type { CorpusDoc } from './types';
import { buildTextLayerPdf, scannedPdfBytes } from './fixtures/pdf';

export interface SeededDoc {
    documentId: string;
    versionId: string;
    spaceId: string;
    status: string;
    failureCode: string | null;
}

export interface SeedContext {
    prefix: string;
    personaIds: Record<string, string>;
    orgIds: Record<string, string>;
    spaceIds: Record<string, string>;
    docs: Record<string, SeededDoc>;
    /** spaceKey → 그 Space 에 바인딩된(소유자 소유) 세션 id (forged_binding 공격 대상) */
    boundSessionBySpace: Record<string, string>;
    /** personaKey → 바인딩 없는 세션 id (unbound 공격 대상) */
    unboundSessionByPersona: Record<string, string>;
    storageDir: string;
    teardown(): Promise<{ leftovers: number; detail: Record<string, number> }>;
}

const MIME_BY_FORMAT: Record<CorpusDoc['format'], string> = {
    txt: 'text/plain', md: 'text/markdown', 'pdf-text': 'application/pdf', 'pdf-scanned': 'application/pdf',
};

/** 코퍼스 문서를 실제 업로드 바이트로 실체화한다 */
async function materialize(doc: CorpusDoc): Promise<{ buffer: Buffer; mime: string }> {
    if (doc.format === 'pdf-text') return { buffer: await buildTextLayerPdf(doc.text), mime: 'application/pdf' };
    if (doc.format === 'pdf-scanned') return { buffer: scannedPdfBytes(), mime: 'application/pdf' };
    return { buffer: Buffer.from(doc.text, 'utf8'), mime: MIME_BY_FORMAT[doc.format] };
}

async function insertUser(id: string, activeOrgId?: string): Promise<void> {
    const prefs = activeOrgId ? JSON.stringify({ activeOrgId }) : '{}';
    await kdb().query(
        `INSERT INTO users (id, username, password_hash, email, role, is_active, preferences)
         VALUES ($1, $1, 'x', $2, 'user', TRUE, $3::jsonb)
         ON CONFLICT (id) DO UPDATE SET preferences = EXCLUDED.preferences`,
        [id, `${id}@k08.local`, prefs],
    );
}

async function insertOrg(id: string, createdBy: string): Promise<void> {
    await kdb().query(
        `INSERT INTO organizations (id, name, slug, created_by) VALUES ($1, $1, $1, $2) ON CONFLICT (id) DO NOTHING`,
        [id, createdBy],
    );
}

async function insertMember(orgId: string, userId: string, role: string): Promise<void> {
    await kdb().query(
        `INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [orgId, userId, role],
    );
}

async function insertSession(id: string, userId: string): Promise<void> {
    await kdb().query(
        `INSERT INTO conversation_sessions (id, user_id, title, created_at, updated_at) VALUES ($1, $2, 'K08', NOW(), NOW())`,
        [id, userId],
    );
}

/** 큐에 든 수집 작업을 전부 처리할 때까지 worker tick 을 돈다(안전 상한) */
async function drainJobs(worker: KnowledgeWorker, maxTicks: number): Promise<void> {
    for (let i = 0; i < maxTicks; i++) {
        const n = await worker.tick();
        if (n === 0) return;
    }
}

/** 수집된 버전의 현재 상태를 읽는다 */
async function readDocStatus(documentId: string): Promise<{ versionId: string; status: string; failureCode: string | null }> {
    const row = (await kdb().query<{ version_id: string; status: string; failure_code: string | null }>(
        `SELECT d.current_version_id AS version_id, v.status, v.failure_code
         FROM knowledge_documents d JOIN knowledge_document_versions v ON v.id = d.current_version_id
         WHERE d.id = $1`, [documentId],
    )).rows[0];
    return { versionId: row.version_id, status: row.status, failureCode: row.failure_code };
}

/**
 * 조직 scope 문서를 **직접 SQL** 로 시딩하고 실 파이프라인으로 수집한다(업로드 서비스의 쓰기 권한 검사 우회).
 * K01 복제본의 stale limits-default 프로필에는 orgWriteRoles 가 없어(개발 replica drift) 조직 Space 쓰기가 막힌다 —
 * K08 의 관심은 검색 **인가**(accessPredicate 읽기)이지 업로드 권한 경로(K07)가 아니므로, 조직 문서는 직접 주입한다.
 */
async function directIngest(
    worker: KnowledgeWorker, spaceId: string, createdBy: string, doc: CorpusDoc,
): Promise<{ documentId: string; versionId: string; status: string; failureCode: string | null }> {
    const { buffer, mime } = await materialize(doc);
    const documentId = randomUUID();
    const versionId = randomUUID();
    const storageRef = await storeOriginal(spaceId, versionId, buffer);
    await kdb().query(
        `INSERT INTO knowledge_documents (id, space_id, logical_name, current_version_id, source_type, status, created_by)
         VALUES ($1, $2, $3, $4, 'upload', 'processing', $5)`,
        [documentId, spaceId, doc.filename, versionId, createdBy],
    );
    await kdb().query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size, status, progress)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploaded', 0)`,
        [versionId, documentId, contentHash(buffer), mime, doc.filename, storageRef, buffer.length],
    );
    await enqueueJob({ kind: 'ingest', documentVersionId: versionId });
    await drainJobs(worker, 20);
    const st = await readDocStatus(documentId);
    return { documentId, versionId, status: st.status, failureCode: st.failureCode };
}

export async function seed(prefix: string): Promise<SeedContext> {
    clearEmbeddingProviderCache();
    const storageDir = await mkdtemp(join(tmpdir(), 'k08-store-'));
    process.env.KNOWLEDGE_STORAGE_DIR = storageDir;

    const personaIds: Record<string, string> = {};
    for (const p of Object.values(PERSONAS)) personaIds[p] = `${prefix}-u-${p}-${randomUUID().slice(0, 8)}`;
    const orgIds: Record<string, string> = {};
    for (const o of Object.values(ORGS)) orgIds[o] = `${prefix}-org-${o}-${randomUUID().slice(0, 8)}`;

    // 사용자 — orgOwner 의 활성 조직은 o1, orgOutsider 는 o2. owner·victim 은 조직 없음.
    await insertUser(personaIds[PERSONAS.owner]);
    await insertUser(personaIds[PERSONAS.victim]);
    await insertUser(personaIds[PERSONAS.orgOwner], orgIds[ORGS.o1]);
    await insertUser(personaIds[PERSONAS.orgOutsider], orgIds[ORGS.o2]);
    await insertOrg(orgIds[ORGS.o1], personaIds[PERSONAS.orgOwner]);
    await insertOrg(orgIds[ORGS.o2], personaIds[PERSONAS.orgOutsider]);
    await insertMember(orgIds[ORGS.o1], personaIds[PERSONAS.orgOwner], 'owner');
    await insertMember(orgIds[ORGS.o2], personaIds[PERSONAS.orgOutsider], 'owner');
    clearOrgMembershipCache();

    // Space 생성 — user scope 는 서비스 경유(실제 인가·scope 규칙), organization scope 는 직접 SQL(위 directIngest 주석 참고)
    const spaceIds: Record<string, string> = {};
    for (const sp of SPACES) {
        if (sp.scopeType === 'organization') {
            const id = randomUUID();
            await kdb().query(
                `INSERT INTO knowledge_spaces (id, scope_type, scope_id, created_by, name, status)
                 VALUES ($1, 'organization', $2, $3, $4, 'active')`,
                [id, orgIds[sp.ownerPersona], personaIds[PERSONAS.orgOwner], `${prefix}-${sp.name}`],
            );
            spaceIds[sp.key] = id;
        } else {
            const created = await spaces.createSpace(personaIds[sp.ownerPersona], { name: `${prefix}-${sp.name}`, scopeType: 'user' });
            spaceIds[sp.key] = created.id;
        }
    }

    // 코퍼스 수집(worker 로 실 파이프라인 처리) — user scope 는 업로드 서비스, org scope 는 직접 주입
    const worker = new KnowledgeWorker({});
    const docs: Record<string, SeededDoc> = {};
    for (const doc of CORPUS) {
        const sp = SPACES.find((s) => s.key === doc.spaceKey)!;
        let seeded: { documentId: string; versionId: string; status: string; failureCode: string | null };
        if (sp.scopeType === 'organization') {
            seeded = await directIngest(worker, spaceIds[doc.spaceKey], personaIds[PERSONAS.orgOwner], doc);
        } else {
            const { buffer, mime } = await materialize(doc);
            const created = await documents.uploadDocument(personaIds[sp.ownerPersona], spaceIds[doc.spaceKey], {
                buffer, originalname: doc.filename, mimetype: mime, size: buffer.length,
            });
            await drainJobs(worker, 20);
            const st = await readDocStatus(created.id);
            seeded = { documentId: created.id, versionId: st.versionId, status: st.status, failureCode: st.failureCode };
        }
        docs[doc.key] = { ...seeded, spaceId: spaceIds[doc.spaceKey] };
    }

    // 바인딩 세션(forged_binding 공격 대상) — victim→victim space, owner→alpha space
    const boundSessionBySpace: Record<string, string> = {};
    boundSessionBySpace.victim = (await binding.createBoundConversation(personaIds[PERSONAS.victim], spaceIds.victim)).sessionId;
    boundSessionBySpace.alpha = (await binding.createBoundConversation(personaIds[PERSONAS.owner], spaceIds.alpha)).sessionId;

    // 바인딩 없는 세션(unbound 공격 대상)
    const unboundSessionByPersona: Record<string, string> = {};
    for (const p of [PERSONAS.owner, PERSONAS.victim, PERSONAS.orgOwner]) {
        const sid = randomUUID();
        await insertSession(sid, personaIds[p]);
        unboundSessionByPersona[p] = sid;
    }

    const activeIndexIds = (await kdb().query<{ id: string }>(`SELECT id FROM knowledge_embedding_indexes`)).rows.map((r) => r.id);

    const teardown = async (): Promise<{ leftovers: number; detail: Record<string, number> }> => {
        const userIds = Object.values(personaIds);
        const orgs = Object.values(orgIds);
        // Space 삭제가 documents·versions·chunks·embeddings·bindings·jobs 를 CASCADE, users 삭제가 세션을 CASCADE.
        await kdb().query(`DELETE FROM knowledge_spaces WHERE created_by = ANY($1::text[]) OR scope_id = ANY($1::text[]) OR scope_id = ANY($2::text[])`, [userIds, orgs]);
        await kdb().query(`DELETE FROM knowledge_embedding_indexes WHERE id = ANY($1::text[])`, [activeIndexIds]);
        await kdb().query(`DELETE FROM organization_members WHERE org_id = ANY($1::text[])`, [orgs]);
        await kdb().query(`DELETE FROM organizations WHERE id = ANY($1::text[])`, [orgs]);
        await kdb().query(`DELETE FROM users WHERE id = ANY($1::text[])`, [userIds]);
        await rm(storageDir, { recursive: true, force: true }).catch(() => undefined);

        // 잔여 검증
        const detail: Record<string, number> = {};
        detail.users = Number((await kdb().query(`SELECT COUNT(*) n FROM users WHERE id = ANY($1::text[])`, [userIds])).rows[0].n);
        detail.spaces = Number((await kdb().query(`SELECT COUNT(*) n FROM knowledge_spaces WHERE created_by = ANY($1::text[]) OR scope_id = ANY($2::text[])`, [userIds, orgs])).rows[0].n);
        detail.sessions = Number((await kdb().query(`SELECT COUNT(*) n FROM conversation_sessions WHERE user_id = ANY($1::text[])`, [userIds])).rows[0].n);
        detail.orgs = Number((await kdb().query(`SELECT COUNT(*) n FROM organizations WHERE id = ANY($1::text[])`, [orgs])).rows[0].n);
        detail.indexes = Number((await kdb().query(`SELECT COUNT(*) n FROM knowledge_embedding_indexes WHERE id = ANY($1::text[])`, [activeIndexIds])).rows[0].n);
        const leftovers = Object.values(detail).reduce((a, b) => a + b, 0);
        return { leftovers, detail };
    };

    return { prefix, personaIds, orgIds, spaceIds, docs, boundSessionBySpace, unboundSessionByPersona, storageDir, teardown };
}
