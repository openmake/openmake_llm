/**
 * ============================================================
 * Trace Analyzer — 에이전트 루프 실행 추적 및 분석
 * ============================================================
 *
 * Harness Engineering 원칙 (Inform):
 * AgentLoop의 각 턴별 도구 호출, 결과, 에러, 소요시간을 구조화하여 수집하고,
 * 루프 종료 후 병목 구간과 실패 패턴을 분석합니다.
 *
 * @module services/chat-strategies/trace-analyzer
 */

import { TRACE_ANALYZER } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TraceAnalyzer');

// ============================================
// 인터페이스 정의
// ============================================

/** 에이전트 루프의 단일 도구 호출에 대한 실행 기록 */
export interface TraceEntry {
    /** 턴 번호 (1-based) */
    turn: number;
    /** 도구 이름 */
    toolName: string;
    /** 인자 요약 (JSON 문자열의 일부) */
    argsSummary: string;
    /** 결과 길이 (문자 수) */
    resultLength: number;
    /** 에러 여부 */
    isError: boolean;
    /** 에러 메시지 (에러 시에만) */
    errorMessage?: string;
    /** 도구 실행 소요 시간 (ms) */
    durationMs: number;
}

/** 도구별 통계 */
export interface ToolStats {
    /** 도구 이름 */
    toolName: string;
    /** 총 호출 횟수 */
    callCount: number;
    /** 에러 횟수 */
    errorCount: number;
    /** 평균 실행 시간 (ms) */
    averageDurationMs: number;
    /** 총 실행 시간 (ms) */
    totalDurationMs: number;
}

/** 트레이스 분석 결과 */
export interface TraceAnalysis {
    /** 총 도구 호출 수 */
    totalToolCalls: number;
    /** 총 실행 시간 (ms) */
    totalDurationMs: number;
    /** 전체 에러율 (0.0~1.0) */
    errorRate: number;
    /** 병목 도구 목록 (임계값 초과) */
    bottlenecks: ToolStats[];
    /** 에러가 발생한 도구 호출 목록 */
    errors: Array<{ turn: number; toolName: string; message?: string }>;
    /** 높은 에러율 경고 여부 */
    highErrorRate: boolean;
    /** 도구별 통계 */
    toolStats: ToolStats[];
}

// ============================================
// TraceAnalyzer 클래스
// ============================================

/** startToolCall에서 반환되어 endToolCall에 전달되는 컨텍스트 */
export interface TraceContext {
    toolName: string;
    argsSummary: string;
    startTime: number;
}

/**
 * 에이전트 루프 실행 트레이스를 수집하고 분석합니다.
 *
 * Stateless 방식: startToolCall이 TraceContext를 반환하고,
 * endToolCall이 해당 컨텍스트를 받아 기록합니다.
 * 이 방식은 예외 안전성과 병렬 호출 지원을 보장합니다.
 *
 * 사용법:
 * 1. 루프 시작 시 `new TraceAnalyzer()` 생성
 * 2. 각 도구 호출 전 `const ctx = analyzer.startToolCall(name, args)` 호출
 * 3. 도구 실행 후 `analyzer.endToolCall(ctx, result, isError)` 호출
 * 4. 루프 종료 후 `analyzer.analyze()` 호출하여 분석 결과 획득
 */
export class TraceAnalyzer {
    private entries: TraceEntry[] = [];
    private currentTurn = 0;

    /**
     * 새로운 턴 시작을 기록합니다.
     * 여러 도구 호출이 한 턴에 있을 수 있으므로, 턴 번호는 외부에서 전달합니다.
     */
    setTurn(turn: number): void {
        this.currentTurn = turn;
    }

    /**
     * 도구 호출 시작을 기록하고, endToolCall에 전달할 컨텍스트를 반환합니다.
     *
     * @param toolName - 호출할 도구 이름
     * @param args - 도구 인자 (요약용)
     * @returns endToolCall에 전달할 TraceContext
     */
    startToolCall(toolName: string, args: Record<string, unknown>): TraceContext {
        return {
            toolName,
            argsSummary: summarizeArgs(args),
            startTime: Date.now(),
        };
    }

