/**
 * 리랭킹·도구 선별 임베딩 모델은 text.embed 배정만 원본이다 — SEARCH_RERANK_EMBED_MODEL 은 폐기돼 읽지 않는다(2026-11-18).
 */
import { loadConfig } from '../env';
import { DEFAULT_CONFIG } from '../env-defaults';

describe('SEARCH_RERANK_EMBED_MODEL 폐기', () => {
    const saved = process.env.SEARCH_RERANK_EMBED_MODEL;
    afterEach(() => {
        if (saved === undefined) delete process.env.SEARCH_RERANK_EMBED_MODEL; else process.env.SEARCH_RERANK_EMBED_MODEL = saved;
    });

    it('env 에 값이 남아 있어도 설정에 싣지 않고, 코드 기본값도 없다', () => {
        process.env.SEARCH_RERANK_EMBED_MODEL = 'leftover-embed';
        expect(Object.hasOwn(loadConfig(), 'searchRerankEmbedModel')).toBe(false);
        expect(Object.hasOwn(DEFAULT_CONFIG, 'searchRerankEmbedModel')).toBe(false);
    });
});
