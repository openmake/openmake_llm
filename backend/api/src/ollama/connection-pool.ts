/**
 * 🆕 연결 풀링 시스템
 * Ollama 서버 연결 재사용으로 레이턴시 감소
 */

import axios, { AxiosInstance } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config';

const logger = createLogger('ConnectionPool');

// 연결 객체
interface PooledConnection {
    id: string;
    client: AxiosInstance;
    baseUrl: string;
    inUse: boolean;
    createdAt: Date;
    lastUsedAt: Date;
    requestCount: number;
}

// 풀 설정
interface PoolConfig {
    maxSize: number;           // 최대 연결 수
    minSize: number;           // 최소 유지 연결 수
    maxIdleTime: number;       // 유휴 연결 최대 시간 (ms)
    acquireTimeout: number;    // 연결 획득 타임아웃 (ms)
    healthCheckInterval: number; // 헬스체크 간격 (ms)
}

// 풀 통계
interface PoolStats {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    totalRequests: number;
    avgWaitTime: number;
    healthyConnections: number;
}

/**
 * 연결 풀 클래스
 */
export class ConnectionPool {
    private pool: Map<string, PooledConnection> = new Map();
    private config: PoolConfig;
    private waitQueue: ((conn: PooledConnection) => void)[] = [];
    private totalRequests = 0;
    private totalWaitTime = 0;
    private healthCheckTimer?: NodeJS.Timeout;

    constructor(config?: Partial<PoolConfig>) {
        this.config = {
            maxSize: config?.maxSize || 10,
            minSize: config?.minSize || 2,
            maxIdleTime: config?.maxIdleTime || 60000,  // 1분
            acquireTimeout: config?.acquireTimeout || 5000,
            healthCheckInterval: config?.healthCheckInterval || 30000
        };

        // 최소 연결 수 만큼 미리 생성
        this.warmUp();

        // 헬스체크 시작
        this.startHealthCheck();

        logger.info(`연결 풀 초기화됨 (max: ${this.config.maxSize}, min: ${this.config.minSize})`);
    }

    /**
     * 풀 워밍업 (최소 연결 미리 생성)
     */
    private async warmUp(): Promise<void> {
        const envConfig = getConfig();
        const baseUrl = envConfig.ollamaBaseUrl;

        for (let i = 0; i < this.config.minSize; i++) {
            await this.createConnection(baseUrl);
        }
    }

