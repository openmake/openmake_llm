/**
 * Key-Value Store 추상화 인터페이스 (Stage 2-H3).
 *
 * MemoryStore(기본, per-instance)와 RedisStore(공용)을 투명하게 교체 가능.
 * Rate limiter의 sliding-window counter 및 OAuth state nonce 저장의 공통 API.
 *
 * @module storage/types
 */

/**
 * 저장 가능한 값 타입. object는 JSON 직렬화 가능한 모든 구조체를 허용 (interface 포함).
 * TypeScript의 Record<string, unknown>은 explicit interface와 호환되지 않으므로 object 사용.
 */
export type StorageValue = string | number | object;

export interface KeyValueStore {
    /**
     * 값 조회. 키 없으면 null. 저장 시 JSON 직렬화되었으므로 파싱하여 반환.
     */
    get<T extends StorageValue = StorageValue>(key: string): Promise<T | null>;

    /**
     * 값 저장. ttlMs 지정 시 해당 ms 경과 후 자동 만료. 기존 값 덮어씀(타이머도 재설정).
     */
    set(key: string, value: StorageValue, ttlMs?: number): Promise<void>;

    /**
     * 원자적 증가. 키 없거나 숫자 아니면 0에서 시작하여 1로. 반환값은 증가 후 값.
     */
    incr(key: string): Promise<number>;

    /**
     * 키 삭제. 없어도 에러 없이 no-op.
     */
    del(key: string): Promise<void>;

    /**
     * 만료 시간 설정(ms). 키가 없으면 false, 성공 시 true.
     */
    expire(key: string, ttlMs: number): Promise<boolean>;

    /** 구현 이름 — 로깅·디버깅·분기 제어용 */
    readonly backend: 'memory' | 'redis';
}
