/**
 * In-memory Key-Value Store 구현 (Stage 2-H3 Phase 1).
 *
 * 단일 인스턴스 환경에서 기존 Map 기반 동작을 정확히 재현.
 * TTL은 setTimeout으로 스케줄링하며, 덮어쓰기 시 이전 타이머를 정리해
 * 누수·좀비 삭제를 방지.
 *
 * Node 의 setTimeout 은 2^31-1ms(약 24.8일)를 넘는 지연을 1ms 로 바꿔 버린다(TimeoutOverflowWarning).
 * 그래서 항목마다 절대 만료 시각(expiresAt)을 기억하고, 타이머는 상한 이하로만 걸어 남은 시간만큼 다시 건다.
 * 읽기·쓰기도 expiresAt 이 지난 항목을 없는 것으로 보므로(지연 만료) 정확성이 타이머에 기대지 않는다.
 *
 * @module storage/memory-store
 */

import { KeyValueStore, StorageValue } from './types';

/** setTimeout 이 받아들이는 최대 지연(ms). 이보다 크면 Node 가 1ms 로 바꾼다. */
export const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

interface Entry {
    value: string;
    timer?: NodeJS.Timeout;
    /** 절대 만료 시각(epoch ms). 없으면 만료 없음. */
    expiresAt?: number;
}

export class MemoryStore implements KeyValueStore {
    readonly backend = 'memory' as const;
    private store = new Map<string, Entry>();

    async get<T extends StorageValue = StorageValue>(key: string): Promise<T | null> {
        const entry = this.liveEntry(key);
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
        this.store.set(key, entry);
        if (ttlMs && ttlMs > 0) {
            this.armExpiry(key, entry, Date.now() + ttlMs);
        }
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
        const existing = this.liveEntry(key);
        let current = 0;
        if (existing) {
            const parsed = Number(existing.value);
            current = Number.isFinite(parsed) ? parsed : 0;
        }
        const next = current + amount;
        if (existing) {
            // 같은 항목을 고쳐 쓴다 — 기존 만료(타이머·expiresAt)가 그대로 유지된다(Redis INCRBY 도 TTL 을 건드리지 않는다).
            existing.value = JSON.stringify(next);
        } else {
            this.store.set(key, { value: JSON.stringify(next) });
        }
        return next;
    }

    async del(key: string): Promise<void> {
        this.clearTimer(key);
        this.store.delete(key);
    }

    async expire(key: string, ttlMs: number): Promise<boolean> {
        const entry = this.liveEntry(key);
        if (!entry) return false;
        this.clearTimer(key);
        this.armExpiry(key, entry, Date.now() + ttlMs);
        return true;
    }

    /** 만료 시각이 지난 항목은 지우고 undefined — 타이머가 늦거나 아직 안 돌았어도 없는 것으로 본다. */
    private liveEntry(key: string): Entry | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
            if (entry.timer) clearTimeout(entry.timer);
            this.store.delete(key);
            return undefined;
        }
        return entry;
    }

    /** expiresAt 을 기록하고 상한 이하 지연으로 타이머를 건다. 일찍 깨면 남은 시간만큼 다시 건다. */
    private armExpiry(key: string, entry: Entry, expiresAt: number): void {
        entry.expiresAt = expiresAt;
        const schedule = (): void => {
            const remaining = Math.max(0, expiresAt - Date.now());
            entry.timer = setTimeout(() => {
                // 그 사이 키가 다른 항목으로 바뀌었거나 만료가 바뀌었으면 이 타이머는 할 일이 없다.
                if (this.store.get(key) !== entry || entry.expiresAt !== expiresAt) return;
                if (Date.now() >= expiresAt) {
                    this.store.delete(key);
                } else {
                    schedule();
                }
            }, Math.min(remaining, MAX_TIMER_DELAY_MS));
        };
        schedule();
    }

    private clearTimer(key: string): void {
        const existing = this.store.get(key);
        if (existing?.timer) clearTimeout(existing.timer);
    }
}
