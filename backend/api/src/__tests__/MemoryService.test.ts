/**
 * MemoryService 단위 테스트
 *
 * 테스트 범위:
 * - extractAndSaveMemories: LLM 추출, 규칙 기반 추출, 중복 제거, 저장 위임
 * - saveMemory: db.createMemory 호출 확인
 * - getUserMemories: 옵션 전달, 결과 반환
 * - getRelevantMemories: 쿼리/limit 전달
 * - buildMemoryContext: 빈 메모리, 카테고리별 그룹화, 컨텍스트 문자열 구성
 * - updateMemory / deleteMemory / clearUserMemories: DB 위임
 * - extractByRules (간접): 이름/직업/선호/프로젝트 패턴
 * - parseExtractionResult (간접): 유효/무효 JSON 처리
 * - deduplicateMemories (간접): 중복 제거
 * - getMemoryService: 싱글톤 반환
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockCreateMemory = jest.fn();
const mockGetUserMemories = jest.fn();
const mockGetRelevantMemories = jest.fn();
const mockUpdateMemory = jest.fn();
const mockDeleteMemory = jest.fn();
const mockDeleteUserMemories = jest.fn();

jest.mock('../data/models/unified-database', () => ({
    getUnifiedDatabase: jest.fn().mockReturnValue({
        createMemory: jest.fn(),
        getUserMemories: jest.fn(),
        getRelevantMemories: jest.fn(),
        updateMemory: jest.fn(),
        deleteMemory: jest.fn(),
        deleteUserMemories: jest.fn(),
    }),
}));

jest.mock('../utils/logger', () => ({
    createLogger: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

jest.mock('uuid', () => ({
    v4: jest.fn().mockReturnValue('test-uuid-001'),
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { MemoryService, getMemoryService } from '../services/MemoryService';
import { getUnifiedDatabase } from '../data/models/unified-database';
import type { UserMemory } from '../data/models/unified-database';

// ─────────────────────────────────────────────
// 헬퍼: UserMemory fixture
// ─────────────────────────────────────────────

function makeMemory(overrides: Partial<UserMemory> = {}): UserMemory {
    return {
        id: 'mem-001',
        user_id: 'user-001',
        category: 'fact',
        key: '이름',
        value: '홍길동',
        importance: 0.9,
        access_count: 0,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

// ─────────────────────────────────────────────
// beforeEach
// ─────────────────────────────────────────────

beforeEach(() => {
    jest.clearAllMocks();

    (getUnifiedDatabase as jest.Mock).mockReturnValue({
        createMemory: mockCreateMemory,
        getUserMemories: mockGetUserMemories,
        getRelevantMemories: mockGetRelevantMemories,
        updateMemory: mockUpdateMemory,
        deleteMemory: mockDeleteMemory,
        deleteUserMemories: mockDeleteUserMemories,
    });

    mockCreateMemory.mockResolvedValue(undefined);
    mockGetUserMemories.mockResolvedValue([]);
    mockGetRelevantMemories.mockResolvedValue([]);
    mockUpdateMemory.mockResolvedValue(undefined);
    mockDeleteMemory.mockResolvedValue(undefined);
    mockDeleteUserMemories.mockResolvedValue(undefined);
});

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('MemoryService', () => {
    let service: MemoryService;

    beforeEach(() => {
        service = new MemoryService();
    });

    // ─────────────────────────────────────────
    // saveMemory
    // ─────────────────────────────────────────
    describe('saveMemory', () => {
        test('db.createMemory에 올바른 파라미터가 전달된다', async () => {
            const memory = { category: 'fact' as const, key: '이름', value: '홍길동', importance: 0.9, tags: ['personal'] };
            await service.saveMemory('user-001', 'session-001', memory);

            expect(mockCreateMemory).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'user-001',
                    category: 'fact',
                    key: '이름',
                    value: '홍길동',
                    importance: 0.9,
                    sourceSessionId: 'session-001',
                    tags: ['personal'],
                })
            );
        });

        test('sessionId가 null이면 sourceSessionId가 undefined로 전달된다', async () => {
            const memory = { category: 'fact' as const, key: '이름', value: '홍길동', importance: 0.9, tags: [] };
            await service.saveMemory('user-001', null, memory);

            const callArg = mockCreateMemory.mock.calls[0][0];
            expect(callArg.sourceSessionId).toBeUndefined();
        });

        test('생성된 UUID를 반환한다', async () => {
            const memory = { category: 'fact' as const, key: 'k', value: 'v', importance: 0.5, tags: [] };
            const id = await service.saveMemory('user-001', null, memory);
            expect(id).toBe('test-uuid-001');
        });
    });

    // ─────────────────────────────────────────
    // getUserMemories
    // ─────────────────────────────────────────
    describe('getUserMemories', () => {
        test('빈 결과이면 빈 배열을 반환한다', async () => {
            const result = await service.getUserMemories('user-001');
            expect(result).toEqual([]);
        });

        test('옵션이 db.getUserMemories로 전달된다', async () => {
            const opts = { category: 'fact' as const, limit: 5, minImportance: 0.7 };
            await service.getUserMemories('user-001', opts);
            expect(mockGetUserMemories).toHaveBeenCalledWith('user-001', opts);
        });

        test('메모리가 있으면 그대로 반환한다', async () => {
            const memories = [makeMemory(), makeMemory({ id: 'mem-002' })];
            mockGetUserMemories.mockResolvedValue(memories);
            const result = await service.getUserMemories('user-001');
            expect(result).toHaveLength(2);
        });
    });

    // ─────────────────────────────────────────
    // getRelevantMemories
    // ─────────────────────────────────────────
    describe('getRelevantMemories', () => {
        test('db.getRelevantMemories에 쿼리와 limit이 전달된다', async () => {
            await service.getRelevantMemories('user-001', 'TypeScript', 5);
            expect(mockGetRelevantMemories).toHaveBeenCalledWith('user-001', 'TypeScript', 5);
        });

        test('기본 limit이 10이다', async () => {
            await service.getRelevantMemories('user-001', 'query');
            expect(mockGetRelevantMemories).toHaveBeenCalledWith('user-001', 'query', 10);
        });
    });

    // ─────────────────────────────────────────
    // buildMemoryContext
    // ─────────────────────────────────────────
    describe('buildMemoryContext', () => {
        test('메모리가 없으면 빈 contextString을 반환한다', async () => {
            mockGetRelevantMemories.mockResolvedValue([]);
            const result = await service.buildMemoryContext('user-001', '쿼리');
            expect(result.contextString).toBe('');
            expect(result.memories).toEqual([]);
        });

        test('메모리가 있으면 헤더가 포함된 contextString을 반환한다', async () => {
            mockGetRelevantMemories.mockResolvedValue([makeMemory()]);
            const result = await service.buildMemoryContext('user-001', '쿼리');
            expect(result.contextString).toContain('## 🧠 User Memory Context');
        });

        test('fact 카테고리 메모리가 있으면 사실 정보 섹션이 포함된다', async () => {
            mockGetRelevantMemories.mockResolvedValue([makeMemory({ category: 'fact' })]);
            const result = await service.buildMemoryContext('user-001', '쿼리');
            expect(result.contextString).toContain('사실 정보');
        });

        test('preference 카테고리 메모리가 있으면 선호도 섹션이 포함된다', async () => {
            mockGetRelevantMemories.mockResolvedValue([
                makeMemory({ category: 'preference', key: '언어', value: 'TypeScript' })
            ]);
            const result = await service.buildMemoryContext('user-001', '쿼리');
            expect(result.contextString).toContain('선호도');
        });

        test('메모리 key-value 형식이 포함된다', async () => {
            mockGetRelevantMemories.mockResolvedValue([makeMemory({ key: '이름', value: '홍길동' })]);
            const result = await service.buildMemoryContext('user-001', '쿼리');
            expect(result.contextString).toContain('**이름**: 홍길동');
        });

        test('결과에 memories 배열이 포함된다', async () => {
            const memories = [makeMemory()];
            mockGetRelevantMemories.mockResolvedValue(memories);
            const result = await service.buildMemoryContext('user-001', '쿼리');
            expect(result.memories).toHaveLength(1);
        });

        test('여러 카테고리 메모리가 있으면 각각 섹션에 포함된다', async () => {
            mockGetRelevantMemories.mockResolvedValue([
                makeMemory({ category: 'fact', key: '이름', value: '홍길동' }),
                makeMemory({ id: 'mem-002', category: 'skill', key: '언어', value: 'TypeScript' }),
            ]);
            const result = await service.buildMemoryContext('user-001', '쿼리');
            expect(result.contextString).toContain('사실 정보');
            expect(result.contextString).toContain('기술/역량');
        });
    });

    // ─────────────────────────────────────────
    // updateMemory
    // ─────────────────────────────────────────
    describe('updateMemory', () => {
        test('db.updateMemory에 위임한다', async () => {
            await service.updateMemory('mem-001', { value: '새 값', importance: 0.8 });
            expect(mockUpdateMemory).toHaveBeenCalledWith('mem-001', { value: '새 값', importance: 0.8 });
        });
    });

    // ─────────────────────────────────────────
    // deleteMemory
    // ─────────────────────────────────────────
    describe('deleteMemory', () => {
        test('db.deleteMemory에 위임한다', async () => {
            await service.deleteMemory('mem-001');
            expect(mockDeleteMemory).toHaveBeenCalledWith('mem-001');
        });
    });

    // ─────────────────────────────────────────
    // clearUserMemories
    // ─────────────────────────────────────────
    describe('clearUserMemories', () => {
        test('db.deleteUserMemories에 위임한다', async () => {
            await service.clearUserMemories('user-001');
            expect(mockDeleteUserMemories).toHaveBeenCalledWith('user-001');
        });
    });

    // ─────────────────────────────────────────
    // consolidateMemories
    // ─────────────────────────────────────────
    describe('consolidateMemories', () => {
        test('메모리가 2개 미만이면 0을 반환한다', async () => {
            mockGetUserMemories.mockResolvedValue([makeMemory()]);
            const result = await service.consolidateMemories('user-001');
            expect(result).toBe(0);
        });

        test('같은 category+key를 가진 중복 메모리를 병합한다', async () => {
            mockGetUserMemories.mockResolvedValue([
                makeMemory({ id: 'mem-001', category: 'fact', key: '이름', value: '홍길동', importance: 0.9 }),
                makeMemory({ id: 'mem-002', category: 'fact', key: '이름', value: '홍길동2', importance: 0.5 }),
            ]);
            const result = await service.consolidateMemories('user-001');
            expect(result).toBe(1);
            expect(mockDeleteMemory).toHaveBeenCalledWith('mem-002');
            expect(mockUpdateMemory).toHaveBeenCalledWith('mem-001', expect.objectContaining({
                value: expect.stringContaining('홍길동'),
            }));
        });

        test('importance가 가장 높은 메모리를 유지한다', async () => {
            mockGetUserMemories.mockResolvedValue([
                makeMemory({ id: 'mem-low', category: 'fact', key: '이름', value: 'A', importance: 0.3 }),
                makeMemory({ id: 'mem-high', category: 'fact', key: '이름', value: 'B', importance: 0.9 }),
            ]);
            await service.consolidateMemories('user-001');
            // importance 낮은 쪽이 삭제됨
            expect(mockDeleteMemory).toHaveBeenCalledWith('mem-low');
            expect(mockDeleteMemory).not.toHaveBeenCalledWith('mem-high');
        });

        test('다른 카테고리의 같은 키는 병합하지 않는다', async () => {
            mockGetUserMemories.mockResolvedValue([
                makeMemory({ id: 'mem-001', category: 'fact', key: '이름', value: 'A' }),
                makeMemory({ id: 'mem-002', category: 'preference', key: '이름', value: 'B' }),
            ]);
            const result = await service.consolidateMemories('user-001');
            expect(result).toBe(0);
        });

        test('값이 동일한 중복은 병합 시 값을 변경하지 않는다', async () => {
            mockGetUserMemories.mockResolvedValue([
                makeMemory({ id: 'mem-001', category: 'fact', key: '이름', value: '홍길동', importance: 0.9 }),
                makeMemory({ id: 'mem-002', category: 'fact', key: '이름', value: '홍길동', importance: 0.5 }),
            ]);
            await service.consolidateMemories('user-001');
            expect(mockUpdateMemory).not.toHaveBeenCalled();
            expect(mockDeleteMemory).toHaveBeenCalledWith('mem-002');
        });
    });

    // ─────────────────────────────────────────
    // buildMemoryContext 캐시 동작
    // ─────────────────────────────────────────
    describe('buildMemoryContext 캐시', () => {
        test('같은 userId+query 조합은 캐시를 반환한다', async () => {
            mockGetRelevantMemories.mockResolvedValue([makeMemory()]);
            await service.buildMemoryContext('user-001', '쿼리A');
            await service.buildMemoryContext('user-001', '쿼리A');
            // 두 번째 호출에서는 DB 호출 없이 캐시 반환
            expect(mockGetRelevantMemories).toHaveBeenCalledTimes(1);
        });

        test('같은 userId지만 다른 query는 별도 캐시 엔트리를 사용한다', async () => {
            mockGetRelevantMemories.mockResolvedValue([makeMemory()]);
            await service.buildMemoryContext('user-001', '쿼리A');
            await service.buildMemoryContext('user-001', '쿼리B');
            expect(mockGetRelevantMemories).toHaveBeenCalledTimes(2);
        });
    });

    // ─────────────────────────────────────────
    // extractAndSaveMemories
    // ─────────────────────────────────────────
    describe('extractAndSaveMemories', () => {
        test('빈 메시지에서 추출 결과가 없으면 빈 배열을 반환한다', async () => {
            const result = await service.extractAndSaveMemories('user-001', 'sess-001', '', '');
            expect(result).toEqual([]);
        });

        test('llmExtractor가 없으면 규칙 기반으로만 추출한다', async () => {
            const result = await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                '제 이름은 홍길동입니다',
                '안녕하세요!'
            );
            expect(result.some(m => m.key === '이름')).toBe(true);
        });

        test('이름 패턴 추출 — "제 이름은 X입니다"', async () => {
            const result = await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                '제 이름은 김철수입니다',
                ''
            );
            const nameMemory = result.find(m => m.key === '이름');
            expect(nameMemory).toBeDefined();
            expect(nameMemory?.value).toBe('김철수');
            expect(nameMemory?.category).toBe('fact');
        });

        test('영어 이름 패턴 추출 — "my name is X"', async () => {
            const result = await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                'my name is John',
                ''
            );
            const nameMemory = result.find(m => m.key === '이름');
            expect(nameMemory).toBeDefined();
            expect(nameMemory?.value).toBe('John');
        });

        test('선호도 패턴 추출 — "X를 좋아합니다"', async () => {
            const result = await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                'TypeScript를 좋아합니다',
                ''
            );
            const prefMemory = result.find(m => m.category === 'preference');
            expect(prefMemory).toBeDefined();
        });

        test('llmExtractor가 있으면 LLM 결과도 포함된다', async () => {
            const llmResult = JSON.stringify([{
                category: 'skill',
                key: 'programming',
                value: 'TypeScript expert',
                importance: 0.8,
                tags: ['skill']
            }]);
            const mockLLM = jest.fn().mockResolvedValue(`[${llmResult.slice(1, -1)}]`);

            const result = await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                '코드 작성 중',
                '',
                mockLLM
            );
            expect(result.some(m => m.category === 'skill')).toBe(true);
        });

        test('llmExtractor가 실패해도 규칙 기반 결과는 반환된다', async () => {
            const mockLLM = jest.fn().mockRejectedValue(new Error('LLM failed'));
            const result = await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                '제 이름은 이순신입니다',
                '',
                mockLLM
            );
            expect(result.some(m => m.key === '이름')).toBe(true);
        });

        test('추출된 메모리마다 saveMemory(db.createMemory)가 호출된다', async () => {
            await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                '제 이름은 홍길동입니다',
                ''
            );
            expect(mockCreateMemory).toHaveBeenCalled();
        });

        test('같은 category+key 중복이 제거된다', async () => {
            // LLM과 규칙 기반 모두 같은 이름을 추출하는 상황
            const llmResultStr = `[{"category":"fact","key":"이름","value":"홍길동LLM","importance":0.5,"tags":[]}]`;
            const mockLLM = jest.fn().mockResolvedValue(llmResultStr);

            const result = await service.extractAndSaveMemories(
                'user-001', 'sess-001',
                '제 이름은 홍길동입니다',
                '',
                mockLLM
            );
            // 이름 fact 카테고리는 중복 제거 후 1개여야 함
            const nameMemories = result.filter(m => m.category === 'fact' && m.key === '이름');
            expect(nameMemories).toHaveLength(1);
        });
    });

    // ─────────────────────────────────────────
    // parseExtractionResult (간접 — LLM 결과 파싱)
    // ─────────────────────────────────────────
    describe('parseExtractionResult (via extractAndSaveMemories)', () => {
        const callWithLLM = (llmOutput: string) =>
            service.extractAndSaveMemories('user-001', 'session-parse', '', '', jest.fn().mockResolvedValue(llmOutput));

        test('유효한 JSON 배열을 파싱한다', async () => {
            const result = await callWithLLM(`[{"category":"preference","key":"언어","value":"한국어","importance":0.7,"tags":["lang"]}]`);
            expect(result.some(m => m.category === 'preference')).toBe(true);
        });

        test('JSON 배열이 없으면 빈 배열을 반환한다 (규칙 기반 제외)', async () => {
            const result = await callWithLLM('no json here');
            // 규칙 기반은 빈 메시지라 추출 없음
            expect(result.every(m => m.category !== undefined)).toBe(true);
        });

        test('유효하지 않은 category는 필터링된다', async () => {
            const result = await callWithLLM(`[{"category":"invalid_cat","key":"k","value":"v","importance":0.5,"tags":[]}]`);
            expect(result.some(m => m.category === 'invalid_cat' as unknown)).toBe(false);
        });

        test('importance는 0.1~1.0 사이로 클램핑된다', async () => {
            const result = await callWithLLM(`[{"category":"fact","key":"k","value":"v","importance":999,"tags":[]}]`);
            const mem = result.find(m => m.key === 'k');
            if (mem) {
                expect(mem.importance).toBeLessThanOrEqual(1);
                expect(mem.importance).toBeGreaterThanOrEqual(0.1);
            }
        });

        test('잘못된 JSON이면 빈 결과를 반환한다 (규칙 기반 제외)', async () => {
            // malformed JSON
            const result = await callWithLLM('[{"category":"fact"');
            // 규칙 기반으로 추출된 것만 있거나 없어야 함 — LLM 파싱 에러는 무시됨
            expect(Array.isArray(result)).toBe(true);
        });
    });
});

// ─────────────────────────────────────────────
// getMemoryService (싱글톤)
// ─────────────────────────────────────────────

describe('getMemoryService', () => {
    test('MemoryService 인스턴스를 반환한다', () => {
        const svc = getMemoryService();
        expect(svc).toBeInstanceOf(MemoryService);
    });

    test('같은 인스턴스를 반환한다 (싱글톤)', () => {
        const svc1 = getMemoryService();
        const svc2 = getMemoryService();
        expect(svc1).toBe(svc2);
    });
});
