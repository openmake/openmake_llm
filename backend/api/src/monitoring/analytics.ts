/**
 * ============================================================
 * Analytics System - 실시간 분석 대시보드 엔진
 * ============================================================
 *
 * 에이전트 성능, 사용자 행동, 비용 분석, 시스템 건강 상태를
 * 종합적으로 수집하고 대시보드 형태로 제공하는 분석 시스템입니다.
 *
 * @module monitoring/analytics
 * @description
 * - 에이전트별 성능 통계 (응답 시간, 성공률, 토큰 사용량, 인기도)
 * - 사용자 행동 분석 (피크 시간대, 인기 쿼리, 세션 길이)
 * - 토큰 기반 비용 추정 (일별/주별/월별 예측)
 * - 시스템 건강 상태 판정 (healthy/degraded/critical)
 * - 메모리 오버플로우 방지를 위한 자동 정리 메커니즘
 * - 싱글톤 패턴으로 전역 인스턴스 관리
 */

import { createLogger } from '../utils/logger';
import { getApiUsageTracker } from '../ollama/api-usage-tracker';
import * as os from 'os';

const logger = createLogger('Analytics');

/**
 * 에이전트 성능 통계 인터페이스
 *
 * @interface AgentPerformance
 */
interface AgentPerformance {
    /** 에이전트 고유 식별자 */
    agentId: string;
    /** 에이전트 표시 이름 */
    agentName: string;
    /** 총 요청 수 */
    totalRequests: number;
    /** 평균 응답 시간 (ms) */
    avgResponseTime: number;
    /** 성공률 (0-100%) */
    successRate: number;
    /** 요청당 평균 토큰 수 */
    avgTokens: number;
    /** 인기도 순위 (1이 가장 높음) */
    popularity: number;
}

/**
 * 사용자 행동 통계 인터페이스
 *
 * @interface UserBehavior
 */
interface UserBehavior {
    /** 피크 시간대 목록 (시간별 요청 수, 상위 5개) */
    peakHours: { hour: number; requests: number }[];
    /** 평균 세션 길이 (분) */
    avgSessionLength: number;
    /** 인기 쿼리 목록 (상위 10개) */
    topQueries: { query: string; count: number }[];
    /** 세션당 평균 쿼리 수 */
    avgQueriesPerSession: number;
}

/**
 * 비용 분석 인터페이스
 *
 * 토큰 사용량 기반으로 비용을 추정합니다.
 *
 * @interface CostAnalysis
 */
interface CostAnalysis {
    /** 일별 추정 비용 (USD) */
    dailyCost: number;
    /** 주별 추정 비용 (USD) */
    weeklyCost: number;
    /** 월별 예측 비용 (USD, 주별 비용 기반 추정) */
    projectedMonthlyCost: number;
    /** 모델별 비용 분석 */
    costByModel: { model: string; cost: number; percentage: number }[];
    /** 에이전트별 비용 분석 */
    costByAgent: { agentId: string; cost: number; percentage: number }[];
}

/**
 * 시스템 건강 상태 인터페이스
 *
 * 에러율과 응답 시간 기반으로 상태를 판정합니다:
 * - healthy: 에러율 5% 이하, 응답 시간 5초 이하
 * - degraded: 에러율 5-10% 또는 응답 시간 5초 초과
 * - critical: 에러율 10% 초과
 *
 * @interface SystemHealth
 */
interface SystemHealth {
    /** 시스템 상태 (healthy/degraded/critical) */
    status: 'healthy' | 'degraded' | 'critical';
    /** 서버 가동 시간 (초) */
    uptime: number;
    /** 평균 응답 시간 (ms) */
    avgResponseTime: number;
    /** 에러율 (%) */
    errorRate: number;
    /** 현재 활성 연결 수 */
    activeConnections: number;
    /** 힙 메모리 사용률 (%) */
    memoryUsage: number;
    /** CPU 사용률 (%, 로드 평균 기반) */
    cpuUsage: number;
}

