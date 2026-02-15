/**
 * ============================================================
 * ConnectionPool - Ollama 서버 연결 풀링 시스템
 * ============================================================
 *
 * Ollama 서버와의 HTTP 연결을 풀링하여 재사용함으로써
 * 연결 생성 오버헤드를 줄이고 레이턴시를 감소시킵니다.
 *
 * @module ollama/connection-pool
 * @description
 * - HTTP Keep-Alive 기반 연결 재사용 (http.Agent, https.Agent)
 * - 최소/최대 연결 수 관리 (minSize ~ maxSize)
 * - 유휴 연결 자동 정리 (maxIdleTime 초과 시 제거)
 * - 주기적 헬스체크 (healthCheckInterval 간격)
 * - 대기열 기반 연결 할당 (풀 가득 찼을 때 acquireTimeout까지 대기)
 * - withConnection() 래퍼로 자동 반환 보장
 *
 * @requires axios - HTTP 클라이언트 (Keep-Alive Agent 포함)
 */

import axios, { AxiosInstance } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { createLogger } from '../utils/logger';
import { getConfig } from '../config';

const logger = createLogger('ConnectionPool');

/**
 * 풀링된 연결 객체 — 연결 상태 및 메타데이터 포함
 * @interface PooledConnection
 */
interface PooledConnection {
    /** 연결 고유 식별자 */
    id: string;
    /** Axios HTTP 클라이언트 인스턴스 (Keep-Alive 에이전트 포함) */
    client: AxiosInstance;
    /** 연결 대상 Ollama 서버 URL */
    baseUrl: string;
    /** 현재 사용 중 여부 */
    inUse: boolean;
    /** 연결 생성 시각 */
    createdAt: Date;
    /** 마지막 사용 시각 */
    lastUsedAt: Date;
    /** 누적 요청 횟수 */
    requestCount: number;
}

/**
 * 연결 풀 설정
 * @interface PoolConfig
 */
interface PoolConfig {
    /** 최대 연결 수 (기본값: 10) */
    maxSize: number;
    /** 최소 유지 연결 수 (기본값: 2, 워밍업 시 미리 생성) */
    minSize: number;
    /** 유휴 연결 최대 허용 시간 (밀리초, 기본값: 60000 = 1분) */
    maxIdleTime: number;
    /** 연결 획득 대기 타임아웃 (밀리초, 기본값: 5000) */
    acquireTimeout: number;
    /** 헬스체크 실행 간격 (밀리초, 기본값: 30000 = 30초) */
    healthCheckInterval: number;
}

/**
 * 연결 풀 통계 정보
 * @interface PoolStats
 */
interface PoolStats {
    /** 전체 연결 수 */
    totalConnections: number;
    /** 사용 중인 연결 수 */
    activeConnections: number;
    /** 유휴 연결 수 */
    idleConnections: number;
    /** 누적 요청 수 */
    totalRequests: number;
    /** 평균 연결 대기 시간 (밀리초) */
    avgWaitTime: number;
    /** 정상 상태 연결 수 (최근 사용 시간 기준) */
    healthyConnections: number;
}

/**
 * Ollama 서버 연결 풀 클래스
 *
 * HTTP Keep-Alive 기반으로 연결을 재사용하여 레이턴시를 줄입니다.
 * 최소 연결 수를 워밍업으로 미리 생성하고, 주기적 헬스체크로
 * 불량 연결을 제거합니다.
 *
 * 연결 할당 흐름:
 * 1. 유휴 연결 검색 (같은 baseUrl, inUse=false)
 * 2. 없으면 새 연결 생성 (maxSize 미만일 때)
 * 3. maxSize 도달 시 대기열에 추가 (acquireTimeout까지 대기)
 *
 * @class ConnectionPool
 */
export class ConnectionPool {
    /** 연결 풀 (ID -> PooledConnection) */
    private pool: Map<string, PooledConnection> = new Map();
    /** 풀 설정 */
    private config: PoolConfig;
    /** 연결 대기 콜백 큐 (풀이 가득 찼을 때) */
    private waitQueue: ((conn: PooledConnection) => void)[] = [];
    /** 누적 총 요청 수 (통계용) */
    private totalRequests = 0;
    /** 누적 총 대기 시간 (통계용, 밀리초) */
    private totalWaitTime = 0;
    /** 헬스체크 인터벌 타이머 */
    private healthCheckTimer?: NodeJS.Timeout;

