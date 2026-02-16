/**
 * ============================================================
 * AllNodesFailedError - 모든 클러스터 노드 실패 에러
 * ============================================================
 *
 * 클러스터의 모든 후보 노드에 대해 요청이 실패했을 때 발생합니다.
 * 요청한 모델명, 시도된 노드 목록, 각 노드별 발생한 에러를 포함하여
 * 디버깅과 failover 로직에 활용됩니다.
 *
 * @module errors/all-nodes-failed.error
 * @throws HTTP 503 Service Unavailable
 * @see cluster/manager.ts - ClusterManager 노드 선택 및 failover
 */
export class AllNodesFailedError extends Error {
    /** 요청한 모델 이름 */
    public readonly model: string;
    /** 시도된 노드 ID 목록 (예: ["192.168.1.100:11434", "192.168.1.101:11434"]) */
    public readonly attemptedNodes: string[];
    /** 각 노드에서 발생한 에러 목록 (attemptedNodes와 동일 순서) */
    public readonly errors: Error[];

    /**
     * @param model - 요청한 모델 이름
     * @param attemptedNodes - 시도된 노드 ID 배열
     * @param errors - 각 노드에서 발생한 에러 배열
     */
    constructor(model: string, attemptedNodes: string[], errors: Error[]) {
        const nodeList = attemptedNodes.length > 0
            ? attemptedNodes.join(', ')
            : 'none';
        const message = `All nodes failed for model '${model}'. Attempted: [${nodeList}] (${errors.length} errors)`;
        super(message);
        this.name = 'AllNodesFailedError';
        this.model = model;
        this.attemptedNodes = attemptedNodes;
        this.errors = errors;
    }

    /**
     * 사용자 친화적 메시지 반환
     */
    getDisplayMessage(language: 'ko' | 'en' = 'ko'): string {
        if (language === 'ko') {
            return `⚠️ 모델 '${this.model}'을(를) 처리할 수 있는 노드가 없습니다.\n` +
                   `시도된 노드: ${this.attemptedNodes.length}개\n` +
                   `잠시 후 다시 시도해주세요.`;
        } else {
            return `⚠️ No available nodes for model '${this.model}'.\n` +
                   `Attempted nodes: ${this.attemptedNodes.length}\n` +
                   `Please try again later.`;
        }
    }
}
