/**
 * circuit-breaker.test.ts
 * CircuitBreaker 상태머신 + CircuitBreakerRegistry 단위 테스트
 */

import { CircuitBreaker, CircuitBreakerRegistry } from '../cluster/circuit-breaker';
import { CircuitOpenError } from '../utils/errors/circuit-open.error';

// CircuitBreakerRegistry 싱글톤 격리
let _registryInstance: CircuitBreakerRegistry | null = null;
function freshRegistry(): CircuitBreakerRegistry {
    // 싱글톤을 우회하기 위해 private static을 리셋
    (CircuitBreakerRegistry as unknown as { instance: CircuitBreakerRegistry | undefined }).instance = undefined;
    return CircuitBreakerRegistry.getInstance();
}

// 성공 함수
const succeed = async () => 'ok';
// 실패 함수
const fail = async () => { throw new Error('simulated failure'); };

describe('CircuitBreaker', () => {

    // ──────────────────────────────────────────
    // 기본 동작 (CLOSED 상태)
    // ──────────────────────────────────────────
    describe('CLOSED 상태 — 정상 운영', () => {
        test('초기 상태는 CLOSED', () => {
            const cb = new CircuitBreaker('test');
            expect(cb.getState()).toBe('CLOSED');
        });

        test('성공 실행 → 결과 반환', async () => {
            const cb = new CircuitBreaker('test');
            const result = await cb.execute(() => Promise.resolve(42));
            expect(result).toBe(42);
        });

        test('실패 시 에러 재throw', async () => {
            const cb = new CircuitBreaker('test');
            await expect(cb.execute(fail)).rejects.toThrow('simulated failure');
        });

        test('실패 횟수가 임계값 미만이면 CLOSED 유지', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 5 });
            for (let i = 0; i < 4; i++) {
                await cb.execute(fail).catch(() => {});
            }
            expect(cb.getState()).toBe('CLOSED');
        });

        test('isAvailable() → true', () => {
            const cb = new CircuitBreaker('test');
            expect(cb.isAvailable()).toBe(true);
        });
    });

    // ──────────────────────────────────────────
    // CLOSED → OPEN 전환
    // ──────────────────────────────────────────
    describe('CLOSED → OPEN 전환', () => {
        test('실패 횟수가 임계값 이상이면 OPEN 전환', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 3 });
            for (let i = 0; i < 3; i++) {
                await cb.execute(fail).catch(() => {});
            }
            expect(cb.getState()).toBe('OPEN');
        });

        test('OPEN 상태에서 CircuitOpenError throw', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 2 });
            await cb.execute(fail).catch(() => {});
            await cb.execute(fail).catch(() => {});

            await expect(cb.execute(succeed)).rejects.toBeInstanceOf(CircuitOpenError);
        });

        test('OPEN 상태에서 isAvailable() → false', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 1 });
            await cb.execute(fail).catch(() => {});
            expect(cb.isAvailable()).toBe(false);
        });

        test('CircuitOpenError는 실패 카운트에 포함 안 됨', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 2 });
            await cb.execute(fail).catch(() => {});
            await cb.execute(fail).catch(() => {});
            // 이미 OPEN. 다시 호출 시 CircuitOpenError → 실패 카운트 증가 없음
            const metricsBefore = cb.getMetrics();
            await cb.execute(succeed).catch(() => {});
            const metricsAfter = cb.getMetrics();
            expect(metricsAfter.totalFailures).toBe(metricsBefore.totalFailures);
        });
    });

    // ──────────────────────────────────────────
    // OPEN → HALF_OPEN 전환
    // ──────────────────────────────────────────
    describe('OPEN → HALF_OPEN 전환', () => {
        test('resetTimeout 경과 후 getState()가 HALF_OPEN 반환', async () => {
            const cb = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 10   // 10ms
            });
            await cb.execute(fail).catch(() => {});
            expect(cb.getState()).toBe('OPEN');

            await new Promise(r => setTimeout(r, 20));
            expect(cb.getState()).toBe('HALF_OPEN');
        });

        test('resetTimeout 경과 전에는 OPEN 유지', async () => {
            const cb = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 5000  // 5초
            });
            await cb.execute(fail).catch(() => {});
            expect(cb.getState()).toBe('OPEN');
        });

        test('HALF_OPEN에서 실패 → OPEN 복귀', async () => {
            const cb = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 10
            });
            await cb.execute(fail).catch(() => {});
            await new Promise(r => setTimeout(r, 20));
            expect(cb.getState()).toBe('HALF_OPEN');

            await cb.execute(fail).catch(() => {});
            expect(cb.getState()).toBe('OPEN');
        });
    });

    // ──────────────────────────────────────────
    // HALF_OPEN → CLOSED 복구
    // ──────────────────────────────────────────
    describe('HALF_OPEN → CLOSED 복구', () => {
        test('연속 성공 halfOpenMaxAttempts 회 → CLOSED', async () => {
            const cb = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 10,
                halfOpenMaxAttempts: 2
            });
            await cb.execute(fail).catch(() => {});
            await new Promise(r => setTimeout(r, 20));

            await cb.execute(succeed);
            expect(cb.getState()).toBe('HALF_OPEN'); // 아직 1회
            await cb.execute(succeed);
            expect(cb.getState()).toBe('CLOSED'); // 2회 → CLOSED
        });

        test('CLOSED 복귀 후 정상 동작', async () => {
            const cb = new CircuitBreaker('test', {
                failureThreshold: 1,
                resetTimeout: 10,
                halfOpenMaxAttempts: 1
            });
            await cb.execute(fail).catch(() => {});
            await new Promise(r => setTimeout(r, 20));
            await cb.execute(succeed);
            expect(cb.getState()).toBe('CLOSED');

            const result = await cb.execute(() => Promise.resolve('recovered'));
            expect(result).toBe('recovered');
        });
    });

    // ──────────────────────────────────────────
    // getFailureCount
    // ──────────────────────────────────────────
    describe('getFailureCount', () => {
        test('실패 후 카운트 반환', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 10 });
            await cb.execute(fail).catch(() => {});
            await cb.execute(fail).catch(() => {});
            expect(cb.getFailureCount()).toBe(2);
        });

        test('성공 시 CLOSED 상태에서 실패 기록 초기화', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 10 });
            await cb.execute(fail).catch(() => {});
            await cb.execute(succeed);
            // 성공 후 failureTimestamps 초기화
            expect(cb.getFailureCount()).toBe(0);
        });

        test('monitorWindow 밖의 실패는 카운트 제외', async () => {
            const cb = new CircuitBreaker('test', {
                failureThreshold: 10,
                monitorWindow: 50   // 50ms 윈도우
            });
            await cb.execute(fail).catch(() => {});
            await new Promise(r => setTimeout(r, 100));
            // monitorWindow 경과 → 만료된 실패는 제외
            expect(cb.getFailureCount()).toBe(0);
        });
    });

    // ──────────────────────────────────────────
    // reset / trip
    // ──────────────────────────────────────────
    describe('reset / trip', () => {
        test('reset() → CLOSED 강제 초기화', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 1 });
            await cb.execute(fail).catch(() => {});
            expect(cb.getState()).toBe('OPEN');

            cb.reset();
            expect(cb.getState()).toBe('CLOSED');
            expect(cb.getFailureCount()).toBe(0);
        });

        test('trip() → OPEN 강제 전환', () => {
            const cb = new CircuitBreaker('test');
            expect(cb.getState()).toBe('CLOSED');
            cb.trip();
            expect(cb.getState()).toBe('OPEN');
        });
    });

    // ──────────────────────────────────────────
    // getMetrics
    // ──────────────────────────────────────────
    describe('getMetrics', () => {
        test('초기 메트릭 상태', () => {
            const cb = new CircuitBreaker('test');
            const m = cb.getMetrics();
            expect(m.state).toBe('CLOSED');
            expect(m.failures).toBe(0);
            expect(m.successes).toBe(0);
            expect(m.totalRequests).toBe(0);
            expect(m.totalFailures).toBe(0);
        });

        test('요청/실패 후 totalRequests, totalFailures 반영', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 10 });
            await cb.execute(succeed);
            await cb.execute(fail).catch(() => {});
            const m = cb.getMetrics();
            expect(m.totalRequests).toBe(2);
            expect(m.totalFailures).toBe(1);
        });

        test('lastFailureTime, lastSuccessTime 기록', async () => {
            const cb = new CircuitBreaker('test', { failureThreshold: 10 });
            await cb.execute(succeed);
            await cb.execute(fail).catch(() => {});
            const m = cb.getMetrics();
            expect(m.lastSuccessTime).toBeDefined();
            expect(m.lastFailureTime).toBeDefined();
        });
    });

    // ──────────────────────────────────────────
    // 설정 오버라이드
    // ──────────────────────────────────────────
    describe('설정 오버라이드', () => {
        test('기본값이 DEFAULT_CONFIG와 일치', () => {
            const cb = new CircuitBreaker('test');
            // 기본값: failureThreshold=5, resetTimeout=30000, halfOpenMaxAttempts=2, monitorWindow=60000
            // 5회 미만이면 OPEN이 안 됨
            // 4회 실패 후 CLOSED
            const execFails = async (n: number) => {
                for (let i = 0; i < n; i++) await cb.execute(fail).catch(() => {});
            };
            return execFails(4).then(() => {
                expect(cb.getState()).toBe('CLOSED');
            });
        });
    });
});

