/**
 * 🆕 분석 대시보드
 * 실시간 에이전트 성능, 사용자 행동, 비용 분석
 */

import { createLogger } from '../utils/logger';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import * as os from 'os';

const logger = createLogger('Analytics');

// 에이전트 성능 통계
interface AgentPerformance {
    agentId: string;
    agentName: string;
    totalRequests: number;
    avgResponseTime: number;
    successRate: number;
    avgTokens: number;
    popularity: number;  // 순위
}

// 사용자 행동 통계
interface UserBehavior {
    peakHours: { hour: number; requests: number }[];
    avgSessionLength: number;
    topQueries: { query: string; count: number }[];
    avgQueriesPerSession: number;
}

// 비용 분석
interface CostAnalysis {
    dailyCost: number;
    weeklyCost: number;
    projectedMonthlyCost: number;
    costByModel: { model: string; cost: number; percentage: number }[];
    costByAgent: { agentId: string; cost: number; percentage: number }[];
}

// 시스템 건강 상태
interface SystemHealth {
    status: 'healthy' | 'degraded' | 'critical';
    uptime: number;
    avgResponseTime: number;
    errorRate: number;
    activeConnections: number;
    memoryUsage: number;
    cpuUsage: number;
}

// 종합 분석 결과
interface AnalyticsDashboard {
    timestamp: Date;
    agentPerformance: AgentPerformance[];
    userBehavior: UserBehavior;
    costAnalysis: CostAnalysis;
    systemHealth: SystemHealth;
}

/**
 * 분석 시스템 클래스
 */
export class AnalyticsSystem {
    private agentStats: Map<string, {
        requests: number;
        totalResponseTime: number;
        successCount: number;
        totalTokens: number;
    }> = new Map();

    private queryLog: { query: string; timestamp: Date }[] = [];
    private sessionLog: { sessionId: string; start: Date; end?: Date; queries: number }[] = [];
    private startTime: Date = new Date();
    private activeConnectionsGetter: () => number = () => 0;

    // Memory overflow prevention constants
    private static readonly MAX_QUERY_LOG = 10000;
    private static readonly MAX_SESSION_LOG = 5000;
    private static readonly SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    private sessionCleanupTimer: ReturnType<typeof setInterval> | null = null;

    constructor() {
        // Periodic cleanup of completed sessions to prevent memory overflow
        this.sessionCleanupTimer = setInterval(() => {
            this.cleanupCompletedSessions();
        }, AnalyticsSystem.SESSION_CLEANUP_INTERVAL_MS);

        // Allow process to exit even if timer is still running
        if (this.sessionCleanupTimer.unref) {
            this.sessionCleanupTimer.unref();
        }

        logger.info('분석 시스템 초기화됨');
    }

    /**
     * 활성 WebSocket 연결 수 게터 설정 (서버에서 주입)
     */
    setActiveConnectionsGetter(getter: () => number): void {
        this.activeConnectionsGetter = getter;
    }

    /**
     * 에이전트 요청 기록
     */
    recordAgentRequest(
        agentId: string,
        agentName: string,
        responseTimeMs: number,
        success: boolean,
        tokens: number
    ): void {
        const stats = this.agentStats.get(agentId) || {
            requests: 0,
            totalResponseTime: 0,
            successCount: 0,
            totalTokens: 0
        };

        stats.requests++;
        stats.totalResponseTime += responseTimeMs;
        if (success) stats.successCount++;
        stats.totalTokens += tokens;

        this.agentStats.set(agentId, stats);
    }

    /**
     * 쿼리 기록
     */
    recordQuery(query: string): void {
        this.queryLog.push({ query, timestamp: new Date() });

        // 최대 MAX_QUERY_LOG개 유지 — splice로 배치 제거 (shift()의 O(n) 반복 방지)
        if (this.queryLog.length > AnalyticsSystem.MAX_QUERY_LOG * 1.2) {
            this.queryLog = this.queryLog.slice(-AnalyticsSystem.MAX_QUERY_LOG);
        }
    }

