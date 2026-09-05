/**
 * ws-stream-registry — 소켓이 끊겨도 생성을 이어 가고 재연결 시 이어받는 규약 검증.
 * 회귀 대상: "탭 전환/앱 백그라운드 → 응답 없음" (2026-09-05).
 */
import { InFlightStreamRegistry, resolveStreamKey } from '../ws-stream-registry';
import type { ExtendedWebSocket } from '../ws-types';

function fakeWs(userId: string | null = 'u1'): ExtendedWebSocket & { sent: unknown[] } {
    const sent: unknown[] = [];
    return {
        OPEN: 1,
        readyState: 1,
        send: (raw: string) => { sent.push(JSON.parse(raw)); },
        sent,
        _authenticatedUserId: userId,
        _authenticatedUserRole: 'user',
        _abortController: null,
        _isAlive: true,
    } as unknown as ExtendedWebSocket & { sent: unknown[] };
}

describe('InFlightStreamRegistry', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('attached 상태에서는 소켓으로 바로 보낸다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1024);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.send(entry, { type: 'token', token: 'ab', messageId: 'm1' });
        expect(ws.sent).toEqual([{ type: 'token', token: 'ab', messageId: 'm1' }]);
        expect(entry.content).toBe('ab');
    });

    it('소켓 종료 후에도 abort 하지 않고 버퍼에 쌓았다가 재연결 소켓에 스냅샷+재생한다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws1 = fakeWs();
        const ac = new AbortController();
        const entry = reg.open('u:u1', ws1, ac);
        reg.send(entry, { type: 'token', token: '안녕', messageId: 'm1' });

        expect(reg.detach(ws1)).toBe(true);
        reg.send(entry, { type: 'token', token: '하세요' });
        reg.send(entry, { type: 'session_created', sessionId: 's1' });
        reg.send(entry, { type: 'artifact_start', artifact: { id: 'a1' } });
        expect(ac.signal.aborted).toBe(false);

        const ws2 = fakeWs();
        expect(reg.attach('u:u1', ws2)).toBe(true);
        expect(ws2.sent[0]).toEqual({
            type: 'stream_resume', messageId: 'm1', sessionId: 's1', content: '안녕하세요', finished: false,
        });
        expect(ws2.sent.slice(1)).toEqual([
            { type: 'session_created', sessionId: 's1' },
            { type: 'artifact_start', artifact: { id: 'a1' } },
        ]);
        expect(ws2._abortController).toBe(ac);

        // 이어서 오는 이벤트는 새 소켓으로
        reg.send(entry, { type: 'done', messageId: 'm1' });
        expect(ws2.sent.at(-1)).toEqual({ type: 'done', messageId: 'm1' });
    });

    it('유예 안에 재연결이 없으면 그때 abort 한다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws = fakeWs();
        const ac = new AbortController();
        reg.open('u:u1', ws, ac);
        reg.detach(ws);
        jest.advanceTimersByTime(999);
        expect(ac.signal.aborted).toBe(false);
        jest.advanceTimersByTime(1);
        expect(ac.signal.aborted).toBe(true);
        expect(reg.attach('u:u1', fakeWs())).toBe(false);
    });

    it('detach 중 끝난 스트림은 보관 시간 동안 늦은 재연결에도 스냅샷+done 을 준다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.detach(ws);
        reg.send(entry, { type: 'token', token: '결과' });
        reg.send(entry, { type: 'done', messageId: 'm1', metrics: { tokenCount: 1 } });
        reg.close(entry);

        jest.advanceTimersByTime(400);
        const ws2 = fakeWs();
        expect(reg.attach('u:u1', ws2)).toBe(true);
        expect(ws2.sent[0]).toMatchObject({ type: 'stream_resume', content: '결과', finished: true });
        expect(ws2.sent[1]).toMatchObject({ type: 'done', messageId: 'm1' });
        expect(ws2._abortController).toBeNull();
        expect(reg.size).toBe(0);
    });

    it('보관 시간이 지나면 이어받을 것이 없다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.detach(ws);
        reg.send(entry, { type: 'done' });
        reg.close(entry);
        jest.advanceTimersByTime(500);
        expect(reg.attach('u:u1', fakeWs())).toBe(false);
    });

    it('같은 키로 새 채팅을 열면 detach 된 이전 스트림은 abort 된다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws1 = fakeWs();
        const ac1 = new AbortController();
        reg.open('u:u1', ws1, ac1);
        reg.detach(ws1);
        const ws2 = fakeWs();
        reg.open('u:u1', ws2, new AbortController());
        expect(ac1.signal.aborted).toBe(true);
        expect(reg.size).toBe(1);
    });

    it('명시적 abort 는 즉시 버린다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws = fakeWs();
        const ac = new AbortController();
        reg.open('u:u1', ws, ac);
        expect(reg.abortByWs(ws)).toBe(true);
        expect(ac.signal.aborted).toBe(true);
        expect(reg.size).toBe(0);
    });

    it('버퍼 상한을 넘으면 비종료 이벤트는 버리고 종료 이벤트는 남긴다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 100);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.detach(ws);
        reg.send(entry, { type: 'artifact_chunk', id: 'a', delta: 'x'.repeat(40) });
        reg.send(entry, { type: 'artifact_chunk', id: 'a', delta: 'y'.repeat(40) });
        reg.send(entry, { type: 'done' });
        expect(entry.overflowed).toBe(true);
        expect(entry.buffered.map((r) => (JSON.parse(r) as { type: string }).type)).toEqual(['artifact_chunk', 'done']);
    });

    it('resolveStreamKey — 인증 사용자 > 게스트 anonSessionId > 없음', () => {
        expect(resolveStreamKey(fakeWs('7'), 'anon')).toBe('u:7');
        expect(resolveStreamKey(fakeWs(null), 'anon-1')).toBe('a:anon-1');
        expect(resolveStreamKey(fakeWs(null), '  ')).toBeNull();
        expect(resolveStreamKey(fakeWs(null))).toBeNull();
    });
});
