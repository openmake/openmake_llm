/**
 * ============================================================
 * 에이전트 모니터 - 에이전트별 성능 모니터링 및 메트릭 수집
 * ============================================================
 *
 * 에이전트 요청의 시작/종료를 추적하여 성능 메트릭을 수집하는 모듈.
 * 요청 수, 성공/실패 수, 평균 응답 시간 등을 에이전트 유형별로 집계한다.
 *
 * @module agents/monitor
 * @description
 * - 에이전트별 요청 수, 성공/실패 수, 평균 응답 시간 추적
 * - 활성 요청(진행 중) 실시간 모니터링
 * - 전체 시스템 요약 통계 제공
 * - 싱글톤 패턴으로 전역 인스턴스 관리
 *
 * @see {@link module:agents/index} - 에이전트 라우팅 시 모니터 연동
 * @see {@link module:agents/learning} - RLHF 피드백과 연계한 성능 분석
 */

import { AgentMetrics, ActiveRequest } from './types';

/**
 * 에이전트 성능 모니터링 클래스
 *
 * 에이전트 유형별로 요청 메트릭을 수집하고 집계한다.
 * startRequest()로 요청 시작을 기록하고, endRequest()로 완료를 기록하면
 * 자동으로 응답 시간, 성공/실패 카운트가 계산된다.
 *
 * @class AgentMonitor
 * @example
 * const monitor = getAgentMonitor();
 * const requestId = monitor.startRequest('software-engineer', '코드 리뷰 요청');
 * // ... 에이전트 처리 ...
 * monitor.endRequest(requestId, true); // 성공
 */
export class AgentMonitor {
    /** 에이전트 유형별 누적 메트릭 (key: agentType) */
    private metrics: Map<string, AgentMetrics> = new Map();
    /** 현재 진행 중인 활성 요청 (key: requestId) */
    private activeRequests: Map<string, ActiveRequest> = new Map();

    /**
     * AgentMonitor 생성자
     *
     * 생성 시 모든 메트릭과 활성 요청을 초기화한다.
     */
    constructor() {
        this.reset();
    }

    /**
     * 요청 시작 기록
     *
     * 고유 requestId를 생성하고 활성 요청 목록에 추가한다.
     * 해당 에이전트 유형의 메트릭이 없으면 초기화한다.
     *
     * @param agentType - 에이전트 유형 ID (예: 'software-engineer')
     * @param message - 사용자 메시지 (처음 100자만 저장)
     * @returns {string} - 생성된 고유 요청 ID (endRequest에서 사용)
     */
    startRequest(agentType: string, message: string): string {
        const requestId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;

        this.activeRequests.set(requestId, {
            requestId,
            agentType,
            startTime: new Date(),
            message: message.substring(0, 100)
        });

        // 메트릭 초기화 (없으면)
        if (!this.metrics.has(agentType)) {
            this.metrics.set(agentType, {
                requestCount: 0,
                successCount: 0,
                failureCount: 0,
                totalResponseTime: 0,
                avgResponseTime: 0
            });
        }

        const metric = this.metrics.get(agentType)!;
        metric.requestCount++;
        metric.lastUsed = new Date();

        return requestId;
    }

    /**
     * 요청 완료 기록
     *
     * 활성 요청에서 제거하고 응답 시간을 계산하여 메트릭에 반영한다.
     * 평균 응답 시간은 (총 응답 시간) / (성공 + 실패 수)로 계산된다.
     *
     * @param requestId - startRequest()에서 반환된 요청 ID
     * @param success - 요청 성공 여부 (기본값: true)
     */
    endRequest(requestId: string, success: boolean = true): void {
        const request = this.activeRequests.get(requestId);
        if (!request) return;

        const responseTime = Date.now() - request.startTime.getTime();
        const metric = this.metrics.get(request.agentType);

        if (metric) {
            if (success) {
                metric.successCount++;
            } else {
                metric.failureCount++;
            }
            metric.totalResponseTime += responseTime;
            metric.avgResponseTime = metric.totalResponseTime /
                (metric.successCount + metric.failureCount);
        }

        this.activeRequests.delete(requestId);
    }

    /**
     * 특정 에이전트 유형의 메트릭 조회
     *
     * @param agentType - 조회할 에이전트 유형 ID
     * @returns {AgentMetrics | null} - 해당 에이전트의 메트릭, 없으면 null
     */
    getMetrics(agentType: string): AgentMetrics | null {
        return this.metrics.get(agentType) || null;
    }

    /**
     * 전체 에이전트 메트릭 조회
     *
     * 등록된 모든 에이전트 유형의 메트릭을 객체 형태로 반환한다.
     *
     * @returns {Record<string, AgentMetrics>} - 에이전트 유형별 메트릭 맵
     */
    getAllMetrics(): Record<string, AgentMetrics> {
        const result: Record<string, AgentMetrics> = {};
        for (const [key, value] of this.metrics.entries()) {
            result[key] = value;
        }
        return result;
    }

    /**
     * 현재 진행 중인 활성 요청 목록 조회
     *
     * @returns {ActiveRequest[]} - 진행 중인 요청 배열
     */
    getActiveRequests(): ActiveRequest[] {
        return Array.from(this.activeRequests.values());
    }

    /**
     * 전체 시스템 요약 통계 조회
     *
     * 모든 에이전트의 메트릭을 합산하여 시스템 전체 통계를 반환한다.
     * 총 요청 수, 성공/실패 수, 평균 응답 시간, 에이전트별 상세 메트릭을 포함한다.
     *
     * @returns 시스템 전체 요약 통계 객체
     */
    getSummary(): {
        totalRequests: number;
        totalSuccess: number;
        totalFailures: number;
        avgResponseTime: number;
        byAgent: Record<string, AgentMetrics>;
    } {
        let totalRequests = 0;
        let totalSuccess = 0;
        let totalFailures = 0;
        let totalResponseTime = 0;

        for (const metric of this.metrics.values()) {
            totalRequests += metric.requestCount;
            totalSuccess += metric.successCount;
            totalFailures += metric.failureCount;
            totalResponseTime += metric.totalResponseTime;
        }

        return {
            totalRequests,
            totalSuccess,
            totalFailures,
            avgResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
            byAgent: this.getAllMetrics()
        };
    }

    /**
     * 모든 메트릭 및 활성 요청 초기화
     *
     * 누적된 모든 메트릭 데이터와 활성 요청 목록을 삭제한다.
     * 생성자에서 자동 호출되며, 수동 리셋에도 사용된다.
     */
    reset(): void {
        this.metrics.clear();
        this.activeRequests.clear();
    }
}

/** AgentMonitor 싱글톤 인스턴스 */
let monitorInstance: AgentMonitor | null = null;

/**
 * AgentMonitor 싱글톤 인스턴스 반환
 *
 * 전역에서 단일 AgentMonitor 인스턴스를 공유하여
 * 모든 에이전트 요청의 메트릭을 중앙에서 관리한다.
 *
 * @returns {AgentMonitor} - 전역 AgentMonitor 인스턴스
 */
export function getAgentMonitor(): AgentMonitor {
    if (!monitorInstance) {
        monitorInstance = new AgentMonitor();
    }
    return monitorInstance;
}
