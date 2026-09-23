/**
 * 실제 text.embed provider(게이트웨이 127.0.0.1:13401, bge-m3) 호출 확인 — 옵트인.
 * KNOWLEDGE_LIVE_EMBED=1 일 때만 돈다. 키는 레포 .env 의 LLM_API_KEY(출력하지 않는다).
 */
import { describeEmbeddingProvider, embedTexts, clearEmbeddingProviderCache } from '../embedding/provider';

const live = process.env.KNOWLEDGE_LIVE_EMBED === '1' ? describe : describe.skip;

live('임베딩 provider 라이브', () => {
    beforeEach(() => clearEmbeddingProviderCache());

    it('describeEmbeddingProvider 가 차원을 측정한다', async () => {
        const info = await describeEmbeddingProvider();
        expect(info.dimension).toBeGreaterThan(0);
        expect(info.modelId.length).toBeGreaterThan(0);
    });

    it('embedTexts 는 입력 수만큼 벡터를 돌려준다', async () => {
        const vecs = await embedTexts(['hello', 'world']);
        expect(vecs).toHaveLength(2);
        expect(vecs[0].length).toBeGreaterThan(0);
        expect(vecs[0].length).toBe(vecs[1].length);
    });
});
