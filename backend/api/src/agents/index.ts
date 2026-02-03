/**
 * Agent System - Main Entry Point
 * 96개 산업별 에이전트 라우터 및 시스템 프롬프트 생성
 * 🆕 의도 기반 스마트 라우팅 추가
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    Agent,
    AgentCategory,
    AgentSelection,
    AgentPhase,
    IndustryAgentsData,
    getIndustryAgentsData,
    findAgentById,
    getAgentsByCategory
} from './types';
import { getAgentMonitor, AgentMonitor } from './monitor';
import { routeWithLLM, isValidAgentId } from './llm-router';

// Re-export types and monitor
export * from './types';
export { getAgentMonitor, AgentMonitor } from './monitor';

// ========================================
// AGENTS 상수 (하위 호환성)
// ========================================

const industryData = getIndustryAgentsData();

// 플랫 에이전트 맵 생성 (id -> Agent)
export const AGENTS: Record<string, Agent> = {};

for (const [categoryId, category] of Object.entries(industryData)) {
    for (const agent of category.agents) {
        AGENTS[agent.id] = {
            ...agent,
            emoji: category.icon,
            category: categoryId
        };
    }
}

// 기본 에이전트 추가 (기존 코드 호환성)
AGENTS['general'] = {
    id: 'general',
    name: '범용 AI 어시스턴트',
    description: '다양한 질문에 도움을 드리는 범용 AI',
    keywords: [],
    emoji: '🤖',
    category: 'general'
};

// ========================================
// 🆕 의도 기반 토픽 분류 시스템
// ========================================

interface TopicCategory {
    name: string;
    patterns: RegExp[];
    relatedAgents: string[];
    expansionKeywords: string[];
}

// 일상 언어 → 전문 에이전트 매핑 (확장됨 + 실제 에이전트 ID 수정)
const TOPIC_CATEGORIES: TopicCategory[] = [
    {
        name: '프로그래밍/개발',
        patterns: [
            /앱|어플|애플리케이션|홈페이지|웹사이트|웹페이지|사이트|코드|코딩|프로그램|개발|버그|오류|에러/i,
            /만들어|개발해|구현해|짜줘|코딩해/i,
            /api|서버|데이터베이스|db|백엔드|프론트|클라이언트/i,
            /자바|파이썬|python|javascript|타입스크립트|리액트|react|vue|앵귤러|노드|node/i,
            /크롤러|크롤링|스크래핑|자동화|봇|함수|클래스|변수/i
        ],
        // 실제 ID: software-engineer, frontend-developer, backend-developer, devops-engineer, mobile-developer
        relatedAgents: ['software-engineer', 'frontend-developer', 'backend-developer', 'devops-engineer', 'mobile-developer'],
        expansionKeywords: ['개발', '코딩', 'API', '서버', '데이터베이스', '프로그래밍']
    },
    {
        name: '비즈니스/창업',
        patterns: [
            /사업|창업|스타트업|회사|기업|비즈니스|매출|수익|투자자/i,
            /마케팅|홍보|광고|브랜드|판매|고객|시장|영업/i,
            /전략|사업계획|경쟁|성장|확장|비용절감/i,
            /직원|채용|인사|조직|팀|리더십|경영/i
        ],
        // 실제 ID: business-strategist, marketing-manager, startup-advisor, product-manager, hr-manager
        relatedAgents: ['business-strategist', 'marketing-manager', 'startup-advisor', 'product-manager', 'hr-manager'],
        expansionKeywords: ['비즈니스', '전략', '마케팅', '투자', '성장']
    },
    {
        name: '금융/투자',
        patterns: [
            /돈|자금|투자|주식|코인|암호화폐|가상화폐|부동산|펀드/i,
            /대출|이자|금리|예금|적금|보험|연금|세금/i,
            /재테크|자산|포트폴리오|수익률|배당|환율|주가/i,
            /은행|증권|카드|신용|저축|급여|월급/i
        ],
        // 실제 ID: financial-analyst, investment-banker, accountant, risk-manager, tax-advisor, portfolio-manager
        relatedAgents: ['financial-analyst', 'investment-banker', 'accountant', 'risk-manager', 'tax-advisor'],
        expansionKeywords: ['투자', '금융', '자산', '수익', '리스크']
    },
    {
        name: '법률/계약',
        patterns: [
            /법률|법적|소송|재판|변호사|판사|검사|법원/i,
            /계약서|계약|합의서|약관|조항|서명|인감/i,
            /저작권|특허|상표|지식재산|지적재산|라이선스/i,
            /규제|규정|준수|컴플라이언스|개인정보|GDPR|분쟁|손해배상/i,
            /고소|고발|형사|민사|합의금|위약금|배상/i
        ],
        // 실제 ID: corporate-lawyer, criminal-lawyer, patent-attorney, labor-lawyer, compliance-officer
        relatedAgents: ['corporate-lawyer', 'criminal-lawyer', 'patent-attorney', 'labor-lawyer', 'compliance-officer'],
        expansionKeywords: ['법률', '계약', '규정', '권리', '의무']
    },
    {
        name: '의료/건강',
        patterns: [
            /건강|병원|의사|진료|진단|치료|수술|입원/i,
            /두통|복통|요통|허리|어깨|목|관절|근육|통증|아프|아파/i,
            /감기|열|기침|콧물|소화|위장|설사|변비|피부|발진/i,
            /다이어트|운동|헬스|피트니스|체중|살빼기|근력/i,
            /정신|심리|우울|불안|스트레스|멘탈|상담|트라우마/i,
            /영양|비타민|보충제|식이요법|수면|불면|피로/i
        ],
        // 실제 ID: physician, pharmacist, nurse, medical-researcher, psychologist, nutritionist
        relatedAgents: ['physician', 'pharmacist', 'nurse', 'psychologist', 'nutritionist'],
        expansionKeywords: ['건강', '치료', '예방', '생활습관', '웰빙']
    },
    {
        name: '교육/학습',
        patterns: [
            /공부|학습|교육|배우|가르|시험|수업|강의/i,
            /학교|대학|입시|취업|자격증|인증|졸업/i,
            /영어|수학|과학|역사|언어|문법|단어/i,
            /토익|토플|자격시험|면접|이력서|포트폴리오/i
        ],
        // 실제 ID: educator, curriculum-designer, educational-technologist, academic-advisor
        relatedAgents: ['educator', 'curriculum-designer', 'educational-technologist', 'academic-advisor'],
        expansionKeywords: ['학습', '교육', '역량', '성장', '개발']
    },
    {
        name: '디자인/크리에이티브',
        patterns: [
            /디자인|그래픽|로고|브랜딩|UI|UX|인터페이스|포스터/i,
            /영상|동영상|유튜브|편집|촬영|콘텐츠|썸네일/i,
            /글쓰기|작문|카피|기획|아이디어|스토리|시나리오/i,
            /포토샵|일러스트|피그마|figma|캔바|canva/i
        ],
        // 실제 ID: ui-ux-designer, graphic-designer, content-writer, video-producer, copywriter
        relatedAgents: ['ui-ux-designer', 'graphic-designer', 'content-writer', 'video-producer', 'copywriter'],
        expansionKeywords: ['디자인', '창작', '시각', '콘텐츠', '브랜드']
    },
    {
        name: '데이터/AI',
        patterns: [
            /데이터|분석|통계|차트|그래프|대시보드|엑셀|스프레드시트/i,
            /AI|인공지능|머신러닝|딥러닝|모델|신경망|GPT|LLM/i,
            /자동화|봇|챗봇|RPA|효율|최적화|예측/i
        ],
        // 실제 ID: ai-ml-engineer, data-analyst, quantitative-analyst
        relatedAgents: ['ai-ml-engineer', 'data-analyst', 'quantitative-analyst', 'research-scientist'],
        expansionKeywords: ['데이터', 'AI', '분석', '예측', '자동화']
    }
];

/**
 * 🆕 의도 기반 토픽 분석 (개선됨 - 점수 기반 우선순위)
 */
