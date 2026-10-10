/**
 * closeKeyValueStore — 서버 종료 단계(boot/graceful-shutdown)가 부른다.
 * Redis 백엔드의 연결만 닫고, 메모리 백엔드·아직 만들어지지 않은 저장소에는 아무 일도 하지 않는다.
 */
const redisClose = jest.fn(async () => undefined);
const redisConstructed = jest.fn();
jest.mock('../redis-store', () => ({
    RedisStore: class {
        readonly backend = 'redis' as const;
        constructor(url: string) { redisConstructed(url); }
        close = redisClose;
    },
}));
const config = { storageBackend: 'memory', redisUrl: '' };
jest.mock('../../config', () => ({ getConfig: () => config }));

import { closeKeyValueStore, getKeyValueStore, resetKeyValueStoreForTests } from '../index';

beforeEach(() => {
    jest.clearAllMocks();
    resetKeyValueStoreForTests();
    config.storageBackend = 'memory';
    config.redisUrl = '';
});

describe('closeKeyValueStore', () => {
    it('Redis 백엔드면 연결을 닫는다', async () => {
        config.storageBackend = 'redis';
        config.redisUrl = 'redis://localhost:6379';
        getKeyValueStore();
        await closeKeyValueStore();
        expect(redisClose).toHaveBeenCalledTimes(1);
    });

    it('저장소가 만들어진 적이 없으면 Redis 설정이어도 새로 연결하지 않는다', async () => {
        config.storageBackend = 'redis';
        config.redisUrl = 'redis://localhost:6379';
        await closeKeyValueStore();
        expect(redisConstructed).not.toHaveBeenCalled();
        expect(redisClose).not.toHaveBeenCalled();
    });

    it('메모리 백엔드(Redis 미설정)에서는 아무 일도 하지 않는다', async () => {
        const store = getKeyValueStore();
        await store.set('k', 'v');
        await expect(closeKeyValueStore()).resolves.toBeUndefined();
        expect(redisConstructed).not.toHaveBeenCalled();
        expect(redisClose).not.toHaveBeenCalled();
        expect(await getKeyValueStore().get('k')).toBe('v');
    });

    it('닫기 실패는 호출자에게 그대로 전한다(종료 단계가 로그만 남긴다)', async () => {
        config.storageBackend = 'redis';
        config.redisUrl = 'redis://localhost:6379';
        getKeyValueStore();
        redisClose.mockRejectedValueOnce(new Error('Connection is closed.'));
        await expect(closeKeyValueStore()).rejects.toThrow('Connection is closed.');
    });
});
