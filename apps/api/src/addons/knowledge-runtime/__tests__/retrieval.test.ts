/**
 * 검색 컨텍스트·인용 단위 테스트 — DB 불필요. 번호 연속성·예산 절단·근거 없음 처리를 검증한다.
 */
import { buildKnowledgeContext } from '../retrieval/context-builder';
import { buildSource, pageLabel, chunkUrl } from '../retrieval/citation';
import { retrieve } from '../retrieval/service';
import { EVIDENCE_TAG } from '../prompts';
import type { SearchHit } from '../retrieval/search';
import type { KnowledgeActor } from '../config/scope-policy';

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
    it('활성 index 가 없으면 "관련 자료 없음" 블록·출처 0', async () => {
        const res = await retrieve(
            { actor, spaceIds: ['s1'], query: 'q', sourceOffset: 0, userLang: 'en' },
            { embed: async (t) => t.map(() => [1, 0]), getActiveIndex: async () => null },
        );
        expect(res.hadEvidence).toBe(false);
        expect(res.sources).toHaveLength(0);
        expect(res.contextBlock.length).toBeGreaterThan(0);
    });

    it('spaceIds 가 비면 검색하지 않는다', async () => {
        const embed = jest.fn(async (t: string[]) => t.map(() => [1, 0]));
        const res = await retrieve(
            { actor, spaceIds: [], query: 'q', sourceOffset: 0, userLang: 'en' },
            { embed, getActiveIndex: async () => ({ id: 'i', providerRef: 'x', modelId: 'm', dimension: 2, metric: 'cosine', status: 'ready', isActive: true }) },
        );
        expect(res.hadEvidence).toBe(false);
        expect(embed).not.toHaveBeenCalled();
    });
});