function analyzeTopicIntent(message: string): {
    matchedCategories: string[];
    suggestedAgents: string[];
    confidence: number;
} {
    // 카테고리별 점수 계산
    const categoryScores: { category: TopicCategory; score: number; matchCount: number }[] = [];

    for (const category of TOPIC_CATEGORIES) {
        let matchCount = 0;
        for (const pattern of category.patterns) {
            if (pattern.test(message)) {
                matchCount++;
            }
        }

        if (matchCount > 0) {
            // 점수 = 매칭된 패턴 수 (더 많은 패턴이 매칭되면 더 관련성 높음)
            categoryScores.push({ category, score: matchCount, matchCount });
        }
    }

    // 점수순 정렬 (내림차순)
    categoryScores.sort((a, b) => b.score - a.score);

    const matchedCategories: string[] = [];
    const suggestedAgentsSet = new Set<string>();
    let totalMatches = 0;

    for (const { category, matchCount } of categoryScores) {
        matchedCategories.push(category.name);
        totalMatches += matchCount;

        // 가장 높은 점수의 카테고리 에이전트만 먼저 추가
        if (suggestedAgentsSet.size === 0) {
            for (const agentId of category.relatedAgents) {
                suggestedAgentsSet.add(agentId);
            }
        }
    }

    return {
        matchedCategories,
        suggestedAgents: Array.from(suggestedAgentsSet),
        confidence: Math.min(totalMatches / 3, 1.0)
    };
}

