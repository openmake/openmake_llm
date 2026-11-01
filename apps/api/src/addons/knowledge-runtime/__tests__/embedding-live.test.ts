/**
 * 실제 text.embed provider(게이트웨이 127.0.0.1:13401, bge-m3) 호출 확인 — 옵트인.
 * KNOWLEDGE_LIVE_EMBED=1 일 때만 돈다. 키는 레포 .env 의 LLM_API_KEY(출력하지 않는다).
 * 사용자 문맥 없이 부르므로 실효 배정이 로컬 모델일 때만 통과한다(외부는 사용자 키로만 실행된다).
 */
import { describeLiveEmbedding, makeIndexEmbedder, probeDimension } from '../embedding/provider';

const live = process.env.KNOWLEDGE_LIVE_EMBED === '1' ? describe : describe.skip;

live('임베딩 provider 라이브', () => {
    it('라이브 배정의 차원을 측정하고, 그 모델로 입력 수만큼 벡터를 돌려준다', async () => {
        const state = await describeLiveEmbedding(undefined);
        expect(state.failure).toBeNull();
        const probe = await probeDimension(state.live!, {});
        expect(probe.dimension).toBeGreaterThan(0);
        expect(probe.model.length).toBeGreaterThan(0);

        const embed = makeIndexEmbedder({ providerRef: state.live!.fullId, modelId: probe.model, dimension: probe.dimension, requestParams: state.live!.params });
        const vecs = await embed(['hello', 'world']);
        expect(vecs).toHaveLength(2);
        expect(vecs[0].length).toBe(probe.dimension);
    });
});
