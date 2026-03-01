#!/usr/bin/env bun
/**
 * ============================================================
 * Embedding A/B Test: 키워드 라우팅 vs 임베딩 시맨틱 라우팅
 * ============================================================
 *
 * 100개 한국어 테스트 쿼리에 대해:
 *   A) 현재 키워드 기반 라우팅 (topic-analyzer + keyword-router)
 *   B) nomic-embed-text 임베딩 코사인 유사도 라우팅
 * 을 비교하여 top-1/top-3 정확도, 레이턴시를 측정합니다.
 *
 * Usage: bun run backend/api/src/scripts/embedding-ab-test.ts
 */

import industryData from '../agents/industry-agents.json';
import { routeToAgent } from '../agents/keyword-router';

// ============================================================
// Types
// ============================================================

interface TestCase {
    query: string;
    /** 정답 에이전트 ID (복수 허용 = 어느 것이든 정답) */
    expectedAgents: string[];
    category: string;
    difficulty: 'easy' | 'medium' | 'hard';
}

interface AgentProfile {
    id: string;
    name: string;
    description: string;
    keywords: string[];
    category: string;
    profileText: string;
    embedding?: number[];
}

interface ABResult {
    query: string;
    expected: string[];
    category: string;
    difficulty: string;
    // Keyword system
    kwAgent: string;
    kwScore: number;
    kwCorrect: boolean;
    kwTop3Correct: boolean;
    kwLatencyMs: number;
    // Embedding system
    embAgent: string;
    embSimilarity: number;
    embCorrect: boolean;
    embTop3Correct: boolean;
    embLatencyMs: number;
    embTop3: string[];
}

// ============================================================
// 100 Test Queries (8 categories + edge cases)
// ============================================================

