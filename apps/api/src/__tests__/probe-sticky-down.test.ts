/**
 * probeLocalModelAvailability — demote 된 모델의 회복(up) 회귀 테스트.
 *
 * 2026-09-03 운영 실측: ping 1회 abort 로 demote 된 qwen3.8-27b 를 다음 주기 프로브가
 * `available === false` = "명시 비활성" 으로 보고 건너뛰어, 재시작 전까지 6시간 `skipped` 로 남았다.
 * 건너뛰는 것은 카탈로그 명시 비활성(사유 없음 / EXPLICIT_DISABLED_REASON)뿐이어야 한다.
 */
import {
    probeLocalModelAvailability,
    getLocalModels,
    EXPLICIT_DISABLED_REASON,
} from '../config/local-models';

type LocalModelEntry = ReturnType<typeof getLocalModels>[number];

const originalFetch = global.fetch;
let chatPingedModels: string[] = [];

beforeEach(() => {
    chatPingedModels = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        if (url.endsWith('/v1/models')) {
            return { ok: true, status: 200, json: async () => ({ data: getLocalModels().map(m => ({ id: m.id })) }) } as Response;
        }
        if (url.endsWith('/v1/chat/completions')) {
            chatPingedModels.push(body.model);
            return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'x' } }] }) } as Response;
        }
        if (url.endsWith('/v1/embeddings')) {
            return { ok: true, status: 200, json: async () => ({ data: [{ embedding: [0] }] }) } as Response;
        }
        // /model/info(발견)·기타 실측 호출은 실패로 — 카탈로그 변경 없음
        return { ok: false, status: 404, json: async () => ({}) } as Response;
    }) as typeof fetch;
});

afterEach(() => {
    global.fetch = originalFetch;
});

describe('probeLocalModelAvailability — demote 회복', () => {
    let snapshot: LocalModelEntry[];
    beforeEach(() => { snapshot = getLocalModels().map(m => ({ ...m })); });
    afterEach(() => {
        const live = getLocalModels();
        for (let i = 0; i < live.length; i++) Object.assign(live[i], snapshot[i]);
    });

    test('직전 ping 실패로 demote 된 모델은 다음 프로브에서 다시 ping 해 회복한다', async () => {
        const chat = getLocalModels().find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = 'This operation was aborted';

        const r = await probeLocalModelAvailability('http://test', 'sk-test', 1000);
        expect(r.probed).toBe(true);
        expect(chatPingedModels).toContain(chat.id);
        expect(r.available).toContain(chat.id);
        expect(r.skipped).not.toContain(chat.id);
        expect(chat.available).toBe(true);
        expect(chat.unavailableReason).toBeUndefined();
    });

    test('런타임 fallback 이 demote 한 모델(runtime: …)도 다시 ping 한다', async () => {
        const chat = getLocalModels().find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = 'runtime: fast-fail-timeout';

        const r = await probeLocalModelAvailability('http://test', 'sk-test', 1000);
        expect(chatPingedModels).toContain(chat.id);
        expect(r.available).toContain(chat.id);
    });

    test('카탈로그 명시 비활성(사유 없음)은 ping 하지 않고 사유를 고정한다', async () => {
        const chat = getLocalModels().find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = undefined;

        const r = await probeLocalModelAvailability('http://test', 'sk-test', 1000);
        expect(chatPingedModels).not.toContain(chat.id);
        expect(r.skipped).toContain(chat.id);
        expect(chat.available).toBe(false);
        expect(chat.unavailableReason).toBe(EXPLICIT_DISABLED_REASON);
    });

    test('명시 비활성은 두 번째 프로브에서도 계속 건너뛴다', async () => {
        const chat = getLocalModels().find(m => m.role === 'chat');
        if (!chat) return;
        chat.available = false;
        chat.unavailableReason = EXPLICIT_DISABLED_REASON;

        const r = await probeLocalModelAvailability('http://test', 'sk-test', 1000);
        expect(chatPingedModels).not.toContain(chat.id);
        expect(r.skipped).toContain(chat.id);
    });
});
