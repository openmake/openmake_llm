/**
 * 턴 전 컨텍스트 확장점(collectTurnContexts) — 출처 번호 오프셋 이어 붙이기·실패/초과 통합 건너뛰기.
 */
import { __setChatTurnIntegrationsForTest, collectTurnContexts, type ChatTurnIntegration } from '../turn-integrations';

const src = (n: number) => ({ n, title: `t${n}`, url: `/x/${n}`, snippet: 's' });

afterEach(() => __setChatTurnIntegrationsForTest(null));

describe('collectTurnContexts', () => {
    it('통합마다 앞선 출처 뒤로 번호를 이어 받는다', async () => {
        const seen: number[] = [];
        const make = (id: string, count: number): ChatTurnIntegration => ({
            id,
            prepareTurnContext: async (input) => {
                seen.push(input.sourceOffset);
                return { contextBlock: `block-${id}`, sources: Array.from({ length: count }, (_, i) => src(input.sourceOffset + i + 1)) };
            },
        });
        __setChatTurnIntegrationsForTest([make('a', 2), make('b', 1)]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko', sourceOffset: 3 });
        expect(seen).toEqual([3, 5]);
        expect(r.sources.map((s) => s.n)).toEqual([4, 5, 6]);
        expect(r.contextBlock).toBe('block-a\n\nblock-b');
    });

    it('던진 통합은 건너뛰고 나머지는 싣는다', async () => {
        __setChatTurnIntegrationsForTest([
            { id: 'bad', prepareTurnContext: async () => { throw new Error('boom'); } },
            { id: 'ok', prepareTurnContext: async () => ({ contextBlock: 'fine' }) },
            { id: 'none' },
        ]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko' });
        expect(r).toEqual({ contextBlock: 'fine', sources: [] });
    });

    it('오프셋 이하 번호를 준 출처는 버린다(웹검색 출처와 충돌 방지)', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'x', prepareTurnContext: async () => ({ sources: [src(1), src(3)] }) }]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko', sourceOffset: 2 });
        expect(r.sources.map((s) => s.n)).toEqual([3]);
    });
});
