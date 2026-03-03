/**
 * ============================================================
 * 의도 기반 토픽 분류 시스템
 * ============================================================
 *
 * 일상 언어의 질문을 전문 에이전트로 매핑하기 위한
 * 토픽 카테고리 정의 및 의도 분석 기능을 제공한다.
 *
 * @module agents/topic-analyzer
 */

// ========================================
// 🆕 의도 기반 토픽 분류 시스템
// ========================================

/**
 * 토픽 카테고리 정의 인터페이스
 *
 * 일상 언어의 질문을 전문 에이전트로 매핑하기 위한 카테고리 구조.
 * 정규식 패턴으로 질문을 분류하고, 관련 에이전트 ID 목록을 제공한다.
 *
 * @interface TopicCategory
 */
export interface TopicCategory {
    /** 카테고리 표시 이름 (예: '프로그래밍/개발', '금융/투자') */
    name: string;
    /** 질문 매칭용 정규식 패턴 배열 (하나라도 매칭되면 해당 카테고리) */
    patterns: RegExp[];
    /** 이 카테고리에 속하는 에이전트 ID 목록 */
    relatedAgents: string[];
    /** 카테고리 확장 검색용 키워드 */
    expansionKeywords: string[];
    /** 제외 패턴: 이 패턴이 매칭되면 해당 카테고리 점수를 차감 (오분류 방지) */
    excludePatterns?: RegExp[];
}

/**
 * 일상 언어 -> 전문 에이전트 매핑 테이블
 *
 * 8개 도메인 카테고리별로 정규식 패턴과 관련 에이전트를 정의한다.
 * 각 카테고리는 여러 정규식 패턴을 가지며, 매칭된 패턴 수가
 * 많을수록 해당 카테고리의 관련성이 높다고 판단한다.
 *
 * 카테고리 목록:
 * - 프로그래밍/개발: 앱, 코딩, API, 서버, 프레임워크 관련
 * - 비즈니스/창업: 사업, 마케팅, 전략, 경영 관련
 * - 금융/투자: 주식, 부동산, 세금, 자산관리 관련
 * - 법률/계약: 소송, 계약서, 저작권, 규제 관련
 * - 의료/건강: 진료, 증상, 다이어트, 정신건강 관련
 * - 교육/학습: 공부, 시험, 자격증, 면접 관련
 * - 디자인/크리에이티브: UI/UX, 영상, 글쓰기, 디자인 도구 관련
 * - 데이터/AI: 분석, 머신러닝, 자동화, 예측 관련
 */
export const TOPIC_CATEGORIES: TopicCategory[] = [
    {
        name: '프로그래밍/개발',
        patterns: [
            // C1 수정: '개발'을 복합 패턴으로 교체하여 '사업 개발' 등과 분리
            /앱|어플|애플리케이션|홈페이지|웹사이트|웹페이지|사이트|코드|코딩|프로그램|버그|오류|에러|개발자/i,
            /소프트웨어\s*개발|앱\s*개발|웹\s*개발|시스템\s*개발|프로그램\s*개발|프론트\s*개발|백엔드\s*개발|서버\s*개발|게임\s*개발/i,
            // C2 수정: '만들어'를 제거하고 명확한 프로그래밍 동사만 유지
            /개발해|구현해|짜줘|코딩해/i,
            /api|서버|데이터베이스|db|백엔드|프론트|클라이언트/i,
            /자바|파이썬|python|javascript|타입스크립트|리액트|react|vue|앵귈러|노드|node/i,
            /크롤러|크롤링|스크래핑|봇|함수|클래스|변수/i
        ],
        // C4 수정: 비즈니스 컨텍스트가 감지되면 점수 차감
        excludePatterns: [
            /사업\s*개발|비즈니스\s*개발|사업을\s*개발|상품\s*개발|서비스\s*개발/i,
            /창업|사업계획|경영|마케팅|투자자|스타트업|매출|수익/i
        ],
        relatedAgents: ['software-engineer', 'frontend-developer', 'backend-developer', 'devops-engineer', 'mobile-developer'],
        expansionKeywords: ['코딩', 'API', '서버', '데이터베이스', '프로그래밍']
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
 * 의도 기반 토픽 분석 (점수 기반 우선순위)
 *
 * 사용자 메시지를 TOPIC_CATEGORIES의 정규식 패턴과 대조하여
 * 매칭되는 카테고리와 관련 에이전트를 추출한다.
 *
 * 점수 계산 알고리즘:
 * - 각 카테고리의 패턴 중 매칭된 수를 점수로 사용
 * - 점수가 높은 카테고리 순으로 정렬
 * - 최고 점수 카테고리의 에이전트만 suggestedAgents에 포함
 * - confidence = min(총 매칭 수 / 3, 1.0)
 *
 * @param message - 분석할 사용자 메시지
 * @returns 매칭된 카테고리명, 추천 에이전트 ID, 신뢰도를 포함한 분석 결과
 */
export function analyzeTopicIntent(message: string): {
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
            // C4 수정: 제외 패턴이 매칭되면 점수 차감
            let excludePenalty = 0;
            if (category.excludePatterns) {
                for (const excludePattern of category.excludePatterns) {
                    if (excludePattern.test(message)) {
                        excludePenalty++;
                    }
                }
            }

            // 제외 패널티를 적용한 최종 점수 (최소 0)
            const adjustedScore = Math.max(0, matchCount - excludePenalty);
            if (adjustedScore > 0) {
                categoryScores.push({ category, score: adjustedScore, matchCount: adjustedScore });
            }
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
