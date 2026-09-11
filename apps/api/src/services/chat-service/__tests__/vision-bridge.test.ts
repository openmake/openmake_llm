/** vision-bridge — 미배정 null / 호출 wire(게이트웨이·헤더·image_url) / 상한 초과 생략 / 실패 throw */
const mockResolve = jest.fn();
jest.mock('../../modality-resolver', () => {
    const actual = jest.requireActual('../../modality-resolver');
    return { ...actual, resolveModalityTarget: (...a: unknown[]) => mockResolve(...a) };
});
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { describeImagesForTextModel, applyVisionBridge } from '../vision-bridge';
import { ModalityUnavailableError } from '../../modality-resolver';
import { MODALITY_LIMITS } from '../../../config/modality';

const target = {
    modality: 'vision', fullId: 'hasa:qwen-vl', providerId: 'hasa', model: 'hasa/qwen-vl',
    baseUrl: 'http://gw', endpoint: '/v1/chat/completions',
    headers: { Authorization: 'Bearer m', 'x-api-key': 'k' }, params: { detail: 'low' }, source: 'user',
};
const okFetch = (text = '이미지 1: 빨간 원') => jest.fn(async () => ({
    ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }), text: async () => '',
})) as unknown as typeof fetch;

beforeEach(() => mockResolve.mockReset());

it('vision 미배정이면 null (호출부가 종전 400)', async () => {
    mockResolve.mockRejectedValue(new ModalityUnavailableError('x', 'MODALITY_UNASSIGNED'));
    const r = await describeImagesForTextModel({ images: ['AAAA'], userMessage: 'q', lang: 'ko', fetchImpl: okFetch() });
    expect(r).toBeNull();
});

it('키 없음 등 다른 사유는 throw (조용한 폴백 금지)', async () => {
    mockResolve.mockRejectedValue(new ModalityUnavailableError('no key', 'MODALITY_KEY_MISSING'));
    await expect(describeImagesForTextModel({ images: ['AAAA'], userMessage: 'q', lang: 'ko', fetchImpl: okFetch() })).rejects.toMatchObject({ code: 'MODALITY_KEY_MISSING' });
});

it('게이트웨이 1곳으로 image_url 블록 + 헤더 계약 + params.detail 을 싣는다', async () => {
    mockResolve.mockResolvedValue(target);
    const f = okFetch();
    const r = await describeImagesForTextModel({ images: ['data:image/png;base64,AAAA', 'BBBB'], userMessage: '이게 뭐야', userId: 'u1', lang: 'ko', fetchImpl: f });
    expect(r).toMatchObject({ fullId: 'hasa:qwen-vl', imageCount: 2, skipped: 0 });
    expect(r!.note).toContain('관찰 기록');
    expect(r!.note).toContain('이미지 1: 빨간 원');
    const [url, init] = (f as unknown as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://gw/v1/chat/completions');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('hasa/qwen-vl');
    expect(body.stream).toBe(false);
    const blocks = body.messages[1].content;
    expect(blocks.filter((b: { type: string }) => b.type === 'image_url')).toHaveLength(2);
    expect(blocks[1].image_url.url).toBe('data:image/png;base64,AAAA');
    expect(blocks[2].image_url.url).toMatch(/^data:image\//);
    expect(blocks[1].image_url.detail).toBe('low');
    expect(mockResolve).toHaveBeenCalledWith('vision', 'u1');
});

it('상한 초과 이미지는 생략하고 안내를 붙인다', async () => {
    mockResolve.mockResolvedValue(target);
    const images = Array.from({ length: MODALITY_LIMITS.VISION_BRIDGE_MAX_IMAGES + 2 }, () => 'AAAA');
    const r = await describeImagesForTextModel({ images, userMessage: '', lang: 'en', fetchImpl: okFetch('Image 1: x') });
    expect(r).toMatchObject({ imageCount: MODALITY_LIMITS.VISION_BRIDGE_MAX_IMAGES, skipped: 2 });
    expect(r!.note).toContain('2 skipped');
});

it('HTTP 오류·빈 응답은 throw', async () => {
    mockResolve.mockResolvedValue(target);
    const bad = jest.fn(async () => ({ ok: false, status: 502, text: async () => 'upstream', json: async () => ({}) })) as unknown as typeof fetch;
    await expect(describeImagesForTextModel({ images: ['AAAA'], userMessage: '', lang: 'ko', fetchImpl: bad })).rejects.toThrow(/HTTP 502/);
    await expect(describeImagesForTextModel({ images: ['AAAA'], userMessage: '', lang: 'ko', fetchImpl: okFetch('   ') })).rejects.toThrow(/비어/);
});

describe('applyVisionBridge — 기록은 req.message 와 ctx.enhancedMessage 둘 다에, 이미지는 제거', () => {
    it('enhancedMessage 가 있으면 그 뒤에 붙는다(외부 경로 user 턴 본문은 enhancedMessage 우선)', () => {
        const req = { message: '뭐가 보여?', images: ['AAAA'], history: [{ role: 'user', content: '이전', images: ['BBBB'] }] } as never;
        const { req: r, ctx } = applyVisionBridge(req, { enhancedMessage: '[스킬 컨텍스트]\n뭐가 보여?' }, '[관찰]\n이미지 1: 빨간 원');
        expect(ctx.enhancedMessage).toBe('[스킬 컨텍스트]\n뭐가 보여?\n\n[관찰]\n이미지 1: 빨간 원');
        expect(r.message).toContain('이미지 1: 빨간 원');
        expect(r.images).toBeUndefined();
        expect(r.history?.[0].images).toBeUndefined();
    });
    it('enhancedMessage 가 없으면 req.message 기준으로 만든다', () => {
        const { ctx } = applyVisionBridge({ message: 'q', images: ['A'] } as never, {} as { enhancedMessage?: string }, 'N');
        expect(ctx.enhancedMessage).toBe('q\n\nN');
    });
});
