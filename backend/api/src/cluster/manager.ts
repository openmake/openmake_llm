/**
 * @fileoverview Ollama 클러스터 관리 모듈
 * 
 * 분산 Ollama 노드들을 관리하는 클러스터 매니저입니다.
 * 노드 등록/제거, 헬스체크, 레이턴시 기반 최적 노드 선택 기능을 제공합니다.
 * 
 * @module cluster/manager
 * 
 * @example
 * ```typescript
 * import { getClusterManager } from './manager';
 * 
 * const cluster = getClusterManager();
 * await cluster.start();
 * 
 * // 특정 모델을 가진 최적의 노드 선택
 * const bestNode = cluster.getBestNode('llama3');
 * if (bestNode) {
 *   const client = cluster.getClient(bestNode.id);
 *   // client를 사용하여 요청 처리
 * }
 * ```
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
    ClusterNode,
    ClusterConfig,
    ClusterStats,
    ClusterEvent
} from './types';
import { loadClusterConfig } from './config';
import { createClient, OllamaClient } from '../ollama/client';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { AllNodesFailedError } from '../errors/all-nodes-failed.error';
import { createLogger } from '../utils/logger';

const logger = createLogger('ClusterManager');

/**
 * Ollama 클러스터 관리자
 * 
 * 여러 Ollama 노드를 관리하고 모니터링합니다.
 * EventEmitter를 상속하여 노드 상태 변경 이벤트를 발생시킵니다.
 * 
 * @class ClusterManager
 * @extends EventEmitter
 * 
 * @fires ClusterManager#event:node:online - 노드가 온라인 상태가 됨
 * @fires ClusterManager#event:node:offline - 노드가 오프라인 상태가 됨
 * @fires ClusterManager#event:node:updated - 노드 정보가 업데이트됨
 * 
 * @example
 * ```typescript
 * const cluster = new ClusterManager({ heartbeatInterval: 30000 });
 * cluster.on('event', (event) => {
 *   if (event.type === 'node:offline') {
 *     console.warn(`노드 오프라인: ${event.nodeId}`);
 *   }
 * });
 * await cluster.start();
 * ```
 */
export class ClusterManager extends EventEmitter {
    /** 등록된 노드 맵 (노드ID -> 노드 정보) */
    private nodes: Map<string, ClusterNode> = new Map();
    
    /** 노드별 Ollama 클라이언트 맵 */
    private clients: Map<string, OllamaClient> = new Map();
    
    /** 클러스터 설정 */
    private config: ClusterConfig;
    
    /** 헬스체크 타이머 */
    private healthCheckTimer?: NodeJS.Timeout;

    /** 헬스체크 실행 간격(ms) */
    private healthCheckIntervalMs: number;

    /** 헬스체크 스케줄러 활성 상태 */
    private healthCheckActive: boolean = false;
    
    /** 이 매니저 인스턴스의 고유 ID */
    private nodeId: string;

    /**
     * ClusterManager 인스턴스 생성
     * 
     * @param config - 클러스터 설정 (선택적, 기본 설정과 병합됨)
     */
    constructor(config?: Partial<ClusterConfig>) {
        super();
        this.config = { ...loadClusterConfig(), ...config };
        this.nodeId = uuidv4();
        this.healthCheckIntervalMs = this.config.heartbeatInterval;
    }

    /**
     * 클러스터 매니저 인스턴스 ID
     * @returns 고유 UUID 문자열
     */
    get id(): string {
        return this.nodeId;
    }

    /**
     * 클러스터 이름
     * @returns 설정된 클러스터 이름
     */
    get clusterName(): string {
        return this.config.name;
    }

    /**
     * 클러스터 시작
     * 
     * 설정에 정의된 정적 노드들을 등록하고 주기적 헬스체크를 시작합니다.
     * 
     * @returns Promise<void>
     * 
     * @example
     * ```typescript
     * const cluster = getClusterManager();
     * await cluster.start();
     * console.log('클러스터 시작됨:', cluster.getStats());
     * ```
     */
    async start(): Promise<void> {
        // 정적 노드들 등록
        for (const staticNode of this.config.nodes) {
            await this.addNode(staticNode.host, staticNode.port, staticNode.name);
        }

        // 주기적 헬스체크 시작
        this.startHealthCheck();
    }

