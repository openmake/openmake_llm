/**
 * Key-Value Store 팩토리 (Stage 2-H3 Phase 1.2).
 *
 * STORAGE_BACKEND 환경변수 기반 디스패치.
 * - memory (기본): MemoryStore — 단일 인스턴스 in-memory
 * - redis: RedisStore — Phase 4에서 추가 예정
 *
 * 싱글톤으로 관리하여 동일 프로세스 내 모든 호출자가 같은 인스턴스 공유.
 * 테스트에서는 resetKeyValueStoreForTests()로 리셋 가능.
 *
 * @module storage
 */

import { KeyValueStore } from './types';
import { MemoryStore } from './memory-store';
import { getConfig } from '../config';

export type { KeyValueStore, StorageValue } from './types';
export { MemoryStore } from './memory-store';

let cachedInstance: KeyValueStore | null = null;

/**
 * STORAGE_BACKEND 설정에 따라 KeyValueStore 싱글톤 인스턴스 반환.
 * Rate limiter / OAuth state 등 공용 저장이 필요한 서브시스템이 호출.
 */
export function getKeyValueStore(): KeyValueStore {
    if (cachedInstance) return cachedInstance;

    const cfg = getConfig();
    switch (cfg.storageBackend) {
        case 'memory':
            cachedInstance = new MemoryStore();
            return cachedInstance;
        case 'redis':
            // Phase 4에서 RedisStore 활성화 예정
            throw new Error('RedisStore not implemented yet — set STORAGE_BACKEND=memory until Phase 4 lands');
        default:
            throw new Error(`Unknown STORAGE_BACKEND: ${cfg.storageBackend}`);
    }
}

/**
 * 테스트 전용: 싱글톤 리셋. Production 코드에서 호출 금지.
 * mock된 getConfig가 다른 값을 반환하도록 바꾼 직후 사용.
 */
export function resetKeyValueStoreForTests(): void {
    cachedInstance = null;
}