    /**
     * 새 연결 생성
     */
    private async createConnection(baseUrl: string): Promise<PooledConnection> {
        const id = `conn_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const client = axios.create({
            baseURL: baseUrl,
            timeout: 120000,
            headers: {
                'Content-Type': 'application/json'
            },
            // HTTP 연결 재사용
            httpAgent: new http.Agent({ keepAlive: true }),
            httpsAgent: new https.Agent({ keepAlive: true })
        });

        const connection: PooledConnection = {
            id,
            client,
            baseUrl,
            inUse: false,
            createdAt: new Date(),
            lastUsedAt: new Date(),
            requestCount: 0
        };

        this.pool.set(id, connection);
        logger.debug(`연결 생성됨: ${id} (총 ${this.pool.size}개)`);

        return connection;
    }

    /**
     * 연결 획득
     */
    async acquire(baseUrl?: string): Promise<PooledConnection> {
        const startTime = Date.now();
        this.totalRequests++;

        const envConfig = getConfig();
        const targetUrl = baseUrl || envConfig.ollamaBaseUrl;

        // 1. 유휴 연결 찾기
        for (const conn of this.pool.values()) {
            if (!conn.inUse && conn.baseUrl === targetUrl) {
                conn.inUse = true;
                conn.lastUsedAt = new Date();
                this.totalWaitTime += Date.now() - startTime;
                logger.debug(`연결 재사용: ${conn.id}`);
                return conn;
            }
        }

        // 2. 새 연결 생성 가능하면 생성
        if (this.pool.size < this.config.maxSize) {
            const conn = await this.createConnection(targetUrl);
            conn.inUse = true;
            this.totalWaitTime += Date.now() - startTime;
            return conn;
        }

        // 3. 대기열에 추가
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const idx = this.waitQueue.indexOf(resolve as (conn: PooledConnection) => void);
                if (idx > -1) this.waitQueue.splice(idx, 1);
                reject(new Error('연결 획득 타임아웃'));
            }, this.config.acquireTimeout);

            this.waitQueue.push((conn) => {
                clearTimeout(timeout);
                this.totalWaitTime += Date.now() - startTime;
                resolve(conn);
            });
        });
    }

    /**
     * 연결 반환
     */
    release(connection: PooledConnection): void {
        const conn = this.pool.get(connection.id);
        if (!conn) return;

        conn.inUse = false;
        conn.lastUsedAt = new Date();
        conn.requestCount++;

        // 대기열에 대기자가 있으면 할당
        if (this.waitQueue.length > 0) {
            const waiter = this.waitQueue.shift()!;
            conn.inUse = true;
            waiter(conn);
            return;
        }

        logger.debug(`연결 반환됨: ${conn.id}`);
    }

    /**
     * 연결 제거
     */
    private removeConnection(connectionId: string): void {
        this.pool.delete(connectionId);
        logger.debug(`연결 제거됨: ${connectionId} (남은 ${this.pool.size}개)`);
    }

    /**
     * 헬스체크 시작
     */
    private startHealthCheck(): void {
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, this.config.healthCheckInterval);
    }

    /**
     * 헬스체크 수행
     */
    private async performHealthCheck(): Promise<void> {
        const now = Date.now();
        const toRemove: string[] = [];

        for (const [id, conn] of this.pool.entries()) {
            // 유휴 시간 초과 확인 (최소 연결 수 유지)
            if (!conn.inUse && this.pool.size > this.config.minSize) {
                const idleTime = now - conn.lastUsedAt.getTime();
                if (idleTime > this.config.maxIdleTime) {
                    toRemove.push(id);
                    continue;
                }
            }

            // 연결 상태 확인 (유휴 연결만)
            if (!conn.inUse) {
                try {
                    await conn.client.get('/api/tags', { timeout: 5000 });
                } catch (error) {
                    logger.warn(`연결 불량: ${id}`);
                    toRemove.push(id);
                }
            }
        }

        // 불량 연결 제거
        for (const id of toRemove) {
            this.removeConnection(id);
        }

        // 최소 연결 수 유지
        const currentSize = this.pool.size;
        if (currentSize < this.config.minSize) {
            const envConfig = getConfig();
            for (let i = 0; i < this.config.minSize - currentSize; i++) {
                await this.createConnection(envConfig.ollamaBaseUrl);
            }
        }
    }

    /**
     * 풀 통계 조회
     */
    getStats(): PoolStats {
        let activeCount = 0;
        let healthyCount = 0;

        for (const conn of this.pool.values()) {
            if (conn.inUse) activeCount++;
            // 간단한 건강 체크 (최근 사용)
            if (Date.now() - conn.lastUsedAt.getTime() < this.config.maxIdleTime) {
                healthyCount++;
            }
        }

        return {
            totalConnections: this.pool.size,
            activeConnections: activeCount,
            idleConnections: this.pool.size - activeCount,
            totalRequests: this.totalRequests,
            avgWaitTime: this.totalRequests > 0
                ? Math.round(this.totalWaitTime / this.totalRequests)
                : 0,
            healthyConnections: healthyCount
        };
    }

    /**
     * 풀 종료
     */
    shutdown(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        this.pool.clear();
        this.waitQueue = [];
        logger.info('연결 풀 종료됨');
    }

    /**
     * 연결 래퍼 (자동 반환)
     */
    async withConnection<T>(
        baseUrl: string | undefined,
        callback: (client: AxiosInstance) => Promise<T>
    ): Promise<T> {
        const conn = await this.acquire(baseUrl);
        try {
            return await callback(conn.client);
        } finally {
            this.release(conn);
        }
    }
}

// 싱글톤 인스턴스
let poolInstance: ConnectionPool | null = null;

export function getConnectionPool(): ConnectionPool {
    if (!poolInstance) {
        poolInstance = new ConnectionPool();
    }
    return poolInstance;
}

export function createConnectionPool(config?: Partial<PoolConfig>): ConnectionPool {
    return new ConnectionPool(config);
}
