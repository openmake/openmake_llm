/**
 * OpenAICompatProvider.validateCredentials — 모델 목록 조회만으로는 키를 검증하지 못한다.
 *
 * 2026-10-03 실측(hasa): `/models` 는 무효 키에도 200 을 줘서 검증이 ok 였는데, 실제 호출은
 * 403 invalid_api_key 로 거절됐다. 그래서 목록 조회 뒤 1토큰 호출로 키를 확인한다.
 */
import { OpenAICompatProvider } from '../openai-compat-provider';

type Mocked = { catalogClient: { models: { list: jest.Mock }; chat: { completions: { create: jest.Mock } } } };

function make(models: string[], ping: () => Promise<unknown>) {
    const provider = new OpenAICompatProvider({ providerId: 'hasa', apiKey: 'sk-test', baseUrl: 'https://example.invalid/v1' });
    const c = (provider as unknown as Mocked).catalogClient;
    c.models.list = jest.fn().mockResolvedValue({ data: models.map((id) => ({ id })) });
    c.chat.completions.create = jest.fn().mockImplementation(ping);
    return { provider, c };
}
const httpErr = (status: number, message: string) => Object.assign(new Error(message), { status });

describe('validateCredentials', () => {
    it('목록 조회와 1토큰 호출이 모두 되면 ok', async () => {
        const { provider, c } = make(['bge-m3', 'nemotron-super-120b'], async () => ({ choices: [] }));
        const r = await provider.validateCredentials();
        expect(r.ok).toBe(true);
        // 채팅이 안 되는 모델(임베딩)은 건너뛰고 첫 채팅 모델로 확인한다
        expect(c.chat.completions.create.mock.calls[0][0]).toMatchObject({ model: 'nemotron-super-120b', max_tokens: 1 });
    });

    it('목록은 되는데 호출이 키 거절(403 invalid_api_key)이면 실패로 판정한다', async () => {
        const { provider } = make(['nemotron-super-120b'], async () => { throw httpErr(403, "security_policy_blocked: 유효하지 않거나 만료된 API Key를 사용했습니다. violation_code: invalid_api_key"); });
        const r = await provider.validateCredentials();
        expect(r.ok).toBe(false);
        expect(r.error).toContain('API 키');
    });

    it('401 도 키 거절이다', async () => {
        const { provider } = make(['m-70b'], async () => { throw httpErr(401, 'Unauthorized'); });
        expect((await provider.validateCredentials()).ok).toBe(false);
    });

    it('키와 무관한 실패(구독 전용 403·잔액·404·시간 초과)는 키 검증을 떨어뜨리지 않는다', async () => {
        for (const e of [httpErr(403, 'this model requires a subscription, upgrade for access'), httpErr(402, 'Payment required'), httpErr(404, 'model not found'), new Error('timeout')]) {
            const { provider } = make(['m-70b'], async () => { throw e; });
            expect((await provider.validateCredentials()).ok).toBe(true);
        }
    });

    it('채팅 모델이 하나도 없으면 목록 조회 결과만으로 판정한다(호출 없음)', async () => {
        const { provider, c } = make(['bge-m3', 'whisper-1'], async () => ({}));
        expect((await provider.validateCredentials()).ok).toBe(true);
        expect(c.chat.completions.create).not.toHaveBeenCalled();
    });

    it('목록 조회가 실패하면 종전처럼 실패', async () => {
        const { provider, c } = make([], async () => ({}));
        c.models.list = jest.fn().mockRejectedValue(httpErr(401, 'bad key'));
        expect((await provider.validateCredentials()).ok).toBe(false);
    });
});
