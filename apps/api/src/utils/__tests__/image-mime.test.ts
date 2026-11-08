/**
 * buildImageDataUrl — data URL·raw base64 만 받는다(이미지 입력 처리 보강, 2026-11-08 점검).
 */
import { buildImageDataUrl } from '../image-mime';

describe('buildImageDataUrl', () => {
    it('data URL 은 그대로', () => {
        expect(buildImageDataUrl('data:image/webp;base64,AAAA')).toBe('data:image/webp;base64,AAAA');
    });

    it.each([
        ['iVBORw0KGgo', 'image/png'],
        ['/9j/4AAQ', 'image/jpeg'],
        ['R0lGODlh', 'image/gif'],
        ['UklGRiQA', 'image/webp'],
    ])('raw base64 %s 는 %s data URL 로 감싼다', (b64, mime) => {
        expect(buildImageDataUrl(b64)).toBe(`data:${mime};base64,${b64}`);
    });

    it.each(['http://example.com/a.png', 'https://example.com/a.png', 'file:///x', 'HTTPS://example.com/a.png', 'ftp://example.com/a.png'])(
        '스킴이 있는 주소(%s)는 undefined', (img) => {
            expect(buildImageDataUrl(img)).toBeUndefined();
        },
    );
});