    /**
     * ConnectionPool 인스턴스를 생성합니다.
     *
     * 최소 연결 수(minSize)만큼 워밍업 연결을 생성하고,
     * 주기적 헬스체크 타이머를 시작합니다.
     *
     * @param config - 풀 설정 (부분 적용 가능, 미지정 시 기본값 사용)
     */
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
     * 풀 워밍업 — 최소 연결 수(minSize)만큼 미리 생성합니다.
     * 서버 시작 시 첫 요청의 연결 생성 지연을 방지합니다.
     * @private
     */
    private async warmUp(): Promise<void> {
        const envConfig = getConfig();
        const baseUrl = envConfig.ollamaBaseUrl;

        for (let i = 0; i < this.config.minSize; i++) {
            await this.createConnection(baseUrl);
        }
    }

    /**
     * 새 풀링 연결을 생성합니다.
     *
     * HTTP/HTTPS Keep-Alive 에이전트를 포함한 Axios 인스턴스를 생성하여
     * TCP 연결 재사용을 활성화합니다.
     *
     * @param baseUrl - 연결할 Ollama 서버 URL
     * @returns 생성된 PooledConnection 객체
     * @private
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
     * 풀에서 연결을 획득합니다.
     *
     * 할당 순서:
     * 1. 유휴 연결 검색 (같은 baseUrl, inUse=false)
     * 2. 유휴 연결 없으면 새 연결 생성 (maxSize 미만일 때)
     * 3. maxSize 도달 시 대기열에 추가하여 반환 대기 (acquireTimeout)
     *
     * @param baseUrl - 연결할 서버 URL (미지정 시 환경변수 기본값)
     * @returns 획득된 PooledConnection 객체 (inUse=true 상태)
     * @throws {Error} acquireTimeout 내에 연결을 획득하지 못한 경우
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
     * 사용 완료된 연결을 풀에 반환합니다.
     *
     * 대기열에 대기자가 있으면 즉시 해당 대기자에게 할당합니다.
     * 대기자가 없으면 유휴 상태(inUse=false)로 전환합니다.
     *
     * @param connection - 반환할 연결 객체
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
     * 풀에서 연결을 제거합니다.
     *
     * @param connectionId - 제거할 연결 ID
     * @private
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
     * 풀 내 모든 연결의 헬스체크를 수행합니다.
     *
     * 검사 항목:
     * 1. 유휴 시간 초과 확인 (minSize 이상일 때만 제거)
     * 2. 유휴 연결에 /api/tags GET 요청으로 연결 상태 확인
     * 3. 불량 연결 제거 후 minSize 미만이면 새 연결 보충
     *
     * @private
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
     * 연결을 자동으로 획득/반환하는 래퍼 함수입니다.
     *
     * try/finally 패턴으로 콜백 실행 후 연결을 자동 반환하여
     * 연결 누수를 방지합니다.
     *
     * @param baseUrl - 연결할 서버 URL (미지정 시 기본값)
     * @param callback - 연결된 Axios 클라이언트를 사용하는 콜백
     * @returns 콜백의 반환값
     * @throws {Error} 연결 획득 실패 또는 콜백 실행 에러 시
     *
     * @example
     * ```typescript
     * const result = await pool.withConnection(undefined, async (client) => {
     *   return client.post('/api/chat', request);
     * });
     * ```
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

// ============================================
// 싱글톤 인스턴스 관리
// ============================================

/** ConnectionPool 싱글톤 인스턴스 */
let poolInstance: ConnectionPool | null = null;

/**
 * ConnectionPool 싱글톤 인스턴스를 반환합니다.
 * 최초 호출 시 기본 설정으로 인스턴스를 생성합니다.
 *
 * @returns ConnectionPool 싱글톤 인스턴스
 */
export function getConnectionPool(): ConnectionPool {
    if (!poolInstance) {
        poolInstance = new ConnectionPool();
    }
    return poolInstance;
}

/**
 * 커스텀 설정으로 ConnectionPool 인스턴스를 생성합니다.
 * 싱글톤이 아닌 독립 인스턴스를 반환합니다.
 *
 * @param config - 커스텀 풀 설정 (부분 적용 가능)
 * @returns 새 ConnectionPool 인스턴스
 */
export function createConnectionPool(config?: Partial<PoolConfig>): ConnectionPool {
    return new ConnectionPool(config);
}
