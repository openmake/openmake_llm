/**
 * ============================================================
 * Request Queue - 우선순위 기반 요청 큐잉 시스템
 * ============================================================
 *
 * 우선순위(high/normal/low) 기반 요청 처리, 동시성 제한,
 * 자동 재시도, 백프레셔 관리를 제공하는 이벤트 구동 큐 시스템입니다.
 * 채팅 요청 등 비동기 작업의 순서 보장과 과부하 방지에 사용됩니다.
 *
 * @module workers/queue/request-queue
 * @description 제공하는 클래스/함수:
 * - RequestQueue<T>          - 제네릭 우선순위 요청 큐 클래스
 * - createChatRequestQueue() - 채팅 전용 큐 생성 헬퍼
 *
 * @description 주요 기능:
 * - 3단계 우선순위 큐 (high > normal > low)
 * - 설정 가능한 동시성 제한 (기본 5)
 * - 지수 백오프 재시도 (attempts * retryDelay)
 * - 백프레셔 임계값 기반 과부하 감지
 * - EventEmitter 기반 이벤트 (completed, failed, backpressure)
 *
 * @requires workers/utils/logger - 로깅
 * @requires events - EventEmitter
 */

import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const logger = createLogger('RequestQueue');

/** 요청 우선순위 타입 (high > normal > low 순서로 처리) */
type RequestPriority = 'high' | 'normal' | 'low';

/**
 * 큐에 저장되는 개별 요청 인터페이스
 * @property id - 고유 요청 ID (req_{timestamp}_{random})
 * @property priority - 요청 우선순위
 * @property data - 요청 데이터 페이로드
 * @property createdAt - 요청 생성 시각
 * @property attempts - 현재까지 시도 횟수
 * @property maxAttempts - 최대 재시도 횟수
 * @property resolve - Promise resolve 콜백
 * @property reject - Promise reject 콜백
 */
interface QueuedRequest<T = any> {
    id: string;
    priority: RequestPriority;
    data: T;
    createdAt: Date;
    attempts: number;
    maxAttempts: number;
    resolve: (value: any) => void;
    reject: (error: any) => void;
}

/**
 * 큐 동작 설정 인터페이스
 * @property maxSize - 최대 큐 크기 (초과 시 요청 거부)
 * @property concurrency - 동시 처리 가능한 요청 수
 * @property retryDelay - 재시도 기본 지연 시간 (ms, attempts 배수 적용)
 * @property maxRetries - 최대 재시도 횟수
 * @property backpressureThreshold - 백프레셔 활성화 임계값 (큐 사용률 %)
 */
interface QueueConfig {
    maxSize: number;              // 최대 큐 크기
    concurrency: number;          // 동시 처리 수
    retryDelay: number;           // 재시도 지연 (ms)
    maxRetries: number;           // 최대 재시도 횟수
    backpressureThreshold: number; // 백프레셔 임계값 (%)
}

/**
 * 큐 운영 통계 인터페이스
 * @property totalQueued - 현재 대기 중인 요청 수
 * @property processing - 현재 처리 중인 요청 수
 * @property completed - 누적 완료 요청 수
 * @property failed - 누적 실패 요청 수
 * @property avgWaitTime - 평균 대기 시간 (ms)
 * @property avgProcessTime - 평균 처리 시간 (ms)
 * @property backpressureActive - 백프레셔 활성화 여부
 */
interface QueueStats {
    totalQueued: number;
    processing: number;
    completed: number;
    failed: number;
    avgWaitTime: number;
    avgProcessTime: number;
    backpressureActive: boolean;
}

/**
 * 우선순위 기반 요청 큐 시스템
 * 3단계 우선순위 큐(high/normal/low)로 요청을 관리하며,
 * 동시성 제한, 자동 재시도, 백프레셔 감지를 제공합니다.
 * @template T - 요청 데이터 타입
 * @emits completed - 요청 처리 완료 시 ({id, waitTime, processTime})
 * @emits failed - 요청 최종 실패 시 ({id, error, attempts})
 * @emits backpressure - 큐가 가득 찼을 때
 */
export class RequestQueue<T = any> extends EventEmitter {
    private highQueue: QueuedRequest<T>[] = [];
    private normalQueue: QueuedRequest<T>[] = [];
    private lowQueue: QueuedRequest<T>[] = [];
    private processing: Set<string> = new Set();
    private config: QueueConfig;

