/** 라벨 인용 마커 정의(citation-markers) — 받는 꼴·안 받는 꼴, 7개 언어(라벨 6종). */
import { CITATION_MARKER_SRC, SOURCE_LABEL_ALT } from '../citation-markers';
import { WEB_SEARCH_TEMPLATES } from '../../../sockets/ws-chat-locales';

const whole = (s: string) => new RegExp(`^${CITATION_MARKER_SRC}$`, 'i').test(s);

describe('CITATION_MARKER_SRC', () => {
    it.each([
        '[출처 3]', '[출처 3, 8]', '[출처 11, 출처 16, 출처 17]', '[출처 11,출처 16]', '[Source 1, Source 2]',
        '[출처 3, 출처 8, 9]', '[source 1, SOURCE 2]', '[出典 1、出典 2]', '[출처 1 · 출처 2]',
    ])('받는 꼴: %s', (s) => expect(whole(s)).toBe(true));

    it.each([
        '[14]', '[제목 99](https://x.com)', '[출처]', '[출처 11 출처 16]', '[출처 1 및 출처 2]', '[출처 1; 출처 2]',
        '[출처 1, 출처]', '[来源 1，来源 2]',
    ])('안 받는 꼴: %s', (s) => expect(new RegExp(CITATION_MARKER_SRC, 'i').test(s)).toBe(false));

    it('7개 언어(라벨 6종)의 sourceLabel 을 모두 받는다 — 단독·묶음 모두', () => {
        const labels = [...new Set(Object.values(WEB_SEARCH_TEMPLATES).map((t) => t.sourceLabel))];
        expect(labels).toHaveLength(6);
        expect(SOURCE_LABEL_ALT.split('|')).toHaveLength(6);
        for (const l of labels) {
            expect(whole(`[${l} 3]`)).toBe(true);
            expect(whole(`[${l} 1, ${l} 2]`)).toBe(true);
        }
    });
});