    /**
     * 세션 시작 기록
     */
    startSession(sessionId: string): void {
        this.sessionLog.push({
            sessionId,
            start: new Date(),
            queries: 0
        });

        // Cap session log to prevent unbounded growth
        if (this.sessionLog.length > AnalyticsSystem.MAX_SESSION_LOG * 1.2) {
            // Remove oldest completed sessions first, keep active ones
            const active = this.sessionLog.filter(s => !s.end);
            const completed = this.sessionLog.filter(s => s.end);
            const keepCompleted = completed.slice(-AnalyticsSystem.MAX_SESSION_LOG + active.length);
            this.sessionLog = [...keepCompleted, ...active];
        }
    }

    /**
     * 세션 종료 기록
     */
    endSession(sessionId: string): void {
        const session = this.sessionLog.find(s => s.sessionId === sessionId && !s.end);
        if (session) {
            session.end = new Date();
        }
    }

    /**
     * 세션 쿼리 증가
     */
    incrementSessionQuery(sessionId: string): void {
        const session = this.sessionLog.find(s => s.sessionId === sessionId && !s.end);
        if (session) {
            session.queries++;
        }
    }

    /**
     * 에이전트 성능 통계 조회
     */
    getAgentPerformance(): AgentPerformance[] {
        const performances: AgentPerformance[] = [];

        for (const [agentId, stats] of this.agentStats.entries()) {
            performances.push({
                agentId,
                agentName: agentId, // TODO: 실제 이름으로 매핑
                totalRequests: stats.requests,
                avgResponseTime: stats.requests > 0
                    ? Math.round(stats.totalResponseTime / stats.requests)
                    : 0,
                successRate: stats.requests > 0
                    ? Math.round((stats.successCount / stats.requests) * 100)
                    : 0,
                avgTokens: stats.requests > 0
                    ? Math.round(stats.totalTokens / stats.requests)
                    : 0,
                popularity: 0
            });
        }

        // 인기도 순위 계산
        performances.sort((a, b) => b.totalRequests - a.totalRequests);
        performances.forEach((p, i) => p.popularity = i + 1);

        return performances;
    }

    /**
     * 피크 시간대 분석
     */
    getPeakHours(): { hour: number; requests: number }[] {
        const hourCounts: number[] = new Array(24).fill(0);

        for (const log of this.queryLog) {
            const hour = log.timestamp.getHours();
            hourCounts[hour]++;
        }

        return hourCounts.map((count, hour) => ({ hour, requests: count }))
            .sort((a, b) => b.requests - a.requests);
    }