/**
 * 종합 분석 대시보드 결과 인터페이스
 *
 * @interface AnalyticsDashboard
 */
interface AnalyticsDashboard {
    /** 대시보드 생성 시점 */
    timestamp: Date;
    /** 에이전트별 성능 통계 목록 */
    agentPerformance: AgentPerformance[];
    /** 사용자 행동 통계 */
    userBehavior: UserBehavior;
    /** 비용 분석 결과 */
    costAnalysis: CostAnalysis;
    /** 시스템 건강 상태 */
    systemHealth: SystemHealth;
}

/**
 * 종합 분석 시스템 클래스
 *
 * 에이전트 성능, 사용자 행동, 비용, 시스템 건강 상태를 추적하고
 * 대시보드 형태로 종합 분석 결과를 제공합니다.
 * 메모리 오버플로우 방지를 위해 쿼리 로그(10,000건)와
 * 세션 로그(5,000건)에 상한을 두고, 1시간마다 완료된 세션을 정리합니다.
 *
 * @class AnalyticsSystem
 */
export class AnalyticsSystem {
    /** 에이전트별 누적 통계 맵 */
    private agentStats: Map<string, {
        requests: number;
        totalResponseTime: number;
        successCount: number;
        totalTokens: number;
    }> = new Map();

    /** 쿼리 기록 배열 (최대 MAX_QUERY_LOG건) */
    private queryLog: { query: string; timestamp: Date }[] = [];
    /** 세션 기록 배열 (최대 MAX_SESSION_LOG건) */
    private sessionLog: { sessionId: string; start: Date; end?: Date; queries: number }[] = [];
    /** 시스템 시작 시간 */
    private startTime: Date = new Date();
    /** 활성 연결 수 조회 콜백 (서버에서 주입) */
    private activeConnectionsGetter: () => number = () => 0;

    /** 쿼리 로그 최대 보관 수 */
    private static readonly MAX_QUERY_LOG = 10000;
    /** 세션 로그 최대 보관 수 */
    private static readonly MAX_SESSION_LOG = 5000;
    /** 세션 정리 주기 (1시간) */
    private static readonly SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
    /** 세션 정리 타이머 핸들 */
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
     * 활성 WebSocket 연결 수 조회 콜백을 설정합니다.
     *
     * 서버 초기화 시 WebSocket 서버의 연결 수 조회 함수를 주입합니다.
     *
     * @param getter - 활성 연결 수를 반환하는 콜백 함수
     */
    setActiveConnectionsGetter(getter: () => number): void {
        this.activeConnectionsGetter = getter;
    }

    /**
     * 에이전트 요청을 기록합니다.
     *
     * 에이전트별 누적 통계(요청 수, 응답 시간, 성공 수, 토큰 수)를 업데이트합니다.
     *
     * @param agentId - 에이전트 고유 식별자
     * @param agentName - 에이전트 표시 이름
     * @param responseTimeMs - 응답 시간 (ms)
     * @param success - 요청 성공 여부
     * @param tokens - 사용된 토큰 수
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
     * 사용자 쿼리를 기록합니다.
     *
     * MAX_QUERY_LOG * 1.2 초과 시 배치 트렁케이션을 수행합니다.
     *
     * @param query - 사용자 쿼리 문자열
     */
    recordQuery(query: string): void {
        this.queryLog.push({ query, timestamp: new Date() });

        // 최대 MAX_QUERY_LOG개 유지 — splice로 배치 제거 (shift()의 O(n) 반복 방지)
        if (this.queryLog.length > AnalyticsSystem.MAX_QUERY_LOG * 1.2) {
            this.queryLog = this.queryLog.slice(-AnalyticsSystem.MAX_QUERY_LOG);
        }
    }

