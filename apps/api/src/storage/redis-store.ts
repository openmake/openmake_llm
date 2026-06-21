/**
 * Redis Key-Value Store 구현 (Stage 2-H3 Phase 4).
 *
 * ioredis 기반 공용 저장소 — 멀티 인스턴스 배포 시 rate limiter 및 OAuth state를
 * 인스턴스 간 일관성 있게 공유한다. MemoryStore와 동일한 `KeyValueStore` 계약을
 * 구현해 `getKeyValueStore()` 팩토리가 투명하게 교체.
 *
 * 값 직렬화는 JSON 기반 (MemoryStore와 동일). TTL은 Redis 네이티브 `PX`(ms)로
 * 위임하며, setTimeout 수준의 프로세스 로컬 타이머는 사용하지 않는다.
 *
 * @module storage/redis-store
 */

import Redis, { RedisOptions } from 'ioredis';
import { KeyValueStore, StorageValue } from './types';

export class RedisStore implements KeyValueStore {
    readonly backend = 'redis' as const;
    private client: Redis;

    constructor(url: string, options?: RedisOptions) {
        this.client = new Redis(url, {
            lazyConnect: false,
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            ...options,
        });
    }

    async get<T extends StorageValue = StorageValue>(key: string): Promise<T | null> {
        const raw = await this.client.get(key);
        if (raw === null) return null;
        try {
            return JSON.parse(raw) as T;
        } catch {
            return raw as unknown as T;
        }
    }

    async set(key: string, value: StorageValue, ttlMs?: number): Promise<void> {
        const serialized = JSON.stringify(value);
        if (ttlMs && ttlMs > 0) {
            await this.client.set(key, serialized, 'PX', ttlMs);
        } else {
            await this.client.set(key, serialized);
        }
    }

    async incr(key: string): Promise<number> {
        return this.client.incr(key);
    }

    async incrBy(key: string, amount: number): Promise<number> {
        return this.client.incrby(key, amount);
    }

    async del(key: string): Promise<void> {
        await this.client.del(key);
    }

    async expire(key: string, ttlMs: number): Promise<boolean> {
        const result = await this.client.pexpire(key, ttlMs);
        return result === 1;
    }

    /** 프로세스 종료 시 graceful shutdown */
    async close(): Promise<void> {
        await this.client.quit();
    }

    /** 테스트 전용: 현재 DB 전체 flush */
    async flushAllForTests(): Promise<void> {
        await this.client.flushdb();
    }
}