    /**
     * 도구 호출 종료를 기록합니다.
     *
     * @param ctx - startToolCall에서 반환된 컨텍스트
     * @param result - 도구 실행 결과 문자열
     * @param isError - 에러 여부
     * @param errorMessage - 에러 메시지 (선택)
     */
    endToolCall(ctx: TraceContext, result: string, isError: boolean, errorMessage?: string): void {
        const durationMs = Date.now() - ctx.startTime;
        this.entries.push({
            turn: this.currentTurn,
            toolName: ctx.toolName,
            argsSummary: ctx.argsSummary,
            resultLength: result.length,
            isError,
            errorMessage,
            durationMs,
        });
    }

    /**
     * 수집된 트레이스를 분석하여 병목, 에러율, 도구별 통계를 산출합니다.
     */
    analyze(): TraceAnalysis {
        const totalToolCalls = this.entries.length;

        if (totalToolCalls === 0) {
            return {
                totalToolCalls: 0,
                totalDurationMs: 0,
                errorRate: 0,
                bottlenecks: [],
                errors: [],
                highErrorRate: false,
                toolStats: [],
            };
        }

        const totalDurationMs = this.entries.reduce((sum, e) => sum + e.durationMs, 0);
        const errorEntries = this.entries.filter(e => e.isError);
        const errorRate = errorEntries.length / totalToolCalls;

        // 도구별 통계 집계
        const statsMap = new Map<string, { totalMs: number; count: number; errors: number }>();
        for (const entry of this.entries) {
            const existing = statsMap.get(entry.toolName) || { totalMs: 0, count: 0, errors: 0 };
            existing.totalMs += entry.durationMs;
            existing.count++;
            if (entry.isError) existing.errors++;
            statsMap.set(entry.toolName, existing);
        }

        const toolStats: ToolStats[] = Array.from(statsMap.entries()).map(([toolName, stats]) => ({
            toolName,
            callCount: stats.count,
            errorCount: stats.errors,
            averageDurationMs: Math.round(stats.totalMs / stats.count),
            totalDurationMs: stats.totalMs,
        }));

        // 병목 감지: 평균 실행 시간이 임계값 초과
        const bottlenecks = toolStats
            .filter(s => s.averageDurationMs > TRACE_ANALYZER.BOTTLENECK_THRESHOLD_MS)
            .sort((a, b) => b.totalDurationMs - a.totalDurationMs);

        const highErrorRate = errorRate > TRACE_ANALYZER.HIGH_ERROR_RATE_THRESHOLD;

        const analysis: TraceAnalysis = {
            totalToolCalls,
            totalDurationMs,
            errorRate: Math.round(errorRate * 1000) / 1000, // 소수점 3자리
            bottlenecks,
            errors: errorEntries.map(e => ({
                turn: e.turn,
                toolName: e.toolName,
                message: e.errorMessage,
            })),
            highErrorRate,
            toolStats,
        };

        // 분석 결과 로깅
        if (bottlenecks.length > 0) {
            logger.warn(
                `⚠️ 병목 감지: ${bottlenecks.map(b => `${b.toolName}(avg ${b.averageDurationMs}ms)`).join(', ')}`
            );
        }
        if (highErrorRate) {
            logger.warn(`⚠️ 높은 에러율: ${(errorRate * 100).toFixed(1)}% (${errorEntries.length}/${totalToolCalls})`);
        }
        logger.info(
            `📊 Trace 분석: ${totalToolCalls}회 도구호출, ${totalDurationMs}ms, 에러율 ${(errorRate * 100).toFixed(1)}%`
        );

        return analysis;
    }

    /** 수집된 트레이스 엔트리 목록 반환 (디버깅/테스트용) */
    getEntries(): readonly TraceEntry[] {
        return this.entries;
    }
}

/**
 * 도구 인자를 지정된 최대 길이로 요약합니다.
 */
function summarizeArgs(args: Record<string, unknown>): string {
    try {
        const str = JSON.stringify(args);
        if (str.length <= TRACE_ANALYZER.ARGS_SUMMARY_MAX_LENGTH) {
            return str;
        }
        return str.substring(0, TRACE_ANALYZER.ARGS_SUMMARY_MAX_LENGTH) + '...';
    } catch {
        return '{...}';
    }
}
