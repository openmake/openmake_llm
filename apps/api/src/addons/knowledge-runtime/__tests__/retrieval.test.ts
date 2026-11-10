/**
 * 검색 컨텍스트·인용 단위 테스트 — DB 불필요. 번호 연속성·예산 절단·근거 없음 처리를 검증한다.
 * retrieve: 공간 색인으로·검색한 사용자의 키로 질의 임베딩, 키 문제는 "검색 불가" 안내 블록(출처 0), 429·5xx 는 throw.
 */
jest.mock('../config/profiles', () => ({
    resolveSpaceProfiles: async () => ({ retrieval: { id: 'r', topK: 5, candidateCount: 10, minSimilarity: 0, maxContextChars: 5000, maxTopK: 10 } }),
    applyRetrievalOverride: (p: unknown) => p,
}));
jest.mock('../retrieval/search', () => ({ searchChunks: jest.fn(async () => []) }));
jest.mock('../embedding/provider', () => ({
    ...jest.requireActual('../embedding/provider'),
    makeIndexEmbedder: jest.fn(),
}));

import { buildKnowledgeContext } from '../retrieval/context-builder';
import { buildSource, pageLabel, chunkUrl } from '../retrieval/citation';
import { retrieve } from '../retrieval/service';
import { EVIDENCE_TAG } from '../prompts';
import type { SearchHit } from '../retrieval/search';
import type { KnowledgeActor } from '../config/scope-policy';
import type { KnowledgeIndex } from '../embedding/index-catalog';
import { EmbeddingError, makeIndexEmbedder } from '../embedding/provider';
import { HttpCallError } from '../../../services/orchestrator/http-call';

const mockMakeIndexEmbedder = makeIndexEmbedder as jest.Mock;
const spaceIndex = (over: Partial<KnowledgeIndex> = {}): KnowledgeIndex => ({
    id: 'i', providerRef: 'gemini:emb-1', modelId: 'gemini/emb-1', dimension: 2, metric: 'cosine', status: 'ready', requestParams: {}, ...over,
});

function hit(over: Partial<SearchHit>): SearchHit {
    return {
        chunkId: 'c1', documentId: 'd1', documentName: 'Doc', spaceId: 's1', spaceName: 'Space',
        content: 'evidence content', pageStart: null, pageEnd: null, similarity: 0.9, ...over,
    };
}

const actor: KnowledgeActor = { userId: 'u1', activeOrg: null, orgWriteRoles: [] };

describe('citation', () => {
    it('pageLabel: 단일·범위·미상', () => {
        expect(pageLabel({ pageStart: 3, pageEnd: 3 })).toBe('p.3');
        expect(pageLabel({ pageStart: 2, pageEnd: 5 })).toBe('p.2–5');
        expect(pageLabel({ pageStart: null, pageEnd: null })).toBe('');
    });

    it('chunkUrl 은 앱 상대 딥링크', () => {
        expect(chunkUrl({ spaceId: 's1', documentId: 'd1', chunkId: 'c1' })).toBe('/knowledge/s1?doc=d1&chunk=c1');
    });

    it('buildSource: 페이지 있으면 title 에 p.N', () => {
        const s = buildSource(hit({ pageStart: 4, pageEnd: 4 }), 3);
        expect(s.n).toBe(3);
        expect(s.title).toBe('Doc · p.4');
        expect(s.source).toBe('Space');
    });
});

describe('buildKnowledgeContext', () => {
    it('출처 번호는 sourceOffset+1 부터 연속이고 블록에 [N] 이 들어간다', () => {
        const hits = [hit({ chunkId: 'a' }), hit({ chunkId: 'b' }), hit({ chunkId: 'c' })];
        const { contextBlock, sources } = buildKnowledgeContext({ hits, sourceOffset: 2, userLang: 'ko', maxContextChars: 10_000 });
        expect(sources.map((s) => s.n)).toEqual([3, 4, 5]);
        expect(contextBlock).toContain(`<${EVIDENCE_TAG}>`);
        expect(contextBlock).toContain('[3]');
        expect(contextBlock).toContain('[5]');
    });

    it('컨텍스트 예산을 넘으면 이미 넣은 것에서 멈춘다(출처도 함께)', () => {
        const hits = [hit({ chunkId: 'a', content: 'A'.repeat(50) }), hit({ chunkId: 'b', content: 'B'.repeat(50) })];
        const { sources } = buildKnowledgeContext({ hits, sourceOffset: 0, userLang: 'en', maxContextChars: 30 });
        expect(sources).toHaveLength(1); // 첫 항목만
        expect(sources[0].n).toBe(1);
    });
});