// ========================================
// 에이전트 라우팅 (개선됨)
// ========================================

/**
 * 메시지를 분석하여 가장 적합한 에이전트 선택
 * 🆕 LLM 기반 의미론적 라우팅 + 키워드 폴백
 */
export async function routeToAgent(message: string, useLLM: boolean = true): Promise<AgentSelection> {
    const lowerMessage = message.toLowerCase();
    const words = lowerMessage.split(/\s+/);

    // 디버그: AGENTS 맵 상태 확인
    const agentCount = Object.keys(AGENTS).length;
    const categoryCount = Object.keys(industryData).length;
    console.log(`[Agent Router] 메시지: "${message.substring(0, 50)}..." | 등록된 에이전트: ${agentCount}개, 카테고리: ${categoryCount}개`);

    // 🆕 LLM 기반 라우팅 시도 (우선순위 1) - 개선됨: 신뢰도 조건 완화
    if (useLLM) {
        try {
            const llmResult = await routeWithLLM(message, 10000); // 타임아웃 10초로 증가
            if (llmResult && llmResult.confidence > 0.3 && isValidAgentId(llmResult.agentId)) {
                const agent = getAgentById(llmResult.agentId);
                if (agent) {
                    console.log(`[Agent Router] ✅ LLM 라우팅 성공: ${agent.name} (신뢰도: ${llmResult.confidence})`);
                    return {
                        primaryAgent: agent.id,
                        category: agent.category || 'general',
                        phase: detectPhase(message),
                        reason: `${agent.name} - LLM 분석: ${llmResult.reasoning}`,
                        confidence: llmResult.confidence,
                        matchedKeywords: []
                    };
                }
            }
        } catch (error) {
            console.log('[Agent Router] LLM 라우팅 실패, 키워드 폴백 사용');
        }
    }

    // 🆕 1단계: 의도 기반 토픽 분석
    const topicAnalysis = analyzeTopicIntent(message);
    console.log(`[Agent Router] 토픽 분석: ${topicAnalysis.matchedCategories.join(', ') || '없음'} (신뢰도: ${topicAnalysis.confidence})`);

    let bestMatch: AgentSelection = {
        primaryAgent: 'general',
        category: 'general',
        phase: 'planning',
        reason: '기본 범용 에이전트',
        confidence: 0.3,
        matchedKeywords: []
    };

    let highestScore = 0;

    // 🆕 의도 분석 결과로 우선 검색
    if (topicAnalysis.suggestedAgents.length > 0) {
        const intentAgent = getAgentById(topicAnalysis.suggestedAgents[0]);
        if (intentAgent) {
            highestScore = 5; // 의도 매칭 기본 점수
            bestMatch = {
                primaryAgent: intentAgent.id,
                category: intentAgent.category || 'general',
                phase: detectPhase(message),
                reason: `${intentAgent.name} - ${topicAnalysis.matchedCategories[0]} 토픽 매칭`,
                confidence: Math.max(0.5, topicAnalysis.confidence),
                matchedKeywords: topicAnalysis.matchedCategories
            };
        }
    }

    // 2단계: 키워드 기반 정밀 매칭 (더 높은 점수 시 덮어씀)
    for (const [categoryId, category] of Object.entries(industryData)) {
        for (const agent of category.agents) {
            let score = 0;
            const matchedKeywords: string[] = [];

            // 키워드 매칭 (🆕 최소 길이 체크로 오매칭 방지)
            for (const keyword of agent.keywords) {
                const keywordLower = keyword.toLowerCase();

                // 2글자 이하 키워드는 단어 완전 일치만 허용 (오매칭 방지)
                if (keywordLower.length <= 2) {
                    if (words.includes(keywordLower)) {
                        score += 3;
                        matchedKeywords.push(keyword);
                    }
                } else {
                    // 3글자 이상은 부분 일치 허용
                    if (lowerMessage.includes(keywordLower)) {
                        score += 2;
                        matchedKeywords.push(keyword);
                    }
                    // 단어 완전 일치 보너스
                    if (words.includes(keywordLower)) {
                        score += 1;
                    }
                }
            }

            // 에이전트 이름 포함 시 보너스
            if (lowerMessage.includes(agent.name.toLowerCase())) {
                score += 3;
                matchedKeywords.push(agent.name);
            }

            // 에이전트 ID 포함 시 보너스
            if (lowerMessage.includes(agent.id.replace(/-/g, ' '))) {
                score += 2;
            }

            if (score > highestScore) {
                highestScore = score;
                bestMatch = {
                    primaryAgent: agent.id,
                    category: categoryId,
                    phase: detectPhase(message),
                    reason: `${agent.name} - ${matchedKeywords.slice(0, 3).join(', ')} 키워드 매칭`,
                    confidence: Math.min(score / 10, 1.0),
                    matchedKeywords
                };
            }
        }
    }

    // 디버그: 최종 선택 결과
    console.log(`[Agent Router] 선택: ${bestMatch.primaryAgent} (점수: ${highestScore}, 신뢰도: ${bestMatch.confidence})`);
    if (bestMatch.matchedKeywords && bestMatch.matchedKeywords.length > 0) {
        console.log(`[Agent Router] 매칭 키워드: ${bestMatch.matchedKeywords.join(', ')}`);
    }

    return bestMatch;
}

