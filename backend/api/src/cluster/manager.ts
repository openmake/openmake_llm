/**
 * @fileoverview Ollama 클러스터 관리 모듈
 *
 * 분산 Ollama 노드들을 관리하는 클러스터 매니저입니다.
 * 노드 등록/제거, 헬스체크, 레이턴시 기반 최적 노드 선택 기능을 제공합니다.
 *
 * 내부적으로 HealthChecker(헬스체크/레이턴시)와 NodeSelector(노드 선택/페일오버)에
 * 각 책임을 위임합니다.
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
import { HealthChecker } from './health-checker';
import { NodeSelector } from './node-selector';

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
 *     logger.warn(`노드 오프라인: ${event.nodeId}`);
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

    /** 이 매니저 인스턴스의 고유 ID */
    private nodeId: string;

    /** 헬스체크 담당 */
    private healthChecker: HealthChecker;

    /** 노드 선택/페일오버 담당 */
    private selector: NodeSelector;

    /**
     * ClusterManager 인스턴스 생성
     *
     * @param config - 클러스터 설정 (선택적, 기본 설정과 병합됨)
     */
    constructor(config?: Partial<ClusterConfig>) {
        super();
        this.config = { ...loadClusterConfig(), ...config };
        this.nodeId = uuidv4();

        this.healthChecker = new HealthChecker(
            this.config.heartbeatInterval,
            this,
            () => this.getNodeEntries()
        );

        this.selector = new NodeSelector(
            () => this.getOnlineNodes(),
            (nodeId, model) => this.createScopedClient(nodeId, model)
        );
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
     * logger.info('클러스터 시작됨:', cluster.getStats());
     * ```
     */
    async start(): Promise<void> {
        // 정적 노드들 등록
        for (const staticNode of this.config.nodes) {
            await this.addNode(staticNode.host, staticNode.port, staticNode.name);
        }

        // 주기적 헬스체크 시작
        this.healthChecker.start();
    }

    /**
     * 클러스터 중지
     *
     * 헬스체크를 중단하고 모든 노드 및 클라이언트 정보를 정리합니다.
     */
    stop(): void {
        this.healthChecker.stop();
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
     *   logger.info(`노드 추가됨: ${node.name} (${node.status})`);
     * }
     * ```
     */
    async addNode(host: string, port: number, name?: string): Promise<ClusterNode | null> {
        const nodeId = `${host}:${port}`;

        if (this.nodes.has(nodeId)) {
            return this.nodes.get(nodeId)!;
        }

        const client = createClient({
            baseUrl: `http://${host}:${port}`,
            // 로컬 노드 헬스체크/모델 목록 수집은 반드시 로컬 Ollama를 보도록
            // non-cloud 모델명을 명시해 Cloud 호스트 자동 전환을 막는다.
            model: 'local-probe'
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
            node.latency = await this.healthChecker.measureLatency(client);
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
     * 노드의 Ollama 클라이언트 가져오기 (싱글톤 -- 공유)
     *
     * 주의: 이 클라이언트는 싱글톤이므로 setModel()을 호출하면
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
     * 요청 격리된 클라이언트 생성
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
     * @param modelName - 필요한 모델 이름 (선택, "default"는 무시됨)
     * @returns 최적의 노드 또는 undefined (후보 없음)
     */
    getBestNode(modelName?: string): ClusterNode | undefined {
        return this.selector.getBestNode(modelName);
    }

    /**
     * 후보 노드 목록 반환 (레이턴시 순, CircuitBreaker OPEN 제외)
     *
     * @param modelName - 필요한 모델 이름 (선택, "default"는 무시됨)
     * @returns 후보 노드 배열 (레이턴시 오름차순)
     */
    getCandidateNodes(modelName?: string): ClusterNode[] {
        return this.selector.getCandidateNodes(modelName);
    }

    /**
     * 후보 노드 순회하며 실행 시도 (자동 페일오버)
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
        return this.selector.tryWithFallback(modelName, fn);
    }

    /**
     * 클러스터 통계 조회
     *
     * @returns 클러스터 통계 객체
     *
     * @example
     * ```typescript
     * const stats = cluster.getStats();
     * logger.info(`전체 노드: ${stats.totalNodes}, 온라인: ${stats.onlineNodes}`);
     * logger.info(`사용 가능한 모델: ${stats.uniqueModels.join(', ')}`);
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
     * HealthChecker에 전달할 노드+클라이언트 엔트리 목록
     */
    private getNodeEntries(): Array<{ node: ClusterNode; client: OllamaClient }> {
        const entries: Array<{ node: ClusterNode; client: OllamaClient }> = [];
        for (const [nodeId, node] of this.nodes) {
            const client = this.clients.get(nodeId);
            if (client) {
                entries.push({ node, client });
            }
        }
        return entries;
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
