/**
 * 접근 불가 모델 자동 학습 — 일시 지연(무응답 시한 UPSTREAM_TIMEOUT)으로 멀쩡한 모델을 목록에서 숨기면 안 된다.
 */
import { markModelUnusableFireAndForget } from '../external-model-availability';
import type { ResolvedProvider } from '../../../providers/provider-router';

const resolved = { providerId: 'gemini', modelId: 'gemini-3.8-flash', fullId: 'gemini:gemini-3.8-flash' } as unknown as ResolvedProvider;

function depsWith(markModelAvailability: jest.Mock) {
    return { providerRouter: { getExternalKeysRepo: () => ({ markModelAvailability }) } } as never;
}

describe('markModelUnusableFireAndForget', () => {
    it('UPSTREAM_TIMEOUT 은 사용불가로 학습하지 않는다', () => {
        const mark = jest.fn().mockResolvedValue(undefined);
        markModelUnusableFireAndForget(depsWith(mark), 'u1', resolved, 'UPSTREAM_TIMEOUT', new Error('stall'));
        expect(mark).not.toHaveBeenCalled();
    });

    it('대조: MODEL_NOT_FOUND 는 학습한다', () => {
        const mark = jest.fn().mockResolvedValue(undefined);
        markModelUnusableFireAndForget(depsWith(mark), 'u1', resolved, 'MODEL_NOT_FOUND', new Error('404'));
        expect(mark).toHaveBeenCalledTimes(1);
    });
});
