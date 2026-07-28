/**
 * 모델 가용성 프로브 단위 테스트.
 *
 * 라이브 실측(2026-07-26): provider 의 /v1/models 가 계정 권한과 무관하게 전체
 * 카탈로그를 반환해, 셀렉터에 보이는 모델을 고르면 실패했다
 * (Ollama Cloud 18종 중 10종 403 구독전용, NVIDIA 118종 중 61종 404).
 *
 * 핵심 규칙 — **일시 오류로 모델을 죽이지 않는다**. 한도(429)·인증 실패·업스트림
 * 장애는 '판정 보류'로 두고 기록하지 않는다. 잘못 기록하면 멀쩡한 모델이 사라진다.
 */
import { probeProviderModels } from '../model-availability-probe';
import { ProviderError } from '../../providers/provider-errors';

const streamChatMock = jest.fn();
const createInstanceMock = jest.fn();

jest.mock('../../providers/provider-router', () => ({
    createExternalProviderInstance: (...args: unknown[]) => createInstanceMock(...args),
    buildOAuthSessionPersist: () => ({}),
}));

function makeRepo(models: string[]) {
    return {
        getByUserAndProvider: jest.fn().mockResolvedValue({
            providerId: 'ollama-cloud', sdkType: 'openai-compatible', authMethod: 'api_key', baseUrl: 'https://x/v1',
        }),
        decryptKey: jest.fn().mockResolvedValue('key'),
        markModelAvailability: jest.fn().mockResolvedValue(undefined),
        __models: models,
    } as never;
}

beforeEach(() => {
    streamChatMock.mockReset();
    createInstanceMock.mockReset();
    createInstanceMock.mockImplementation(() => ({
        listModels: async () => ['a', 'b', 'c'].map((id) => ({ id })),
        streamChat: streamChatMock,
    }));
});

describe('probeProviderModels', () => {
    it('403 구독전용은 사용 불가로 기록한다', async () => {
        streamChatMock.mockImplementation(async (opts: { modelId: string }) => {
            if (opts.modelId === 'b') throw new ProviderError('SUBSCRIPTION_REQUIRED', '구독 전용');
            return { content: '', usage: {}, finishReason: 'stop' };
        });
        const repo = makeRepo([]);
        const r = await probeProviderModels('u1', 'ollama-cloud', repo, { concurrency: 1 });

        expect(r.usable).toBe(2);
        expect(r.unusable).toBe(1);
        expect(r.unusableModels[0].modelId).toBe('b');
        expect((repo as never as { markModelAvailability: jest.Mock }).markModelAvailability)
            .toHaveBeenCalledWith(expect.objectContaining({ modelId: 'b', usable: false }));
    });

    it('404 모델 미발견도 사용 불가로 기록한다', async () => {
        streamChatMock.mockImplementation(async (opts: { modelId: string }) => {
            if (opts.modelId !== 'a') throw new ProviderError('MODEL_NOT_FOUND', '404');
            return { content: '', usage: {}, finishReason: 'stop' };
        });
        const r = await probeProviderModels('u1', 'ollama-cloud', makeRepo([]), { concurrency: 1 });
        expect(r.usable).toBe(1);
        expect(r.unusable).toBe(2);
    });

    it('한도 초과(429)는 판정 보류 — 모델을 죽이지 않는다', async () => {
        streamChatMock.mockImplementation(async () => {
            throw new ProviderError('QUOTA_EXCEEDED', '한도 초과');
        });
        const repo = makeRepo([]);
        const r = await probeProviderModels('u1', 'ollama-cloud', repo, { concurrency: 1 });

        expect(r.unusable).toBe(0);
        expect(r.inconclusive).toBe(3);
        expect((repo as never as { markModelAvailability: jest.Mock }).markModelAvailability)
            .not.toHaveBeenCalledWith(expect.objectContaining({ usable: false }));
    });

    it('인증 실패도 판정 보류 (키 문제지 모델 문제가 아님)', async () => {
        streamChatMock.mockImplementation(async () => {
            throw new ProviderError('INVALID_API_KEY', '키 오류');
        });
        const r = await probeProviderModels('u1', 'ollama-cloud', makeRepo([]), { concurrency: 1 });
        expect(r.unusable).toBe(0);
        expect(r.inconclusive).toBe(3);
    });

    it('성공한 모델은 usable=true 로 기록한다', async () => {
        streamChatMock.mockResolvedValue({ content: '', usage: {}, finishReason: 'stop' });
        const repo = makeRepo([]);
        const r = await probeProviderModels('u1', 'ollama-cloud', repo, { concurrency: 2 });
        expect(r.usable).toBe(3);
        expect((repo as never as { markModelAvailability: jest.Mock }).markModelAvailability)
            .toHaveBeenCalledWith(expect.objectContaining({ usable: true }));
    });

    it('modelIds 를 주면 카탈로그 조회 없이 해당 모델만 점검한다', async () => {
        streamChatMock.mockResolvedValue({ content: '', usage: {}, finishReason: 'stop' });
        const r = await probeProviderModels('u1', 'ollama-cloud', makeRepo([]), {
            modelIds: ['only-one'], concurrency: 1,
        });
        expect(r.total).toBe(1);
        expect(streamChatMock).toHaveBeenCalledTimes(1);
    });

    it('키 미등록이면 ProviderError 를 던진다', async () => {
        const repo = { getByUserAndProvider: jest.fn().mockResolvedValue(null) } as never;
        await expect(probeProviderModels('u1', 'ollama-cloud', repo))
            .rejects.toBeInstanceOf(ProviderError);
    });
});