/**
 * 🆕 토론용 관련 에이전트 추천 (개선됨: LLM 기반 + 컨텍스트 반영)
 * @param message 사용자 메시지
 * @param count 최대 에이전트 수
 * @param context 추가 컨텍스트 (문서 내용 등)
 */
export async function getRelatedAgentsForDiscussion(
    message: string,
    count: number = 10,
    context?: string
): Promise<Agent[]> {
    // 🆕 전체 분석 대상 텍스트 (메시지 + 컨텍스트)
    const fullText = context ? `${message}\n\n컨텍스트: ${context}` : message;

    const topicAnalysis = analyzeTopicIntent(fullText);

    // 🆕 LLM 기반 라우팅 사용 (정확도 향상)
    const selection = await routeToAgent(fullText, true);

    const result: Agent[] = [];
    const usedIds = new Set<string>();

    // 1. 주요 에이전트 추가 (LLM 선택 우선)
    const primaryAgent = getAgentById(selection.primaryAgent);
    if (primaryAgent && primaryAgent.id !== 'general') {
        result.push(primaryAgent);
        usedIds.add(primaryAgent.id);
    }

    // 2. 의도 분석 기반 에이전트 추가
    for (const agentId of topicAnalysis.suggestedAgents) {
        if (usedIds.has(agentId)) continue;
        const agent = getAgentById(agentId);
        if (agent) {
            result.push(agent);
            usedIds.add(agentId);
        }
    }

    // 3. 같은 카테고리의 다른 에이전트 추가
    if (selection.category && selection.category !== 'general') {
        const categoryData = industryData[selection.category];
        if (categoryData) {
            for (const agent of categoryData.agents) {
                if (usedIds.has(agent.id)) continue;
                result.push({
                    ...agent,
                    emoji: categoryData.icon,
                    category: selection.category
                });
                usedIds.add(agent.id);
            }
        }
    }

    // 🆕 4. 보완적 에이전트 - 기술적 질문에는 기술 에이전트만, 비즈니스 질문에는 비즈니스 에이전트만
    const techCategories = ['프로그래밍/개발', '데이터/AI'];
    const businessCategories = ['비즈니스/창업', '금융/투자'];

    const isTechQuestion = topicAnalysis.matchedCategories.some(c => techCategories.includes(c));
    const isBusinessQuestion = topicAnalysis.matchedCategories.some(c => businessCategories.includes(c));

    // 🆕 기술적 질문이면 기술 보완 에이전트만
    if (isTechQuestion && !isBusinessQuestion) {
        const techComplementary = ['software-engineer', 'devops-engineer', 'ai-ml-engineer', 'data-analyst'];
        for (const agentId of techComplementary) {
            if (usedIds.has(agentId)) continue;
            const agent = getAgentById(agentId);
            if (agent) {
                result.push(agent);
                usedIds.add(agentId);
            }
        }
    }
    // 🆕 비즈니스 질문이면 비즈니스 보완 에이전트만
    else if (isBusinessQuestion && !isTechQuestion) {
        const businessComplementary = ['business-strategist', 'financial-analyst', 'risk-manager', 'project-manager'];
        for (const agentId of businessComplementary) {
            if (usedIds.has(agentId)) continue;
            const agent = getAgentById(agentId);
            if (agent) {
                result.push(agent);
                usedIds.add(agentId);
            }
        }
    }
    // 🆕 혼합 질문 또는 카테고리 미분류 시에만 다양한 관점 추가
    else if (result.length < 3) {
        const diverseAgents = ['business-strategist', 'data-analyst', 'project-manager'];
        for (const agentId of diverseAgents) {
            if (usedIds.has(agentId)) continue;
            const agent = getAgentById(agentId);
            if (agent) {
                result.push(agent);
                usedIds.add(agentId);
            }
            if (result.length >= 5) break;
        }
    }

    // 최종적으로 count 제한 적용 (count가 0이면 전체 반환)
    return count === 0 ? result : result.slice(0, count);
}

