/**
 * ============================================================
 * CircuitBreaker - 서킷 브레이커 패턴 구현
 * ============================================================
 *
 * Ollama 클러스터 노드의 장애 감지 및 자동 복구를 위한 서킷 브레이커입니다.
 * 연속된 실패 감지 시 해당 노드로의 요청을 차단하여 장애 전파를 방지하고,
 * 일정 시간 후 자동으로 복구를 시도합니다.
 *
 * 상태 머신:
 * - CLOSED: 정상 운영. monitorWindow 내 실패 횟수가 failureThreshold 이상이면 → OPEN
 * - OPEN: 즉시 거부 (CircuitOpenError). resetTimeout 경과 후 → HALF_OPEN
 * - HALF_OPEN: 프로브 요청 허용. 실패 시 → OPEN, 연속 성공 시 → CLOSED
 *
 * @module cluster/circuit-breaker
 * @see errors/circuit-open.error.ts - CircuitOpenError
 * @see cluster/manager.ts - ClusterManager에서 노드별 서킷 브레이커 사용
 */

import { CircuitOpenError } from '../errors/circuit-open.error';
import { createLogger } from '../utils/logger';

const logger = createLogger('CircuitBreaker');

/** 서킷 브레이커 상태 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * 서킷 브레이커 설정
 */
export interface CircuitBreakerConfig {
    /** OPEN 전환까지의 실패 횟수 (기본값: 5) */
    failureThreshold: number;
    /** OPEN → HALF_OPEN 전환 대기 시간 (ms, 기본값: 30000) */
    resetTimeout: number;
    /** HALF_OPEN에서 CLOSED 전환까지의 연속 성공 횟수 (기본값: 2) */
    halfOpenMaxAttempts: number;
    /** 실패 카운트 슬라이딩 윈도우 크기 (ms, 기본값: 60000) */
    monitorWindow: number;
}

/**
 * 서킷 브레이커 메트릭
 */
export interface CircuitBreakerMetrics {
    /** 현재 서킷 상태 */
    state: CircuitState;
    /** 현재 윈도우 내 실패 횟수 */
    failures: number;
    /** HALF_OPEN 연속 성공 횟수 */
    successes: number;
    /** 마지막 실패 시각 (Unix timestamp, ms) */
    lastFailureTime?: number;
    /** 마지막 성공 시각 (Unix timestamp, ms) */
    lastSuccessTime?: number;
    /** 누적 총 요청 수 */
    totalRequests: number;
    /** 누적 총 실패 수 */
    totalFailures: number;
}