    /**
     * 세션 시작을 기록합니다.
     *
     * MAX_SESSION_LOG * 1.2 초과 시 완료된 세션을 우선 제거합니다.
     *
     * @param sessionId - 세션 고유 식별자
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
     * 세션 종료를 기록합니다.
     *
     * @param sessionId - 종료할 세션의 고유 식별자
     */
    endSession(sessionId: string): void {
        const session = this.sessionLog.find(s => s.sessionId === sessionId && !s.end);
        if (session) {
            session.end = new Date();
        }
    }

    /**
     * 세션의 쿼리 카운트를 1 증가시킵니다.
     *
     * @param sessionId - 대상 세션의 고유 식별자
     */
    incrementSessionQuery(sessionId: string): void {
        const session = this.sessionLog.find(s => s.sessionId === sessionId && !s.end);
        if (session) {
            session.queries++;
        }
    }

    /**
     * 에이전트별 성능 통계를 조회합니다.
     *
     * 요청 수 기준 내림차순 정렬 후 인기도 순위를 부여합니다.
     *
     * @returns 에이전트 성능 통계 배열 (인기도 순)
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
     * 시간대별 요청 분포를 분석합니다.
     *
     * 0-23시 각 시간대의 요청 수를 집계하여 내림차순 정렬합니다.
     *
     * @returns 시간대별 요청 수 배열 (요청 수 내림차순)
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
     * 인기 쿼리를 분석합니다.
     *
     * 쿼리를 소문자 정규화(100자 제한) 후 빈도를 집계합니다.
     *
     * @param limit - 반환할 최대 쿼리 수 (기본값: 10)
     * @returns 인기 쿼리 배열 (빈도 내림차순)
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
     * 사용자 행동 통계를 종합 조회합니다.
     *
     * 피크 시간대, 평균 세션 길이, 인기 쿼리, 세션당 평균 쿼리 수를 포함합니다.
     *
     * @returns 사용자 행동 통계 객체
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
     * 토큰 사용량 기반 비용을 분석합니다.
     *
     * API 사용량 추적기에서 토큰 데이터를 가져와 일별/주별/월별 비용을 추정합니다.
     * 비용 단가: $0.000001/토큰 (예시 값)
     *
     * @returns 비용 분석 결과 객체
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
     * 시스템 건강 상태를 조회합니다.
     *
     * 에러율과 응답 시간을 기반으로 healthy/degraded/critical 상태를 판정합니다.
     *
     * @returns 시스템 건강 상태 객체
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
     * 종합 분석 대시보드를 조회합니다.
     *
     * 에이전트 성능, 사용자 행동, 비용 분석, 시스템 건강 상태를 한 번에 반환합니다.
     *
     * @returns 종합 분석 대시보드 객체
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
     * 정리 타이머를 중지합니다.
     *
     * 테스트 환경 또는 서버 종료 시 호출하여 타이머를 해제합니다.
     */
    dispose(): void {
        if (this.sessionCleanupTimer) {
            clearInterval(this.sessionCleanupTimer);
            this.sessionCleanupTimer = null;
        }
    }

    /**
     * 모든 분석 통계를 초기화합니다.
     *
     * 에이전트 통계, 쿼리 로그, 세션 로그를 모두 삭제합니다.
     */
    reset(): void {
        this.agentStats.clear();
        this.queryLog = [];
        this.sessionLog = [];
        logger.info('분석 통계 리셋됨');
    }
}

/** 싱글톤 인스턴스 */
let analyticsInstance: AnalyticsSystem | null = null;

/**
 * AnalyticsSystem 싱글톤 인스턴스를 반환합니다.
 *
 * 최초 호출 시 인스턴스를 생성하고, 이후 동일 인스턴스를 재사용합니다.
 *
 * @returns AnalyticsSystem 싱글톤 인스턴스
 */
export function getAnalyticsSystem(): AnalyticsSystem {
    if (!analyticsInstance) {
        analyticsInstance = new AnalyticsSystem();
    }
    return analyticsInstance;
}
