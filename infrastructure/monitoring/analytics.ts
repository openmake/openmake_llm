/**
 * 🆕 분석 대시보드
 * 실시간 에이전트 성능, 사용자 행동, 비용 분석
 */

import { createLogger } from '../utils/logger';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';

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

    // #7 개선: 컬렉션 최대 크기 제한
    private readonly MAX_QUERY_LOG = 10000;
    private readonly MAX_SESSION_LOG = 5000;
    // #7: 완료된 세션 정리 주기
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor() {
        logger.info('분석 시스템 초기화됨');

        // #7 개선: 5분마다 완료된 세션 정리
        this.cleanupInterval = setInterval(() => this.cleanupCompletedSessions(), 5 * 60 * 1000);
    }

    /**
     * 리소스 정리 - 메모리 누수 방지
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * #7 개선: 완료된 오래된 세션 정리
     */
    private cleanupCompletedSessions(): void {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24시간 이전
        const before = this.sessionLog.length;
        this.sessionLog = this.sessionLog.filter(s => {
            // 활성 세션이거나 24시간 이내의 완료된 세션 유지
            if (!s.end) return true;
            return s.end.getTime() > cutoff;
        });
        const cleaned = before - this.sessionLog.length;
        if (cleaned > 0) {
            logger.info(`완료된 세션 ${cleaned}개 정리됨`);
        }
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

        // 최대 10,000개 유지
        if (this.queryLog.length > 10000) {
            this.queryLog.shift();
        }
    }

    /**
     * 세션 시작 기록
     * #7 개선: 최대 크기 제한 적용
     */
    startSession(sessionId: string): void {
        // #7: 크기 제한 초과 시 오래된 완료 세션부터 제거
        if (this.sessionLog.length >= this.MAX_SESSION_LOG) {
            const completedIdx = this.sessionLog.findIndex(s => s.end);
            if (completedIdx >= 0) {
                this.sessionLog.splice(completedIdx, 1);
            } else {
                this.sessionLog.shift(); // 모두 활성이면 가장 오래된 것 제거
            }
        }

        this.sessionLog.push({
            sessionId,
            start: new Date(),
            queries: 0
        });
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
     * #14 개선: 하드코딩 제거 → 환경변수/설정 기반 비용 단가
     */
    getCostAnalysis(): CostAnalysis {
        const tracker = getApiUsageTracker();
        const summary = tracker.getSummary();

        // #14: 모델별 비용 단가 (환경변수에서 로드, 기본값 제공)
        const MODEL_COST_CONFIG: Record<string, number> = {
            // 환경변수: COST_PER_TOKEN_{MODEL}=0.000001 형식
            default: parseFloat(process.env.COST_PER_TOKEN_DEFAULT || '0.000001'),
            'gpt-4': parseFloat(process.env.COST_PER_TOKEN_GPT4 || '0.00003'),
            'gpt-3.5-turbo': parseFloat(process.env.COST_PER_TOKEN_GPT35 || '0.000002'),
            'claude-3-opus': parseFloat(process.env.COST_PER_TOKEN_CLAUDE_OPUS || '0.000015'),
            'claude-3-sonnet': parseFloat(process.env.COST_PER_TOKEN_CLAUDE_SONNET || '0.000003'),
        };

        const getCostPerToken = (model: string): number => {
            return MODEL_COST_CONFIG[model] || MODEL_COST_CONFIG.default;
        };

        const defaultCostPerToken = MODEL_COST_CONFIG.default;
        const dailyTokens = summary.today.totalTokens;
        const weeklyTokens = summary.weekly.totalTokens;

        const dailyCost = dailyTokens * defaultCostPerToken;
        const weeklyCost = weeklyTokens * defaultCostPerToken;
        const projectedMonthlyCost = (weeklyCost / 7) * 30;

        // 모델별 비용 (설정 기반)
        const modelCosts: { model: string; cost: number; percentage: number }[] = [];
        let totalCost = weeklyCost || 1;

        const todayModels = (summary.today as any).models || {};
        for (const [model, count] of Object.entries(todayModels)) {
            const tokenCount = count as number;
            const cost = tokenCount * getCostPerToken(model);
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
            activeConnections: 0, // TODO: 실제 연결 수
            memoryUsage,
            cpuUsage: 0 // TODO: CPU 사용량
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