/** 기본 서킷 브레이커 설정 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeout: 30000,
    halfOpenMaxAttempts: 2,
    monitorWindow: 60000,
};

/**
 * 서킷 브레이커 클래스
 *
 * 비동기 호출을 래핑하여 장애 감지 및 자동 복구를 수행합니다.
 * 슬라이딩 윈도우 방식으로 실패를 추적하며, OPEN 상태에서는
 * CircuitOpenError를 즉시 throw하여 불필요한 요청을 차단합니다.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker('node:192.168.1.100:11434');
 * try {
 *   const result = await breaker.execute(() => client.chat(messages));
 * } catch (error) {
 *   if (error instanceof CircuitOpenError) {
 *     // 다른 노드로 failover
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
    /** 서킷 브레이커 식별 이름 */
    private readonly name: string;
    /** 서킷 브레이커 설정 */
    private readonly config: CircuitBreakerConfig;
    /** 현재 서킷 상태 */
    private state: CircuitState = 'CLOSED';
    /** 슬라이딩 윈도우 내 실패 타임스탬프 배열 */
    private failureTimestamps: number[] = [];
    /** HALF_OPEN 상태에서의 연속 성공 카운트 */
    private halfOpenSuccesses: number = 0;
    /** OPEN → HALF_OPEN 전환 타이머 */
    private resetTimer?: ReturnType<typeof setTimeout>;
    /** OPEN 전환 시각 (HALF_OPEN 전환 예상 시각 계산용) */
    private openedAt: number = 0;
    /** 마지막 실패 시각 */
    private lastFailureTime?: number;
    /** 마지막 성공 시각 */
    private lastSuccessTime?: number;
    /** 누적 총 요청 수 */
    private totalRequests: number = 0;
    /** 누적 총 실패 수 */
    private totalFailures: number = 0;

    /**
     * @param name - 서킷 브레이커 식별 이름 (예: "node:192.168.1.100:11434")
     * @param config - 부분 설정 (미지정 항목은 기본값 적용)
     */
    constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
        this.name = name;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 비동기 함수를 서킷 브레이커로 래핑하여 실행합니다.
     *
     * - OPEN 상태: 즉시 CircuitOpenError throw
     * - CLOSED/HALF_OPEN 상태: 함수 실행 후 성공/실패에 따라 상태 전환
     *
     * @param fn - 래핑할 비동기 함수
     * @returns 래핑된 함수의 반환값
     * @throws {CircuitOpenError} 서킷이 OPEN 상태일 때
     * @throws 래핑된 함수에서 발생한 에러 (서킷 상태 업데이트 후 재throw)
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        this.totalRequests++;

        // OPEN 상태: 즉시 거부
        if (this.state === 'OPEN') {
            // resetTimeout 경과 여부 확인 → 경과 시 HALF_OPEN 전환
            if (Date.now() >= this.openedAt + this.config.resetTimeout) {
                this.transitionTo('HALF_OPEN');
            } else {
                throw new CircuitOpenError(
                    this.name,
                    this.openedAt + this.config.resetTimeout
                );
            }
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            // CircuitOpenError는 재귀 방지를 위해 실패로 카운트하지 않음
            if (error instanceof CircuitOpenError) {
                throw error;
            }
            this.onFailure();
            throw error;
        }
    }

    /**
     * 현재 서킷 상태를 반환합니다.
     */
    getState(): CircuitState {
        // OPEN 상태에서 resetTimeout 경과 시 HALF_OPEN으로 자동 전환
        if (this.state === 'OPEN' && Date.now() >= this.openedAt + this.config.resetTimeout) {
            this.transitionTo('HALF_OPEN');
        }
        return this.state;
    }

    /**
     * 현재 모니터링 윈도우 내 실패 횟수를 반환합니다.
     */
    getFailureCount(): number {
        this.pruneFailureTimestamps();
        return this.failureTimestamps.length;
    }

    /**
     * 서킷이 사용 가능한 상태인지 확인합니다.
     * OPEN 상태이면 false, CLOSED/HALF_OPEN이면 true입니다.
     */
    isAvailable(): boolean {
        const currentState = this.getState();
        return currentState !== 'OPEN';
    }

    /**
     * 서킷을 강제로 CLOSED 상태로 초기화합니다.
     * 모든 실패 기록과 카운터를 리셋합니다.
     */
    reset(): void {
        this.clearResetTimer();
        this.state = 'CLOSED';
        this.failureTimestamps = [];
        this.halfOpenSuccesses = 0;
        this.openedAt = 0;
        logger.info(`[${this.name}] 서킷 강제 리셋 → CLOSED`);
    }

    /**
     * 서킷을 강제로 OPEN 상태로 전환합니다.
     * 수동 개입이 필요한 경우 사용합니다.
     */
    trip(): void {
        this.transitionTo('OPEN');
        logger.warn(`[${this.name}] 서킷 강제 OPEN (수동 트립)`);
    }

    /**
     * 서킷 브레이커 메트릭을 반환합니다.
     */
    getMetrics(): CircuitBreakerMetrics {
        this.pruneFailureTimestamps();
        return {
            state: this.getState(),
            failures: this.failureTimestamps.length,
            successes: this.halfOpenSuccesses,
            lastFailureTime: this.lastFailureTime,
            lastSuccessTime: this.lastSuccessTime,
            totalRequests: this.totalRequests,
            totalFailures: this.totalFailures,
        };
    }

    /**
     * 성공 처리: 상태에 따라 적절한 전환 수행
     */
    private onSuccess(): void {
        this.lastSuccessTime = Date.now();

        switch (this.state) {
            case 'CLOSED':
                // CLOSED 상태에서 성공 시 실패 기록 초기화
                this.failureTimestamps = [];
                break;

            case 'HALF_OPEN':
                // HALF_OPEN에서 연속 성공 카운트 증가
                this.halfOpenSuccesses++;
                logger.info(
                    `[${this.name}] HALF_OPEN 프로브 성공 (${this.halfOpenSuccesses}/${this.config.halfOpenMaxAttempts})`
                );
                if (this.halfOpenSuccesses >= this.config.halfOpenMaxAttempts) {
                    this.transitionTo('CLOSED');
                }
                break;
        }
    }

    /**
     * 실패 처리: 슬라이딩 윈도우에 기록, 임계값 초과 시 OPEN 전환
     */
    private onFailure(): void {
        const now = Date.now();
        this.lastFailureTime = now;
        this.totalFailures++;

        switch (this.state) {
            case 'CLOSED': {
                this.failureTimestamps.push(now);
                this.pruneFailureTimestamps();

                if (this.failureTimestamps.length >= this.config.failureThreshold) {
                    this.transitionTo('OPEN');
                } else {
                    logger.debug(
                        `[${this.name}] 실패 기록 (${this.failureTimestamps.length}/${this.config.failureThreshold})`
                    );
                }
                break;
            }

            case 'HALF_OPEN':
                // HALF_OPEN에서 실패 시 즉시 OPEN 복귀
                logger.warn(`[${this.name}] HALF_OPEN 프로브 실패 → OPEN 복귀`);
                this.transitionTo('OPEN');
                break;
        }
    }

    /**
     * 상태 전환을 수행합니다.
     *
     * @param newState - 전환할 목표 상태
     */
    private transitionTo(newState: CircuitState): void {
        const prevState = this.state;
        this.state = newState;

        switch (newState) {
            case 'OPEN':
                this.openedAt = Date.now();
                this.halfOpenSuccesses = 0;
                this.scheduleHalfOpenTransition();
                logger.warn(
                    `[${this.name}] ${prevState} → OPEN (${this.config.resetTimeout}ms 후 HALF_OPEN 전환)`
                );
                break;

            case 'HALF_OPEN':
                this.clearResetTimer();
                this.halfOpenSuccesses = 0;
                logger.info(`[${this.name}] ${prevState} → HALF_OPEN (프로브 시작)`);
                break;

            case 'CLOSED':
                this.clearResetTimer();
                this.failureTimestamps = [];
                this.halfOpenSuccesses = 0;
                this.openedAt = 0;
                logger.info(`[${this.name}] ${prevState} → CLOSED (복구 완료)`);
                break;
        }
    }

    /**
     * OPEN → HALF_OPEN 전환 타이머를 스케줄합니다.
     * unref()를 호출하여 프로세스 종료를 차단하지 않습니다.
     */
    private scheduleHalfOpenTransition(): void {
        this.clearResetTimer();
        this.resetTimer = setTimeout(() => {
            if (this.state === 'OPEN') {
                this.transitionTo('HALF_OPEN');
            }
        }, this.config.resetTimeout);

        // Graceful shutdown을 차단하지 않도록 unref
        if (this.resetTimer && typeof this.resetTimer.unref === 'function') {
            this.resetTimer.unref();
        }
    }

    /**
     * 리셋 타이머를 정리합니다.
     */
    private clearResetTimer(): void {
        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
            this.resetTimer = undefined;
        }
    }

    /**
     * 슬라이딩 윈도우 밖의 오래된 실패 기록을 제거합니다.
     */
    private pruneFailureTimestamps(): void {
        const cutoff = Date.now() - this.config.monitorWindow;
        this.failureTimestamps = this.failureTimestamps.filter(ts => ts > cutoff);
    }
}

