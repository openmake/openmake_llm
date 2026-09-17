/**
 * ws-stream-registry — 소켓이 끊겨도 생성을 이어 가고 재연결 시 이어받는 규약 검증.
 * 회귀 대상: "탭 전환/앱 백그라운드 → 응답 없음" (2026-09-05).
 */
import { InFlightStreamRegistry, resolveStreamKey, normalizeStreamLane } from '../ws-stream-registry';
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

/** 순번 필드(streamId·seq)를 떼어 종전 페이로드와 비교한다 */
function plain(ev: unknown): unknown {
    if (!ev || typeof ev !== 'object') return ev;
    const { streamId: _s, seq: _q, lastSeq: _l, ...rest } = ev as Record<string, unknown>;
    return rest;
}

describe('InFlightStreamRegistry', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    it('attached 상태에서는 소켓으로 바로 보낸다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1024);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.send(entry, { type: 'token', token: 'ab', messageId: 'm1' });
        expect(ws.sent.map(plain)).toEqual([{ type: 'token', token: 'ab', messageId: 'm1' }]);
        expect(ws.sent[0]).toMatchObject({ seq: 1, streamId: entry.streamId });
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
        expect(plain(ws2.sent[0])).toEqual({
            type: 'stream_resume', messageId: 'm1', sessionId: 's1', content: '안녕하세요', finished: false,
        });
        expect(ws2.sent.slice(1).map(plain)).toEqual([
            { type: 'session_created', sessionId: 's1' },
            { type: 'artifact_start', artifact: { id: 'a1' } },
        ]);
        expect(ws2._abortController).toBe(ac);

        // 이어서 오는 이벤트는 새 소켓으로
        reg.send(entry, { type: 'done', messageId: 'm1' });
        expect(plain(ws2.sent.at(-1))).toEqual({ type: 'done', messageId: 'm1' });
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

    it('링 바이트 상한을 넘으면 오래된 이벤트부터 밀어내고 종료 이벤트는 남긴다 — 재생 범위와 겹치면 gap', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 260);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.detach(ws);
        reg.send(entry, { type: 'artifact_chunk', id: 'a', delta: 'x'.repeat(40) });
        reg.send(entry, { type: 'artifact_chunk', id: 'a', delta: 'y'.repeat(40) });
        reg.send(entry, { type: 'done' });
        expect(entry.overflowed).toBe(true);
        expect(entry.ring.map((r) => (JSON.parse(r.raw) as { type: string }).type)).toEqual(['artifact_chunk', 'done']);
        const ws2 = fakeWs();
        reg.attach('u:u1', ws2);
        expect(ws2.sent[0]).toMatchObject({ type: 'stream_resume', gap: true, lastSeq: 3 });
        expect(ws2.sent.slice(1).map((e) => (e as { seq: number }).seq)).toEqual([2, 3]);
    });

    // ── 순번 이어받기 (F19.11, 2026-09-17) ──

    it('attached 중 이벤트도 링에 남고, afterSeq 커서로 붙으면 그 뒤만 재생한다(중복 0)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1 << 20, 100);
        const wsA = fakeWs();
        const entry = reg.open('u:u1', wsA, new AbortController());
        reg.send(entry, { type: 'session_created', sessionId: 's1' });      // seq 1
        reg.send(entry, { type: 'token', token: '가' });                    // seq 2(스냅샷)
        reg.send(entry, { type: 'artifact_start', artifact: { id: 'a' } }); // seq 3
        reg.send(entry, { type: 'artifact_chunk', id: 'a', delta: '1' });   // seq 4
        expect(entry.ring.map((r) => r.seq)).toEqual([1, 3, 4]);

        // 탭 B 가 seq 3 까지 받은 상태로 이어받는다(A 는 아직 열려 있음 — 마지막 접속이 이긴다)
        const wsB = fakeWs();
        expect(reg.attach('u:u1', wsB, { streamId: entry.streamId, afterSeq: 3 })).toBe(true);
        expect(wsB.sent[0]).toMatchObject({ type: 'stream_resume', content: '가', streamId: entry.streamId, lastSeq: 4 });
        expect(wsB.sent[0]).not.toHaveProperty('gap');
        expect(wsB.sent.slice(1).map((e) => (e as { seq: number }).seq)).toEqual([4]);

        reg.send(entry, { type: 'done' });
        expect(wsB.sent.at(-1)).toMatchObject({ type: 'done', seq: 5 });
        expect(wsA.sent.at(-1)).toMatchObject({ seq: 4 }); // 옮겨 간 뒤 A 로는 보내지 않는다
    });

    it('다른 streamId·범위 밖 afterSeq 는 커서를 무시하고 미전달 이벤트만 재생한다(구 클라이언트 호환)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1 << 20, 100);
        const ws1 = fakeWs();
        const entry = reg.open('u:u1', ws1, new AbortController());
        reg.send(entry, { type: 'session_created', sessionId: 's1' }); // 전달됨
        reg.detach(ws1);
        reg.send(entry, { type: 'artifact_start', artifact: { id: 'a' } }); // 미전달 seq 2

        const other = fakeWs();
        reg.attach('u:u1', other, { streamId: '00000000-0000-0000-0000-000000000000', afterSeq: 0 });
        expect(other.sent.slice(1).map((e) => (e as { type: string }).type)).toEqual(['artifact_start']);

        const future = fakeWs();
        reg.attach('u:u1', future, { streamId: entry.streamId, afterSeq: 99 });
        // 재부착 시 전량 전달된 것으로 본다 → 새로 재생할 것 없음
        expect(future.sent).toHaveLength(1);
        expect(future.sent[0]).toMatchObject({ type: 'stream_resume', lastSeq: 2 });
    });

    it('개수 상한(ringMax)을 넘으면 오래된 것부터 밀려나고, 밀려난 구간을 요구한 커서는 gap', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1 << 20, 2);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        for (let i = 0; i < 4; i++) reg.send(entry, { type: 'artifact_chunk', id: 'a', delta: String(i) });
        expect(entry.ring.map((r) => r.seq)).toEqual([3, 4]);
        const ws2 = fakeWs();
        reg.attach('u:u1', ws2, { streamId: entry.streamId, afterSeq: 1 });
        expect(ws2.sent[0]).toMatchObject({ gap: true });
        expect(ws2.sent.slice(1).map((e) => (e as { seq: number }).seq)).toEqual([3, 4]);
        const ws3 = fakeWs();
        reg.attach('u:u1', ws3, { streamId: entry.streamId, afterSeq: 2 });
        expect(ws3.sent[0]).not.toHaveProperty('gap');
    });

    it('ringMax=0 이면 attached 중에는 링에 남기지 않는다(종전 동작 롤백 스위치)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 1 << 20, 0);
        const ws = fakeWs();
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.send(entry, { type: 'artifact_start', artifact: { id: 'a' } });
        expect(entry.ring).toHaveLength(0);
        reg.detach(ws);
        reg.send(entry, { type: 'artifact_chunk', id: 'a', delta: 'x' });
        expect(entry.ring).toHaveLength(1);
        reg.attach('u:u1', fakeWs());
        expect(entry.ring).toHaveLength(0);
    });

    it('resolveStreamKey — 인증 사용자 > 게스트 anonSessionId > 없음', () => {
        expect(resolveStreamKey(fakeWs('7'), 'anon')).toBe('u:7');
        expect(resolveStreamKey(fakeWs(null), '3f2b9c1e-7d4a-4e21-9b6f-0c8d1e2f3a4b')).toBe('a:3f2b9c1e-7d4a-4e21-9b6f-0c8d1e2f3a4b');
        // 짧거나 임의 문자가 섞인 게스트 id 는 키가 되지 않는다(추측 가능한 id 로 타인 스트림 재부착 차단)
        expect(resolveStreamKey(fakeWs(null), 'anon-1')).toBeNull();
        expect(resolveStreamKey(fakeWs(null), 'a'.repeat(15))).toBeNull();
        expect(resolveStreamKey(fakeWs(null), 'x'.repeat(16) + ' y')).toBeNull();
        expect(resolveStreamKey(fakeWs(null), '  ')).toBeNull();
        expect(resolveStreamKey(fakeWs(null))).toBeNull();
    });

    // ── 레인(비교 모드) 테스트 (2026-09-09) ──

    it('같은 사용자의 서로 다른 레인은 독립 키를 가지며, 두 번째 레인이 첫 번째를 abort 하지 않는다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws1 = fakeWs('u1');
        const ac1 = new AbortController();
        reg.open('u:u1#a', ws1, ac1);

        const ws2 = fakeWs('u1');
        const ac2 = new AbortController();
        reg.open('u:u1#b', ws2, ac2);

        expect(ac1.signal.aborted).toBe(false);
        expect(ac2.signal.aborted).toBe(false);
        expect(reg.size).toBe(2);
    });

    it('resolveStreamKey — 유효한 lane 이면 #lane 접미사가 붙는다', () => {
        expect(resolveStreamKey(fakeWs('u1'), undefined, 'a')).toBe('u:u1#a');
        expect(resolveStreamKey(fakeWs('u1'), undefined, 'model-b')).toBe('u:u1#model-b');
    });

    it('resolveStreamKey — 유효하지 않은 lane 은 무시된다 (접미사 없음)', () => {
        // 대문자+공백
        expect(resolveStreamKey(fakeWs('u1'), undefined, 'A B')).toBe('u:u1');
        // 40자 (16자 초과)
        expect(resolveStreamKey(fakeWs('u1'), undefined, 'a'.repeat(40))).toBe('u:u1');
        // 비문자열
        expect(resolveStreamKey(fakeWs('u1'), undefined, 123)).toBe('u:u1');
        expect(resolveStreamKey(fakeWs('u1'), undefined, null)).toBe('u:u1');
        expect(resolveStreamKey(fakeWs('u1'), undefined, undefined)).toBe('u:u1');
    });

    it('게스트 anonSessionId + lane → a:<id>#<lane>', () => {
        expect(resolveStreamKey(fakeWs(null), 'sess-0123456789ab', 'a')).toBe('a:sess-0123456789ab#a');
    });

    it('같은 레인 키로 재오픈하면 이전 스트림은 여전히 abort 된다 (기존 동작 보존)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws1 = fakeWs('u1');
        const ac1 = new AbortController();
        reg.open('u:u1#a', ws1, ac1);

        const ws2 = fakeWs('u1');
        reg.open('u:u1#a', ws2, new AbortController());

        expect(ac1.signal.aborted).toBe(true);
        expect(reg.size).toBe(1);
    });

    it('normalizeStreamLane — 유효/무효 분류', () => {
        expect(normalizeStreamLane('left')).toBe('left');
        expect(normalizeStreamLane('model-a_1')).toBe('model-a_1');
        expect(normalizeStreamLane('A B')).toBeNull();
        expect(normalizeStreamLane('a'.repeat(17))).toBeNull();
        expect(normalizeStreamLane('')).toBeNull();
        expect(normalizeStreamLane(42)).toBeNull();
        expect(normalizeStreamLane(null)).toBeNull();
        expect(normalizeStreamLane(undefined)).toBeNull();
    });
});
