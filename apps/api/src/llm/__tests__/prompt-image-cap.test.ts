import { capPromptImages } from '../prompt-image-cap';
import type { ChatMessage } from '../types';

const img = (n: number): string[] => Array.from({ length: n }, (_, i) => `img${i}`);

describe('capPromptImages', () => {
    it('상한 이하면 입력 배열을 그대로 돌려준다', () => {
        const msgs: ChatMessage[] = [
            { role: 'user', content: 'a', images: img(3) },
            { role: 'user', content: 'b', images: img(5) },
        ];
        const r = capPromptImages(msgs, 8);
        expect(r.messages).toBe(msgs);
        expect(r).toMatchObject({ total: 8, dropped: 0 });
    });

    it('상한 초과 시 오래된 메시지의 이미지부터 제외하고 최신은 보존한다', () => {
        const msgs: ChatMessage[] = [
            { role: 'user', content: 'old', images: img(4) },
            { role: 'assistant', content: 'r' },
            { role: 'user', content: 'mid', images: img(3) },
            { role: 'user', content: 'new', images: img(4) },
        ];
        const r = capPromptImages(msgs, 8);
        expect(r).toMatchObject({ total: 11, dropped: 3 });
        expect(r.messages[0].images).toEqual(['img3']);        // 4 → 1 (앞쪽부터 제외)
        expect(r.messages[2].images).toEqual(img(3));          // 그대로
        expect(r.messages[3].images).toEqual(img(4));          // 최신 보존
        expect(msgs[0].images).toHaveLength(4);                // 입력 불변
    });

    it('한 메시지가 상한을 통째로 넘으면 그 메시지 안에서도 최신 첨부를 남긴다', () => {
        const msgs: ChatMessage[] = [
            { role: 'user', content: 'old', images: img(2) },
            { role: 'user', content: 'goal', images: img(12) },
        ];
        const r = capPromptImages(msgs, 8);
        expect(r.messages[0].images).toBeUndefined();          // 전부 제외 → 필드 제거
        expect(r.messages[1].images).toEqual(img(12).slice(4));
        expect(r.dropped).toBe(6);
    });

    it('assistant 메시지의 images 는 wire 에 실리지 않으므로 세지 않는다', () => {
        const msgs: ChatMessage[] = [
            { role: 'assistant', content: 'x', images: img(9) },
            { role: 'user', content: 'y', images: img(2) },
        ];
        expect(capPromptImages(msgs, 8).dropped).toBe(0);
    });

    it('cap <= 0 이면 비활성', () => {
        const msgs: ChatMessage[] = [{ role: 'user', content: 'a', images: img(30) }];
        expect(capPromptImages(msgs, 0).messages).toBe(msgs);
    });
});