    /**
     * 인기 쿼리 분석
     */
    getTopQueries(limit: number = 10): { query: string; count: number }[] {
        const queryCounts: Map<string, number> = new Map();

        for (const log of this.queryLog) {
            // 정규화된 쿼리
            const normalized = log.query.toLowerCase().trim().substring(0, 100);
            queryCounts.set(normalized, (queryCounts.get(normalized) || 0) + 1);
        }

        return Array.from(queryCounts.entries())
            .map(([query, count]) => ({ query, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    /**
     * 사용자 행동 통계 조회
     */
    getUserBehavior(): UserBehavior {
        const completedSessions = this.sessionLog.filter(s => s.end);
        const avgSessionLength = completedSessions.length > 0
            ? completedSessions.reduce((sum, s) => sum + (s.end!.getTime() - s.start.getTime()), 0) / completedSessions.length / 1000 / 60
            : 0;

        const avgQueriesPerSession = completedSessions.length > 0
            ? completedSessions.reduce((sum, s) => sum + s.queries, 0) / completedSessions.length
            : 0;

        return {
            peakHours: this.getPeakHours().slice(0, 5),
            avgSessionLength: Math.round(avgSessionLength),
            topQueries: this.getTopQueries(10),
            avgQueriesPerSession: Math.round(avgQueriesPerSession * 10) / 10
        };
    }

    /**
     * 비용 분석 (토큰 기반 추정)
     */
    getCostAnalysis(): CostAnalysis {
        const tracker = getApiUsageTracker();
        const summary = tracker.getSummary();

        // 토큰당 비용 추정 (예시: $0.001 per 1000 tokens)
        const costPerToken = 0.000001;

        const dailyTokens = summary.today.totalTokens;
        const weeklyTokens = summary.weekly.totalTokens;

        const dailyCost = dailyTokens * costPerToken;
        const weeklyCost = weeklyTokens * costPerToken;
        const projectedMonthlyCost = (weeklyCost / 7) * 30;

        // 모델별 비용 (에이전트 통계에서 추정)
        const modelCosts: { model: string; cost: number; percentage: number }[] = [];
        let totalCost = weeklyCost || 1;

        const todayModels = summary.today.modelUsage || {};
        for (const [model, count] of Object.entries(todayModels)) {
            const cost = count * 0.001; // 예시 비용
            modelCosts.push({
                model,
                cost,
                percentage: Math.round((cost / totalCost) * 100)
            });
        }

        return {
            dailyCost: Math.round(dailyCost * 1000) / 1000,
            weeklyCost: Math.round(weeklyCost * 1000) / 1000,
            projectedMonthlyCost: Math.round(projectedMonthlyCost * 100) / 100,
            costByModel: modelCosts,
            costByAgent: []
        };
    }

    /**
     * 시스템 건강 상태 조회
     */
    getSystemHealth(): SystemHealth {
        const tracker = getApiUsageTracker();
        const summary = tracker.getSummary();

        const uptime = (Date.now() - this.startTime.getTime()) / 1000;
        const errorRate = summary.today.totalRequests > 0
            ? (summary.today.totalErrors / summary.today.totalRequests) * 100
            : 0;

        let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
        if (errorRate > 10) status = 'critical';
        else if (errorRate > 5 || summary.today.avgResponseTime > 5000) status = 'degraded';

        // 메모리 사용량
        const memUsage = process.memoryUsage();
        const memoryUsage = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100);

        return {
            status,
            uptime: Math.round(uptime),
            avgResponseTime: summary.today.avgResponseTime,
            errorRate: Math.round(errorRate * 10) / 10,
            activeConnections: this.activeConnectionsGetter(),
            memoryUsage,
            cpuUsage: Math.round((os.loadavg()[0] / os.cpus().length) * 100)
        };
    }

    /**
     * 종합 분석 대시보드 조회
     */
    getDashboard(): AnalyticsDashboard {
        return {
            timestamp: new Date(),
            agentPerformance: this.getAgentPerformance(),
            userBehavior: this.getUserBehavior(),
            costAnalysis: this.getCostAnalysis(),
            systemHealth: this.getSystemHealth()
        };
    }

    /**
     * 완료된 오래된 세션 정리 (메모리 오버플로우 방지)
     * 24시간 이상 지난 완료 세션을 제거
     */
    private cleanupCompletedSessions(): void {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago
        const before = this.sessionLog.length;

        this.sessionLog = this.sessionLog.filter(s => {
            // Keep active sessions (no end time)
            if (!s.end) return true;
            // Keep recently completed sessions
            return s.end.getTime() > cutoff;
        });

        const removed = before - this.sessionLog.length;
        if (removed > 0) {
            logger.debug(`세션 로그 정리: ${removed}개 완료 세션 제거 (${this.sessionLog.length}개 유지)`);
        }
    }

    /**
     * 정리 타이머 중지 (테스트 또는 종료 시)
     */
    dispose(): void {
        if (this.sessionCleanupTimer) {
            clearInterval(this.sessionCleanupTimer);
            this.sessionCleanupTimer = null;
        }
    }

    /**
     * 통계 리셋
     */
    reset(): void {
        this.agentStats.clear();
        this.queryLog = [];
        this.sessionLog = [];
        logger.info('분석 통계 리셋됨');
    }
}

// 싱글톤 인스턴스
let analyticsInstance: AnalyticsSystem | null = null;

export function getAnalyticsSystem(): AnalyticsSystem {
    if (!analyticsInstance) {
        analyticsInstance = new AnalyticsSystem();
    }
    return analyticsInstance;
}
