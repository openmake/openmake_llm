import { RequestIdempotencyRegistry, normalizeClientRequestId, claimClientRequest } from '../request-idempotency';

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
