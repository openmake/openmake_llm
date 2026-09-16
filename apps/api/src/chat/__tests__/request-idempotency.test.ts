import { RequestIdempotencyRegistry, normalizeClientRequestId } from '../request-idempotency';

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