    // 통계
    private stats = {
        completed: 0,
        failed: 0,
        totalWaitTime: 0,
        totalProcessTime: 0
    };

    /**
     * RequestQueue 생성자
     * @param processor - 각 요청을 처리하는 비동기 함수
     * @param config - 큐 설정 (선택, 기본값 적용)
     */
    constructor(
        private processor: (request: T) => Promise<any>,
        config?: Partial<QueueConfig>
    ) {
        super();
        this.config = {
            maxSize: config?.maxSize || 1000,
            concurrency: config?.concurrency || 5,
            retryDelay: config?.retryDelay || 1000,
            maxRetries: config?.maxRetries || 3,
            backpressureThreshold: config?.backpressureThreshold || 80
        };

        logger.info(`요청 큐 초기화됨 (concurrency: ${this.config.concurrency})`);
    }

    /**
     * 전체 큐 크기
     */
    get size(): number {
        return this.highQueue.length + this.normalQueue.length + this.lowQueue.length;
    }

    /**
     * 백프레셔 활성화 여부
     */
    get isBackpressureActive(): boolean {
        return (this.size / this.config.maxSize) * 100 >= this.config.backpressureThreshold;
    }

    /**
     * 요청을 우선순위 큐에 추가합니다.
     * 큐가 가득 찬 경우 즉시 reject되며 'backpressure' 이벤트가 발생합니다.
     * @param data - 요청 데이터
     * @param priority - 요청 우선순위 (기본값: 'normal')
     * @returns 처리 결과 Promise
     * @throws 큐가 가득 찬 경우 Error
     */
    enqueue(data: T, priority: RequestPriority = 'normal'): Promise<any> {
        return new Promise((resolve, reject) => {
            // 백프레셔 체크
            if (this.size >= this.config.maxSize) {
                reject(new Error('큐가 가득 찼습니다. 잠시 후 다시 시도하세요.'));
                this.emit('backpressure');
                return;
            }

            const request: QueuedRequest<T> = {
                id: `req_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                priority,
                data,
                createdAt: new Date(),
                attempts: 0,
                maxAttempts: this.config.maxRetries,
                resolve,
                reject
            };

            // 우선순위별 큐에 추가
            switch (priority) {
                case 'high':
                    this.highQueue.push(request);
                    break;
                case 'low':
                    this.lowQueue.push(request);
                    break;
                default:
                    this.normalQueue.push(request);
            }

            logger.debug(`요청 추가됨: ${request.id} (${priority}), 큐 크기: ${this.size}`);

            // 처리 시작
            this.processQueue();
        });
    }

    /**
     * 우선순위 순서(high > normal > low)로 다음 요청을 꺼냅니다.
     * @returns 다음 처리할 요청 또는 undefined (큐가 비어있는 경우)
     */
    private dequeue(): QueuedRequest<T> | undefined {
        if (this.highQueue.length > 0) {
            return this.highQueue.shift();
        }
        if (this.normalQueue.length > 0) {
            return this.normalQueue.shift();
        }
        if (this.lowQueue.length > 0) {
            return this.lowQueue.shift();
        }
        return undefined;
    }

    /**
     * 큐에서 요청을 꺼내 동시성 제한 내에서 처리합니다.
     * 이벤트 구동 방식으로 busy-wait 폴링 없이 동작합니다.
     * 처리 완료 후 대기 중인 요청이 있으면 재귀적으로 호출됩니다.
     */
    private processQueue(): void {
        // 동시성 제한 내에서 가능한 요청 모두 디큐
        while (this.processing.size < this.config.concurrency && this.size > 0) {
            const request = this.dequeue();
            if (!request) break;

            this.processing.add(request.id);
            this.processRequest(request).then(() => {
                // 처리 완료 후 다음 요청 트리거
                if (this.size > 0) {
                    this.processQueue();
                }
            });
        }
    }

    /**
     * 개별 요청을 processor 함수로 처리합니다.
     * 실패 시 maxAttempts 이내이면 지수 백오프로 재시도합니다.
     * @param request - 처리할 큐 요청
     */
    private async processRequest(request: QueuedRequest<T>): Promise<void> {
        const startTime = Date.now();
        const waitTime = startTime - request.createdAt.getTime();

        try {
            request.attempts++;
            const result = await this.processor(request.data);

            const processTime = Date.now() - startTime;
            this.stats.completed++;
            this.stats.totalWaitTime += waitTime;
            this.stats.totalProcessTime += processTime;

            request.resolve(result);
            this.emit('completed', { id: request.id, waitTime, processTime });

        } catch (error) {
            // 재시도 가능 여부 확인
            if (request.attempts < request.maxAttempts) {
                logger.warn(`요청 재시도: ${request.id} (${request.attempts}/${request.maxAttempts})`);

                // 재시도 지연 후 큐에 다시 추가
                setTimeout(() => {
                    this.normalQueue.unshift(request);
                    this.processQueue();
                }, this.config.retryDelay * request.attempts);
            } else {
                this.stats.failed++;
                request.reject(error);
                this.emit('failed', { id: request.id, error, attempts: request.attempts });
            }
        } finally {
            this.processing.delete(request.id);
        }
    }

    /**
     * 큐 운영 통계를 반환합니다.
     * @returns 대기/처리/완료/실패 수, 평균 대기/처리 시간, 백프레셔 상태
     */
    getStats(): QueueStats {
        const total = this.stats.completed + this.stats.failed;

        return {
            totalQueued: this.size,
            processing: this.processing.size,
            completed: this.stats.completed,
            failed: this.stats.failed,
            avgWaitTime: total > 0
                ? Math.round(this.stats.totalWaitTime / total)
                : 0,
            avgProcessTime: this.stats.completed > 0
                ? Math.round(this.stats.totalProcessTime / this.stats.completed)
                : 0,
            backpressureActive: this.isBackpressureActive
        };
    }

    /**
     * 모든 대기 중인 요청을 취소하고 큐를 비웁니다.
     * 각 대기 요청의 Promise는 '큐가 비워졌습니다' 에러로 reject됩니다.
     */
    clear(): void {
        // 대기 중인 요청들 취소
        const allQueued = [...this.highQueue, ...this.normalQueue, ...this.lowQueue];
        for (const req of allQueued) {
            req.reject(new Error('큐가 비워졌습니다.'));
        }

        this.highQueue = [];
        this.normalQueue = [];
        this.lowQueue = [];

        logger.info('큐 비워짐');
    }

    /**
     * 누적 통계(완료/실패/대기시간/처리시간)를 초기화합니다.
     */
    resetStats(): void {
        this.stats = {
            completed: 0,
            failed: 0,
            totalWaitTime: 0,
            totalProcessTime: 0
        };
    }

    /**
     * 대기 중인 특정 요청을 ID로 찾아 취소합니다.
     * 이미 처리 중인 요청은 취소할 수 없습니다.
     * @param requestId - 취소할 요청 ID
     * @returns 취소 성공 여부
     */
    cancel(requestId: string): boolean {
        const queues = [this.highQueue, this.normalQueue, this.lowQueue];

        for (const queue of queues) {
            const idx = queue.findIndex(r => r.id === requestId);
            if (idx > -1) {
                const [removed] = queue.splice(idx, 1);
                removed.reject(new Error('요청이 취소되었습니다.'));
                return true;
            }
        }

        return false;
    }

    /**
     * 우선순위별 큐 크기와 처리 중인 요청 수를 반환합니다.
     * @returns 각 우선순위 큐의 크기 및 처리 중 요청 수
     */
    getQueueState(): {
        high: number;
        normal: number;
        low: number;
        processing: number;
    } {
        return {
            high: this.highQueue.length,
            normal: this.normalQueue.length,
            low: this.lowQueue.length,
            processing: this.processing.size
        };
    }
}

/**
 * 채팅 요청 전용 큐를 생성하는 헬퍼 함수입니다.
 * 동시성 3, 최대 크기 100, 재시도 2회로 설정됩니다.
 * @param processor - 채팅 요청 처리 함수
 * @returns 채팅 전용 RequestQueue 인스턴스
 */
export function createChatRequestQueue(
    processor: (request: any) => Promise<any>
): RequestQueue {
    return new RequestQueue(processor, {
        concurrency: 3,
        maxSize: 100,
        maxRetries: 2
    });
}
