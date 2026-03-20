/**
 * ============================================================
 * KB Repository + Routes 단위 테스트
 * ============================================================
 *
 * KBRepository 메서드 및 kb.routes.ts 핸들러를 모킹하여 테스트합니다.
 * DB 의존성 없이 단위 테스트로 실행됩니다.
 */



// ────────────────────────────────────────
// KBRepository 단위 테스트
// ────────────────────────────────────────

describe('KBRepository', () => {
    // mock pool & query
    const mockRows: Record<string, unknown>[] = [];
    let mockRowCount = 0;
    const mockQuery = jest.fn((_sql: string, _params?: unknown[]) => Promise.resolve({ rows: mockRows, rowCount: mockRowCount }));
    const mockPool = { query: mockQuery } as unknown;

    let KBRepository: typeof import('../data/repositories/kb-repository').KBRepository;

    beforeEach(async () => {
        mockQuery.mockClear();
        mockRows.length = 0;
        mockRowCount = 0;

        // Re-import to reset module state
        const mod = await import('../data/repositories/kb-repository');
        KBRepository = mod.KBRepository;
    });

    describe('createCollection', () => {
        it('INSERT 쿼리를 실행하고 매핑된 결과를 반환한다', async () => {
            const now = new Date().toISOString();
            const dbRow = {
                id: 'col-1',
                owner_user_id: 'user-1',
                name: 'Test Collection',
                description: null,
                visibility: 'private',
                created_at: now,
                updated_at: now,
            };
            mockQuery.mockResolvedValueOnce({ rows: [dbRow], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.createCollection('user-1', { name: 'Test Collection' });

            expect(result.id).toBe('col-1');
            expect(result.ownerUserId).toBe('user-1');
            expect(result.name).toBe('Test Collection');
            expect(result.description).toBeNull();
            expect(result.visibility).toBe('private');
            expect(result.createdAt).toBe(now);
            expect(mockQuery).toHaveBeenCalledTimes(1);

            const callArgs = mockQuery.mock.calls[0];
            expect(callArgs[0]).toContain('INSERT INTO knowledge_collections');
            expect(callArgs[1]).toEqual(['user-1', 'Test Collection', null, 'private']);
        });

        it('visibility 옵션이 전달되면 해당 값을 사용한다', async () => {
            const dbRow = {
                id: 'col-2',
                owner_user_id: 'user-1',
                name: 'Public KB',
                description: 'desc',
                visibility: 'public',
                created_at: '2026-01-01',
                updated_at: '2026-01-01',
            };
            mockQuery.mockResolvedValueOnce({ rows: [dbRow], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.createCollection('user-1', {
                name: 'Public KB',
                description: 'desc',
                visibility: 'public',
            });

            expect(result.visibility).toBe('public');
            const callArgs = mockQuery.mock.calls[0];
            expect(callArgs[1]).toEqual(['user-1', 'Public KB', 'desc', 'public']);
        });
    });

    describe('getCollection', () => {
        it('ID로 컬렉션을 조회하고 매핑한다', async () => {
            const dbRow = {
                id: 'col-1',
                owner_user_id: 'user-1',
                name: 'KB',
                description: 'test',
                visibility: 'private',
                created_at: '2026-01-01',
                updated_at: '2026-01-01',
            };
            mockQuery.mockResolvedValueOnce({ rows: [dbRow], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.getCollection('col-1');

            expect(result).not.toBeNull();
            expect(result!.id).toBe('col-1');
            expect(result!.ownerUserId).toBe('user-1');
        });

        it('존재하지 않으면 null을 반환한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.getCollection('nonexistent');
            expect(result).toBeNull();
        });
    });

    describe('listCollections', () => {
        it('사용자의 컬렉션 목록을 반환한다', async () => {
            const rows = [
                { id: 'c1', owner_user_id: 'u1', name: 'A', description: null, visibility: 'private', created_at: '2026-01-01', updated_at: '2026-01-02' },
                { id: 'c2', owner_user_id: 'u1', name: 'B', description: 'desc', visibility: 'public', created_at: '2026-01-01', updated_at: '2026-01-01' },
            ];
            mockQuery.mockResolvedValueOnce({ rows, rowCount: 2 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.listCollections('u1');

            expect(result).toHaveLength(2);
            expect(result[0].id).toBe('c1');
            expect(result[1].visibility).toBe('public');
        });

        it('컬렉션이 없으면 빈 배열을 반환한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.listCollections('u1');
            expect(result).toEqual([]);
        });
    });

    describe('updateCollection', () => {
        it('name만 업데이트하면 SET 절에 name만 포함된다', async () => {
            const dbRow = {
                id: 'c1', owner_user_id: 'u1', name: 'New Name',
                description: null, visibility: 'private',
                created_at: '2026-01-01', updated_at: '2026-01-02',
            };
            mockQuery.mockResolvedValueOnce({ rows: [dbRow], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.updateCollection('c1', { name: 'New Name' });

            expect(result).not.toBeNull();
            expect(result!.name).toBe('New Name');
            const sql = mockQuery.mock.calls[0][0] as string;
            expect(sql).toContain('name = $1');
            expect(sql).toContain('updated_at = NOW()');
        });

        it('업데이트할 필드가 없으면 getCollection을 호출한다', async () => {
            const dbRow = {
                id: 'c1', owner_user_id: 'u1', name: 'Original',
                description: null, visibility: 'private',
                created_at: '2026-01-01', updated_at: '2026-01-01',
            };
            // getCollection 호출을 위한 mock
            mockQuery.mockResolvedValueOnce({ rows: [dbRow], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.updateCollection('c1', {});

            expect(result).not.toBeNull();
            expect(result!.name).toBe('Original');
            // SELECT 쿼리가 호출됨 (UPDATE가 아님)
            const sql = mockQuery.mock.calls[0][0] as string;
            expect(sql).toContain('SELECT');
        });

        it('존재하지 않으면 null을 반환한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.updateCollection('nonexistent', { name: 'Test' });
            expect(result).toBeNull();
        });
    });

    describe('deleteCollection', () => {
        it('삭제 성공 시 true를 반환한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.deleteCollection('c1');
            expect(result).toBe(true);
        });

        it('존재하지 않으면 false를 반환한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.deleteCollection('nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('addDocument', () => {
        it('ON CONFLICT DO NOTHING으로 문서를 추가한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            await repo.addDocument('c1', 'doc-1');

            const sql = mockQuery.mock.calls[0][0] as string;
            expect(sql).toContain('INSERT INTO knowledge_collection_documents');
            expect(sql).toContain('ON CONFLICT');
            expect(mockQuery.mock.calls[0][1]).toEqual(['c1', 'doc-1']);
        });
    });

    describe('removeDocument', () => {
        it('삭제 성공 시 true를 반환한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.removeDocument('c1', 'doc-1');
            expect(result).toBe(true);
        });

        it('연결이 없으면 false를 반환한다', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.removeDocument('c1', 'doc-nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('listDocuments', () => {
        it('컬렉션의 문서 ID 목록을 반환한다', async () => {
            const rows = [{ document_id: 'doc-1' }, { document_id: 'doc-2' }];
            mockQuery.mockResolvedValueOnce({ rows, rowCount: 2 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.listDocuments('c1');

            expect(result).toEqual(['doc-1', 'doc-2']);
        });
    });

    describe('getCollectionsForDocument', () => {
        it('문서가 속한 컬렉션 ID 목록을 반환한다', async () => {
            const rows = [{ collection_id: 'c1' }, { collection_id: 'c2' }];
            mockQuery.mockResolvedValueOnce({ rows, rowCount: 2 });

            const repo = new KBRepository(mockPool as import('pg').Pool);
            const result = await repo.getCollectionsForDocument('doc-1');

            expect(result).toEqual(['c1', 'c2']);
        });
    });
});

// ────────────────────────────────────────
// KB Routes 입력 검증 테스트 (핸들러 로직만)
// ────────────────────────────────────────

describe('KB Routes - Input Validation', () => {
    /**
     * 실제 Express 라우터를 실행하지 않고,
     * 라우트 파일이 올바르게 export되는지 확인합니다.
     */
    it('kb.routes.ts가 올바르게 Router를 export한다', async () => {
        const mod = await import('../routes/kb.routes');
        expect(mod.default).toBeDefined();
        // Express Router는 함수
        expect(typeof mod.default).toBe('function');
    });

    it('KBRepository가 barrel export에 포함되어 있다', async () => {
        const mod = await import('../data/repositories/index');
        expect(mod.KBRepository).toBeDefined();
    });

    it('kbRouter가 routes/index barrel export에 포함되어 있다', async () => {
        const mod = await import('../routes/index');
        expect(mod.kbRouter).toBeDefined();
    });
});
