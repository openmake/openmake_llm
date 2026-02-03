import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
    ClusterNode,
    ClusterConfig,
    ClusterStats,
    ClusterEvent,
    NodeResources
} from './types';
import { loadClusterConfig } from './config';
import { createClient, OllamaClient } from '../ollama/client';

export class ClusterManager extends EventEmitter {
    private nodes: Map<string, ClusterNode> = new Map();
    private clients: Map<string, OllamaClient> = new Map();
    private config: ClusterConfig;
    private healthCheckInterval?: NodeJS.Timeout;
    private nodeId: string;

    constructor(config?: Partial<ClusterConfig>) {
        super();
        this.config = { ...loadClusterConfig(), ...config };
        this.nodeId = uuidv4();
    }

    get id(): string {
        return this.nodeId;
    }

    get clusterName(): string {
        return this.config.name;
    }

    /**
     * 클러스터 시작 - 정적 노드 연결 및 헬스체크 시작
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
     */
    stop(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }
        this.nodes.clear();
        this.clients.clear();
    }

    /**
     * 노드 추가
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
            } catch (e: any) {
                // 모델 목록 조회 실패 - 로깅
                console.debug(`[Cluster] ${nodeId} 모델 목록 조회 실패:`, e.message || e);
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
     */
    getNodes(): ClusterNode[] {
        return Array.from(this.nodes.values());
    }

    /**
     * 온라인 노드만 조회
     */
    getOnlineNodes(): ClusterNode[] {
        return this.getNodes().filter(n => n.status === 'online');
    }

    /**
     * 특정 모델을 가진 노드 조회
     */
    getNodesWithModel(modelName: string): ClusterNode[] {
        return this.getOnlineNodes().filter(n =>
            n.models.some(m => m.includes(modelName))
        );
    }

    /**
     * 노드의 클라이언트 가져오기
     */
    getClient(nodeId: string): OllamaClient | undefined {
        return this.clients.get(nodeId);
    }

    /**
     * 최적의 노드 선택 (레이턴시 기반)
     */
    getBestNode(modelName?: string): ClusterNode | undefined {
        let candidates = this.getOnlineNodes();

        if (modelName) {
            candidates = candidates.filter(n =>
                n.models.some(m => m.includes(modelName))
            );
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
     * 클러스터 통계
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
            } catch (e: any) {
                // 모델 목록 갱신 실패 - 로깅
                console.debug(`[Cluster] ${nodeId} 모델 갱신 실패:`, e.message || e);
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
     * 헬스체크 시작
     */
    private startHealthCheck(): void {
        this.healthCheckInterval = setInterval(async () => {
            const nodeIds = Array.from(this.nodes.keys());
            await Promise.all(nodeIds.map(id => this.updateNodeStatus(id)));
        }, this.config.heartbeatInterval);
    }
}

// 싱글톤 인스턴스
let clusterInstance: ClusterManager | null = null;

export function getClusterManager(): ClusterManager {
    if (!clusterInstance) {
        clusterInstance = new ClusterManager();
    }
    return clusterInstance;
}

export function createClusterManager(config?: Partial<ClusterConfig>): ClusterManager {
    return new ClusterManager(config);
}
