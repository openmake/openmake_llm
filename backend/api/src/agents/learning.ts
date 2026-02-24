/**
 * ============================================================
 * Agent Learning - RLHF 기반 에이전트 학습 및 피드백 시스템
 * ============================================================
 *
 * 사용자 피드백(1-5점 평점)을 수집하고, 에이전트별 품질 점수를 계산하며,
 * 실패 패턴 분석과 프롬프트 자동 최적화 제안 기능을 제공합니다.
 * 피드백은 인메모리 배열에 저장하며, DB에도 비동기로 영속화합니다.
 *
 * @module agents/learning
 * @description
 * - 피드백 수집: collectFeedback() - 1-5점 평점 + 코멘트 + 태그 (async, DB 저장 포함)
 * - 품질 점수: calculateQualityScore() - 평균 평점, 트렌드 분석, 강점/약점 파악
 * - 실패 패턴: analyzeFailurePatterns() - 저평가 피드백에서 공통 실패 유형 추출
 * - 프롬프트 최적화: suggestPromptImprovements() - 실패 패턴 기반 프롬프트 개선 제안
 * - 전체 통계: getOverallStats() - 에이전트 순위, 평균 평점 등
 *
 * @see agents/custom-builder.ts - 커스텀 에이전트 관리
 * @see routes/agents.routes.ts - 피드백 API 엔드포인트
 */

import crypto from 'node:crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentLearning');

/**
 * 에이전트 피드백 인터페이스
 */
interface AgentFeedback {
    feedbackId: string;
    agentId: string;
    userId?: string;
    rating: 1 | 2 | 3 | 4 | 5;
    comment?: string;
    query: string;
    response: string;
    timestamp: Date;
    tags?: string[];
}

/**
 * 실패 패턴 인터페이스
 */
interface FailurePattern {
    pattern: string;
    count: number;
    examples: string[];
    suggestedFix?: string;
}

/**
 * 에이전트 품질 점수 인터페이스
 */
interface AgentQualityScore {
    agentId: string;
    overallScore: number;
    avgRating: number;
    totalFeedbacks: number;
    recentTrend: 'improving' | 'stable' | 'declining';
    strengths: string[];
    weaknesses: string[];
}

/**
 * 프롬프트 개선 제안 인터페이스
 */
interface PromptImprovement {
    agentId: string;
    currentPrompt: string;
    suggestedAdditions: string[];
    suggestedRemovals: string[];
    reasoning: string;
}

/**
 * 에이전트 학습 시스템 클래스
 *
 * 싱글톤 패턴으로 getAgentLearningSystem()을 통해 접근합니다.
 * 피드백은 인메모리 배열에 저장하고 DB에도 비동기로 영속화합니다.
 *
 * @class AgentLearningSystem
 */
export class AgentLearningSystem {
    private feedbacks: AgentFeedback[] = [];