describe('retrieve (근거 없음 경로)', () => {
    it('공간 색인이 없으면(문서 없는 새 공간) "관련 자료 없음" 블록·출처 0', async () => {
        const res = await retrieve(
            { actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: 'en' },
            { embed: async (t) => t.map(() => [1, 0]), getSpaceIndex: async () => null },
        );
        expect(res.hadEvidence).toBe(false);
        expect(res.sources).toHaveLength(0);
        expect(res.contextBlock.length).toBeGreaterThan(0);
    });

    it('색인 없는 공간 검색은 현재 배정과 무관하게 noEvidence — 질의 임베딩·임베더 생성 없음', async () => {
        mockMakeIndexEmbedder.mockReset();
        const embed = jest.fn(async (t: string[]) => t.map(() => [1, 0]));
        const res = await retrieve(
            { actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: 'en' },
            { embed, getSpaceIndex: async () => null },
        );
        expect(res).toMatchObject({ hadEvidence: false, sources: [] });
        expect(res).not.toHaveProperty('unavailableReason');
        expect(embed).not.toHaveBeenCalled();
        expect(mockMakeIndexEmbedder).not.toHaveBeenCalled();
    });

    it('spaceIds 가 비면 검색하지 않는다', async () => {
        const embed = jest.fn(async (t: string[]) => t.map(() => [1, 0]));
        const res = await retrieve(
            { actor, spaceIds: [], query: 'q', sourceOffset: 0, userLang: 'en' },
            { embed, getSpaceIndex: async () => spaceIndex() },
        );
        expect(res.hadEvidence).toBe(false);
        expect(embed).not.toHaveBeenCalled();
    });
});

describe('retrieve (공간 색인·검색한 사용자의 키)', () => {
    beforeEach(() => mockMakeIndexEmbedder.mockReset());

    it('공간 색인 모델을 검색한 사용자의 키로 임베딩한다', async () => {
        const embedder = jest.fn(async (t: string[]) => t.map(() => [1, 0]));
        mockMakeIndexEmbedder.mockReturnValue(embedder);
        const index = spaceIndex();
        const getSpaceIndex = jest.fn(async () => index);
        await retrieve({ actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: 'en' }, { getSpaceIndex });
        expect(getSpaceIndex).toHaveBeenCalledWith('s1');
        expect(mockMakeIndexEmbedder).toHaveBeenCalledWith(index, { userId: 'u1' }, { spaceId: 's1' });
        expect(embedder).toHaveBeenCalledWith(['q']);
    });

    it.each([
        ['key_missing', /키|key/i],
        ['key_rejected', /교체|replace/i],
    ])('%s → "검색할 수 없었다" 안내 블록·출처 0·hadEvidence false (관련 자료 없음으로 위장하지 않는다)', async (reason, pattern) => {
        const embed = async () => { throw new EmbeddingError(reason as 'key_missing', '키 문제'); };
        for (const lang of ['ko', 'en']) {
            const res = await retrieve({ actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: lang }, { embed, getSpaceIndex: async () => spaceIndex() });
            expect(res).toMatchObject({ sources: [], hadEvidence: false, unavailableReason: reason });
            expect(res.contextBlock).toMatch(pattern);
            expect(res.contextBlock).toContain('gemini');
            const noEvidence = await retrieve({ actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: lang }, { embed: async (t) => t.map(() => [1, 0]), getSpaceIndex: async () => null });
            expect(res.contextBlock).not.toBe(noEvidence.contextBlock);
        }
    });

    it('429·5xx 는 throw — Base 가 이 통합만 건너뛴다(채팅은 계속)', async () => {
        const embed = async () => { throw new HttpCallError('429 Too Many Requests', 429); };
        await expect(retrieve({ actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: 'en' }, { embed, getSpaceIndex: async () => spaceIndex() }))
            .rejects.toThrow(/429/);
    });

    it('여러 공간의 색인이 다르면 throw(한 질의 벡터로 섞어 검색하지 않는다)', async () => {
        const getSpaceIndex = async (id: string) => spaceIndex({ id: `i-${id}` });
        await expect(retrieve({ actor, spaceIds: ['a', 'b'], query: 'q', sourceOffset: 0, userLang: 'en' }, { embed: async (t) => t.map(() => [1, 0]), getSpaceIndex }))
            .rejects.toThrow(/색인/);
    });
});
