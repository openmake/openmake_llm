/**
 * @fileoverview 클러스터 노드 선택 모듈
 *
 * 레이턴시 기반 최적 노드 선택, CircuitBreaker 연동 후보 필터링,
 * 자동 페일오버 실행을 담당합니다.
 *
 * @module cluster/node-selector
 */

import { ClusterNode } from './types';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { OllamaClient } from '../ollama/client';
import { AllNodesFailedError } from '../errors/all-nodes-failed.error';
import { createLogger } from '../utils/logger';

const logger = createLogger('NodeSelector');

/**
 * 노드 선택 및 페일오버 담당
 *
 * 온라인 노드 목록을 받아 레이턴시/모델/CircuitBreaker 조건으로
 * 최적의 노드를 선택합니다.
 */
export class NodeSelector {
    constructor(
        private readonly getOnlineNodes: () => ClusterNode[],
        private readonly createScopedClient: (nodeId: string, model?: string) => OllamaClient | undefined
    ) {}

    /**
     * 최적의 노드 선택 (레이턴시 기반)
     *
     * 온라인 노드 중 레이턴시가 가장 낮은 노드를 선택합니다.
     * 모델명이 지정되면 해당 모델을 가진 노드들 중에서 선택합니다.
     *
     * @param modelName - 필요한 모델 이름 (선택, "default"는 무시됨)
     * @returns 최적의 노드 또는 undefined (후보 없음)
     */
    getBestNode(modelName?: string): ClusterNode | undefined {
        let candidates = this.getOnlineNodes();
        logger.info(`getBestNode 호출 - model: ${modelName}, online nodes: ${candidates.length}`);
        candidates.forEach(n => logger.info(`  - ${n.id}: ${n.status}, models: ${n.models.join(', ')}`));

        candidates = this.filterByModel(candidates, modelName);

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
     * @param modelName - 필요한 모델 이름 (선택, "default"는 무시됨)
     * @returns 후보 노드 배열 (레이턴시 오름차순)
     */
    getCandidateNodes(modelName?: string): ClusterNode[] {
        let candidates = this.filterByModel(this.getOnlineNodes(), modelName);

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
     * 모델 조건으로 후보 필터링
     */
    private filterByModel(candidates: ClusterNode[], modelName?: string): ClusterNode[] {
        if (!modelName || modelName === 'default') {
            return candidates;
        }

        const lowerModel = modelName.toLowerCase();
        const isCloudModel = lowerModel.endsWith(':cloud') || lowerModel.endsWith('-cloud');

        if (isCloudModel) {
            logger.info(`Cloud 모델 → 노드 필터링 건너뜀 (${modelName})`);
            return candidates;
        }

        const filtered = candidates.filter(n =>
            n.models.some(m => m.includes(modelName))
        );
        logger.info(`모델 필터링 후 candidates: ${filtered.length} (검색: ${modelName})`);
        return filtered;
    }
}