/**
 * 서킷 브레이커 레지스트리 (싱글톤)
 *
 * 노드별/모델별 서킷 브레이커 인스턴스를 관리합니다.
 * 키 형식: "node:{nodeId}" 또는 "model:{modelName}:{nodeId}"
 *
 * @example
 * ```typescript
 * const registry = CircuitBreakerRegistry.getInstance();
 * const breaker = registry.getOrCreate('node:192.168.1.100:11434', {
 *   failureThreshold: 3,
 *   resetTimeout: 15000,
 * });
 *
 * const result = await breaker.execute(() => client.chat(messages));
 * ```
 */
export class CircuitBreakerRegistry {
    /** 싱글톤 인스턴스 */
    private static instance: CircuitBreakerRegistry;
    /** 서킷 브레이커 맵 (이름 → 인스턴스) */
    private readonly breakers: Map<string, CircuitBreaker> = new Map();

    private constructor() {}

    /**
     * 싱글톤 인스턴스를 반환합니다.
     */
    static getInstance(): CircuitBreakerRegistry {
        if (!CircuitBreakerRegistry.instance) {
            CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
        }
        return CircuitBreakerRegistry.instance;
    }

    /**
     * 이름으로 서킷 브레이커를 조회하거나, 없으면 새로 생성합니다.
     *
     * @param name - 서킷 브레이커 식별 이름
     * @param config - 부분 설정 (새로 생성할 때만 적용)
     * @returns 기존 또는 새로 생성된 CircuitBreaker 인스턴스
     */
    getOrCreate(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
        let breaker = this.breakers.get(name);
        if (!breaker) {
            breaker = new CircuitBreaker(name, config);
            this.breakers.set(name, breaker);
            logger.debug(`[Registry] 서킷 브레이커 생성: ${name}`);
        }
        return breaker;
    }

    /**
     * 이름으로 서킷 브레이커를 조회합니다.
     *
     * @param name - 서킷 브레이커 식별 이름
     * @returns CircuitBreaker 인스턴스 또는 undefined
     */
    get(name: string): CircuitBreaker | undefined {
        return this.breakers.get(name);
    }

    /**
     * 모든 서킷 브레이커를 CLOSED 상태로 초기화합니다.
     */
    resetAll(): void {
        for (const [name, breaker] of this.breakers) {
            breaker.reset();
            logger.info(`[Registry] 서킷 리셋: ${name}`);
        }
    }

    /**
     * 등록된 모든 서킷 브레이커를 반환합니다.
     *
     * @returns 이름 → CircuitBreaker 맵의 복사본
     */
    getAll(): Map<string, CircuitBreaker> {
        return new Map(this.breakers);
    }
}