    /**
     * 클러스터 중지
     * 
     * 헬스체크를 중단하고 모든 노드 및 클라이언트 정보를 정리합니다.
     */
    stop(): void {
        this.healthCheckActive = false;
        if (this.healthCheckTimer) {
            clearTimeout(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }
        this.nodes.clear();
        this.clients.clear();
    }

    /**
     * 노드 추가
     * 
     * 새로운 Ollama 노드를 클러스터에 추가합니다.
     * 연결 테스트 후 온라인/오프라인 상태를 설정합니다.
     * 
     * @param host - 노드 호스트 주소
     * @param port - 노드 포트 번호
     * @param name - 노드 별칭 (선택, 기본값: "host:port")
     * @returns 추가된 노드 정보 또는 null (이미 존재하는 경우)
     * 
     * @example
     * ```typescript
     * const node = await cluster.addNode('192.168.1.100', 11434, 'gpu-server');
     * if (node) {
     *   console.log(`노드 추가됨: ${node.name} (${node.status})`);
     * }
     * ```
     */
    async addNode(host: string, port: number, name?: string): Promise<ClusterNode | null> {
        const nodeId = `${host}:${port}`;

        if (this.nodes.has(nodeId)) {
            return this.nodes.get(nodeId)!;
        }

        const client = createClient({
            baseUrl: `http://${host}:${port}`
        });

        // 연결 테스트
        const isAvailable = await client.isAvailable();

        const node: ClusterNode = {
            id: nodeId,
            name: name || nodeId,
            host,
            port,
            status: isAvailable ? 'online' : 'offline',
            models: [],
            resources: {},
            lastSeen: new Date()
        };

        if (isAvailable) {
            // 모델 목록 가져오기
            try {
                const response = await client.listModels();
                node.models = response.models.map(m => m.name);
            } catch (e: unknown) {
                // 모델 목록 조회 실패 - 로깅
                console.debug(`[Cluster] ${nodeId} 모델 목록 조회 실패:`, (e instanceof Error ? e.message : String(e)) || e);
            }

            // 레이턴시 측정
            node.latency = await this.measureLatency(client);
        }

        this.nodes.set(nodeId, node);
        this.clients.set(nodeId, client);

        this.emit('event', { type: 'node:online', node } as ClusterEvent);

        return node;
    }

    /**
     * 노드 제거
     * 
     * 클러스터에서 노드를 제거합니다.
     * 
     * @param nodeId - 제거할 노드 ID ("host:port" 형식)
     * @returns 제거 성공 여부
     */
    removeNode(nodeId: string): boolean {
        const existed = this.nodes.delete(nodeId);
        this.clients.delete(nodeId);

        if (existed) {
            this.emit('event', { type: 'node:offline', nodeId } as ClusterEvent);
        }

        return existed;
    }

    /**
     * 모든 노드 조회
     * 
     * @returns 등록된 모든 노드 배열 (온라인/오프라인 모두 포함)
     */
    getNodes(): ClusterNode[] {
        return Array.from(this.nodes.values());
    }

    /**
     * 온라인 노드만 조회
     * 
     * @returns 현재 온라인 상태인 노드들만 반환
     */
    getOnlineNodes(): ClusterNode[] {
        return this.getNodes().filter(n => n.status === 'online');
    }

    /**
     * 특정 모델을 가진 노드 조회
     * 
     * 지정된 모델이 설치된 온라인 노드들을 반환합니다.
     * 모델명은 부분 일치로 검색됩니다.
     * 
     * @param modelName - 검색할 모델 이름 (부분 일치)
     * @returns 해당 모델을 가진 온라인 노드 배열
     * 
     * @example
     * ```typescript
     * const llamaNodes = cluster.getNodesWithModel('llama');
     * // llama3, llama2, codellama 등 'llama'가 포함된 모델을 가진 노드들 반환
     * ```
     */
    getNodesWithModel(modelName: string): ClusterNode[] {
        return this.getOnlineNodes().filter(n =>
            n.models.some(m => m.includes(modelName))
        );
    }

    /**
     * 노드의 Ollama 클라이언트 가져오기 (싱글톤 — 공유)
     * 
     * ⚠️ 주의: 이 클라이언트는 싱글톤이므로 setModel()을 호출하면 
     * 동시 요청 간 모델이 덮어쓰여질 수 있습니다.
     * 동시성이 필요한 경우 createScopedClient()를 사용하세요.
     * 
     * @param nodeId - 노드 ID
     * @returns 해당 노드의 OllamaClient 또는 undefined
     */
    getClient(nodeId: string): OllamaClient | undefined {
        return this.clients.get(nodeId);
    }

    /**
     * 🔒 Phase 2 보안 패치: 요청 격리된 클라이언트 생성
     * 
     * 싱글톤 클라이언트의 설정을 복제하여 독립적인 새 인스턴스를 반환합니다.
     * 동시 요청 시 setModel() 경쟁 조건을 방지합니다.
     * 
     * @param nodeId - 노드 ID
     * @param model - 이 요청에서 사용할 모델명 (선택)
     * @returns 격리된 새 OllamaClient 인스턴스 또는 undefined
     * 
     * @example
     * ```typescript
     * const client = cluster.createScopedClient(bestNode.id, 'gemma:2b');
     * // client.setModel()은 다른 요청에 영향을 주지 않음
     * ```
     */
    createScopedClient(nodeId: string, model?: string): OllamaClient | undefined {
        const baseClient = this.clients.get(nodeId);
        const node = this.nodes.get(nodeId);
        if (!baseClient || !node) return undefined;

        // 기본 설정으로 새 인스턴스 생성 (TCP 커넥션 풀은 OS 레벨에서 재사용)
        const scopedClient = createClient({
            baseUrl: `http://${node.host}:${node.port}`,
            model: model || baseClient.model,
        });

        return scopedClient;
    }

    /**
     * 최적의 노드 선택 (레이턴시 기반)
     * 
     * 온라인 노드 중 레이턴시가 가장 낮은 노드를 선택합니다.
     * 모델명이 지정되면 해당 모델을 가진 노드들 중에서 선택합니다.
     * 
     * @param modelName - 필요한 모델 이름 (선택, "default"는 무시됨)
     * @returns 최적의 노드 또는 undefined (후보 없음)
     * 
     * @example
     * ```typescript
     * const node = cluster.getBestNode('gemma:2b');
     * if (node) {
     *   console.log(`최적 노드: ${node.name}, 레이턴시: ${node.latency}ms`);
     * }
     * ```
     */
    getBestNode(modelName?: string): ClusterNode | undefined {
        let candidates = this.getOnlineNodes();
        console.log(`[Cluster] getBestNode 호출 - model: ${modelName}, online nodes: ${candidates.length}`);
        candidates.forEach(n => console.log(`[Cluster]   - ${n.id}: ${n.status}, models: ${n.models.join(', ')}`));

        // "default"는 특별한 값이므로 모델 필터링을 건너뜀
        if (modelName && modelName !== 'default') {
            // Cloud 모델(`:cloud` 접미사)은 OllamaClient가 자동으로 Cloud API로 라우팅
            // → 로컬 노드에 해당 모델이 설치되어 있을 필요 없음 → 필터링 건너뜀
            const isCloudModel = modelName.toLowerCase().endsWith(':cloud');
            if (!isCloudModel) {
                candidates = candidates.filter(n =>
                    n.models.some(m => m.includes(modelName))
                );
                console.log(`[Cluster] 모델 필터링 후 candidates: ${candidates.length} (검색: ${modelName})`);
            } else {
                console.log(`[Cluster] Cloud 모델 → 노드 필터링 건너뜀 (${modelName})`);
            }
        }

        if (candidates.length === 0) return undefined;

        // 레이턴시가 가장 낮은 노드 선택
        return candidates.reduce((best, node) => {
            if (!best) return node;
            if ((node.latency || Infinity) < (best.latency || Infinity)) {
                return node;
            }
            return best;
        });
    }

    /**
     * 후보 노드 목록 반환 (레이턴시 순, CircuitBreaker OPEN 제외)
     * 
     * 온라인 노드 중 모델 조건에 맞고 CircuitBreaker가 OPEN이 아닌 노드들을
     * 레이턴시가 낮은 순서로 정렬하여 반환합니다.
     * 
     * @param modelName - 필요한 모델 이름 (선택, "default"는 무시됨)
     * @returns 후보 노드 배열 (레이턴시 오름차순)
     */
    getCandidateNodes(modelName?: string): ClusterNode[] {
        let candidates = this.getOnlineNodes();

        if (modelName && modelName !== 'default') {
            const isCloudModel = modelName.toLowerCase().endsWith(':cloud');
            if (!isCloudModel) {
                candidates = candidates.filter(n =>
                    n.models.some(m => m.includes(modelName))
                );
            }
        }

        // CircuitBreaker OPEN 노드 제외
        const registry = CircuitBreakerRegistry.getInstance();
        candidates = candidates.filter(n => {
            const breaker = registry.get(`node:${n.id}`);
            return !breaker || breaker.isAvailable();
        });

        // 레이턴시 순 정렬
        return candidates.sort((a, b) => (a.latency || Infinity) - (b.latency || Infinity));
    }

    /**
     * 후보 노드 순회하며 실행 시도 (자동 페일오버)
     * 
     * 레이턴시 순으로 정렬된 후보 노드들을 순회하며 비동기 함수를 실행합니다.
     * 실패 시 자동으로 다음 노드로 페일오버하며, 각 노드의 CircuitBreaker를 통해
     * 실행하여 장애 추적을 자동화합니다.
     * 
     * @param modelName - 요청할 모델 이름
     * @param fn - 각 노드에서 실행할 비동기 함수
     * @returns 실행 결과와 성공한 노드 정보
     * @throws {AllNodesFailedError} 모든 노드 실패 시
     */
    async tryWithFallback<T>(
        modelName: string,
        fn: (client: OllamaClient, node: ClusterNode) => Promise<T>
    ): Promise<{ result: T; node: ClusterNode }> {
        const candidates = this.getCandidateNodes(modelName);
        if (candidates.length === 0) {
            throw new AllNodesFailedError(modelName, [], []);
        }

        const registry = CircuitBreakerRegistry.getInstance();
        const attemptedNodes: string[] = [];
        const errors: Error[] = [];

        for (const node of candidates) {
            attemptedNodes.push(node.id);
            const breaker = registry.getOrCreate(`node:${node.id}`);
            const client = this.createScopedClient(node.id, modelName);
            if (!client) continue;

            try {
                const result = await breaker.execute(() => fn(client, node));
                return { result, node };
            } catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
                logger.warn(`[Cluster] 노드 ${node.id} 실패, 다음 후보로 페일오버`);
            }
        }

        throw new AllNodesFailedError(modelName, attemptedNodes, errors);
    }

