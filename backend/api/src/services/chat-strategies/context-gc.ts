/**
 * ============================================================
 * Context GC — 컨텍스트 윈도우 가비지 컬렉션
 * ============================================================
 *
 * Harness Engineering 원칙 (Constrain):
 * 에이전트 루프 실행 중 컨텍스트 윈도우 압력을 모니터링하고,
 * 압력 수준에 따라 적응형으로 불필요한 메시지를 정리합니다.
 *
 * 정리 전략:
 * - normal: 정리 없음
 * - warning: 오래된 assistant 중간 메시지 압축
 * - critical: warning + 오래된 tool 결과 제거 + assistant 공격적 압축
 *
 * @module services/chat-strategies/context-gc
 */

import { CONTEXT_GC } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ContextGC');

// ============================================
// 타입 정의
// ============================================

/** 컨텍스트 압력 수준 */
export type ContextPressureLevel = 'normal' | 'warning' | 'critical';

/** GC 실행 결과 메트릭 */
export interface GCResult {
    /** 정리 전 총 문자 수 */
    charsBefore: number;
    /** 정리 후 총 문자 수 */
    charsAfter: number;
    /** 압축률 (0.0~1.0, 높을수록 많이 압축됨) */
    compressionRatio: number;
    /** 정리된 메시지 수 */
    messagesCompacted: number;
    /** 삭제된 메시지 수 */
    messagesRemoved: number;
    /** 감지된 압력 수준 */
    pressureLevel: ContextPressureLevel;
}

/** 히스토리 메시지 타입 (AgentLoop에서 사용하는 형태) */
interface HistoryMessage {
    role: string;
    content?: string;
    tool_name?: string;
}

// ============================================
// ContextGC 클래스
// ============================================

/**
 * 컨텍스트 윈도우 가비지 컬렉션을 수행합니다.
 *
 * 사용법:
 * ```
 * const gc = new ContextGC();
 * const result = gc.run(context.currentHistory);
 * ```
 */
export class ContextGC {
    private totalGCRuns = 0;
    private totalCharsFreed = 0;

    /**
     * 현재 히스토리의 컨텍스트 압력 수준을 측정합니다.
     */
    measurePressure(history: HistoryMessage[]): { level: ContextPressureLevel; usage: number; totalChars: number } {
        const totalChars = measureTotalChars(history);
        const usage = totalChars / CONTEXT_GC.MAX_CONTEXT_CHARS;

        let level: ContextPressureLevel;
        if (usage > CONTEXT_GC.CRITICAL_THRESHOLD) {
            level = 'critical';
        } else if (usage > CONTEXT_GC.WARNING_THRESHOLD) {
            level = 'warning';
        } else {
            level = 'normal';
        }

        return { level, usage, totalChars };
    }

    /**
     * 압력 수준에 따라 적응형 GC를 실행합니다.
     *
     * @param history - 현재 대화 히스토리 (in-place 수정)
     * @returns GC 실행 결과 메트릭
     */
    run(history: HistoryMessage[]): GCResult {
        const { level, totalChars: charsBefore } = this.measurePressure(history);

        if (level === 'normal') {
            return {
                charsBefore,
                charsAfter: charsBefore,
                compressionRatio: 0,
                messagesCompacted: 0,
                messagesRemoved: 0,
                pressureLevel: 'normal',
            };
        }

        const protectedCount = CONTEXT_GC.PROTECTED_RECENT_COUNT;
        let messagesCompacted = 0;
        let messagesRemoved = 0;

        // 보호 대상: system(첫 메시지) + 최근 N개 메시지
        const protectedStart = 1; // system 메시지 이후부터
        const protectedEnd = Math.max(protectedStart, history.length - protectedCount);

        // Warning 수준: assistant 중간 메시지 압축
        for (let i = protectedStart; i < protectedEnd; i++) {
            const msg = history[i];

            if (msg.role === 'assistant' && msg.content) {
                const contentLen = msg.content.length;
                if (contentLen > CONTEXT_GC.ASSISTANT_COMPACT_MAX_CHARS) {
                    const maxChars = level === 'critical'
                        ? Math.floor(CONTEXT_GC.ASSISTANT_COMPACT_MAX_CHARS / 2)
                        : CONTEXT_GC.ASSISTANT_COMPACT_MAX_CHARS;
                    msg.content = msg.content.substring(0, maxChars) + '...[compacted]';
                    messagesCompacted++;
                }
            }
        }

        // Critical 수준: 추가로 오래된 tool 결과 메시지 대폭 축소
        // 역방향 순회로 splice 안전성 확보 (앞→뒤 순회 시 보호 영역 침범 버그 방지)
        if (level === 'critical') {
            for (let i = protectedEnd - 1; i >= protectedStart; i--) {
                const msg = history[i];

                if (msg.role === 'tool' && msg.content) {
                    if (msg.content.length > CONTEXT_GC.TOOL_COMPACT_MIN_CHARS) {
                        const toolName = msg.tool_name || 'tool';
                        msg.content = `[GC] ${toolName}: (${msg.content.length}자 결과 압축됨)`;
                        messagesCompacted++;
                    }
                }

                // user 역할 중 [System Notice]는 제거 가능
                if (msg.role === 'user' && msg.content?.startsWith('[System Notice]')) {
                    history.splice(i, 1);
                    messagesRemoved++;
                }
            }
        }

        const charsAfter = measureTotalChars(history);
        const compressionRatio = charsBefore > 0
            ? Math.round((1 - charsAfter / charsBefore) * 1000) / 1000
            : 0;

        this.totalGCRuns++;
        this.totalCharsFreed += (charsBefore - charsAfter);

        if (messagesCompacted > 0 || messagesRemoved > 0) {
            logger.info(
                `🗑️ Context GC (${level}): ${charsBefore}→${charsAfter}자, ` +
                `압축=${messagesCompacted}개, 삭제=${messagesRemoved}개, 압축률=${(compressionRatio * 100).toFixed(1)}%`
            );
        }

        return {
            charsBefore,
            charsAfter,
            compressionRatio,
            messagesCompacted,
            messagesRemoved,
            pressureLevel: level,
        };
    }

    /** 누적 GC 통계 */
    getStats(): { totalRuns: number; totalCharsFreed: number } {
        return { totalRuns: this.totalGCRuns, totalCharsFreed: this.totalCharsFreed };
    }
}

/**
 * 히스토리의 총 문자 수를 측정합니다.
 */
function measureTotalChars(history: HistoryMessage[]): number {
    let total = 0;
    for (const msg of history) {
        if (msg.content) {
            total += msg.content.length;
        }
    }
    return total;
}
