import { emitSearchSources, parseUserLocation } from '../ws-chat-sources';
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

    it('parseUserLocation — 범위 밖·비숫자 무시', () => {
        expect(parseUserLocation({ type: 'chat', userLocation: { lat: 37.5, lng: 127 } } as never)).toEqual({ lat: 37.5, lng: 127 });
        expect(parseUserLocation({ type: 'chat', userLocation: { lat: 91, lng: 0 } } as never)).toBeUndefined();
        expect(parseUserLocation({ type: 'chat', userLocation: { lat: '1', lng: 0 } } as never)).toBeUndefined();
        expect(parseUserLocation({ type: 'chat' } as never)).toBeUndefined();
    });
});