const TEST_CASES: TestCase[] = [
    // ── 프로그래밍/개발 (15) ──
    { query: '파이썬으로 REST API 만들어줘', expectedAgents: ['software-engineer', 'backend-developer'], category: '프로그래밍', difficulty: 'easy' },
    { query: 'React 컴포넌트에서 useState가 리렌더링을 계속 일으켜', expectedAgents: ['frontend-developer', 'software-engineer'], category: '프로그래밍', difficulty: 'easy' },
    { query: '이 코드 왜 안 돌아가는지 모르겠어', expectedAgents: ['software-engineer'], category: '프로그래밍', difficulty: 'hard' },
    { query: 'Docker 컨테이너가 자꾸 죽어', expectedAgents: ['devops-engineer', 'cloud-architect'], category: '프로그래밍', difficulty: 'easy' },
    { query: 'iOS 앱에서 푸시 알림 구현하려면', expectedAgents: ['mobile-developer'], category: '프로그래밍', difficulty: 'easy' },
    { query: '서버 응답이 너무 느린데 어떻게 최적화하지?', expectedAgents: ['backend-developer', 'software-engineer', 'devops-engineer'], category: '프로그래밍', difficulty: 'medium' },
    { query: 'Git merge conflict 해결하는 좋은 방법이 뭐야?', expectedAgents: ['software-engineer', 'devops-engineer'], category: '프로그래밍', difficulty: 'medium' },
    { query: 'AWS Lambda에서 타임아웃이 자꾸 발생해', expectedAgents: ['cloud-architect', 'devops-engineer'], category: '프로그래밍', difficulty: 'easy' },
    { query: '데이터베이스 인덱스를 어떻게 설계해야 하나?', expectedAgents: ['backend-developer', 'software-engineer', 'data-scientist'], category: '프로그래밍', difficulty: 'medium' },
    { query: 'Flutter로 크로스플랫폼 앱 개발할 때 주의할 점', expectedAgents: ['mobile-developer'], category: '프로그래밍', difficulty: 'easy' },
    { query: '마이크로서비스 아키텍처로 전환하는 게 좋을까?', expectedAgents: ['software-engineer', 'cloud-architect'], category: '프로그래밍', difficulty: 'medium' },
    { query: 'SQL 쿼리 속도가 갑자기 느려졌어', expectedAgents: ['backend-developer', 'data-scientist'], category: '프로그래밍', difficulty: 'medium' },
    { query: 'CI/CD 파이프라인 구축하려는데 어디서부터 시작하지?', expectedAgents: ['devops-engineer'], category: '프로그래밍', difficulty: 'easy' },
    { query: '스마트 컨트랙트 보안 감사는 어떻게 하나?', expectedAgents: ['blockchain-developer', 'cybersecurity-expert'], category: '프로그래밍', difficulty: 'medium' },
    { query: '딥러닝 모델 학습이 수렴하지 않아', expectedAgents: ['ai-ml-engineer'], category: '프로그래밍', difficulty: 'easy' },

    // ── 비즈니스/창업 (13) ──
    { query: '사업계획서를 어떻게 작성해야 하나요?', expectedAgents: ['business-strategist', 'startup-advisor'], category: '비즈니스', difficulty: 'easy' },
    { query: '스타트업 초기에 투자를 어떻게 유치하나?', expectedAgents: ['startup-advisor', 'investment-banker'], category: '비즈니스', difficulty: 'easy' },
    { query: '우리 회사 매출이 3개월째 떨어지고 있어', expectedAgents: ['business-strategist', 'marketing-manager'], category: '비즈니스', difficulty: 'medium' },
    { query: '팀원들이 자꾸 퇴사하는데 어떻게 해야 할까?', expectedAgents: ['hr-manager'], category: '비즈니스', difficulty: 'hard' },
    { query: '브랜드 리뉴얼을 고민하고 있어', expectedAgents: ['brand-strategist', 'marketing-manager'], category: '비즈니스', difficulty: 'medium' },
    { query: '신제품 출시 전략을 세워야 하는데', expectedAgents: ['product-manager', 'marketing-manager'], category: '비즈니스', difficulty: 'medium' },
    { query: '공급망 비용을 줄이고 싶어', expectedAgents: ['supply-chain-manager', 'operations-manager'], category: '비즈니스', difficulty: 'medium' },
    { query: '프로젝트 일정이 계속 밀리고 있어', expectedAgents: ['project-manager'], category: '비즈니스', difficulty: 'hard' },
    { query: '경쟁사 분석은 어떤 프레임워크로 하면 좋아?', expectedAgents: ['business-strategist'], category: '비즈니스', difficulty: 'medium' },
    { query: '직원 성과 평가 체계를 새로 만들려고 해', expectedAgents: ['hr-manager'], category: '비즈니스', difficulty: 'medium' },
    { query: 'SNS 마케팅 전략을 짜야 하는데', expectedAgents: ['social-media-manager', 'marketing-manager'], category: '비즈니스', difficulty: 'easy' },
    { query: '법인 설립 절차가 궁금해', expectedAgents: ['startup-advisor', 'corporate-lawyer'], category: '비즈니스', difficulty: 'medium' },
    { query: '우리 서비스의 PMF를 찾아야 해', expectedAgents: ['product-manager', 'startup-advisor'], category: '비즈니스', difficulty: 'hard' },

    // ── 금융/투자 (12) ──
    { query: '주식 포트폴리오를 어떻게 구성하면 좋을까?', expectedAgents: ['portfolio-manager', 'financial-analyst'], category: '금융', difficulty: 'easy' },
    { query: '비트코인에 투자해도 될까?', expectedAgents: ['cryptocurrency-analyst'], category: '금융', difficulty: 'easy' },
    { query: '연말정산 세금을 줄이는 방법이 뭐야?', expectedAgents: ['tax-advisor', 'accountant'], category: '금융', difficulty: 'easy' },
    { query: '부동산 투자와 주식 투자 중 뭐가 나을까?', expectedAgents: ['financial-analyst', 'real-estate-analyst', 'portfolio-manager'], category: '금융', difficulty: 'medium' },
    { query: '환율이 오르면 내 자산에 어떤 영향이 있어?', expectedAgents: ['financial-analyst', 'risk-manager'], category: '금융', difficulty: 'medium' },
    { query: '보험을 어떤 걸 들어야 하는지 모르겠어', expectedAgents: ['actuary', 'financial-analyst'], category: '금융', difficulty: 'medium' },
    { query: '퇴직연금 운용을 어떻게 해야 하나?', expectedAgents: ['portfolio-manager', 'financial-analyst'], category: '금융', difficulty: 'medium' },
    { query: 'DeFi 수익률이 진짜 안전한 거야?', expectedAgents: ['cryptocurrency-analyst', 'blockchain-developer'], category: '금융', difficulty: 'medium' },
    { query: '알고리즘 트레이딩을 시작하려면 뭘 배워야 해?', expectedAgents: ['quantitative-analyst'], category: '금융', difficulty: 'easy' },
    { query: '법인 세무 관련 질문이 있어', expectedAgents: ['tax-advisor', 'accountant'], category: '금융', difficulty: 'easy' },
    { query: '금리 인상이 부동산 시장에 미치는 영향', expectedAgents: ['real-estate-analyst', 'financial-analyst'], category: '금융', difficulty: 'medium' },
    { query: '자산 배분 전략을 다시 짜고 싶어', expectedAgents: ['portfolio-manager', 'financial-analyst'], category: '금융', difficulty: 'easy' },

    // ── 법률/계약 (10) ──
    { query: '계약서에서 이 조항이 불리한 건지 봐줘', expectedAgents: ['corporate-lawyer'], category: '법률', difficulty: 'easy' },
    { query: '저작권 침해로 소송을 당했어', expectedAgents: ['patent-attorney'], category: '법률', difficulty: 'easy' },
    { query: '직원이 부당해고를 주장하고 있어', expectedAgents: ['labor-lawyer'], category: '법률', difficulty: 'easy' },
    { query: '개인정보보호법 GDPR 준수 방법', expectedAgents: ['compliance-officer'], category: '법률', difficulty: 'easy' },
    { query: '형사 고소장을 작성해야 하는데', expectedAgents: ['criminal-lawyer'], category: '법률', difficulty: 'easy' },
    { query: '프리랜서 계약 시 주의할 법적 사항', expectedAgents: ['corporate-lawyer', 'labor-lawyer'], category: '법률', difficulty: 'medium' },
    { query: '특허 출원 절차가 어떻게 되나요?', expectedAgents: ['patent-attorney'], category: '법률', difficulty: 'easy' },
    { query: '온라인 쇼핑몰 약관을 작성해야 하는데', expectedAgents: ['corporate-lawyer', 'compliance-officer'], category: '법률', difficulty: 'medium' },
    { query: '이웃이 소음 문제로 고소하겠다고 해', expectedAgents: ['criminal-lawyer', 'corporate-lawyer'], category: '법률', difficulty: 'hard' },
    { query: '회사 내부 감사 체계를 구축하려면', expectedAgents: ['compliance-officer', 'accountant'], category: '법률', difficulty: 'medium' },

    // ── 의료/건강 (12) ──
    { query: '두통이 일주일째 지속되고 있어', expectedAgents: ['physician'], category: '의료', difficulty: 'easy' },
    { query: '불면증이 심해서 잠을 못 자겠어', expectedAgents: ['physician', 'psychologist'], category: '의료', difficulty: 'easy' },
    { query: '다이어트할 때 영양 균형을 어떻게 맞춰?', expectedAgents: ['nutritionist'], category: '의료', difficulty: 'easy' },
    { query: '약을 같이 먹어도 되는지 궁금해', expectedAgents: ['pharmacist'], category: '의료', difficulty: 'easy' },
    { query: '스트레스 받아서 우울한 기분이 계속돼', expectedAgents: ['psychologist'], category: '의료', difficulty: 'easy' },
    { query: '허리가 아파서 일상생활이 힘들어', expectedAgents: ['physician'], category: '의료', difficulty: 'easy' },
    { query: '임상시험에 참여하고 싶은데 어떻게 하나?', expectedAgents: ['medical-researcher'], category: '의료', difficulty: 'medium' },
    { query: '아이의 성장 발달이 또래보다 느린 것 같아', expectedAgents: ['physician', 'psychologist'], category: '의료', difficulty: 'hard' },
    { query: '건강검진 결과를 해석해줘', expectedAgents: ['physician'], category: '의료', difficulty: 'medium' },
    { query: '비타민 보충제를 어떤 걸 먹어야 하나?', expectedAgents: ['nutritionist', 'pharmacist'], category: '의료', difficulty: 'easy' },
    { query: '운동할 때 근육 부상을 예방하려면', expectedAgents: ['physician', 'nutritionist'], category: '의료', difficulty: 'medium' },
    { query: '의료기기 인허가 절차가 궁금해', expectedAgents: ['biomedical-engineer', 'medical-researcher'], category: '의료', difficulty: 'hard' },

    // ── 교육/학습 (10) ──
    { query: '토익 900점 이상 받으려면 어떻게 공부해야 해?', expectedAgents: ['educator', 'academic-advisor'], category: '교육', difficulty: 'easy' },
    { query: '초등학생 수학 학습법을 알려줘', expectedAgents: ['educator', 'curriculum-designer'], category: '교육', difficulty: 'easy' },
    { query: '이러닝 플랫폼을 만들고 싶어', expectedAgents: ['educational-technologist'], category: '교육', difficulty: 'easy' },
    { query: '면접 준비를 어떻게 해야 하나?', expectedAgents: ['academic-advisor', 'hr-manager'], category: '교육', difficulty: 'medium' },
    { query: '효과적인 프레젠테이션 하는 법을 알려줘', expectedAgents: ['educator', 'content-writer'], category: '교육', difficulty: 'hard' },
    { query: '자격증 시험 공부 계획을 세워줘', expectedAgents: ['academic-advisor', 'educator'], category: '교육', difficulty: 'easy' },
    { query: '아이에게 코딩을 가르치고 싶어', expectedAgents: ['educator', 'educational-technologist'], category: '교육', difficulty: 'medium' },
    { query: '대학원 진학과 취업 중 어떤 게 나을까?', expectedAgents: ['academic-advisor'], category: '교육', difficulty: 'hard' },
    { query: '온라인 강의 커리큘럼을 설계하려면', expectedAgents: ['curriculum-designer', 'educational-technologist'], category: '교육', difficulty: 'easy' },
    { query: '영어 회화 실력을 빠르게 늘리려면', expectedAgents: ['educator'], category: '교육', difficulty: 'easy' },

    // ── 디자인/크리에이티브 (10) ──
    { query: '로고 디자인을 새로 하고 싶어', expectedAgents: ['graphic-designer', 'brand-strategist'], category: '디자인', difficulty: 'easy' },
    { query: '유튜브 썸네일 잘 만드는 팁', expectedAgents: ['graphic-designer', 'video-producer'], category: '디자인', difficulty: 'easy' },
    { query: '모바일 앱 UI를 사용하기 편하게 바꾸고 싶어', expectedAgents: ['ui-ux-designer'], category: '디자인', difficulty: 'easy' },
    { query: '블로그 글을 매력적으로 쓰는 방법', expectedAgents: ['content-writer', 'copywriter'], category: '디자인', difficulty: 'easy' },
    { query: '광고 카피를 작성해야 하는데 아이디어가 안 떠올라', expectedAgents: ['copywriter', 'creative-director'], category: '디자인', difficulty: 'easy' },
    { query: '유니티로 모바일 게임 만들고 싶어', expectedAgents: ['game-designer'], category: '디자인', difficulty: 'medium' },
    { query: '기업 홍보 영상을 기획하려면', expectedAgents: ['video-producer', 'creative-director'], category: '디자인', difficulty: 'medium' },
    { query: '피그마로 프로토타입 만드는 법', expectedAgents: ['ui-ux-designer'], category: '디자인', difficulty: 'easy' },
    { query: '소설을 쓰고 싶은데 스토리 구조를 잡아줘', expectedAgents: ['content-writer'], category: '디자인', difficulty: 'medium' },
    { query: '포스터 디자인에서 색상 배합을 어떻게 해야 해?', expectedAgents: ['graphic-designer'], category: '디자인', difficulty: 'easy' },

    // ── 데이터/AI (8) ──
    { query: '엑셀 데이터를 시각화하고 싶어', expectedAgents: ['data-analyst', 'data-scientist'], category: '데이터', difficulty: 'easy' },
    { query: 'GPT 같은 LLM을 파인튜닝하려면?', expectedAgents: ['ai-ml-engineer'], category: '데이터', difficulty: 'easy' },
    { query: '자동화 봇을 만들어서 반복 작업을 줄이고 싶어', expectedAgents: ['software-engineer', 'ai-ml-engineer'], category: '데이터', difficulty: 'medium' },
    { query: '고객 이탈률을 예측하는 모델을 만들고 싶어', expectedAgents: ['data-scientist', 'ai-ml-engineer'], category: '데이터', difficulty: 'medium' },
    { query: '대시보드를 만들어서 매출 추이를 보고 싶어', expectedAgents: ['data-analyst', 'data-scientist'], category: '데이터', difficulty: 'easy' },
    { query: 'A/B 테스트 결과를 통계적으로 분석해줘', expectedAgents: ['data-scientist', 'data-analyst'], category: '데이터', difficulty: 'medium' },
    { query: '추천 시스템을 구축하려면 어떤 알고리즘이 좋아?', expectedAgents: ['ai-ml-engineer', 'data-scientist'], category: '데이터', difficulty: 'medium' },
    { query: 'RPA로 업무 프로세스를 자동화하고 싶어', expectedAgents: ['ai-ml-engineer', 'operations-manager'], category: '데이터', difficulty: 'medium' },

    // ── 엣지 케이스 / 교차 도메인 (10) ──
    { query: '이사를 가려는데 어떤 동네가 좋을까?', expectedAgents: ['real-estate-analyst', 'urban-planner'], category: '교차', difficulty: 'hard' },
    { query: '요즘 ESG가 왜 중요한 거야?', expectedAgents: ['sustainability-consultant'], category: '교차', difficulty: 'hard' },
    { query: '외교관이 되려면 어떤 준비를 해야 해?', expectedAgents: ['diplomat', 'academic-advisor'], category: '교차', difficulty: 'hard' },
    { query: '식품 유통기한 관련 규정이 궁금해', expectedAgents: ['food-scientist', 'compliance-officer'], category: '교차', difficulty: 'hard' },
    { query: '로봇이 인간의 일자리를 대체할까?', expectedAgents: ['futurist', 'robotics-engineer'], category: '교차', difficulty: 'hard' },
    { query: '태양광 패널 설치 비용 대비 효율이 궁금해', expectedAgents: ['renewable-energy-engineer', 'energy-analyst'], category: '교차', difficulty: 'hard' },
    { query: '결혼식 준비를 도와줘', expectedAgents: ['event-planner'], category: '교차', difficulty: 'hard' },
    { query: '물류비를 절감하는 방법이 뭐야?', expectedAgents: ['logistics-manager', 'supply-chain-manager'], category: '교차', difficulty: 'hard' },
    { query: '윤리적 딜레마에 대해 토론하고 싶어', expectedAgents: ['ethicist'], category: '교차', difficulty: 'hard' },
    { query: '기후변화가 농업에 미치는 영향', expectedAgents: ['agricultural-scientist', 'environmental-scientist'], category: '교차', difficulty: 'hard' },
];

