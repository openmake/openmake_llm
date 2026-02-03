import { ClusterManager, getClusterManager } from './manager';
import { OllamaClient, createClient } from '../ollama/client';
import { ChatMessage, ModelOptions, ListModelsResponse, ModelInfo } from '../ollama/types';
import { ClusterNode } from './types';
import { getConfig } from '../config';

type LoadBalanceStrategy = 'round-robin' | 'least-latency' | 'random';

interface MultiClientOptions {
    strategy?: LoadBalanceStrategy;
    retries?: number;
    fallbackToLocal?: boolean;
}

/**
 * 다중 노드에 연결하는 클라이언트
 * 로드 밸런싱과 장애 복구 지원
 */
export class MultiNodeClient {
    private cluster: ClusterManager;
    private currentIndex: number = 0;
    private options: Required<MultiClientOptions>;
    private defaultModel: string;

    constructor(cluster?: ClusterManager, options?: MultiClientOptions) {
        this.cluster = cluster || getClusterManager();
        this.options = {
            strategy: options?.strategy || 'least-latency',
            retries: options?.retries || 2,
            fallbackToLocal: options?.fallbackToLocal ?? true
        };
        // 환경설정에서 기본 모델 읽기
        const envConfig = getConfig();
        this.defaultModel = envConfig.ollamaDefaultModel;
    }

    /**
     * 모델 설정
     */
    setModel(model: string): void {
        this.defaultModel = model;
    }

    /**
     * 클러스터의 모든 모델 목록
     */
    async listModels(): Promise<ListModelsResponse> {
        const nodes = this.cluster.getOnlineNodes();
        const allModels: Map<string, ModelInfo> = new Map();

        for (const node of nodes) {
            const client = this.cluster.getClient(node.id);
            if (!client) continue;

            try {
                const response = await client.listModels();
                for (const model of response.models) {
                    // 중복 제거 (더 최근에 수정된 것 유지)
                    const existing = allModels.get(model.name);
                    if (!existing || new Date(model.modified_at) > new Date(existing.modified_at)) {
                        allModels.set(model.name, model);
                    }
                }
            } catch (e) {
                // 노드 오류 무시
            }
        }

        return { models: Array.from(allModels.values()) };
    }

    /**
     * 텍스트 생성 (로드밸런싱 적용)
     */
    async generate(
        prompt: string,
        options?: ModelOptions,
        onToken?: (token: string) => void
    ): Promise<string> {
        const model = this.defaultModel;

        for (let attempt = 0; attempt <= this.options.retries; attempt++) {
            const node = this.selectNode(model);

            if (!node) {
                if (this.options.fallbackToLocal) {
                    // 로컬 폴백
                    const localClient = createClient();
                    return localClient.generate(prompt, options, onToken);
                }
                throw new Error('사용 가능한 노드가 없습니다');
            }

            const client = this.cluster.getClient(node.id);
            if (!client) continue;

            try {
                client.setModel(model);
                return await client.generate(prompt, options, onToken);
            } catch (e) {
                console.warn(`노드 ${node.name} 오류, 재시도 중...`);
                // 다음 노드 시도
            }
        }

        throw new Error('모든 노드에서 생성 실패');
    }

    /**
     * 채팅 (로드밸런싱 적용)
     */
    async chat(
        messages: ChatMessage[],
        options?: ModelOptions,
        onToken?: (token: string) => void
    ): Promise<ChatMessage> {
        const model = this.defaultModel;

        for (let attempt = 0; attempt <= this.options.retries; attempt++) {
            const node = this.selectNode(model);

            if (!node) {
                if (this.options.fallbackToLocal) {
                    const localClient = createClient();
                    return localClient.chat(messages, options, onToken);
                }
                throw new Error('사용 가능한 노드가 없습니다');
            }

            const client = this.cluster.getClient(node.id);
            if (!client) continue;

            try {
                client.setModel(model);
                return await client.chat(messages, options, onToken);
            } catch (e) {
                console.warn(`노드 ${node.name} 오류, 재시도 중...`);
            }
        }

        throw new Error('모든 노드에서 채팅 실패');
    }

    /**
     * 연결 가능 여부
     */
    async isAvailable(): Promise<boolean> {
        return this.cluster.getOnlineNodes().length > 0;
    }

    /**
     * 노드 선택 (로드밸런싱 전략에 따라)
     */
    private selectNode(model?: string): ClusterNode | undefined {
        let candidates = this.cluster.getOnlineNodes();

        if (model) {
            const modelNodes = this.cluster.getNodesWithModel(model);
            if (modelNodes.length > 0) {
                candidates = modelNodes;
            }
        }

        if (candidates.length === 0) return undefined;

        switch (this.options.strategy) {
            case 'round-robin':
                this.currentIndex = (this.currentIndex + 1) % candidates.length;
                return candidates[this.currentIndex];

            case 'random':
                return candidates[Math.floor(Math.random() * candidates.length)];

            case 'least-latency':
            default:
                return candidates.reduce((best, node) => {
                    if (!best) return node;
                    if ((node.latency || Infinity) < (best.latency || Infinity)) {
                        return node;
                    }
                    return best;
                });
        }
    }

    /**
     * 클러스터 정보
     */
    getClusterInfo() {
        return {
            name: this.cluster.clusterName,
            stats: this.cluster.getStats(),
            nodes: this.cluster.getNodes()
        };
    }
}

export function createMultiClient(options?: MultiClientOptions): MultiNodeClient {
    return new MultiNodeClient(undefined, options);
}