/**
 * 메시지에서 작업 페이즈 감지
 */
function detectPhase(message: string): AgentPhase {
    const lowerMessage = message.toLowerCase();

    // 기획/설계 관련 키워드
    const planningKeywords = ['설계', '계획', '기획', '분석', '조사', '검토', '평가', '전략', 'plan', 'design', 'analyze', '어떻게', '방법', '뭐가', '무엇'];
    if (planningKeywords.some(kw => lowerMessage.includes(kw))) {
        return 'planning';
    }

    // 구현/개발 관련 키워드
    const buildKeywords = ['구현', '개발', '코딩', '만들', '작성', '생성', 'implement', 'build', 'create', 'develop', '해줘', '해 줘'];
    if (buildKeywords.some(kw => lowerMessage.includes(kw))) {
        return 'build';
    }

    // 최적화/개선 관련 키워드
    const optimizationKeywords = ['최적화', '개선', '리팩토링', '성능', '효율', 'optimize', 'improve', 'refactor', '더 좋', '더좋'];
    if (optimizationKeywords.some(kw => lowerMessage.includes(kw))) {
        return 'optimization';
    }

    return 'planning';
}

// ========================================
// 시스템 프롬프트 생성
// ========================================

/**
 * 에이전트 선택 결과에 따른 시스템 프롬프트 생성
 */