    /**
     * 클러스터 통계 조회
     * 
     * 현재 클러스터의 전체 상태 요약을 반환합니다.
     * 
     * @returns 클러스터 통계 객체
     * 
     * @example
     * ```typescript
     * const stats = cluster.getStats();
     * console.log(`전체 노드: ${stats.totalNodes}, 온라인: ${stats.onlineNodes}`);
     * console.log(`사용 가능한 모델: ${stats.uniqueModels.join(', ')}`);
     * ```
     */
    getStats(): ClusterStats {
        const nodes = this.getNodes();
        const onlineNodes = nodes.filter(n => n.status === 'online');
        const allModels = onlineNodes.flatMap(n => n.models);
        const uniqueModels = [...new Set(allModels)];

        return {
            totalNodes: nodes.length,
            onlineNodes: onlineNodes.length,
            totalModels: allModels.length,
            uniqueModels
        };
    }

    /**
     * 레이턴시 측정
     * 
     * 노드까지의 왕복 시간을 측정합니다.
     * 
     * @param client - 측정 대상 Ollama 클라이언트
     * @returns 레이턴시(ms) 또는 Infinity (연결 실패 시)
     */
    private async measureLatency(client: OllamaClient): Promise<number> {
        const start = Date.now();
        try {
            await client.isAvailable();
            return Date.now() - start;
        } catch {
            return Infinity;
        }
    }

