/**
 * 턴 전 컨텍스트 확장점(collectTurnContexts) — 출처 번호 오프셋 이어 붙이기·실패/초과 통합 건너뛰기.
 */
import {
    __setChatTurnIntegrationsForTest, collectTurnContexts, collectHiddenSessionIds,
    isSessionMemoryIsolated, type ChatTurnIntegration,
} from '../turn-integrations';

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
        expect(r).toEqual({ contextBlock: 'fine', sources: [], systemPromptPart: '' });
    });

    it('systemPromptPart 를 통합 순서대로 이어 붙인다(없으면 빈 문자열)', async () => {
        __setChatTurnIntegrationsForTest([
            { id: 'a', prepareTurnContext: async () => ({ systemPromptPart: 'PART-A' }) },
            { id: 'b', prepareTurnContext: async () => ({ contextBlock: 'ctx' }) },
            { id: 'c', prepareTurnContext: async () => ({ systemPromptPart: 'PART-C' }) },
        ]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko' });
        expect(r.systemPromptPart).toBe('PART-A\n\nPART-C');
        expect(r.contextBlock).toBe('ctx');
    });
});

describe('isSessionMemoryIsolated (전역 메모리 쓰기 게이트)', () => {
    it('격리 훅을 선언한 통합이 없으면 false(일반 채팅 무영향)', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'x', prepareTurnContext: async () => undefined }]);
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(false);
    });

    it('어느 통합이 격리라 하면 true', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'x', isMemoryIsolatedSession: async () => true }]);
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(true);
    });

    it('판정이 던지면 fail-closed 로 true(누출 방지)', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'x', isMemoryIsolatedSession: async () => { throw new Error('db'); } }]);
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(true);
    });

    it('게스트·세션 없음은 격리 대상이 아니다', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'x', isMemoryIsolatedSession: async () => true }]);
        expect(await isSessionMemoryIsolated('guest', 's1')).toBe(false);
        expect(await isSessionMemoryIsolated('u1', undefined)).toBe(false);
    });
});

describe('collectHiddenSessionIds (기본 목록 숨김)', () => {
    it('통합들의 숨김 세션 id 합집합', async () => {
        __setChatTurnIntegrationsForTest([
            { id: 'a', listHiddenSessionIds: async () => ['s1', 's2'] },
            { id: 'b', listHiddenSessionIds: async () => ['s2', 's3'] },
        ]);
        const hidden = await collectHiddenSessionIds('u1');
        expect([...hidden].sort()).toEqual(['s1', 's2', 's3']);
    });

    it('던진 통합은 건너뛴다(fail-open — 나머지는 유지)', async () => {
        __setChatTurnIntegrationsForTest([
            { id: 'a', listHiddenSessionIds: async () => { throw new Error('x'); } },
            { id: 'b', listHiddenSessionIds: async () => ['s3'] },
        ]);
        expect([...(await collectHiddenSessionIds('u1'))]).toEqual(['s3']);
    });

    it('게스트는 빈 집합', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'a', listHiddenSessionIds: async () => ['s1'] }]);
        expect((await collectHiddenSessionIds('guest')).size).toBe(0);
    });

    it('오프셋 이하 번호를 준 출처는 버린다(웹검색 출처와 충돌 방지)', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'x', prepareTurnContext: async () => ({ sources: [src(1), src(3)] }) }]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko', sourceOffset: 2 });
        expect(r.sources.map((s) => s.n)).toEqual([3]);
    });
});