// ──────────────────────────────────────────
// CircuitBreakerRegistry
// ──────────────────────────────────────────
describe('CircuitBreakerRegistry', () => {
    let registry: CircuitBreakerRegistry;

    beforeEach(() => {
        registry = freshRegistry();
    });

    test('싱글톤: getInstance()는 같은 인스턴스 반환', () => {
        const a = CircuitBreakerRegistry.getInstance();
        const b = CircuitBreakerRegistry.getInstance();
        expect(a).toBe(b);
    });

    test('getOrCreate — 새 서킷 브레이커 생성', () => {
        const cb = registry.getOrCreate('node-1');
        expect(cb).toBeInstanceOf(CircuitBreaker);
    });

    test('getOrCreate — 같은 이름으로 호출 시 동일 인스턴스 반환', () => {
        const a = registry.getOrCreate('node-1');
        const b = registry.getOrCreate('node-1');
        expect(a).toBe(b);
    });

    test('getOrCreate — 다른 이름은 다른 인스턴스', () => {
        const a = registry.getOrCreate('node-1');
        const b = registry.getOrCreate('node-2');
        expect(a).not.toBe(b);
    });

    test('get — 존재하는 서킷 브레이커 반환', () => {
        registry.getOrCreate('node-x');
        expect(registry.get('node-x')).toBeInstanceOf(CircuitBreaker);
    });

    test('get — 존재하지 않으면 undefined 반환', () => {
        expect(registry.get('non-existent')).toBeUndefined();
    });

    test('getAll — 등록된 모든 서킷 브레이커 맵 반환', () => {
        registry.getOrCreate('n1');
        registry.getOrCreate('n2');
        const all = registry.getAll();
        expect(all.size).toBe(2);
        expect(all.has('n1')).toBe(true);
        expect(all.has('n2')).toBe(true);
    });

    test('getAll — 복사본이므로 원본에 영향 없음', () => {
        registry.getOrCreate('n1');
        const copy = registry.getAll();
        copy.delete('n1');
        expect(registry.get('n1')).toBeDefined();
    });

    test('resetAll — 모든 서킷을 CLOSED로 초기화', async () => {
        const cb = registry.getOrCreate('node-fail', { failureThreshold: 1 });
        await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
        expect(cb.getState()).toBe('OPEN');

        registry.resetAll();
        expect(cb.getState()).toBe('CLOSED');
    });

    test('config 옵션이 새 서킷 브레이커에 전달됨', async () => {
        const cb = registry.getOrCreate('node-config', { failureThreshold: 1 });
        await cb.execute(async () => { throw new Error(); }).catch(() => {});
        // failureThreshold=1이므로 1회 실패로 OPEN
        expect(cb.getState()).toBe('OPEN');
    });

    test('이미 존재하면 getOrCreate 시 config가 무시됨 (기존 인스턴스 재사용)', async () => {
        const cb1 = registry.getOrCreate('existing', { failureThreshold: 10 });
        const cb2 = registry.getOrCreate('existing', { failureThreshold: 1 }); // 무시됨
        expect(cb1).toBe(cb2);
    });
});
