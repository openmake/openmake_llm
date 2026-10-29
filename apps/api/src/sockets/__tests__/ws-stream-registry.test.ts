/**
 * ws-stream-registry — 소켓이 끊겨도 생성을 이어 가고 재연결 시 이어받는 규약 검증.
 * 회귀 대상: "탭 전환/앱 백그라운드 → 응답 없음" (2026-09-05).
 */
import { InFlightStreamRegistry, resolveStreamKey, normalizeStreamLane, normalizeClientStreamId } from '../ws-stream-registry';
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

    it('토큰 전 조기 session_created 는 재부착 스냅샷에 남고, 명시 abort 뒤 새 소켓엔 이전 id 가 가지 않는다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws1 = fakeWs();
        const entry = reg.open('u:u1', ws1, new AbortController());
        reg.send(entry, { type: 'session_created', sessionId: 's-early' });
        expect(reg.detach(ws1)).toBe(true);

        const ws2 = fakeWs();
        expect(reg.attach('u:u1', ws2)).toBe(true);
        expect(plain(ws2.sent[0])).toMatchObject({ type: 'stream_resume', sessionId: 's-early', content: '' });

        expect(reg.abortByWs(ws2)).toBe(true);
        const ws3 = fakeWs();
        expect(reg.attach('u:u1', ws3)).toBe(false);
        expect(ws3.sent).toEqual([]);
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

/**
 * 클라이언트 지정 생성 식별자와 정확 이어받기(2026-10-29) — 비교 레인은 첫 이벤트 전에 끊겨도 자기 생성을 지정해 이어받고,
 * 다른 탭이 같은 키로 시작한 생성을 빼앗지 않는다. exact 가 없으면 종전(커서 불일치여도 재부착) 그대로.
 */
describe('InFlightStreamRegistry — 클라이언트 streamId · exact 이어받기', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    const CLIENT_ID = '3f2b9c1e-7d4a-4e21-9b6f-0c8d1e2f3a4b';

    it('유효한 클라이언트 streamId 를 받으면 그 값으로 등록하고 이벤트 봉투에 싣는다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws = fakeWs();
        const entry = reg.open('u:u1#a', ws, new AbortController(), CLIENT_ID);
        expect(entry.streamId).toBe(CLIENT_ID);
        reg.send(entry, { type: 'session_created', sessionId: 's1' });
        expect(ws.sent[0]).toMatchObject({ streamId: CLIENT_ID, seq: 1 });
    });

    it('클라이언트 streamId 가 없거나 형식이 틀리면 종전처럼 서버가 발급한다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        for (const bad of [undefined, '', 'abc', 42, `${CLIENT_ID}x`, '00000000-0000-0000-0000-000000000000', CLIENT_ID.toUpperCase().replace('4E21', '1E21')]) {
            const entry = reg.open('u:u1#a', fakeWs(), new AbortController(), bad);
            expect(entry.streamId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(entry.streamId).not.toBe(bad);
        }
    });

    it('normalizeClientStreamId — UUID v4 형식만 받고 소문자로 맞춘다', () => {
        expect(normalizeClientStreamId(CLIENT_ID)).toBe(CLIENT_ID);
        expect(normalizeClientStreamId(CLIENT_ID.toUpperCase())).toBe(CLIENT_ID);
        expect(normalizeClientStreamId('3f2b9c1e-7d4a-1e21-9b6f-0c8d1e2f3a4b')).toBeNull(); // v1
        expect(normalizeClientStreamId('3f2b9c1e-7d4a-4e21-7b6f-0c8d1e2f3a4b')).toBeNull(); // variant
        expect(normalizeClientStreamId(null)).toBeNull();
    });

    it('exact: 등록된 streamId 와 정확히 같을 때만 붙인다(첫 이벤트 전 끊김도 afterSeq 0 으로 전량 재생)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 100);
        const ws1 = fakeWs();
        const ac = new AbortController();
        const entry = reg.open('u:u1#a', ws1, ac, CLIENT_ID);
        reg.detach(ws1); // 첫 이벤트 전에 끊김
        reg.send(entry, { type: 'session_created', sessionId: 's1' });
        const ws2 = fakeWs();
        expect(reg.attach('u:u1#a', ws2, { streamId: CLIENT_ID, afterSeq: 0 }, { exact: true })).toBe(true);
        expect(ws2.sent[0]).toMatchObject({ type: 'stream_resume', streamId: CLIENT_ID, finished: false });
        expect(ws2.sent.slice(1)).toEqual([expect.objectContaining({ type: 'session_created', seq: 1 })]);
        expect(ws2._abortController).toBe(ac);
    });

    it('exact: streamId 가 다르거나 없으면 붙이지 않고 기존 소켓·컨트롤러·전달 상태를 바꾸지 않는다(다른 탭 보호)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 100);
        const otherTab = fakeWs();
        const ac = new AbortController();
        otherTab._abortController = ac;
        const entry = reg.open('u:u1#a', otherTab, ac, CLIENT_ID);
        reg.send(entry, { type: 'token', token: '가' });
        for (const cursor of [{ streamId: '11111111-2222-4333-8444-555555555555', afterSeq: 0 }, {}, { afterSeq: 0 }]) {
            const me = fakeWs();
            expect(reg.attach('u:u1#a', me, cursor, { exact: true })).toBe(false);
            expect(me.sent).toEqual([]);
            expect(me._abortController).toBeNull();
        }
        expect(entry.ws).toBe(otherTab);
        expect(otherTab._abortController).toBe(ac);
        reg.send(entry, { type: 'token', token: '나' });
        expect(otherTab.sent).toHaveLength(2); // 다른 탭은 계속 받는다
        expect(reg.abortByWs(otherTab)).toBe(true); // 다른 탭의 중단도 그대로 동작
        expect(ac.signal.aborted).toBe(true);
    });

    it('exact: detach 된 다른 생성에도 붙지 않고 유예 타이머를 건드리지 않는다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws1 = fakeWs();
        const ac = new AbortController();
        reg.open('u:u1#a', ws1, ac, CLIENT_ID);
        reg.detach(ws1);
        expect(reg.attach('u:u1#a', fakeWs(), { streamId: '11111111-2222-4333-8444-555555555555', afterSeq: 0 }, { exact: true })).toBe(false);
        jest.advanceTimersByTime(1000);
        expect(ac.signal.aborted).toBe(true); // 유예 만료 규약 유지
    });

    it('exact 없이는 커서가 달라도 종전대로 재부착한다(구 클라이언트 호환)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 100);
        const ws1 = fakeWs();
        reg.open('u:u1#a', ws1, new AbortController(), CLIENT_ID);
        const ws2 = fakeWs();
        expect(reg.attach('u:u1#a', ws2, { streamId: '11111111-2222-4333-8444-555555555555', afterSeq: 0 })).toBe(true);
        expect(ws2.sent[0]).toMatchObject({ type: 'stream_resume', streamId: CLIENT_ID });
    });

    it('exact 는 키(사용자·레인)를 넘지 않는다 — 같은 streamId 라도 다른 레인 키에는 붙지 않는다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        reg.open('u:u1#a', fakeWs(), new AbortController(), CLIENT_ID);
        expect(reg.attach('u:u1#b', fakeWs(), { streamId: CLIENT_ID, afterSeq: 0 }, { exact: true })).toBe(false);
        expect(reg.attach('u:u2#a', fakeWs('u2'), { streamId: CLIENT_ID, afterSeq: 0 }, { exact: true })).toBe(false);
    });

    it('streamIdOf — 소켓에 붙은 스트림의 식별자(중단 응답에 싣는다), 없으면 null', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096);
        const ws = fakeWs();
        reg.open('u:u1#a', ws, new AbortController(), CLIENT_ID);
        expect(reg.streamIdOf(ws)).toBe(CLIENT_ID);
        expect(reg.streamIdOf(fakeWs())).toBeNull();
    });
});

