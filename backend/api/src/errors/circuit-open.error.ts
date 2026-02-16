/**
 * ============================================================
 * CircuitOpenError - 서킷 브레이커 OPEN 상태 에러
 * ============================================================
 *
 * 서킷 브레이커가 OPEN 상태일 때 요청이 즉시 거부되면 발생합니다.
 * 서킷 이름, 현재 상태, 다음 HALF_OPEN 전환 예상 시각(Unix timestamp)을
 * 포함하여 클라이언트가 적절한 재시도 타이밍을 결정할 수 있도록 합니다.
 *
 * @module errors/circuit-open.error
 * @throws HTTP 503 Service Unavailable 또는 내부 failover 트리거
 * @see cluster/circuit-breaker.ts - 서킷 브레이커 상태 머신
 */

/** 서킷 브레이커 상태 */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitOpenError extends Error {
    /** 서킷 브레이커 이름 (예: "node:192.168.1.100:11434") */
    public readonly circuitName: string;
    /** 현재 서킷 상태 (항상 'OPEN') */
    public readonly state: CircuitState;
    /** 다음 HALF_OPEN 전환 예상 시각 (Unix timestamp, ms) */
    public readonly nextRetryAt: number;

    /**
     * @param circuitName - 서킷 브레이커 식별 이름
     * @param nextRetryAt - HALF_OPEN 전환 예상 Unix timestamp (ms)
     */
    constructor(circuitName: string, nextRetryAt: number) {
        const retryInSeconds = Math.max(0, Math.ceil((nextRetryAt - Date.now()) / 1000));
        const message = `Circuit breaker '${circuitName}' is OPEN. Retry after ${retryInSeconds}s`;
        super(message);
        this.name = 'CircuitOpenError';
        this.circuitName = circuitName;
        this.state = 'OPEN';
        this.nextRetryAt = nextRetryAt;
    }

    /**
     * 사용자 친화적 메시지 반환
     */
    getDisplayMessage(language: 'ko' | 'en' = 'ko'): string {
        const retryInSeconds = Math.max(0, Math.ceil((this.nextRetryAt - Date.now()) / 1000));

        if (language === 'ko') {
            return `⚠️ 노드 '${this.circuitName}'이(가) 일시적으로 사용 불가능합니다.\n` +
                   `약 ${retryInSeconds}초 후에 자동으로 재시도됩니다.`;
        } else {
            return `⚠️ Node '${this.circuitName}' is temporarily unavailable.\n` +
                   `Will automatically retry in about ${retryInSeconds} seconds.`;
        }
    }
}
