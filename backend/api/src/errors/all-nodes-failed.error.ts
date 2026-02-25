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
    getDisplayMessage(language: string = 'en'): string {
        const nodes = this.attemptedNodes.length;
        const messages: Record<string, string> = {
            ko: `⚠️ 모델 '${this.model}'을(를) 처리할 수 있는 노드가 없습니다.\n시도된 노드: ${nodes}개\n잠시 후 다시 시도해주세요.`,
            en: `⚠️ No available nodes for model '${this.model}'.\nAttempted nodes: ${nodes}\nPlease try again later.`,
            ja: `⚠️ モデル '${this.model}' を処理できるノードがありません。\n試行ノード数: ${nodes}\nしばらくしてからもう一度お試しください。`,
            zh: `⚠️ 没有可用节点处理模型 '${this.model}'。\n已尝试节点: ${nodes}\n请稍后重试。`,
            es: `⚠️ No hay nodos disponibles para el modelo '${this.model}'.\nNodos intentados: ${nodes}\nPor favor, inténtelo de nuevo más tarde.`,
            de: `⚠️ Keine verfügbaren Knoten für Modell '${this.model}'.\nVersuchte Knoten: ${nodes}\nBitte versuchen Sie es später erneut.`
        };
        return messages[language] || messages['en']!;
    }
}
