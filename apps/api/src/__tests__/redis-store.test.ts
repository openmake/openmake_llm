/**
 * redis-store.test.ts
 * Stage 2-H3 Phase 4: RedisStore 통합 테스트.
 *
 * 실제 Redis 인스턴스가 필요하므로 TEST_REDIS_URL 환경변수가 설정된 경우에만 실행.
 * 미설정 시 describe.skip으로 전체 suite skip (CI/로컬 부재 환경 대응).
 *
 * 수동 실행:
 *   TEST_REDIS_URL=redis://localhost:6379 npx jest --testPathPattern="redis-store"
 */

import { RedisStore } from '../storage/redis-store';

const REDIS_URL = process.env.TEST_REDIS_URL;
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('RedisStore (integration — TEST_REDIS_URL required)', () => {
    let store: RedisStore;

    beforeEach(async () => {
        store = new RedisStore(REDIS_URL!);
        await store.flushAllForTests();
    });

    afterEach(async () => {
        await store.close();
    });

    test('backend identifier === "redis"', () => {
        expect(store.backend).toBe('redis');
    });

    test('set + get round-trip preserves value', async () => {
        await store.set('k:string', 'hello');
        await store.set('k:number', 42);
        await store.set('k:object', { a: 1, b: [2, 3] });

        expect(await store.get('k:string')).toBe('hello');
        expect(await store.get('k:number')).toBe(42);
        expect(await store.get('k:object')).toEqual({ a: 1, b: [2, 3] });
    });

    test('get returns null for missing key', async () => {
        expect(await store.get('nonexistent')).toBeNull();
    });

    test('incr increments atomically starting from 0', async () => {
        expect(await store.incr('counter')).toBe(1);
        expect(await store.incr('counter')).toBe(2);
        expect(await store.incr('counter')).toBe(3);
    });

    test('ttlMs expires key (PX)', async () => {
        await store.set('ttl:key', 'transient', 100);
        expect(await store.get('ttl:key')).toBe('transient');
        await new Promise((r) => setTimeout(r, 150));
        expect(await store.get('ttl:key')).toBeNull();
    });

    test('set without TTL persists (no expiry)', async () => {
        await store.set('persistent', 'stays');
        await new Promise((r) => setTimeout(r, 50));
        expect(await store.get('persistent')).toBe('stays');
    });

    test('del removes key', async () => {
        await store.set('k', 'v');
        await store.del('k');
        expect(await store.get('k')).toBeNull();
    });

    test('del on missing key is no-op (no throw)', async () => {
        await expect(store.del('never-set')).resolves.toBeUndefined();
    });

    test('expire sets TTL on existing key', async () => {
        await store.set('expireme', 'v');
        const result = await store.expire('expireme', 100);
        expect(result).toBe(true);
        await new Promise((r) => setTimeout(r, 150));
        expect(await store.get('expireme')).toBeNull();
    });

    test('expire on missing key returns false', async () => {
        expect(await store.expire('missing', 1000)).toBe(false);
    });

    test('set overwrites previous value and resets TTL', async () => {
        await store.set('k', 'v1', 50);
        await store.set('k', 'v2');
        await new Promise((r) => setTimeout(r, 100));
        expect(await store.get('k')).toBe('v2');
    });
});
