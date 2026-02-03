/**
 * Agent Monitor
 * 에이전트별 성능 모니터링 및 메트릭 수집
 */

import { AgentMetrics, ActiveRequest } from './types';

export class AgentMonitor {
    private metrics: Map<string, AgentMetrics> = new Map();
    private activeRequests: Map<string, ActiveRequest> = new Map();

    constructor() {
        this.reset();
    }

    /**
     * 요청 시작 기록
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
     * 요청 완료 기록 (성공)
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
     * 특정 에이전트 메트릭 조회
     */
    getMetrics(agentType: string): AgentMetrics | null {
        return this.metrics.get(agentType) || null;
    }

    /**
     * 전체 에이전트 메트릭 조회
     */
    getAllMetrics(): Record<string, AgentMetrics> {
        const result: Record<string, AgentMetrics> = {};
        for (const [key, value] of this.metrics.entries()) {
            result[key] = value;
        }
        return result;
    }

    /**
     * 활성 요청 목록 조회
     */
    getActiveRequests(): ActiveRequest[] {
        return Array.from(this.activeRequests.values());
    }

    /**
     * 요약 통계 조회
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
     * 메트릭 초기화
     */
    reset(): void {
        this.metrics.clear();
        this.activeRequests.clear();
    }
}

// 싱글톤 인스턴스
let monitorInstance: AgentMonitor | null = null;

export function getAgentMonitor(): AgentMonitor {
    if (!monitorInstance) {
        monitorInstance = new AgentMonitor();
    }
    return monitorInstance;
}
