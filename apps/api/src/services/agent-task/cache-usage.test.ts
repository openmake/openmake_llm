import { CacheUsageTally } from './cache-usage';

describe('CacheUsageTally — 작업의 캐시 적중 프롬프트 토큰 누적', () => {
    it('서버가 한 번도 값을 주지 않으면 저장할 것이 없다(0 으로 꾸미지 않는다)', () => {
        const tally = new CacheUsageTally();
        tally.add({ prompt_tokens: 100, completion_tokens: 5 });
        tally.add(undefined);
        expect(tally.snapshot()).toEqual({});
    });

    it('값을 준 호출의 적중 토큰과 그 호출의 입력 토큰을 함께 누적한다', () => {
        const tally = new CacheUsageTally();
        tally.add({ prompt_tokens: 100, cached_prompt_tokens: 0 });
        tally.add({ prompt_tokens: 150, cached_prompt_tokens: 100 });
        expect(tally.snapshot()).toEqual({ cachedPromptTokens: 100, cacheReportedPromptTokens: 250 });
    });

    it('값을 주지 않은 호출은 분모(입력 토큰)에도 넣지 않는다 — 적중률이 낮게 보이지 않게', () => {
        const tally = new CacheUsageTally();
        tally.add({ prompt_tokens: 100, cached_prompt_tokens: 60 });
        tally.add({ prompt_tokens: 900 });
        expect(tally.snapshot()).toEqual({ cachedPromptTokens: 60, cacheReportedPromptTokens: 100 });
    });

    it('재개는 저장된 값에서 이어 센다 — 저장된 값이 없으면(NULL) 없는 채로 시작', () => {
        const resumed = new CacheUsageTally();
        resumed.restore({ cached_prompt_tokens: 40, cache_reported_prompt_tokens: 100 });
        resumed.add({ prompt_tokens: 50, cached_prompt_tokens: 50 });
        expect(resumed.snapshot()).toEqual({ cachedPromptTokens: 90, cacheReportedPromptTokens: 150 });

        const empty = new CacheUsageTally();
        empty.restore({ cached_prompt_tokens: null, cache_reported_prompt_tokens: null });
        empty.restore(undefined);
        expect(empty.snapshot()).toEqual({});
    });
});
