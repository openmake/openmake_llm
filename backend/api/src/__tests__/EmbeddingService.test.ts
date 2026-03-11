/**
 * EmbeddingService 단위 테스트
 *
 * 테스트 범위:
 * - embedText: 정상 반환, 클라이언트 없을 때 null, embed 실패 시 null
 * - embedBatch: 빈 배열, 배치 분할, 부분 실패 시 null 채움
 * - isAvailable: 정상 true, 클라이언트 없으면 false
 * - getModelName: RAG_CONFIG.EMBEDDING_MODEL 반환
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockEmbed = jest.fn();
const mockGetBestNode = jest.fn();
const mockCreateScopedClient = jest.fn();

jest.mock('../cluster/manager', () => ({
    getClusterManager: jest.fn().mockReturnValue({
        getBestNode: mockGetBestNode,
        createScopedClient: mockCreateScopedClient,
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

jest.mock('../config/runtime-limits', () => ({
    RAG_CONFIG: {
        EMBEDDING_MODEL: 'test-embed-model',
        EMBEDDING_BATCH_SIZE: 2,
        CHUNK_SIZE: 1000,
        CHUNK_OVERLAP: 200,
        TOP_K: 5,
        RELEVANCE_THRESHOLD: 0.45,
        EMBEDDING_DIMENSIONS: 768,
        MAX_CONTEXT_CHARS: 4000,
    },
}));

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { EmbeddingService } from '../services/EmbeddingService';

// ─────────────────────────────────────────────
// 테스트
// ─────────────────────────────────────────────

describe('EmbeddingService', () => {
    let service: EmbeddingService;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new EmbeddingService();

        // 기본: 노드 있고 클라이언트 정상 반환
        mockGetBestNode.mockReturnValue({ id: 'node-1' });
        mockCreateScopedClient.mockReturnValue({ embed: mockEmbed });
    });

    describe('embedText', () => {
        test('정상적으로 임베딩 벡터를 반환해야 함', async () => {
            mockEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);

            const result = await service.embedText('테스트 텍스트');

            expect(result).toEqual([0.1, 0.2, 0.3]);
            expect(mockEmbed).toHaveBeenCalledWith('테스트 텍스트', 'test-embed-model');
        });

        test('사용 가능한 노드가 없으면 null 반환', async () => {
            mockGetBestNode.mockReturnValue(null);

            const result = await service.embedText('텍스트');

            expect(result).toBeNull();
            expect(mockEmbed).not.toHaveBeenCalled();
        });

        test('embed 호출 실패 시 null 반환', async () => {
            mockEmbed.mockRejectedValue(new Error('Ollama 연결 실패'));

            const result = await service.embedText('텍스트');

            expect(result).toBeNull();
        });

        test('빈 임베딩 결과 시 null 반환', async () => {
            mockEmbed.mockResolvedValue([[]]);

            const result = await service.embedText('텍스트');

            expect(result).toBeNull();
        });

        test('전혀 결과 없을 때 null 반환', async () => {
            mockEmbed.mockResolvedValue([]);

            const result = await service.embedText('텍스트');

            expect(result).toBeNull();
        });
    });

    describe('embedBatch', () => {
        test('빈 배열 입력 시 빈 배열 반환', async () => {
            const result = await service.embedBatch([]);

            expect(result).toEqual([]);
            expect(mockEmbed).not.toHaveBeenCalled();
        });

        test('정상적으로 배치 임베딩을 반환해야 함', async () => {
            mockEmbed.mockResolvedValue([[0.1, 0.2], [0.3, 0.4]]);

            const result = await service.embedBatch(['텍스트1', '텍스트2']);

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual([0.1, 0.2]);
            expect(result[1]).toEqual([0.3, 0.4]);
        });

        test('배치 크기(2)를 초과하면 분할 처리해야 함', async () => {
            mockEmbed
                .mockResolvedValueOnce([[0.1], [0.2]])   // 첫 배치
                .mockResolvedValueOnce([[0.3]]);          // 두 번째 배치

            const result = await service.embedBatch(['a', 'b', 'c']);

            expect(result).toHaveLength(3);
            expect(mockEmbed).toHaveBeenCalledTimes(2);
        });

        test('사용 가능한 노드가 없으면 모든 항목이 null', async () => {
            mockGetBestNode.mockReturnValue(null);

            const result = await service.embedBatch(['a', 'b']);

            expect(result).toEqual([null, null]);
        });

        test('배치 실패 시 해당 배치 항목 모두 null', async () => {
            mockEmbed
                .mockResolvedValueOnce([[0.1], [0.2]])
                .mockRejectedValueOnce(new Error('배치 실패'));

            const result = await service.embedBatch(['a', 'b', 'c']);

            expect(result).toHaveLength(3);
            expect(result[0]).toEqual([0.1]);
            expect(result[1]).toEqual([0.2]);
            expect(result[2]).toBeNull();
        });

        test('개별 항목이 빈 배열이면 null로 처리', async () => {
            mockEmbed.mockResolvedValue([[0.1], []]);

            const result = await service.embedBatch(['a', 'b']);

            expect(result[0]).toEqual([0.1]);
            expect(result[1]).toBeNull();
        });
    });

    describe('isAvailable', () => {
        test('임베딩 모델 사용 가능 시 true 반환', async () => {
            mockEmbed.mockResolvedValue([[0.1]]);

            const result = await service.isAvailable();

            expect(result).toBe(true);
        });

        test('노드 없으면 false 반환', async () => {
            mockGetBestNode.mockReturnValue(null);

            const result = await service.isAvailable();

            expect(result).toBe(false);
        });

        test('embed 호출 실패 시 false 반환', async () => {
            mockEmbed.mockRejectedValue(new Error('모델 없음'));

            const result = await service.isAvailable();

            expect(result).toBe(false);
        });
    });

    describe('getModelName', () => {
        test('RAG_CONFIG.EMBEDDING_MODEL 값을 반환해야 함', () => {
            expect(service.getModelName()).toBe('test-embed-model');
        });
    });
});
