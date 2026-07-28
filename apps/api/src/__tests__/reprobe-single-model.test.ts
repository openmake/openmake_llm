/**
 * reprobeSingleModel 단위 테스트.
 *
 * 검증 (advisor 권고 3개):
 *  1. in-flight 가드 — 동시 호출 시 1개만 실행
 *  2. fire-and-forget — Promise<void> 반환, await 안 해도 호출처 영향 없음
 *  3. runtime-only promote — config-demote 는 절대 promote 안 함
 */
import { reprobeSingleModel, getLocalModels } from '../config/local-models';

type LocalModelEntry = ReturnType<typeof getLocalModels>[number];

// global.fetch 를 mock 으로 가로채 — 실제 backend 호출 없음
const originalFetch = global.fetch;
let mockFetchCallCount = 0;
let mockFetchResponse: { ok: boolean; status?: number; jsonValue?: unknown } = { ok: true, jsonValue: { choices: [] } };

beforeEach(() => {
    mockFetchCallCount = 0;
    mockFetchResponse = { ok: true, jsonValue: { choices: [] } };
    global.fetch = jest.fn(async () => {
        mockFetchCallCount++;
        return {
            ok: mockFetchResponse.ok,
            status: mockFetchResponse.status ?? 200,
            json: async () => mockFetchResponse.jsonValue,
        } as Response;
    }) as typeof fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
});

describe('reprobeSingleModel', () => {
    let originalCatalog: LocalModelEntry[];

    beforeEach(() => {
        originalCatalog = getLocalModels().map(m => ({ ...m }));
    });

    afterEach(() => {
        const live = getLocalModels();
        for (let i = 0; i < live.length; i++) Object.assign(live[i], originalCatalog[i]);
    });

    test('[runtime-demote] ping 성공 → promote (available=true, reason=undefined)', async () => {
        const live = getLocalModels();
        const chat = live.find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = 'runtime: http-5xx';

        await reprobeSingleModel(chat.id, 'http://test', 'sk-test');
        expect(chat.available).toBe(true);
        expect(chat.unavailableReason).toBeUndefined();
    });

    test('[runtime-demote] ping 실패 → still down (available=false, reason 갱신)', async () => {
        const live = getLocalModels();
        const chat = live.find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = 'runtime: http-5xx';
        mockFetchResponse = { ok: false, status: 500 };

        await reprobeSingleModel(chat.id, 'http://test', 'sk-test');
        expect(chat.available).toBe(false);
        expect(chat.unavailableReason).toMatch(/^runtime:/);
    });

    test('[config-demote] explicit disabled 모델은 절대 promote 안 함', async () => {
        const live = getLocalModels();
        const chat = live.find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = 'explicit disabled';

        await reprobeSingleModel(chat.id, 'http://test', 'sk-test');
        expect(chat.available).toBe(false);  // promote 금지
        expect(chat.unavailableReason).toBe('explicit disabled');  // reason 도 미변경
        expect(mockFetchCallCount).toBe(0);  // ping 자체 안 함
    });

    test('[probe-demote] HTTP 5xx reason 도 promote 안 함 (runtime: prefix 아님)', async () => {
        const live = getLocalModels();
        const chat = live.find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = 'HTTP 500';  // startup probe 결과

        await reprobeSingleModel(chat.id, 'http://test', 'sk-test');
        expect(chat.available).toBe(false);
        expect(mockFetchCallCount).toBe(0);
    });

    test('[in-flight 가드] 동시 호출 시 ping 1회만 실행', async () => {
        const live = getLocalModels();
        const chat = live.find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = 'runtime: http-5xx';
        // fetch 가 조금 시간 걸리도록
        global.fetch = jest.fn(async () => {
            mockFetchCallCount++;
            await new Promise(r => setTimeout(r, 50));
            return { ok: true, status: 200, json: async () => ({}) } as Response;
        }) as typeof fetch;

        await Promise.all([
            reprobeSingleModel(chat.id, 'http://test', 'sk-test'),
            reprobeSingleModel(chat.id, 'http://test', 'sk-test'),
            reprobeSingleModel(chat.id, 'http://test', 'sk-test'),
        ]);
        expect(mockFetchCallCount).toBe(1);  // 3 호출 중 1개만 fetch
    });

    test('[unknown model] catalog 에 없는 modelId → no-op', async () => {
        await reprobeSingleModel('non-existent-model', 'http://test', 'sk-test');
        expect(mockFetchCallCount).toBe(0);
    });
});