export function getAgentSystemMessage(selection: AgentSelection): string {
    const agent = AGENTS[selection.primaryAgent];
    if (!agent) {
        return getDefaultSystemPrompt();
    }

    // 프롬프트 파일 로드 시도
    // 🆕 1. 카테고리별 하위 폴더 확인 (우선)
    let promptPath = '';

    if (agent.category) {
        const categoryPath = path.join(__dirname, 'prompts', agent.category, `${agent.id}.md`);
        if (fs.existsSync(categoryPath)) {
            promptPath = categoryPath;
        }
    }

    // 🆕 2. 루트 폴더 확인 (폴백 - 하위 호환성)
    if (!promptPath) {
        const rootPath = path.join(__dirname, 'prompts', `${agent.id}.md`);
        if (fs.existsSync(rootPath)) {
            promptPath = rootPath;
        }
    }

    let customPrompt = '';

    try {
        if (promptPath && fs.existsSync(promptPath)) {
            customPrompt = fs.readFileSync(promptPath, 'utf-8');
            console.log(`[Agent System] 프롬프트 로드 성공: ${agent.name} (${promptPath})`);
        }
    } catch (e) {
        console.warn(`[Agent System] 프롬프트 로드 실패: ${agent.name}`, e);
    }

    // 시스템 프롬프트 조합
    const basePrompt = `# ${agent.emoji} ${agent.name}

## 역할
당신은 **${agent.name}** 전문가입니다.
${agent.description}

## 전문 분야
${agent.keywords.map(k => `- ${k}`).join('\n')}

## 작업 페이즈
현재 **${getPhaseLabel(selection.phase)}** 단계에서 작업하고 있습니다.

## 응답 지침
1. 전문 분야에 맞는 정확하고 실용적인 답변을 제공합니다.
2. 구체적인 예시와 함께 설명합니다.
3. 필요한 경우 추가 질문을 통해 요구사항을 명확히 합니다.
4. 한국어로 친절하고 전문적으로 응답합니다.
`;

    if (customPrompt) {
        return `${basePrompt}\n\n## 상세 지침\n${customPrompt}`;
    }

    return basePrompt;
}

function getPhaseLabel(phase?: AgentPhase): string {
    const labels: Record<AgentPhase, string> = {
        planning: '기획/분석',
        build: '구현/개발',
        optimization: '최적화/개선'
    };
    return labels[phase || 'planning'];
}

function getDefaultSystemPrompt(): string {
    return `# 🤖 범용 AI 어시스턴트

당신은 다양한 분야의 질문에 도움을 줄 수 있는 범용 AI 어시스턴트입니다.

## 응답 지침
1. 정확하고 도움이 되는 답변을 제공합니다.
2. 모르는 내용은 솔직하게 인정합니다.
3. 한국어로 친절하게 응답합니다.
`;
}

// ========================================
// 유틸리티 함수
// ========================================

/**
 * 전체 에이전트 목록 반환
 */
export function getAllAgents(): Agent[] {
    return Object.values(AGENTS);
}

/**
 * 카테고리별 에이전트 목록 반환
 */
export function getAgentCategories(): Record<string, AgentCategory> {
    return industryData;
}

/**
 * 에이전트 ID로 에이전트 찾기
 */
export function getAgentById(agentId: string): Agent | null {
    return AGENTS[agentId] || null;
}

/**
 * 카테고리별 에이전트 수 통계
 */
export function getAgentStats(): { total: number; byCategory: Record<string, number> } {
    const byCategory: Record<string, number> = {};
    let total = 0;

    for (const [categoryId, category] of Object.entries(industryData)) {
        byCategory[categoryId] = category.agents.length;
        total += category.agents.length;
    }

    return { total, byCategory };
}
