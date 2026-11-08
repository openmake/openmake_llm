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

beforeEach(() => {
    mockDownload.mockReset();
});

describe('resolveInboundImages', () => {
    it('data URL·raw base64 는 내려받지 않고 그대로 둔다', async () => {
        const out = await resolveInboundImages([DATA_URL, PNG_B64]);
        expect(out).toEqual([DATA_URL, PNG_B64]);
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it('비었거나 없으면 그대로 돌려준다', async () => {
        expect(await resolveInboundImages(undefined)).toBeUndefined();
        expect(await resolveInboundImages([])).toEqual([]);
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it('https 주소는 서버가 받아 data URL 로 바꾼다', async () => {
        mockDownload.mockResolvedValue({ bytes: Buffer.from('abc'), contentType: 'image/png' });
        const out = await resolveInboundImages(['https://example.com/a.png', DATA_URL]);
        expect(out).toEqual([`data:image/png;base64,${Buffer.from('abc').toString('base64')}`, DATA_URL]);
        expect(mockDownload).toHaveBeenCalledTimes(1);
        const [url, opts] = mockDownload.mock.calls[0];
        expect(url).toBe('https://example.com/a.png');
        expect(opts.allowTypes).toEqual(['image/']);
        expect(typeof opts.timeoutMs).toBe('number');
        expect(typeof opts.maxBytes).toBe('number');
    });

    it.each(['file:///x', 'ftp://example.com/a.png', 'javascript:alert(1)'])('그 밖의 스킴(%s)은 거부한다', async (img) => {
        await expect(resolveInboundImages([img])).rejects.toBeInstanceOf(InboundImageError);
        expect(mockDownload).not.toHaveBeenCalled();
    });

    it('가져오기 실패는 InboundImageError 이고 메시지에 주소가 없다', async () => {
        mockDownload.mockRejectedValue(new Error('blocked: https://example.com/a.png?token=1'));
        const err = await resolveInboundImages(['https://example.com/a.png?token=1']).catch((e) => e);
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
        const out = await resolveHistoryImages([plain, withImg]);
        expect(out![0]).toBe(plain);
        expect(out![1]).not.toBe(withImg);
        expect(out![1]).toEqual({ ...withImg, images: [`data:image/jpeg;base64,${Buffer.from('xyz').toString('base64')}`] });
        expect(withImg.images).toEqual(['https://example.com/a.png']);
    });

    it('없으면 undefined', async () => {
        expect(await resolveHistoryImages(undefined)).toBeUndefined();
    });

    it('history 항목의 거부 스킴도 InboundImageError', async () => {
        await expect(resolveHistoryImages([{ images: ['file:///x'] }])).rejects.toBeInstanceOf(InboundImageError);
    });
});
