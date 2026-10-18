/**
 * 턴 전 컨텍스트 확장점(collectTurnContexts) — 출처 번호 오프셋 이어 붙이기·실패/초과 통합 건너뛰기.
 */
const integrationGate = jest.fn();
jest.mock('../../addon/integration-gate', () => ({ integrationGate: (...a: unknown[]) => integrationGate(...a) }));
const isAddonEnabledSync = jest.fn((_id: string) => true);
jest.mock('../../addon/addon-state', () => ({ isAddonEnabledSync: (id: string) => isAddonEnabledSync(id) }));
// 데이터 모듈(꺼진 add-on 도 불러오는 보호 훅) — 기본은 없음, 격리 판정 테스트에서만 채운다
let data: unknown[] = [];
jest.mock('../../../addon-host/addon-data', () => ({ getAddonDataModules: () => data }));

import {
    __setChatTurnIntegrationsForTest, collectTurnContexts, collectHiddenSessionIds, collectContextRefs,
    collectIntegrationSystemPromptParts, detectIntegrationIntents, extractIntegrationBlocks, getActiveChatTurnIntegrations,
    isSessionMemoryIsolated, type ChatTurnIntegration, type IntegrationBlocks,
} from '../turn-integrations';
import { TURN_CONTEXT_TIMEOUT_MS } from '../../../config/service-limits';

const src = (n: number) => ({ n, title: `t${n}`, url: `/x/${n}`, snippet: 's' });

