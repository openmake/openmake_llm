/**
 * toOpenAIMessages 이미지 블록 — data URL 만 image_url 로 싣는다(이미지 입력 처리 보강, 2026-11-08 점검).
 */
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { toOpenAIMessages } from '../openai-request';
import type { ChatMessage } from '../types';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo';

describe('toOpenAIMessages images', () => {
    it('data URL 은 image_url 블록으로 싣는다', () => {
        const out = toOpenAIMessages([{ role: 'user', content: '봐', images: [DATA_URL] } as ChatMessage]);
        expect(out[0]).toEqual({
            role: 'user',
            content: [{ type: 'text', text: '봐' }, { type: 'image_url', image_url: { url: DATA_URL } }],
        });
    });

    it('스킴이 있는 주소는 블록을 만들지 않는다(텍스트 블록만)', () => {
        const out = toOpenAIMessages([
            { role: 'user', content: '봐', images: ['https://example.com/a.png', 'file:///x'] } as ChatMessage,
        ]);
        expect(out[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '봐' }] });
    });
});
