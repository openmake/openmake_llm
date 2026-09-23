/**
 * Knowledge 도메인 실 DB 검증(K01 복제본 전용) — 운영(5432)에 절대 붙지 않는다.
 * TEST_DATABASE_URL 없으면 skip. cross-user 누출 0·조직 규칙·중복 해시 409·삭제 즉시 비노출·바인딩 소유권을 검증한다.
 *
 * `../db` 를 K01 풀로, conversation-sessions·membership-cache 를 mock 해 서비스가 K01 만 만지게 한다.
 * (repository 들은 module-level kdb() 를 쓰므로 주입 대신 모듈 mock 으로 라우팅한다.)
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

const CONN = process.env.TEST_DATABASE_URL;
const describeOrSkip = CONN ? describe : describe.skip;

// ── K01 풀로 db 모듈 대체 ──
jest.mock('../db', () => {
    const { Pool: PgPool } = require('pg');
    const pool = new PgPool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 });
    return {
        __esModule: true,
        __pool: pool,
        kdb: () => pool,
        inTransaction: async (fn: (c: unknown) => Promise<unknown>) => {
            const c = await pool.connect();
            try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
            catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; }
            finally { c.release(); }
        },
    };
});
// 조직 멤버십은 개인 scope 테스트 기준으로 항상 null(조직 규칙은 scope-policy.test 에서 순수 검증)
jest.mock('../../../services/org/membership-cache', () => ({ activeOrgFor: jest.fn(async () => null) }));
// 새 대화 생성은 K01 에 직접 세션 행을 넣는 mock 으로(운영 conversation-sessions 는 getPool→5432 라 부르면 안 된다)
jest.mock('../../../data/conversation-sessions', () => ({ createSession: jest.fn() }));

import { createSession } from '../../../data/conversation-sessions';
import { AppError } from '../../../utils/error-handler';
import { contentHash } from '../documents/storage';
import * as spaces from '../spaces/service';
import * as documents from '../documents/service';
import * as binding from '../conversations/binding-service';

const dbMock = jest.requireMock('../db') as { __pool: Pool };
const pool = dbMock.__pool;

const userA = `ktest-${randomUUID()}`;
const userB = `ktest-${randomUUID()}`;

async function insertUser(id: string): Promise<void> {
    await pool.query(
        `INSERT INTO users (id, username, password_hash, email, role, is_active) VALUES ($1, $1, 'x', $2, 'user', TRUE) ON CONFLICT (id) DO NOTHING`,
        [id, `${id}@test.local`],
    );
}

/** 직접 문서+현재버전 삽입(파일 저장 없이) — 삭제/중복 판정에 쓸 살아있는 문서 */
async function seedDocument(spaceId: string, createdBy: string, hash: string): Promise<string> {
    const docId = randomUUID();
    const verId = randomUUID();
    await pool.query(
        `INSERT INTO knowledge_documents (id, space_id, logical_name, current_version_id, status, created_by)
         VALUES ($1, $2, 'seed.txt', $3, 'ready', $4)`,
        [docId, spaceId, verId, createdBy],
    );
    await pool.query(
        `INSERT INTO knowledge_document_versions (id, document_id, content_hash, mime_type, original_filename, storage_ref, source_size, status, progress)
         VALUES ($1, $2, $3, 'text/plain', 'seed.txt', $1, 10, 'ready', 100)`,
        [verId, docId, hash],
    );
    return docId;
}

async function insertSession(id: string, userId: string): Promise<void> {
    await pool.query(
        `INSERT INTO conversation_sessions (id, user_id, title, created_at, updated_at) VALUES ($1, $2, '새 대화', NOW(), NOW())`,
        [id, userId],
    );
}

