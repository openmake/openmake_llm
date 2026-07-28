/**
 * storage-factory.test.ts
 * Stage 2-H3 Phase 1.2: getKeyValueStore() 팩토리가 STORAGE_BACKEND env에 따라
 * 올바른 구현을 반환하고 싱글톤을 유지하는지 검증.
 */

// RedisStore를 mock하여 실제 ioredis 연결을 회피 (단위 테스트 scope).
// 실 Redis 통합 테스트는 redis-store.test.ts에서 TEST_REDIS_URL 가드로 분리.
jest.mock('../storage/redis-store', () => ({
    RedisStore: jest.fn().mockImplementation(function (this: { backend: 'redis' }) {
        this.backend = 'redis';
    }),
}));

jest.mock('../config', () => ({
    getConfig: jest.fn(),
}));

import { getConfig } from '../config';
import { getKeyValueStore, resetKeyValueStoreForTests } from '../storage';
import { RedisStore } from '../storage/redis-store';

describe('getKeyValueStore factory', () => {
    beforeEach(() => {
        resetKeyValueStoreForTests();
        (RedisStore as jest.Mock).mockClear();
    });

    test('returns MemoryStore when STORAGE_BACKEND=memory', () => {
        (getConfig as jest.Mock).mockReturnValue({ storageBackend: 'memory', redisUrl: '' });
        const store = getKeyValueStore();
        expect(store.backend).toBe('memory');
    });

    test('returns RedisStore when STORAGE_BACKEND=redis and URL provided', () => {
        (getConfig as jest.Mock).mockReturnValue({ storageBackend: 'redis', redisUrl: 'redis://localhost:6379' });
        const store = getKeyValueStore();
        expect(store.backend).toBe('redis');
        expect(RedisStore).toHaveBeenCalledWith('redis://localhost:6379');
    });

    test('throws when STORAGE_BACKEND=redis but REDIS_URL is empty', () => {
        (getConfig as jest.Mock).mockReturnValue({ storageBackend: 'redis', redisUrl: '' });
        expect(() => getKeyValueStore()).toThrow(/REDIS_URL/);
    });

    test('same instance returned on repeat calls (singleton)', () => {
        (getConfig as jest.Mock).mockReturnValue({ storageBackend: 'memory', redisUrl: '' });
        const a = getKeyValueStore();
        const b = getKeyValueStore();
        expect(a).toBe(b);
    });

    test('unknown backend throws with descriptive error', () => {
        (getConfig as jest.Mock).mockReturnValue({ storageBackend: 'invalid' as 'memory', redisUrl: '' });
        expect(() => getKeyValueStore()).toThrow(/unknown storage_backend/i);
    });

    test('resetKeyValueStoreForTests clears singleton so new config takes effect', () => {
        (getConfig as jest.Mock).mockReturnValue({ storageBackend: 'memory', redisUrl: '' });
        const first = getKeyValueStore();
        resetKeyValueStoreForTests();
        const second = getKeyValueStore();
        expect(first).not.toBe(second);
        expect(second.backend).toBe('memory');
    });
});
