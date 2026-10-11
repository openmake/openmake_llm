import { emitSearchSources, createTurnSourceEmitter, parseUserLocation } from '../ws-chat-sources';
import { takeMessageSources, clearMessageSources } from '../../chat/message-sources';

describe('ws-chat-sources', () => {
    beforeEach(() => clearMessageSources());

    it('출처가 있으면 search_sources 를 보내고 저장용으로 기록한다', () => {
        const out = jest.fn();
        emitSearchSources(out, 'm1', [{ n: 1, title: 'T', url: 'https://e.example', snippet: 's' }]);
        expect(out).toHaveBeenCalledWith({ type: 'search_sources', messageId: 'm1', sources: [{ n: 1, title: 'T', url: 'https://e.example', snippet: 's' }] });
        expect(takeMessageSources('m1')).toHaveLength(1);
    });

    it('출처가 없으면 아무것도 보내지 않는다', () => {
        const out = jest.fn();
        emitSearchSources(out, 'm1', undefined);
        emitSearchSources(out, 'm1', []);
        expect(out).not.toHaveBeenCalled();
    });

    // 도구 출처 번호가 호출마다 이어지므로(11~, 21~) 마지막 검색 것으로 덮지 않고 턴 단위로 쌓아 보낸다
    it('createTurnSourceEmitter — 턴 시작 출처를 먼저 보내고 도구 출처를 누적해 보낸다', () => {
        const out = jest.fn();
        const src = (n: number) => ({ n, title: `T${n}`, url: `https://e.example/${n}`, snippet: 's' });
        const emit = createTurnSourceEmitter(out, 'm2', [src(1), src(2)]);
        expect(out).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'search_sources', messageId: 'm2', sources: [src(1), src(2)] }));

        emit([src(3), src(4)]);
        emit([src(5)]);
        expect(out).toHaveBeenLastCalledWith(expect.objectContaining({ sources: [src(1), src(2), src(3), src(4), src(5)] }));
        expect(takeMessageSources('m2')?.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    });

    it('createTurnSourceEmitter — 출처 없는 도구 결과는 다시 보내지 않고, 시작 출처가 없어도 도구 출처는 보낸다', () => {
        const out = jest.fn();
        const emit = createTurnSourceEmitter(out, 'm3', []);
        emit(undefined);
        emit([]);
        expect(out).not.toHaveBeenCalled();
        emit([{ n: 1, title: 'T', url: 'https://e.example', snippet: 's' }]);
        expect(out).toHaveBeenCalledTimes(1);
    });

    it('parseUserLocation — 범위 밖·비숫자 무시', () => {
        expect(parseUserLocation({ type: 'chat', userLocation: { lat: 37.5, lng: 127 } } as never)).toEqual({ lat: 37.5, lng: 127 });
        expect(parseUserLocation({ type: 'chat', userLocation: { lat: 91, lng: 0 } } as never)).toBeUndefined();
        expect(parseUserLocation({ type: 'chat', userLocation: { lat: '1', lng: 0 } } as never)).toBeUndefined();
        expect(parseUserLocation({ type: 'chat' } as never)).toBeUndefined();
    });
});