/**
 * 송신 백프레셔 — 느린 클라이언트 하나의 송신 버퍼(ws.bufferedAmount)가 서버 메모리를 계속 차지하지 않게 한다.
 * 임계를 넘으면 그 소켓을 끊고(terminate) 스트림은 detach — 생성은 유예 동안 이어지고 재연결 시 스냅샷으로 잇는다.
 */
describe('InFlightStreamRegistry — 송신 백프레셔', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    function slowWs(buffered: number): ExtendedWebSocket & { sent: unknown[]; terminated: number; bufferedAmount: number } {
        const ws = fakeWs() as ExtendedWebSocket & { sent: unknown[]; terminated: number; bufferedAmount: number };
        ws.bufferedAmount = buffered;
        ws.terminated = 0;
        (ws as unknown as { terminate: () => void }).terminate = () => { ws.terminated += 1; (ws as unknown as { readyState: number }).readyState = 3; };
        return ws;
    }

    it('버퍼가 임계 이하면 종전대로 바로 보낸다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 2000, 1024);
        const ws = slowWs(1024);
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.send(entry, { type: 'token', token: 'a', messageId: 'm1' });
        expect(ws.sent).toHaveLength(1);
        expect(ws.terminated).toBe(0);
        expect(entry.ws).toBe(ws);
    });

    it('버퍼가 임계를 넘으면 보내지 않고 소켓을 끊으며, 생성은 중단하지 않는다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 2000, 1024);
        const ws = slowWs(0);
        const ac = new AbortController();
        const entry = reg.open('u:u1', ws, ac);
        reg.send(entry, { type: 'token', token: '안녕', messageId: 'm1' });
        ws.bufferedAmount = 1025;
        reg.send(entry, { type: 'token', token: '하세요' });

        expect(ws.sent).toHaveLength(1);
        expect(ws.terminated).toBe(1);
        expect(entry.ws).toBeNull();
        expect(ws._abortController).toBeNull();
        expect(ac.signal.aborted).toBe(false);
        // 이미 분리됐으므로 close 핸들러의 detach 는 false — 종전 abort 경로로 떨어져도 끊을 컨트롤러가 없다
        expect(reg.detach(ws)).toBe(false);
    });

    it('끊긴 뒤 이벤트는 버퍼에 쌓였다가 재연결 소켓에 스냅샷+재생으로 이어진다', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 2000, 1024);
        const ws1 = slowWs(0);
        const entry = reg.open('u:u1', ws1, new AbortController());
        reg.send(entry, { type: 'token', token: '안녕', messageId: 'm1' });
        ws1.bufferedAmount = 5000;
        reg.send(entry, { type: 'token', token: '하세요' });
        reg.send(entry, { type: 'artifact_start', artifact: { id: 'a1' } });
        expect(ws1.terminated).toBe(1); // 한 번만 끊는다

        const ws2 = slowWs(0);
        expect(reg.attach('u:u1', ws2)).toBe(true);
        expect(plain(ws2.sent[0])).toMatchObject({ type: 'stream_resume', content: '안녕하세요', finished: false });
        expect(ws2.sent.slice(1).map(plain)).toEqual([{ type: 'artifact_start', artifact: { id: 'a1' } }]);
    });

    it('재연결이 없으면 유예 뒤 생성을 중단한다(종전 detach 규약과 동일)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 2000, 1024);
        const ws = slowWs(2000);
        const ac = new AbortController();
        const entry = reg.open('u:u1', ws, ac);
        reg.send(entry, { type: 'token', token: 'x' });
        expect(ac.signal.aborted).toBe(false);
        jest.advanceTimersByTime(1001);
        expect(ac.signal.aborted).toBe(true);
    });

    it('임계 0 이면 검사하지 않는다(롤백 스위치)', () => {
        const reg = new InFlightStreamRegistry(1000, 500, 4096, 2000, 0);
        const ws = slowWs(10_000_000);
        const entry = reg.open('u:u1', ws, new AbortController());
        reg.send(entry, { type: 'token', token: 'x' });
        expect(ws.sent).toHaveLength(1);
        expect(ws.terminated).toBe(0);
    });
});