describeOrSkip('Knowledge 실 DB (K01)', () => {
    beforeAll(async () => {
        await insertUser(userA);
        await insertUser(userB);
        (createSession as jest.Mock).mockImplementation(async (uid: string) => {
            const id = randomUUID();
            await insertSession(id, uid);
            return { id };
        });
    });

    afterAll(async () => {
        // spaces 삭제가 documents·versions·chunks·bindings·jobs 를 CASCADE, users 삭제가 sessions 를 CASCADE
        await pool.query(`DELETE FROM knowledge_spaces WHERE scope_id = ANY($1::text[]) OR created_by = ANY($1::text[])`, [[userA, userB]]);
        await pool.query(`DELETE FROM users WHERE id = ANY($1::text[])`, [[userA, userB]]);
        await pool.end();
    });

    it('cross-user: B 는 A 의 Space 를 목록·상세·바인딩에서 볼 수 없다(누출 0)', async () => {
        const space = await spaces.createSpace(userA, { name: 'A-secret' });

        const listA = await spaces.listSpaces(userA);
        expect(listA.some((s) => s.id === space.id)).toBe(true);
        expect(listA.find((s) => s.id === space.id)?.canEdit).toBe(true);

        const listB = await spaces.listSpaces(userB);
        expect(listB.some((s) => s.id === space.id)).toBe(false);

        await expect(spaces.getSpaceDetail(userB, space.id)).rejects.toMatchObject({ statusCode: 404 });
        await expect(spaces.updateSpace(userB, space.id, { name: 'hijack' })).rejects.toMatchObject({ statusCode: 404 });
        await expect(spaces.deleteSpace(userB, space.id)).rejects.toMatchObject({ statusCode: 404 });
        await expect(binding.createBoundConversation(userB, space.id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('중복 해시 업로드는 409 DUPLICATE_DOCUMENT(파일명 무관)', async () => {
        const space = await spaces.createSpace(userA, { name: 'dedupe' });
        const buffer = Buffer.from(`hello knowledge ${randomUUID()}`);
        const hash = contentHash(buffer);
        await seedDocument(space.id, userA, hash);

        await expect(
            documents.uploadDocument(userA, space.id, {
                buffer, originalname: 'different-name.txt', mimetype: 'text/plain', size: buffer.length,
            }),
        ).rejects.toMatchObject({ code: 'DUPLICATE_DOCUMENT', statusCode: 409 });
    });

    it('Space 삭제는 즉시 비노출(tombstone) — 목록·상세에서 사라진다', async () => {
        const space = await spaces.createSpace(userA, { name: 'to-delete' });
        await spaces.deleteSpace(userA, space.id);

        const listA = await spaces.listSpaces(userA);
        expect(listA.some((s) => s.id === space.id)).toBe(false);
        await expect(spaces.getSpaceDetail(userA, space.id)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('문서 삭제는 즉시 상세에서 제외된다', async () => {
        const space = await spaces.createSpace(userA, { name: 'doc-delete' });
        const docId = await seedDocument(space.id, userA, contentHash(Buffer.from(randomUUID())));

        const before = await spaces.getSpaceDetail(userA, space.id);
        expect(before.documents.map((d) => d.id)).toContain(docId);

        await documents.deleteDocument(userA, space.id, docId);
        const after = await spaces.getSpaceDetail(userA, space.id);
        expect(after.documents.map((d) => d.id)).not.toContain(docId);
    });

    it('바인딩은 세션 소유권을 요구하고 resolveBoundSpace 는 소유자에게만 해석된다', async () => {
        const space = await spaces.createSpace(userA, { name: 'bind' });

        // B 소유 세션을 A 가 연결 시도 → 404
        const sessB = randomUUID();
        await insertSession(sessB, userB);
        await expect(binding.bindExistingConversation(userA, space.id, sessB)).rejects.toMatchObject({ statusCode: 404 });

        // A 소유 세션 연결 → resolveBoundSpace 는 A 에게만 값, B 에겐 null
        const sessA = randomUUID();
        await insertSession(sessA, userA);
        await binding.bindExistingConversation(userA, space.id, sessA);

        const boundA = await binding.resolveBoundSpace(userA, sessA);
        expect(boundA?.spaceId).toBe(space.id);
        expect(await binding.resolveBoundSpace(userB, sessA)).toBeNull();

        // 배너 엔드포인트도 소유자에게만 space
        expect((await binding.getBinding(userA, sessA)).space?.id).toBe(space.id);
        expect((await binding.getBinding(userB, sessA)).space).toBeNull();
    });

    it('새 대화 생성은 세션을 만들고 Space 에 바인딩한다', async () => {
        const space = await spaces.createSpace(userA, { name: 'new-conv' });
        const { sessionId } = await binding.createBoundConversation(userA, space.id);
        const bound = await binding.resolveBoundSpace(userA, sessionId);
        expect(bound?.spaceId).toBe(space.id);

        const detail = await spaces.getSpaceDetail(userA, space.id);
        expect(detail.conversations.map((c) => c.sessionId)).toContain(sessionId);
    });

    it('AppError 계층이 그대로 노출된다(스모크)', () => {
        expect(new AppError('x', 404).statusCode).toBe(404);
    });
});
