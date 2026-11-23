/**
 * @fileoverview 클러스터 노드 선택 모듈
 *
 * 레이턴시 기반 최적 노드 선택을 담당합니다.
 * (노드별 CircuitBreaker·자동 페일오버 tryWithFallback 은 운영 경로에서 호출 0 이라 2026-11-24 제거 — 단일 LiteLLM 게이트웨이,
 *  도구 서킷은 tool-contract/tool-health 가 맡는다.)
 *
 * @module cluster/node-selector
 */

import { ClusterNode } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('NodeSelector');

/** 노드 모델 목록 로그 프리뷰 상한 — wildcard 확장 카탈로그 전체 나열 방지 */
const NODE_MODELS_LOG_PREVIEW = 8;

/**
 * 노드 선택 및 페일오버 담당
 *
 * 온라인 노드 목록을 받아 레이턴시/모델 조건으로
 * 최적의 노드를 선택합니다.
 */
export class NodeSelector {
    constructor(
        private readonly getOnlineNodes: () => ClusterNode[],
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
        // 게이트웨이 /v1/models 는 wildcard 확장으로 수백 개가 될 수 있어 전체 나열 금지
        // (LiteLLM Mac 이전 후 매 요청 ~30KB 로그 노이즈 실측) — 개수 + 앞 N개만 기록.
        candidates.forEach(n => {
            const preview = n.models.slice(0, NODE_MODELS_LOG_PREVIEW);
            const rest = n.models.length - preview.length;
            logger.info(`  - ${n.id}: ${n.status}, models(${n.models.length}): ${preview.join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''}`);
        });

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
     * 모델 조건으로 후보 필터링.
     *
     * vLLM/LiteLLM 환경에서는 모든 모델이 동일 LiteLLM 진입점 (단일 노드) 으로 라우팅되므로
     * 노드별 model list 필터는 사실상 'default' 와 동일하게 모든 후보 통과시킴 — 그러나
     * 미래 multi-node 운영 대비해 필터 로직 자체는 유지.
     */
    private filterByModel(candidates: ClusterNode[], modelName?: string): ClusterNode[] {
        if (!modelName || modelName === 'default') {
            return candidates;
        }

        const filtered = candidates.filter(n =>
            n.models.some(m => m.includes(modelName))
        );
        logger.info(`모델 필터링 후 candidates: ${filtered.length} (검색: ${modelName})`);
        return filtered;
    }
}
