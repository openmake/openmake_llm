/**
 * In-memory Key-Value Store 구현 (Stage 2-H3 Phase 1).
 *
 * 단일 인스턴스 환경에서 기존 Map 기반 동작을 정확히 재현.
 * TTL은 setTimeout으로 스케줄링하며, 덮어쓰기 시 이전 타이머를 정리해
 * 누수·좀비 삭제를 방지.
 *
 * @module storage/memory-store
 */

import { KeyValueStore, StorageValue } from './types';

interface Entry {
    value: string;
    timer?: NodeJS.Timeout;
}

export class MemoryStore implements KeyValueStore {
    readonly backend = 'memory' as const;
    private store = new Map<string, Entry>();

    async get<T extends StorageValue = StorageValue>(key: string): Promise<T | null> {
        const entry = this.store.get(key);
        if (!entry) return null;
        try {
            return JSON.parse(entry.value) as T;
        } catch {
            return entry.value as unknown as T;
        }
    }

    async set(key: string, value: StorageValue, ttlMs?: number): Promise<void> {
        this.clearTimer(key);
        const entry: Entry = { value: JSON.stringify(value) };
        if (ttlMs && ttlMs > 0) {
            entry.timer = setTimeout(() => { this.store.delete(key); }, ttlMs);
        }
        this.store.set(key, entry);
    }

    async incr(key: string): Promise<number> {
        return this.incrBy(key, 1);
    }

    /**
     * 원자적 증가 — Redis INCRBY 와 같은 계약. ⚠️ 읽기-쓰기 사이에 await 를 두지 않는다:
     * 종전엔 `await this.get()` 으로 yield 해 동시 호출이 모두 같은 값을 읽었고, 쿼터 예약(F25 PR-2)의
     * "동시 N요청 중 1건만 통과" 판정이 메모리 백엔드에서 깨졌다.
     */
    async incrBy(key: string, amount: number): Promise<number> {
        const existing = this.store.get(key);
        let current = 0;
        if (existing) {
            const parsed = Number(existing.value);
            current = Number.isFinite(parsed) ? parsed : 0;
        }
        const next = current + amount;
        this.store.set(key, { value: JSON.stringify(next), timer: existing?.timer });
        return next;
    }

    async del(key: string): Promise<void> {
        this.clearTimer(key);
        this.store.delete(key);
    }

    async expire(key: string, ttlMs: number): Promise<boolean> {
        const entry = this.store.get(key);
        if (!entry) return false;
        this.clearTimer(key);
        entry.timer = setTimeout(() => { this.store.delete(key); }, ttlMs);
        return true;
    }

    private clearTimer(key: string): void {
        const existing = this.store.get(key);
        if (existing?.timer) clearTimeout(existing.timer);
    }
}
