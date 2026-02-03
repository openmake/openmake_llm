/**
 * 🆕 요청 큐잉 시스템
 * 우선순위 기반 요청 처리, 배치 처리, 백프레셔 관리
 */

import { createLogger } from '../utils/logger';
import { EventEmitter } from 'events';

const logger = createLogger('RequestQueue');

// 요청 우선순위
type RequestPriority = 'high' | 'normal' | 'low';

// 큐에 저장되는 요청
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

// 큐 설정
interface QueueConfig {
    maxSize: number;              // 최대 큐 크기
    concurrency: number;          // 동시 처리 수
    retryDelay: number;           // 재시도 지연 (ms)
    maxRetries: number;           // 최대 재시도 횟수
    backpressureThreshold: number; // 백프레셔 임계값 (%)
}

// 큐 통계
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
 * 요청 큐 시스템
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
     * 요청 추가
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
     * 다음 요청 가져오기 (우선순위 순)
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
     * 큐 처리
     * #9 개선: busy-wait 폴링 제거 → 이벤트 구동 방식
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
     * 개별 요청 처리
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
     * 통계 조회
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
     * 큐 비우기
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
     * 통계 리셋
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
     * 특정 요청 취소
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
     * 큐 상태 조회
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

// 채팅 요청 큐 생성 헬퍼
export function createChatRequestQueue(
    processor: (request: any) => Promise<any>
): RequestQueue {
    return new RequestQueue(processor, {
        concurrency: 3,
        maxSize: 100,
        maxRetries: 2
    });
}
