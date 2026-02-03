/**
 * 🆕 에이전트 학습/피드백 시스템
 * 사용자 피드백 수집, 품질 점수 계산, 프롬프트 최적화 제안
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('AgentLearning');

// 피드백 인터페이스
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

// 실패 패턴 인터페이스
interface FailurePattern {
    pattern: string;
    count: number;
    examples: string[];
    suggestedFix?: string;
}

// 품질 점수 인터페이스
interface AgentQualityScore {
    agentId: string;
    overallScore: number;  // 0-100
    avgRating: number;     // 1-5
    totalFeedbacks: number;
    recentTrend: 'improving' | 'stable' | 'declining';
    strengths: string[];
    weaknesses: string[];
}

// 프롬프트 개선 제안
interface PromptImprovement {
    agentId: string;
    currentPrompt: string;
    suggestedAdditions: string[];
    suggestedRemovals: string[];
    reasoning: string;
}

/**
 * 에이전트 학습 시스템
 */
export class AgentLearningSystem {
    private feedbacks: AgentFeedback[] = [];
    private dataPath: string;

    constructor(dataDir: string = './data') {
        this.dataPath = path.join(dataDir, 'agent-feedback.json');
        this.loadFeedbacks();
        logger.info('에이전트 학습 시스템 초기화됨');
    }

    /**
     * 피드백 데이터 로드
     */
    private loadFeedbacks(): void {
        try {
            if (fs.existsSync(this.dataPath)) {
                const data = JSON.parse(fs.readFileSync(this.dataPath, 'utf-8'));
                this.feedbacks = data.feedbacks || [];
                logger.info(`피드백 ${this.feedbacks.length}개 로드됨`);
            }
        } catch (error) {
            logger.warn('피드백 데이터 로드 실패:', error);
            this.feedbacks = [];
        }
    }

    /**
     * 피드백 데이터 저장
     */
    private saveFeedbacks(): void {
        try {
            const dir = path.dirname(this.dataPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.dataPath, JSON.stringify({
                feedbacks: this.feedbacks,
                lastUpdated: new Date().toISOString()
            }, null, 2));
        } catch (error) {
            logger.error('피드백 저장 실패:', error);
        }
    }

    /**
     * 피드백 수집
     */
    collectFeedback(params: {
        agentId: string;
        userId?: string;
        rating: 1 | 2 | 3 | 4 | 5;
        comment?: string;
        query: string;
        response: string;
        tags?: string[];
    }): AgentFeedback {
        const feedback: AgentFeedback = {
            feedbackId: `fb_${Date.now()}_${Math.random().toString(36).substring(7)}`,
            ...params,
            timestamp: new Date()
        };

        this.feedbacks.push(feedback);
        this.saveFeedbacks();

        logger.info(`피드백 수집: ${params.agentId} (${params.rating}/5)`);
        return feedback;
    }

    /**
     * 에이전트 품질 점수 계산
     */
    calculateQualityScore(agentId: string): AgentQualityScore {
        const agentFeedbacks = this.feedbacks.filter(f => f.agentId === agentId);

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

        // 평균 평점 계산
        const avgRating = agentFeedbacks.reduce((sum, f) => sum + f.rating, 0) / agentFeedbacks.length;

        // 전체 점수 (100점 기준)
        const overallScore = Math.round(avgRating * 20);

        // 최근 트렌드 분석 (최근 10개 vs 이전 10개)
        const sorted = [...agentFeedbacks].sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );

        let recentTrend: 'improving' | 'stable' | 'declining' = 'stable';
        if (sorted.length >= 10) {
            const recent = sorted.slice(0, 5).reduce((sum, f) => sum + f.rating, 0) / 5;
            const previous = sorted.slice(5, 10).reduce((sum, f) => sum + f.rating, 0) / 5;

            if (recent > previous + 0.3) recentTrend = 'improving';
            else if (recent < previous - 0.3) recentTrend = 'declining';
        }

        // 강점/약점 분석 (태그 기반)
        const strengths: string[] = [];
        const weaknesses: string[] = [];

        const tagCounts: Map<string, { good: number; bad: number }> = new Map();
        for (const feedback of agentFeedbacks) {
            if (feedback.tags) {
                for (const tag of feedback.tags) {
                    const current = tagCounts.get(tag) || { good: 0, bad: 0 };
                    if (feedback.rating >= 4) current.good++;
                    else if (feedback.rating <= 2) current.bad++;
                    tagCounts.set(tag, current);
                }
            }
        }