    /**
     * 노드 상태 업데이트
     * 
     * 노드의 온라인/오프라인 상태, 모델 목록, 레이턴시를 갱신합니다.
     * 상태 변경 시 적절한 이벤트를 발생시킵니다.
     * 
     * @param nodeId - 업데이트할 노드 ID
     * @fires ClusterManager#event:node:online
     * @fires ClusterManager#event:node:offline
     * @fires ClusterManager#event:node:updated
     */
    private async updateNodeStatus(nodeId: string): Promise<void> {
        const node = this.nodes.get(nodeId);
        const client = this.clients.get(nodeId);

        if (!node || !client) return;

        const wasOnline = node.status === 'online';
        const isAvailable = await client.isAvailable();

        node.status = isAvailable ? 'online' : 'offline';
        node.lastSeen = isAvailable ? new Date() : node.lastSeen;

        if (isAvailable) {
            // 모델 목록 갱신
            try {
                const response = await client.listModels();
                node.models = response.models.map(m => m.name);
            } catch (e: unknown) {
                // 모델 목록 갱신 실패 - 로깅
                console.debug(`[Cluster] ${nodeId} 모델 갱신 실패:`, (e instanceof Error ? e.message : String(e)) || e);
            }
            node.latency = await this.measureLatency(client);
        }

        // 상태 변경 이벤트
        if (wasOnline !== isAvailable) {
            if (isAvailable) {
                this.emit('event', { type: 'node:online', node } as ClusterEvent);
            } else {
                this.emit('event', { type: 'node:offline', nodeId } as ClusterEvent);
            }
        } else {
            this.emit('event', { type: 'node:updated', node } as ClusterEvent);
        }
    }