// ============================================================
// Ollama Embedding (직접 API 호출)
// ============================================================

const OLLAMA_URL = 'http://localhost:11434';
const EMBED_MODEL = 'nomic-embed-text';

async function embedText(text: string): Promise<number[] | null> {
    try {
        const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBED_MODEL, input: text }),
        });
        if (!resp.ok) return null;
        const data = await resp.json() as { embeddings?: number[][] };
        return data.embeddings?.[0] ?? null;
    } catch {
        return null;
    }
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    // nomic-embed-text supports batch input
    try {
        const resp = await fetch(`${OLLAMA_URL}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
        });
        if (!resp.ok) return texts.map(() => null);
        const data = await resp.json() as { embeddings?: number[][] };
        return data.embeddings ?? texts.map(() => null);
    } catch {
        return texts.map(() => null);
    }
}

function cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}

// ============================================================
// Agent Profile Builder
// ============================================================

function buildAgentProfiles(): AgentProfile[] {
    const profiles: AgentProfile[] = [];
    for (const [catId, cat] of Object.entries(industryData)) {
        const category = cat as { agents: Array<{ id: string; name: string; description: string; keywords: string[] }> };
        for (const agent of category.agents) {
            const profileText = `${agent.name}: ${agent.description}. 키워드: ${agent.keywords.join(', ')}`;
            profiles.push({
                id: agent.id,
                name: agent.name,
                description: agent.description,
                keywords: agent.keywords,
                category: catId,
                profileText,
            });
        }
    }
    return profiles;
}

// ============================================================
// Main Experiment
// ============================================================

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   Embedding A/B Test: 키워드 vs 임베딩 시맨틱 라우팅   ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`테스트 쿼리: ${TEST_CASES.length}개`);
    console.log(`임베딩 모델: ${EMBED_MODEL}`);
    console.log('');

    // 1. Build agent profiles
    const profiles = buildAgentProfiles();
    console.log(`에이전트 프로필: ${profiles.length}개`);

    // 2. Generate agent embeddings (batch)
    console.log('\n[1/3] 에이전트 프로필 임베딩 생성 중...');
    const profileTexts = profiles.map(p => p.profileText);
    const profileEmbStart = Date.now();

    // Batch in groups of 32 (safe for Ollama)
    const BATCH_SIZE = 32;
    const allProfileEmbeddings: (number[] | null)[] = [];
    for (let i = 0; i < profileTexts.length; i += BATCH_SIZE) {
        const batch = profileTexts.slice(i, i + BATCH_SIZE);
        const results = await embedBatch(batch);
        allProfileEmbeddings.push(...results);
        process.stdout.write(`  ${Math.min(i + BATCH_SIZE, profileTexts.length)}/${profileTexts.length} `);
    }
    console.log(`\n  완료 (${Date.now() - profileEmbStart}ms)`);

    // Assign embeddings to profiles
    let embeddedCount = 0;
    for (let i = 0; i < profiles.length; i++) {
        if (allProfileEmbeddings[i]) {
            profiles[i].embedding = allProfileEmbeddings[i]!;
            embeddedCount++;
        }
    }
    console.log(`  임베딩 성공: ${embeddedCount}/${profiles.length}`);

    if (embeddedCount === 0) {
        console.error('❌ 임베딩 생성 실패 — Ollama 연결 확인 필요');
        process.exit(1);
    }

    // 3. Run A/B test on each query
    console.log('\n[2/3] A/B 테스트 실행 중...');
    const results: ABResult[] = [];

    for (let i = 0; i < TEST_CASES.length; i++) {
        const tc = TEST_CASES[i];
        process.stdout.write(`  ${i + 1}/${TEST_CASES.length}: ${tc.query.substring(0, 30)}...`);

        // --- A) Keyword routing ---
        const kwStart = Date.now();
        const kwResult = await routeToAgent(tc.query);
        const kwLatency = Date.now() - kwStart;

        // --- B) Embedding routing ---
        const embStart = Date.now();
        const queryEmb = await embedText(tc.query);
        let embAgent = 'general';
        let embSimilarity = 0;
        let embTop3: string[] = [];

        if (queryEmb) {
            const scored = profiles
                .filter(p => p.embedding)
                .map(p => ({
                    id: p.id,
                    similarity: cosineSimilarity(queryEmb, p.embedding!),
                }))
                .sort((a, b) => b.similarity - a.similarity);

            if (scored.length > 0) {
                embAgent = scored[0].id;
                embSimilarity = scored[0].similarity;
                embTop3 = scored.slice(0, 3).map(s => s.id);
            }
        }
        const embLatency = Date.now() - embStart;

        const kwCorrect = tc.expectedAgents.includes(kwResult.primaryAgent);
        const embCorrect = tc.expectedAgents.includes(embAgent);

        // Top-3 check: any of the expected agents in the top 3?
        // For keyword system, we only have top-1, so check that
        const kwTop3Correct = kwCorrect; // keyword system doesn't produce top-3 easily
        const embTop3Correct = embTop3.some(a => tc.expectedAgents.includes(a));

        results.push({
            query: tc.query,
            expected: tc.expectedAgents,
            category: tc.category,
            difficulty: tc.difficulty,
            kwAgent: kwResult.primaryAgent,
            kwScore: kwResult.confidence ?? 0,
            kwCorrect,
            kwTop3Correct,
            kwLatencyMs: kwLatency,
            embAgent,
            embSimilarity,
            embCorrect,
            embTop3Correct,
            embLatencyMs: embLatency,
            embTop3,
        });

        const kwMark = kwCorrect ? '✅' : '❌';
        const embMark = embCorrect ? '✅' : '❌';
        console.log(` KW:${kwMark}(${kwResult.primaryAgent}) EMB:${embMark}(${embAgent})`);
    }

    // 4. Analysis
    console.log('\n[3/3] 결과 분석\n');

    const total = results.length;
    const kwCorrectCount = results.filter(r => r.kwCorrect).length;
    const embCorrectCount = results.filter(r => r.embCorrect).length;
    const embTop3CorrectCount = results.filter(r => r.embTop3Correct).length;
    const avgKwLatency = results.reduce((s, r) => s + r.kwLatencyMs, 0) / total;
    const avgEmbLatency = results.reduce((s, r) => s + r.embLatencyMs, 0) / total;

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║                    종합 결과                            ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  총 테스트 쿼리:     ${total}개                           ║`);
    console.log('╠──────────────────────────────────────────────────────────╣');
    console.log(`║  [키워드] Top-1 정확도:  ${kwCorrectCount}/${total} (${(kwCorrectCount / total * 100).toFixed(1)}%)       ║`);
    console.log(`║  [임베딩] Top-1 정확도:  ${embCorrectCount}/${total} (${(embCorrectCount / total * 100).toFixed(1)}%)       ║`);
    console.log(`║  [임베딩] Top-3 정확도:  ${embTop3CorrectCount}/${total} (${(embTop3CorrectCount / total * 100).toFixed(1)}%)       ║`);
    console.log('╠──────────────────────────────────────────────────────────╣');
    console.log(`║  [키워드] 평균 레이턴시:  ${avgKwLatency.toFixed(1)}ms                   ║`);
    console.log(`║  [임베딩] 평균 레이턴시:  ${avgEmbLatency.toFixed(1)}ms                  ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');

    // By difficulty
    console.log('\n── 난이도별 정확도 ──');
    for (const diff of ['easy', 'medium', 'hard'] as const) {
        const subset = results.filter(r => r.difficulty === diff);
        if (subset.length === 0) continue;
        const kwAcc = subset.filter(r => r.kwCorrect).length;
        const embAcc = subset.filter(r => r.embCorrect).length;
        const embT3 = subset.filter(r => r.embTop3Correct).length;
        console.log(`  ${diff.padEnd(6)}: KW ${kwAcc}/${subset.length} (${(kwAcc / subset.length * 100).toFixed(0)}%) | EMB ${embAcc}/${subset.length} (${(embAcc / subset.length * 100).toFixed(0)}%) | EMB-Top3 ${embT3}/${subset.length} (${(embT3 / subset.length * 100).toFixed(0)}%)`);
    }

    // By category
    console.log('\n── 카테고리별 정확도 ──');
    const categories = [...new Set(results.map(r => r.category))];
    for (const cat of categories) {
        const subset = results.filter(r => r.category === cat);
        const kwAcc = subset.filter(r => r.kwCorrect).length;
        const embAcc = subset.filter(r => r.embCorrect).length;
        const embT3 = subset.filter(r => r.embTop3Correct).length;
        console.log(`  ${cat.padEnd(8)}: KW ${kwAcc}/${subset.length} (${(kwAcc / subset.length * 100).toFixed(0)}%) | EMB ${embAcc}/${subset.length} (${(embAcc / subset.length * 100).toFixed(0)}%) | EMB-Top3 ${embT3}/${subset.length} (${(embT3 / subset.length * 100).toFixed(0)}%)`);
    }

    // Show where embedding wins and keyword loses
    console.log('\n── 임베딩이 이기고 키워드가 진 케이스 ──');
    const embWins = results.filter(r => r.embCorrect && !r.kwCorrect);
    if (embWins.length === 0) {
        console.log('  (없음)');
    } else {
        for (const r of embWins) {
            console.log(`  Q: "${r.query}"`);
            console.log(`    기대: [${r.expected.join(', ')}] | KW: ${r.kwAgent} ❌ | EMB: ${r.embAgent} ✅ (sim: ${r.embSimilarity.toFixed(3)})`);
        }
    }

    // Show where keyword wins and embedding loses
    console.log('\n── 키워드가 이기고 임베딩이 진 케이스 ──');
    const kwWins = results.filter(r => r.kwCorrect && !r.embCorrect);
    if (kwWins.length === 0) {
        console.log('  (없음)');
    } else {
        for (const r of kwWins) {
            console.log(`  Q: "${r.query}"`);
            console.log(`    기대: [${r.expected.join(', ')}] | KW: ${r.kwAgent} ✅ | EMB: ${r.embAgent} ❌ (sim: ${r.embSimilarity.toFixed(3)}) | EMB-Top3: [${r.embTop3.join(', ')}]`);
        }
    }

    // Both fail
    console.log('\n── 둘 다 실패한 케이스 ──');
    const bothFail = results.filter(r => !r.kwCorrect && !r.embCorrect);
    if (bothFail.length === 0) {
        console.log('  (없음)');
    } else {
        for (const r of bothFail) {
            console.log(`  Q: "${r.query}"`);
            console.log(`    기대: [${r.expected.join(', ')}] | KW: ${r.kwAgent} ❌ | EMB: ${r.embAgent} ❌ (sim: ${r.embSimilarity.toFixed(3)}) | EMB-Top3: [${r.embTop3.join(', ')}]`);
        }
    }

    // Summary statistics
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║                  최종 요약                              ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  키워드만 정답:    ${kwWins.length}건                                ║`);
    console.log(`║  임베딩만 정답:    ${embWins.length}건                                ║`);
    console.log(`║  둘 다 정답:      ${results.filter(r => r.kwCorrect && r.embCorrect).length}건                                ║`);
    console.log(`║  둘 다 오답:      ${bothFail.length}건                                ║`);
    console.log('╠──────────────────────────────────────────────────────────╣');
    const improvement = embCorrectCount - kwCorrectCount;
    const pctDiff = ((embCorrectCount - kwCorrectCount) / kwCorrectCount * 100);
    console.log(`║  정확도 차이:     ${improvement >= 0 ? '+' : ''}${improvement}건 (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%)            ║`);
    console.log(`║  레이턴시 차이:   ${(avgEmbLatency - avgKwLatency).toFixed(0)}ms 추가               ║`);
    console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(err => {
    console.error('실험 실패:', err);
    process.exit(1);
});
