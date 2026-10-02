import { RequestIdempotencyRegistry, normalizeClientRequestId, claimClientRequest, claimClientRequestShared } from '../request-idempotency';
import { MemoryStore } from '../../storage/memory-store';

describe('RequestIdempotencyRegistry', () => {
    test('같은 owner·id 는 TTL 안에서 이전 messageId, TTL 지나면 null', () => {
        const r = new RequestIdempotencyRegistry(1000, 10);
        r.remember('u:1', 'req-aaaaaaaa', 'm1', 0);
        expect(r.lookup('u:1', 'req-aaaaaaaa', 500)).toBe('m1');
        expect(r.lookup('u:2', 'req-aaaaaaaa', 500)).toBeNull();
        expect(r.lookup('u:1', 'req-aaaaaaaa', 2000)).toBeNull();
    });
    test('owner 당 상한을 넘으면 가장 오래된 항목부터 밀린다', () => {
        const r = new RequestIdempotencyRegistry(60_000, 2);
        r.remember('u', 'id-00000001', 'a', 1); r.remember('u', 'id-00000002', 'b', 2); r.remember('u', 'id-00000003', 'c', 3);
        expect(r.lookup('u', 'id-00000001', 4)).toBeNull();
        expect(r.lookup('u', 'id-00000003', 4)).toBe('c');
    });
    test('normalizeClientRequestId — UUID/안전 문자열만', () => {
        expect(normalizeClientRequestId('6f1c2a9e-1b2c-4d3e-8f90-abcdef123456')).toBe('6f1c2a9e-1b2c-4d3e-8f90-abcdef123456');
        expect(normalizeClientRequestId('short')).toBeUndefined();
        expect(normalizeClientRequestId('has space here')).toBeUndefined();
        expect(normalizeClientRequestId(123)).toBeUndefined();
    });
});

describe('claimClientRequest', () => {
    test('처음 보는 id 는 이번 messageId 를 기억하고, 재전송이면 이전 messageId 를 돌려준다', () => {
        const r = new RequestIdempotencyRegistry(60_000, 10);
        expect(claimClientRequest('u:1', 'req-aaaaaaaa', 'm1', r)).toEqual({ clientRequestId: 'req-aaaaaaaa', priorMessageId: null });
        expect(claimClientRequest('u:1', 'req-aaaaaaaa', 'm2', r)).toEqual({ clientRequestId: 'req-aaaaaaaa', priorMessageId: 'm1' });
        expect(claimClientRequest('u:2', 'req-aaaaaaaa', 'm3', r).priorMessageId).toBeNull();
    });
    test('id 가 없거나 형식이 틀리면 멱등 없음(기억하지 않음)', () => {
        const r = new RequestIdempotencyRegistry(60_000, 10);
        expect(claimClientRequest('u:1', undefined, 'm1', r)).toEqual({ priorMessageId: null });
        expect(claimClientRequest('u:1', 'short', 'm1', r)).toEqual({ priorMessageId: null });
        expect(r.lookup('u:1', 'short')).toBeNull();
    });
});

describe('claimClientRequestShared — 서버 여러 대가 공유 저장소로 선점한다', () => {
    // 서버 두 대 = 메모리 레지스트리 둘 + 공유 저장소 하나
    const twoServers = () => ({ a: new RequestIdempotencyRegistry(), b: new RequestIdempotencyRegistry(), store: new MemoryStore() });

    it('다른 서버가 먼저 받은 요청이면 그 messageId 를 돌려준다', async () => {
        const { a, b, store } = twoServers();
        const first = await claimClientRequestShared('u:1', 'req-12345678', 'm1', { registry: a, store });
        const second = await claimClientRequestShared('u:1', 'req-12345678', 'm2', { registry: b, store });
        expect(first.priorMessageId).toBeNull();
        expect(second).toEqual({ clientRequestId: 'req-12345678', priorMessageId: 'm1' });
    });

    it('동시에 와도 한쪽만 통과한다', async () => {
        const { a, b, store } = twoServers();
        const [x, y] = await Promise.all([
            claimClientRequestShared('u:1', 'req-12345678', 'm1', { registry: a, store }),
            claimClientRequestShared('u:1', 'req-12345678', 'm2', { registry: b, store }),
        ]);
        expect([x.priorMessageId, y.priorMessageId].filter((p) => p === null)).toHaveLength(1);
    });

    it('사용자·요청 id 가 다르면 별개다', async () => {
        const { a, b, store } = twoServers();
        await claimClientRequestShared('u:1', 'req-12345678', 'm1', { registry: a, store });
        expect((await claimClientRequestShared('u:2', 'req-12345678', 'm2', { registry: b, store })).priorMessageId).toBeNull();
        expect((await claimClientRequestShared('u:1', 'req-87654321', 'm3', { registry: b, store })).priorMessageId).toBeNull();
    });

    it('같은 서버의 재전송은 저장소를 보지 않고 메모리로 판정한다', async () => {
        const { a, store } = twoServers();
        await claimClientRequestShared('u:1', 'req-12345678', 'm1', { registry: a, store });
        const incr = jest.spyOn(store, 'incr');
        expect((await claimClientRequestShared('u:1', 'req-12345678', 'm2', { registry: a, store })).priorMessageId).toBe('m1');
        expect(incr).not.toHaveBeenCalled();
    });

    it('저장소가 실패하면 요청을 막지 않는다(메모리 판정만)', async () => {
        const { a, store } = twoServers();
        jest.spyOn(store, 'incr').mockRejectedValue(new Error('redis down'));
        expect((await claimClientRequestShared('u:1', 'req-12345678', 'm1', { registry: a, store })).priorMessageId).toBeNull();
    });

    it('공유 저장소가 없으면(null) 종전 메모리 판정과 같다', async () => {
        const a = new RequestIdempotencyRegistry();
        expect((await claimClientRequestShared('u:1', 'req-12345678', 'm1', { registry: a, store: null })).priorMessageId).toBeNull();
        expect((await claimClientRequestShared('u:1', 'req-12345678', 'm2', { registry: a, store: null })).priorMessageId).toBe('m1');
    });

    it('id 형식이 틀리면 멱등 없음', async () => {
        const { a, store } = twoServers();
        expect(await claimClientRequestShared('u:1', 'x', 'm1', { registry: a, store })).toEqual({ priorMessageId: null });
    });
});