afterEach(() => __setChatTurnIntegrationsForTest(null));
beforeEach(() => {
    integrationGate.mockReset(); integrationGate.mockResolvedValue({ allowed: true });
    isAddonEnabledSync.mockReset(); isAddonEnabledSync.mockImplementation(() => true);
});

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

    it('관리자가 끈 add-on 의 prepareTurnContext 는 부르지 않고 나머지는 싣는다', async () => {
        const offCalls = jest.fn(async () => ({ contextBlock: 'OFF' }));
        integrationGate.mockImplementation(async (id: string) => (id === 'off' ? { allowed: false, reason: 'disabled' } : { allowed: true }));
        __setChatTurnIntegrationsForTest([
            { id: 'off', prepareTurnContext: offCalls },
            { id: 'on', prepareTurnContext: async () => ({ contextBlock: 'ON' }) },
        ]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko' });
        expect(offCalls).not.toHaveBeenCalled();
        expect(r.contextBlock).toBe('ON');
        expect(integrationGate).toHaveBeenCalledWith('off', undefined);
    });

    it('사용자 id 를 게이트에 넘긴다(조직 사용권 축)', async () => {
        __setChatTurnIntegrationsForTest([{ id: 'k', prepareTurnContext: async () => ({ contextBlock: 'K' }) }]);
        await collectTurnContexts({ message: 'q', userLang: 'ko', userId: 'u1' });
        expect(integrationGate).toHaveBeenCalledWith('k', 'u1');
    });

    it('조직 허용 목록 밖 add-on 은 건너뛴다(채팅은 계속)', async () => {
        integrationGate.mockResolvedValue({ allowed: false, reason: 'not_entitled' });
        const prepare = jest.fn(async () => ({ contextBlock: 'K' }));
        __setChatTurnIntegrationsForTest([{ id: 'k', prepareTurnContext: prepare }]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko', userId: 'u1' });
        expect(prepare).not.toHaveBeenCalled();
        expect(r).toEqual({ contextBlock: '', sources: [], systemPromptPart: '' });
    });

    it('상태를 확인하지 못한 add-on 도 건너뛴다(채팅은 계속)', async () => {
        integrationGate.mockResolvedValue({ allowed: false, reason: 'state_unknown', detail: 'DB 장애' });
        __setChatTurnIntegrationsForTest([{ id: 'k', prepareTurnContext: async () => ({ contextBlock: 'K' }) }]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko' });
        expect(r).toEqual({ contextBlock: '', sources: [], systemPromptPart: '' });
    });

    it('부팅에 실패한 add-on 도 건너뛴다(채팅은 계속)', async () => {
        integrationGate.mockResolvedValue({ allowed: false, reason: 'failed' });
        const prepare = jest.fn(async () => ({ contextBlock: 'K' }));
        __setChatTurnIntegrationsForTest([{ id: 'k', prepareTurnContext: prepare }]);
        const r = await collectTurnContexts({ message: 'q', userLang: 'ko' });
        expect(prepare).not.toHaveBeenCalled();
        expect(r).toEqual({ contextBlock: '', sources: [], systemPromptPart: '' });
    });

    it('게이트 조회가 시간 상한을 넘기면 그 통합만 건너뛴다', async () => {
        jest.useFakeTimers();
        try {
            const hungCalls = jest.fn(async () => ({ contextBlock: 'HUNG' }));
            integrationGate.mockImplementation((id: string) => (id === 'hung' ? new Promise(() => {}) : Promise.resolve({ allowed: true })));
            __setChatTurnIntegrationsForTest([
                { id: 'hung', prepareTurnContext: hungCalls },
                { id: 'ok', prepareTurnContext: async () => ({ contextBlock: 'OK' }) },
            ]);
            const p = collectTurnContexts({ message: 'q', userLang: 'ko' });
            await jest.advanceTimersByTimeAsync(TURN_CONTEXT_TIMEOUT_MS + 1);
            const r = await p;
            expect(hungCalls).not.toHaveBeenCalled();
            expect(r.contextBlock).toBe('OK');
        } finally {
            jest.useRealTimers();
        }
    });
});

describe('isSessionMemoryIsolated — 데이터 모듈(env 로 꺼진 add-on 도 유지, 외부 검토 A2)', () => {
    afterEach(() => { data = []; });

    it('채팅 통합 목록에 없어도 데이터 모듈이 격리라 하면 true', async () => {
        __setChatTurnIntegrationsForTest([]);
        data = [{ addonId: 'k', data: { isMemoryIsolatedSession: async (_u: string, sid: string) => sid === 's1' }, error: null }];
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(true);
        expect(await isSessionMemoryIsolated('u1', 's2')).toBe(false);
    });

    it('모듈을 불러오지 못한 add-on 이 있으면 판정을 알 수 없으므로 격리(fail-closed)', async () => {
        __setChatTurnIntegrationsForTest([]);
        data = [{ addonId: 'broken', data: null, error: 'Cannot find module' }];
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(true);
    });

    it('판정이 던지면 격리(fail-closed)', async () => {
        __setChatTurnIntegrationsForTest([]);
        data = [{ addonId: 'k', data: { isMemoryIsolatedSession: async () => { throw new Error('db'); } }, error: null }];
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(true);
    });

    it('게스트·세션 없음은 판정하지 않는다', async () => {
        data = [{ addonId: 'broken', data: null, error: 'x' }];
        expect(await isSessionMemoryIsolated(undefined, 's1')).toBe(false);
        expect(await isSessionMemoryIsolated('u1', undefined)).toBe(false);
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

    it('꺼진 add-on 도 격리 훅은 호출된다(보호 훅은 토글과 무관)', async () => {
        integrationGate.mockResolvedValue({ allowed: false, reason: 'disabled' });
        const isolated = jest.fn(async () => true);
        __setChatTurnIntegrationsForTest([{ id: 'x', isMemoryIsolatedSession: isolated }]);
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(true);
        expect(isolated).toHaveBeenCalledTimes(1);
        expect(integrationGate).not.toHaveBeenCalled();
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

describe('순수 동기 훅의 상태 캐시 게이트 (getActiveChatTurnIntegrations)', () => {
    const offOnly = (id: string) => id !== 'off';

    it('꺼진 add-on 은 활성 목록에서 빠진다', () => {
        isAddonEnabledSync.mockImplementation(offOnly);
        __setChatTurnIntegrationsForTest([{ id: 'off' }, { id: 'on' }]);
        expect(getActiveChatTurnIntegrations().map((i) => i.id)).toEqual(['on']);
    });

    it('detectIntegrationIntents 에 꺼진 add-on 의 키가 없다', () => {
        isAddonEnabledSync.mockImplementation(offOnly);
        const offIntent = jest.fn(() => true);
        __setChatTurnIntegrationsForTest([
            { id: 'off', detectIntent: offIntent },
            { id: 'on', detectIntent: () => true },
        ]);
        expect(detectIntegrationIntents('q')).toEqual({ on: true });
        expect(offIntent).not.toHaveBeenCalled();
    });

    it('collectIntegrationSystemPromptParts 에 꺼진 add-on 의 프롬프트 조각이 없다', () => {
        isAddonEnabledSync.mockImplementation(offOnly);
        const offParts = jest.fn(() => ['OFF-PART']);
        __setChatTurnIntegrationsForTest([
            { id: 'off', systemPromptParts: offParts },
            { id: 'on', systemPromptParts: () => ['ON-PART'] },
            { id: 'none' },
        ]);
        expect(collectIntegrationSystemPromptParts({ message: 'q' })).toEqual(['ON-PART']);
        expect(offParts).not.toHaveBeenCalled();
    });

    it('extractIntegrationBlocks 는 꺼진 add-on 의 블록 추출을 건너뛴다', () => {
        isAddonEnabledSync.mockImplementation(offOnly);
        const offExtract = jest.fn((t: string) => ({ blocks: ['B-OFF'], modelFacing: t }));
        __setChatTurnIntegrationsForTest([
            { id: 'off', extractBlocks: offExtract },
            { id: 'on', extractBlocks: (t: string) => ({ blocks: ['B-ON'], modelFacing: `${t}!` }) },
        ]);
        const state: IntegrationBlocks = {};
        expect(extractIntegrationBlocks('r', state)).toBe('r!');
        expect(state).toEqual({ on: ['B-ON'] });
        expect(offExtract).not.toHaveBeenCalled();
    });

    it('꺼진 add-on 도 보호 훅(격리 판정·숨김 세션)은 호출된다', async () => {
        isAddonEnabledSync.mockImplementation(() => false);
        const isolated = jest.fn(async () => true);
        const hidden = jest.fn(async () => ['s9']);
        __setChatTurnIntegrationsForTest([{ id: 'off', isMemoryIsolatedSession: isolated, listHiddenSessionIds: hidden }]);
        expect(await isSessionMemoryIsolated('u1', 's1')).toBe(true);
        expect([...(await collectHiddenSessionIds('u1'))]).toEqual(['s9']);
        expect(isolated).toHaveBeenCalledTimes(1);
        expect(hidden).toHaveBeenCalledTimes(1);
    });

    it('꺼진 add-on 의 컨텍스트 참조도 collectContextRefs 가 옮겨 받는다(구 필드 포함)', () => {
        isAddonEnabledSync.mockImplementation(() => false);
        __setChatTurnIntegrationsForTest([{ id: 'off', legacyWsContextField: 'notebook' }]);
        expect(collectContextRefs({ notebook: { id: 'n1', title: 'T' } })).toEqual({ off: { id: 'n1', title: 'T' } });
    });
});
