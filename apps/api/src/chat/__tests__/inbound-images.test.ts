/**
 * 이미지 입력 처리 보강(2026-11-08 점검) — 유입 지점에서 주소 형태 이미지를 data URL 로 바꾼다.
 */
const mockDownload = jest.fn();
jest.mock('../../services/orchestrator/http-call', () => ({
    downloadProviderUrl: (...a: unknown[]) => mockDownload(...a),
}));
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { resolveInboundImages, resolveHistoryImages, InboundImageError } from '../inbound-images';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg==';
const DATA_URL = `data:image/png;base64,${PNG_B64}`;
const freshOpts = () => ({ budget: { remaining: 20 } });

beforeEach(() => {
    mockDownload.mockReset();
});

describe('resolveInboundImages', () => {
    it('data URL·raw base64 는 내려받지 않고 그대로 둔다', async () => {
        const out = await resolveInboundImages([DATA_URL, PNG_B64], freshOpts());
        expect(out).toEqual([DATA_URL, PNG_B64]);
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it('비었거나 없으면 그대로 돌려준다', async () => {
        expect(await resolveInboundImages(undefined, freshOpts())).toBeUndefined();
        expect(await resolveInboundImages([], freshOpts())).toEqual([]);
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it('https 주소는 서버가 받아 data URL 로 바꾼다', async () => {
        mockDownload.mockResolvedValue({ bytes: Buffer.from('abc'), contentType: 'image/png' });
        const out = await resolveInboundImages(['https://example.com/a.png', DATA_URL], freshOpts());
        expect(out).toEqual([`data:image/png;base64,${Buffer.from('abc').toString('base64')}`, DATA_URL]);
        expect(mockDownload).toHaveBeenCalledTimes(1);
        const [url, opts] = mockDownload.mock.calls[0];
        expect(url).toBe('https://example.com/a.png');
        expect(opts.allowTypes).toEqual(['image/']);
        expect(typeof opts.timeoutMs).toBe('number');
        expect(typeof opts.maxBytes).toBe('number');
    });

    it.each(['file:///x', 'ftp://example.com/a.png', 'javascript:alert(1)'])('그 밖의 스킴(%s)은 거부한다', async (img) => {
        await expect(resolveInboundImages([img], freshOpts())).rejects.toBeInstanceOf(InboundImageError);
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it('받은 형식이 이미지 형식이 아니면 거부한다', async () => {
        mockDownload.mockResolvedValue({ bytes: Buffer.from('abc'), contentType: 'image/png,x' });
        await expect(resolveInboundImages(['https://example.com/1.png'], freshOpts())).rejects.toThrow('이미지 주소를 가져올 수 없습니다');
    });

    it('중단 신호를 내려받기에 그대로 넘긴다', async () => {
        mockDownload.mockResolvedValue({ bytes: Buffer.from('abc'), contentType: 'image/png' });
        const signal = new AbortController().signal;
        await resolveInboundImages(['https://example.com/1.png'], { signal, budget: { remaining: 20 } });
        expect(mockDownload.mock.calls[0][1].signal).toBe(signal);
    });

    it('가져오기 실패는 InboundImageError 이고 메시지에 주소가 없다', async () => {
        mockDownload.mockRejectedValue(new Error('blocked: https://example.com/a.png?token=1'));
        const err = await resolveInboundImages(['https://example.com/a.png?token=1'], freshOpts()).catch((e) => e);
        expect(err).toBeInstanceOf(InboundImageError);
        expect(err.message).not.toContain('example.com');
        expect(err.message).not.toContain('token');
    });
});

describe('resolveHistoryImages', () => {
    it('images 가 있는 항목만 바꾸고 없는 항목은 같은 참조를 둔다', async () => {
        mockDownload.mockResolvedValue({ bytes: Buffer.from('xyz'), contentType: 'image/jpeg' });
        type H = { role: string; content: string; images?: string[] };
        const plain: H = { role: 'assistant', content: '답' };
        const withImg: H = { role: 'user', content: '봐', images: ['https://example.com/a.png'] };
        const out = await resolveHistoryImages([plain, withImg], freshOpts());
        expect(out![0]).toBe(plain);
        expect(out![1]).not.toBe(withImg);
        expect(out![1]).toEqual({ ...withImg, images: [`data:image/jpeg;base64,${Buffer.from('xyz').toString('base64')}`] });
        expect(withImg.images).toEqual(['https://example.com/a.png']);
    });

    it('없으면 undefined', async () => {
        expect(await resolveHistoryImages(undefined, freshOpts())).toBeUndefined();
    });

    it('history 항목의 거부 스킴도 InboundImageError', async () => {
        await expect(resolveHistoryImages([{ images: ['file:///x'] }], freshOpts())).rejects.toBeInstanceOf(InboundImageError);
    });
});

describe('요청당 주소 이미지 예산', () => {
    it('현재 턴과 history 를 합쳐 21개째에서 거부하고 내려받기는 20회 이하', async () => {
        mockDownload.mockResolvedValue({ bytes: Buffer.from('abc'), contentType: 'image/png' });
        const urls = (from: number, n: number) => Array.from({ length: n }, (_, i) => `https://example.com/${from + i}.png`);
        const budget = { remaining: 20 };
        const run = Promise.all([
            resolveInboundImages(urls(1, 15), { budget }),
            resolveHistoryImages([{ images: urls(16, 6) }], { budget }),
        ]);
        await expect(run).rejects.toThrow('이미지 주소가 너무 많습니다');
        expect(mockDownload.mock.calls.length).toBeLessThanOrEqual(20);
    });

    it('data URL·raw base64 는 예산을 쓰지 않는다', async () => {
        const budget = { remaining: 0 };
        await expect(resolveInboundImages([DATA_URL, PNG_B64], { budget })).resolves.toEqual([DATA_URL, PNG_B64]);
        expect(budget.remaining).toBe(0);
    });
});