        for (const [tag, counts] of tagCounts.entries()) {
            if (counts.good > counts.bad * 2) strengths.push(tag);
            else if (counts.bad > counts.good * 2) weaknesses.push(tag);
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
     * 실패 패턴 분석
     */
    analyzeFailurePatterns(agentId: string): FailurePattern[] {
        const lowRatedFeedbacks = this.feedbacks.filter(
            f => f.agentId === agentId && f.rating <= 2
        );

        if (lowRatedFeedbacks.length === 0) {
            return [];
        }

        // 간단한 패턴 분석 (실제로는 더 복잡한 NLP 필요)
        const patterns: Map<string, { count: number; examples: string[] }> = new Map();

        // 일반적인 실패 유형
        const patternTypes = [
            { pattern: '정보 부족', keywords: ['모르', '없', '정보', '부족'] },
            { pattern: '잘못된 응답', keywords: ['틀리', '오류', '잘못', '아님'] },
            { pattern: '느린 응답', keywords: ['늦', '오래', '시간', '느림'] },
            { pattern: '불명확한 답변', keywords: ['명확', '이해', '모호', '불분명'] },
            { pattern: '관련성 부족', keywords: ['관련', '질문', '엉뚱', '다른'] }
        ];

        for (const feedback of lowRatedFeedbacks) {
            const combined = (feedback.query + ' ' + feedback.response + ' ' + (feedback.comment || '')).toLowerCase();

            for (const type of patternTypes) {
                if (type.keywords.some(kw => combined.includes(kw))) {
                    const existing = patterns.get(type.pattern) || { count: 0, examples: [] };
                    existing.count++;
                    if (existing.examples.length < 3) {
                        existing.examples.push(feedback.query.substring(0, 100));
                    }
                    patterns.set(type.pattern, existing);
                }
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
     * 프롬프트 자동 최적화 제안
     */
    suggestPromptImprovements(agentId: string, currentPrompt: string): PromptImprovement {
        const failurePatterns = this.analyzeFailurePatterns(agentId);
        const qualityScore = this.calculateQualityScore(agentId);

        const suggestedAdditions: string[] = [];
        const suggestedRemovals: string[] = [];
        let reasoning = '';

        // 실패 패턴 기반 개선
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
            }
        }

        // 약점 기반 개선
        for (const weakness of qualityScore.weaknesses) {
            if (!suggestedAdditions.some(s => s.includes(weakness))) {
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
     * 에이전트별 피드백 조회
     */
    getFeedbacks(agentId?: string, limit: number = 50): AgentFeedback[] {
        let filtered = agentId
            ? this.feedbacks.filter(f => f.agentId === agentId)
            : this.feedbacks;

        return filtered
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);
    }

    /**
     * 전체 통계 조회
     */
    getOverallStats(): {
        totalFeedbacks: number;
        avgRating: number;
        topAgents: { agentId: string; score: number }[];
        worstAgents: { agentId: string; score: number }[];
    } {
        if (this.feedbacks.length === 0) {
            return {
                totalFeedbacks: 0,
                avgRating: 0,
                topAgents: [],
                worstAgents: []
            };
        }

        const avgRating = this.feedbacks.reduce((sum, f) => sum + f.rating, 0) / this.feedbacks.length;

        // 에이전트별 점수
        const agentIds = [...new Set(this.feedbacks.map(f => f.agentId))];
        const agentScores = agentIds.map(id => ({
            agentId: id,
            score: this.calculateQualityScore(id).overallScore
        })).sort((a, b) => b.score - a.score);

        return {
            totalFeedbacks: this.feedbacks.length,
            avgRating: Math.round(avgRating * 10) / 10,
            topAgents: agentScores.slice(0, 5),
            worstAgents: agentScores.slice(-5).reverse()
        };
    }
}

// 싱글톤 인스턴스
let learningSystemInstance: AgentLearningSystem | null = null;

export function getAgentLearningSystem(): AgentLearningSystem {
    if (!learningSystemInstance) {
        learningSystemInstance = new AgentLearningSystem();
    }
    return learningSystemInstance;
}
