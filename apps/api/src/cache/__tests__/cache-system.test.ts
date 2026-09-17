import { getCacheSystem } from '..';

describe('CacheSystem — 라우팅 캐시만', () => {
    beforeEach(() => getCacheSystem().clear());

    it('정규화된 질의로 라우팅 결과를 돌려주고 적중률을 센다', () => {
        const cache = getCacheSystem();
        expect(cache.getRoutingResult('Hello  World')).toBeUndefined();
        cache.setRoutingResult('hello world', 'software-engineer', 0.8);
        expect(cache.getRoutingResult('  HELLO world ')).toMatchObject({ agentId: 'software-engineer', confidence: 0.8 });
        expect(cache.getStats()).toMatchObject({ totalHits: 1, totalMisses: 1, hitRate: 50, size: 1 });
    });

    it('응답 캐시 API 는 없다(사용자 간 응답 혼입 방지)', () => {
        const cache = getCacheSystem() as unknown as Record<string, unknown>;
        expect(cache.getQueryResponse).toBeUndefined();
        expect(cache.setQueryResponse).toBeUndefined();
    });
});
