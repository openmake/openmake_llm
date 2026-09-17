import { recordMessageSources, takeMessageSources, normalizeSources, clearMessageSources } from '../message-sources';
import { MESSAGE_SOURCES_LIMITS } from '../../config/runtime-limits';

const src = (n: number) => ({ n, title: `t${n}`, url: `https://e.example/${n}`, snippet: 's' });

describe('message-sources', () => {
    beforeEach(() => clearMessageSources());

    it('기록 후 한 번만 꺼낸다, 같은 턴의 마지막 목록이 이긴다', () => {
        recordMessageSources('m1', [src(1)], 0);
        recordMessageSources('m1', [src(1), src(2)], 10);
        expect(takeMessageSources('m1', 20)?.map((s) => s.n)).toEqual([1, 2]);
        expect(takeMessageSources('m1', 30)).toBeUndefined();
        expect(takeMessageSources(undefined)).toBeUndefined();
    });

    it('TTL 이 지나면 저장하지 않는다', () => {
        recordMessageSources('m2', [src(1)], 0);
        expect(takeMessageSources('m2', MESSAGE_SOURCES_LIMITS.TTL_MS + 1)).toBeUndefined();
    });

    it('정규화 — 개수·길이 상한, 빈 목록은 기록하지 않는다', () => {
        const many = Array.from({ length: MESSAGE_SOURCES_LIMITS.MAX_SOURCES + 5 }, (_, i) => ({ ...src(i + 1), title: 'x'.repeat(1000) }));
        const n = normalizeSources(many);
        expect(n).toHaveLength(MESSAGE_SOURCES_LIMITS.MAX_SOURCES);
        expect(n[0].title).toHaveLength(MESSAGE_SOURCES_LIMITS.MAX_TITLE_CHARS);
        recordMessageSources('m3', [], 0);
        expect(takeMessageSources('m3', 1)).toBeUndefined();
    });
});