    constructor() {
        logger.info('에이전트 학습 시스템 초기화됨');
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    private getPool(): import('pg').Pool {
        const { getPool } = require('../data/models/unified-database') as { getPool: () => import('pg').Pool };
        return getPool();
    }

    /**
     * 피드백 수집 (async — DB 영속화 포함)
     * 로컬 배열에 즉시 저장하고 DB에도 비동기로 저장합니다.
     */
    async collectFeedback(params: {
        agentId: string;
        userId?: string;
        rating: 1 | 2 | 3 | 4 | 5;
        comment?: string;
        query: string;
        response: string;
        tags?: string[];
    }): Promise<AgentFeedback> {
        const feedbackId = `fb_${crypto.randomBytes(8).toString('hex')}`;
        const feedback: AgentFeedback = {
            feedbackId,
            ...params,
            timestamp: new Date()
        };

        // 로컬 배열에 즉시 저장
        this.feedbacks.push(feedback);

        // DB에 비동기 영속화 (실패해도 로컬은 유지)
        try {
            const pool = this.getPool();
            await pool.query(
                `INSERT INTO agent_feedback (id, agent_id, user_id, rating, comment, query, response, tags)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [
                    feedback.feedbackId,
                    feedback.agentId,
                    feedback.userId ?? null,
                    feedback.rating,
                    feedback.comment ?? null,
                    feedback.query,
                    feedback.response,
                    feedback.tags ? JSON.stringify(feedback.tags) : null,
                ]
            );
        } catch (error) {
            logger.error('피드백 DB 저장 실패 (로컬 배열은 유지됨):', error);
        }

        logger.info(`피드백 수집: ${params.agentId} (${params.rating}/5)`);
        return feedback;
    }

    /**
     * 에이전트 품질 점수 계산 (동기 — 인메모리 배열 기반)
     */
    calculateQualityScore(agentId: string): AgentQualityScore {
        const agentFeedbacks = this.feedbacks
            .filter(f => f.agentId === agentId)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        if (agentFeedbacks.length === 0) {
            return {
                agentId,
                overallScore: 50,
                avgRating: 0,
                totalFeedbacks: 0,
                recentTrend: 'stable',
                strengths: [],
                weaknesses: []
            };
        }

        const avgRating = agentFeedbacks.reduce((sum, feedback) => sum + feedback.rating, 0) / agentFeedbacks.length;
        const overallScore = Math.round(avgRating * 20);

        let recentTrend: 'improving' | 'stable' | 'declining' = 'stable';
        if (agentFeedbacks.length >= 10) {
            const recent = agentFeedbacks.slice(0, 5).reduce((sum, f) => sum + f.rating, 0) / 5;
            const previous = agentFeedbacks.slice(5, 10).reduce((sum, f) => sum + f.rating, 0) / 5;

            if (recent > previous + 0.3) {
                recentTrend = 'improving';
            } else if (recent < previous - 0.3) {
                recentTrend = 'declining';
            }
        }

        const strengths: string[] = [];
        const weaknesses: string[] = [];
        const tagCounts: Map<string, { good: number; bad: number }> = new Map();

        for (const feedback of agentFeedbacks) {
            if (!feedback.tags) {
                continue;
            }

            for (const tag of feedback.tags) {
                const current = tagCounts.get(tag) || { good: 0, bad: 0 };
                if (feedback.rating >= 4) {
                    current.good++;
                } else if (feedback.rating <= 2) {
                    current.bad++;
                }
                tagCounts.set(tag, current);
            }
        }

        for (const [tag, counts] of tagCounts.entries()) {
            if (counts.good > counts.bad * 2) {
                strengths.push(tag);
            } else if (counts.bad > counts.good * 2) {
                weaknesses.push(tag);
            }
        }

        return {
            agentId,
            overallScore,
            avgRating: Math.round(avgRating * 10) / 10,
            totalFeedbacks: agentFeedbacks.length,
            recentTrend,
            strengths,
            weaknesses
        };
    }

    /**
     * 실패 패턴 분석 (동기 — 인메모리 배열 기반)
     */
    analyzeFailurePatterns(agentId: string): FailurePattern[] {
        const lowRatedFeedbacks = this.feedbacks.filter(
            f => f.agentId === agentId && f.rating <= 2
        );

        if (lowRatedFeedbacks.length === 0) {
            return [];
        }

        const patterns: Map<string, { count: number; examples: string[] }> = new Map();
        const patternTypes = [
            { pattern: '정보 부족', keywords: ['모르', '없', '정보', '부족'] },
            { pattern: '잘못된 응답', keywords: ['틀리', '오류', '잘못', '아님'] },
            { pattern: '느린 응답', keywords: ['늦', '오래', '시간', '느림'] },
            { pattern: '불명확한 답변', keywords: ['명확', '이해', '모호', '불분명'] },
            { pattern: '관련성 부족', keywords: ['관련', '질문', '엉뚱', '다른'] }
        ];

        for (const feedback of lowRatedFeedbacks) {
            const combined = `${feedback.query} ${feedback.response} ${feedback.comment || ''}`.toLowerCase();

            for (const type of patternTypes) {
                if (!type.keywords.some(keyword => combined.includes(keyword))) {
                    continue;
                }

                const existing = patterns.get(type.pattern) || { count: 0, examples: [] };
                existing.count++;
                if (existing.examples.length < 3) {
                    existing.examples.push(feedback.query.substring(0, 100));
                }
                patterns.set(type.pattern, existing);
            }
        }

        return Array.from(patterns.entries())
            .map(([pattern, data]) => ({
                pattern,
                count: data.count,
                examples: data.examples
            }))
            .sort((a, b) => b.count - a.count);
    }

    /**
     * 프롬프트 자동 최적화 제안 (async — 내부에서 동기 메서드 호출)
     */
    suggestPromptImprovements(agentId: string, currentPrompt: string): PromptImprovement {
        const failurePatterns = this.analyzeFailurePatterns(agentId);
        const qualityScore = this.calculateQualityScore(agentId);

        const suggestedAdditions: string[] = [];
        const suggestedRemovals: string[] = [];
        let reasoning = '';

        for (const pattern of failurePatterns.slice(0, 3)) {
            switch (pattern.pattern) {
                case '정보 부족':
                    suggestedAdditions.push('사용자에게 추가 정보를 요청하거나 불확실한 경우 명시');
                    break;
                case '잘못된 응답':
                    suggestedAdditions.push('확실하지 않은 정보는 "추정" 또는 "확인 필요"로 표시');
                    break;
                case '느린 응답':
                    suggestedAdditions.push('복잡한 질문은 단계별로 나누어 응답');
                    break;
                case '불명확한 답변':
                    suggestedAdditions.push('구체적인 예시와 함께 설명');
                    break;
                case '관련성 부족':
                    suggestedAdditions.push('질문의 핵심을 먼저 파악하고 직접적으로 답변');
                    break;
                default:
                    break;
            }
        }

        for (const weakness of qualityScore.weaknesses) {
            if (!suggestedAdditions.some(suggestion => suggestion.includes(weakness))) {
                suggestedAdditions.push(`${weakness} 관련 지침 강화 필요`);
            }
        }

        if (failurePatterns.length > 0) {
            reasoning = `주요 실패 패턴: ${failurePatterns.map(p => p.pattern).join(', ')}. `;
        }
        if (qualityScore.recentTrend === 'declining') {
            reasoning += '최근 품질 하락 추세. ';
        }
        reasoning += `현재 품질 점수: ${qualityScore.overallScore}/100`;

        return {
            agentId,
            currentPrompt,
            suggestedAdditions,
            suggestedRemovals,
            reasoning
        };
    }

    /**
     * 에이전트별 피드백 조회 (동기 — 인메모리 배열 기반)
     */
    getFeedbacks(agentId?: string, limit: number = 50): AgentFeedback[] {
        const filtered = agentId
            ? this.feedbacks.filter(f => f.agentId === agentId)
            : [...this.feedbacks];

        return filtered
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
            .slice(0, limit);
    }

    /**
     * 전체 통계 조회 (동기 — 인메모리 배열 기반)
     */
    getOverallStats(): {
        totalFeedbacks: number;
        avgRating: number;
        topAgents: { agentId: string; score: number }[];
        worstAgents: { agentId: string; score: number }[];
    } {
        const totalFeedbacks = this.feedbacks.length;

        if (totalFeedbacks === 0) {
            return {
                totalFeedbacks: 0,
                avgRating: 0,
                topAgents: [],
                worstAgents: []
            };
        }

        const avgRating = this.feedbacks.reduce((sum, f) => sum + f.rating, 0) / totalFeedbacks;

        // 에이전트별 평균 점수 계산
        const agentMap: Map<string, number[]> = new Map();
        for (const f of this.feedbacks) {
            const ratings = agentMap.get(f.agentId) || [];
            ratings.push(f.rating);
            agentMap.set(f.agentId, ratings);
        }

        const agentScores = Array.from(agentMap.entries())
            .map(([agentId, ratings]) => ({
                agentId,
                score: Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 20)
            }))
            .sort((a, b) => b.score - a.score);

        return {
            totalFeedbacks,
            avgRating: Math.round(avgRating * 10) / 10,
            topAgents: agentScores.slice(0, 5),
            worstAgents: [...agentScores].reverse().slice(0, 5)
        };
    }
}

// 싱글톤 인스턴스
let learningSystemInstance: AgentLearningSystem | null = null;

/**
 * AgentLearningSystem 싱글톤 인스턴스를 반환합니다.
 *
 * @returns AgentLearningSystem 싱글톤 인스턴스
 */
export function getAgentLearningSystem(): AgentLearningSystem {
    if (!learningSystemInstance) {
        learningSystemInstance = new AgentLearningSystem();
    }
    return learningSystemInstance;
}
