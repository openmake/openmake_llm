/**
 * tryFallbackAfterFailure 단위 테스트.
 *
 * 시나리오:
 *  1. fallbackable error + chat role + 다른 가용 모델 존재 → fallback 반환 + demote
 *  2. non-fallbackable error → null
 *  3. fallbackable error + 가용 모델 없음 → null + demote
 *  4. embedding role 실패 → null (fallback 안 함)
 */
import { tryFallbackAfterFailure } from '../providers/local-llm-fallback';
import { getLocalModels } from '../config/local-models';

type LocalModelEntry = ReturnType<typeof getLocalModels>[number];

describe('tryFallbackAfterFailure', () => {
    // 테스트 격리 — 각 테스트 시작 시 카탈로그 상태 백업/복원
    let original: LocalModelEntry[];

    beforeEach(() => {
        original = getLocalModels().map(m => ({ ...m }));
    });

    afterEach(() => {
        const live = getLocalModels();
        for (let i = 0; i < live.length; i++) {
            Object.assign(live[i], original[i]);
        }
    });

    test('fallbackable + 다른 chat 모델 존재 → fallback 반환 + 실패 모델 demote', () => {
        const live = getLocalModels();
        const chatModels = live.filter(m => m.role === 'chat');
        if (chatModels.length < 2) return;  // 카탈로그에 chat 2개 이상 있을 때만

        chatModels.forEach(m => { m.available = true; delete m.unavailableReason; });

        const failedId = chatModels[0].id;
        const err = new Error('UPSTREAM_ERROR: fetch failed');
        const r = tryFallbackAfterFailure(failedId, err);

        expect(r).not.toBeNull();
        expect(r!.fallbackModelId).not.toBe(failedId);
        expect(chatModels[0].available).toBe(false);
        expect(chatModels[0].unavailableReason).toMatch(/runtime:/);
    });

    test('non-fallbackable error → null 반환 + demote 안 함', () => {
        const live = getLocalModels();
        const chatModels = live.filter(m => m.role === 'chat');
        if (chatModels.length === 0) return;
        chatModels.forEach(m => { m.available = true; delete m.unavailableReason; });

        const failedId = chatModels[0].id;
        const err = new Error('quota exceeded');
        const r = tryFallbackAfterFailure(failedId, err);

        expect(r).toBeNull();
        expect(chatModels[0].available).toBe(true);
    });

    test('fallbackable + 다른 가용 chat 모델 없음 → null + 실패 모델만 demote', () => {
        const live = getLocalModels();
        const chatModels = live.filter(m => m.role === 'chat');
        if (chatModels.length === 0) return;

        // 모두 unavailable 로 두고 첫 번째만 available
        chatModels.forEach(m => { m.available = false; });
        chatModels[0].available = true;
        delete chatModels[0].unavailableReason;

        const r = tryFallbackAfterFailure(chatModels[0].id, new Error('ECONNREFUSED'));
        expect(r).toBeNull();
        expect(chatModels[0].available).toBe(false);
    });

    test('FAST_FAIL_TIMEOUT_EXCEEDED → fallbackable (reason=fast-fail-timeout)', () => {
        const live = getLocalModels();
        const chatModels = live.filter(m => m.role === 'chat');
        if (chatModels.length < 2) return;
        chatModels.forEach(m => { m.available = true; delete m.unavailableReason; });

        const failedId = chatModels[0].id;
        const err = new Error('FAST_FAIL_TIMEOUT_EXCEEDED (5000ms)');
        const r = tryFallbackAfterFailure(failedId, err);

        expect(r).not.toBeNull();
        expect(chatModels[0].available).toBe(false);
        expect(chatModels[0].unavailableReason).toMatch(/runtime: fast-fail-timeout/);
    });

    test('embedding role 실패 → null (dim 불일치 위험으로 fallback 안 함)', () => {
        const live = getLocalModels();
        const embed = live.find(m => m.role === 'embedding');
        if (!embed) return;
        embed.available = true;
        delete embed.unavailableReason;

        const r = tryFallbackAfterFailure(embed.id, new Error('fetch failed'));
        expect(r).toBeNull();
        // embedding 도 demote 자체는 발생
        expect(embed.available).toBe(false);
    });
});