    /**
     * 모든 노드 헬스체크 수행
     */
    private async performHealthCheck(): Promise<void> {
        const nodeIds = Array.from(this.nodes.keys());
        await Promise.all(nodeIds.map(id => this.updateNodeStatus(id)));
    }

    /**
     * 다음 헬스체크 스케줄링
     */
    private scheduleNextHealthCheck(): void {
        if (!this.healthCheckActive) {
            return;
        }

        if (this.healthCheckTimer) {
            clearTimeout(this.healthCheckTimer);
        }

        this.healthCheckTimer = setTimeout(async () => {
            try {
                await this.performHealthCheck();
            } finally {
                this.scheduleNextHealthCheck();
            }
        }, this.healthCheckIntervalMs);
    }

    /**
     * 헬스체크 시작
     * 
     * 설정된 간격으로 모든 노드의 상태를 확인하는 인터벌을 시작합니다.
     */
    private startHealthCheck(): void {
        this.healthCheckActive = true;
        this.scheduleNextHealthCheck();
    }
}

/** 싱글톤 ClusterManager 인스턴스 */
let clusterInstance: ClusterManager | null = null;

/**
 * ClusterManager 싱글톤 인스턴스 획득
 * 
 * 애플리케이션 전역에서 동일한 클러스터 매니저를 사용할 수 있습니다.
 * 
 * @returns ClusterManager 싱글톤 인스턴스
 * 
 * @example
 * ```typescript
 * const cluster = getClusterManager();
 * await cluster.start();
 * ```
 */
export function getClusterManager(): ClusterManager {
    if (!clusterInstance) {
        clusterInstance = new ClusterManager();
    }
    return clusterInstance;
}

/**
 * 새로운 ClusterManager 인스턴스 생성
 * 
 * 싱글톤이 아닌 독립적인 클러스터 매니저가 필요할 때 사용합니다.
 * 
 * @param config - 클러스터 설정 (선택)
 * @returns 새로운 ClusterManager 인스턴스
 */
export function createClusterManager(config?: Partial<ClusterConfig>): ClusterManager {
    return new ClusterManager(config);
}
