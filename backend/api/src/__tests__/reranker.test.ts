/**
 * Reranker 단위 테스트
 *
 * 테스트 범위:
 * - buildRerankPrompt: 프롬프트 생성 형식
 * - parseScore: LLM 응답에서 점수 파싱
 * - Reranker.rerank: fallback, 빈 후보, topK 이하 패스스루
 */

// ─────────────────────────────────────────────
// Mock 설정
// ─────────────────────────────────────────────

const mockGenerate = jest.fn();
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

// ─────────────────────────────────────────────
// Import after mocks
// ─────────────────────────────────────────────

import { Reranker, buildRerankPrompt, parseScore } from '../domains/rag/Reranker';
import type { VectorSearchResult } from '../data/repositories/vector-repository';

// ─────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────

function makeResult(id: number, content: string = `청크 ${id}`): VectorSearchResult {
    return {
        id,
        sourceType: 'document',
        sourceId: `doc-${id}`,
        chunkIndex: 0,
        content,
        metadata: { filename: `file-${id}.pdf` },
        similarity: 0.8,
        createdAt: '2026-01-01T00:00:00.000Z',
    };
}

// ─────────────────────────────────────────────
// parseScore 테스트
// ─────────────────────────────────────────────

describe('parseScore', () => {
    test('정수 점수 파싱', () => {
        expect(parseScore('8')).toBe(8);
    });

    test('소수 점수 파싱', () => {
        expect(parseScore('7.5')).toBe(7.5);
    });

    test('텍스트 포함 응답에서 점수 추출', () => {
        expect(parseScore('Score: 9')).toBe(9);
    });

    test('여러 숫자 중 첫 번째 추출', () => {
        expect(parseScore('8 out of 10')).toBe(8);
    });

    test('빈 응답 시 기본값 5', () => {
        expect(parseScore('')).toBe(5);
    });

    test('숫자 없는 응답 시 기본값 5', () => {
        expect(parseScore('no score here')).toBe(5);
    });

    test('10 초과 점수는 10으로 클램핑', () => {
        expect(parseScore('15')).toBe(10);
    });

    test('음수 문자열에서 숫자 부분 추출', () => {
        // '-3'에서 정규식은 '3'을 추출 → 유효 범위이므로 3 반환
        expect(parseScore('-3')).toBe(3);
    });

    test('0점 파싱', () => {
        expect(parseScore('0')).toBe(0);
    });

    test('10점 파싱', () => {
        expect(parseScore('10')).toBe(10);
    });
});

// ─────────────────────────────────────────────
// buildRerankPrompt 테스트
// ─────────────────────────────────────────────

describe('buildRerankPrompt', () => {
    test('쿼리와 문서가 포함된 프롬프트 생성', () => {
        const prompt = buildRerankPrompt('AI란 무엇인가?', '인공지능은 컴퓨터 과학의 한 분야입니다.');
        expect(prompt).toContain('AI란 무엇인가?');
        expect(prompt).toContain('인공지능은 컴퓨터 과학의 한 분야입니다.');
        expect(prompt).toContain('0 to 10');
        expect(prompt).toContain('Relevance score:');
    });
});

// ─────────────────────────────────────────────
// Reranker.rerank 테스트
// ─────────────────────────────────────────────

describe('Reranker', () => {
    let reranker: Reranker;

    beforeEach(() => {
        jest.clearAllMocks();
        reranker = new Reranker({ timeoutMs: 1000 });

        // 기본: Ollama 클라이언트 사용 가능
        mockGetBestNode.mockReturnValue({ id: 'node-1' });
        mockCreateScopedClient.mockReturnValue({ generate: mockGenerate });
    });

    test('빈 후보 배열은 빈 결과 반환', async () => {
        const result = await reranker.rerank('query', [], 5);
        expect(result).toHaveLength(0);
    });

    test('후보가 topK 이하면 재순위화 없이 그대로 반환', async () => {
        const candidates = [makeResult(1), makeResult(2)];
        const result = await reranker.rerank('query', candidates, 5);
        expect(result).toHaveLength(2);
        expect(result[0].id).toBe(1);
        expect(result[1].id).toBe(2);
        // generate가 호출되지 않아야 함
        expect(mockGenerate).not.toHaveBeenCalled();
    });

    test('Ollama 불가 시 fallback으로 원본 순서 반환', async () => {
        mockGetBestNode.mockReturnValue(null);

        const candidates = Array.from({ length: 10 }, (_, i) => makeResult(i + 1));
        const result = await reranker.rerank('query', candidates, 3);
        expect(result).toHaveLength(3);
        // 원본 순서 유지 (fallback)
        expect(result[0].id).toBe(1);
    });

    test('LLM 스코어링으로 재순위화 수행', async () => {
        // 10개 후보, topK=3
        const candidates = Array.from({ length: 10 }, (_, i) => makeResult(i + 1));

        // ID 5에 높은 점수, ID 3에 중간 점수, 나머지에 낮은 점수
        mockGenerate.mockImplementation(async (prompt: string) => {
            if (prompt.includes('청크 5')) return { response: '9' };
            if (prompt.includes('청크 3')) return { response: '8' };
            return { response: '2' };
        });

        const result = await reranker.rerank('query', candidates, 3);
        expect(result).toHaveLength(3);
        // 가장 높은 점수가 첫 번째
        expect(result[0].id).toBe(5);
        expect(result[1].id).toBe(3);
    });

    test('스코어링 실패 시 중간 점수 부여', async () => {
        const candidates = Array.from({ length: 6 }, (_, i) => makeResult(i + 1));

        // ID 1만 성공, 나머지 실패
        mockGenerate.mockImplementation(async (prompt: string) => {
            if (prompt.includes('청크 1')) return { response: '10' };
            throw new Error('connection error');
        });

        const result = await reranker.rerank('query', candidates, 3);
        expect(result).toHaveLength(3);
        // ID 1이 10점 → 1.0 similarity, 나머지 5점 → 0.5
        expect(result[0].id).toBe(1);
        expect(result[0].similarity).toBe(1.0);
    });

    test('similarity 필드가 0~1로 정규화됨', async () => {
        const candidates = Array.from({ length: 6 }, (_, i) => makeResult(i + 1));

        mockGenerate.mockResolvedValue({ response: '7' });

        const result = await reranker.rerank('query', candidates, 3);
        // 7/10 = 0.7
        expect(result[0].similarity).toBe(0.7);
    });

    test('문서 텍스트가 maxDocChars로 절단됨', async () => {
        const longContent = 'A'.repeat(1000);
        const candidates = Array.from({ length: 6 }, (_, i) => makeResult(i + 1, longContent));

        mockGenerate.mockResolvedValue({ response: '5' });
        const shortReranker = new Reranker({ maxDocChars: 100, timeoutMs: 1000 });

        await shortReranker.rerank('query', candidates, 3);

        // generate의 프롬프트에 절단된 텍스트가 포함되어야 함
        const firstCallPrompt = mockGenerate.mock.calls[0][0];
        expect(firstCallPrompt.length).toBeLessThan(longContent.length);
    });
});
