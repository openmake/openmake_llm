#!/usr/bin/env bun
/**
 * Keyword routing accuracy test
 * Tests the enhanced keyword system against 100 ground-truth queries
 * Usage: bun run backend/api/src/scripts/keyword-accuracy-test.ts
 */

import { routeToAgent } from '../agents/keyword-router';

interface TestCase {
    query: string;
    expectedAgents: string[];
    category: string;
    difficulty: 'easy' | 'medium' | 'hard';
}

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

async function main() {
    console.log('=== Enhanced Keyword Routing Accuracy Test ===\n');
    console.log(`Total test cases: ${TEST_CASES.length}\n`);

    let correct = 0;
    let total = 0;
    const categoryResults: Record<string, { correct: number; total: number }> = {};
    const difficultyResults: Record<string, { correct: number; total: number }> = {};
    const failures: Array<{ query: string; expected: string[]; got: string; category: string; difficulty: string }> = [];

    for (const tc of TEST_CASES) {
        const result = await routeToAgent(tc.query);
        const isCorrect = tc.expectedAgents.includes(result.primaryAgent);

        if (!categoryResults[tc.category]) categoryResults[tc.category] = { correct: 0, total: 0 };
        if (!difficultyResults[tc.difficulty]) difficultyResults[tc.difficulty] = { correct: 0, total: 0 };

        categoryResults[tc.category].total++;
        difficultyResults[tc.difficulty].total++;
        total++;

        if (isCorrect) {
            correct++;
            categoryResults[tc.category].correct++;
            difficultyResults[tc.difficulty].correct++;
        } else {
            failures.push({
                query: tc.query,
                expected: tc.expectedAgents,
                got: result.primaryAgent,
                category: tc.category,
                difficulty: tc.difficulty,
            });
        }
    }

    console.log('\n============================================');
    console.log(`\n🎯 OVERALL ACCURACY: ${correct}/${total} (${((correct / total) * 100).toFixed(1)}%)\n`);

    console.log('📊 By Category:');
    for (const [cat, res] of Object.entries(categoryResults).sort((a, b) => a[0].localeCompare(b[0]))) {
        const pct = ((res.correct / res.total) * 100).toFixed(1);
        console.log(`  ${cat}: ${res.correct}/${res.total} (${pct}%)`);
    }

    console.log('\n📊 By Difficulty:');
    for (const [diff, res] of Object.entries(difficultyResults).sort((a, b) => a[0].localeCompare(b[0]))) {
        const pct = ((res.correct / res.total) * 100).toFixed(1);
        console.log(`  ${diff}: ${res.correct}/${res.total} (${pct}%)`);
    }

    if (failures.length > 0) {
        console.log(`\n❌ Failures (${failures.length}):`);
        for (const f of failures) {
            console.log(`  [${f.category}/${f.difficulty}] "${f.query.substring(0, 40)}..." → got: ${f.got}, expected: ${f.expected.join('|')}`);
        }
    }

    console.log('\n============================================');
    const baseline = 43;
    const improvement = ((correct / total) * 100) - baseline;
    console.log(`\n📈 Improvement: ${baseline}% → ${((correct / total) * 100).toFixed(1)}% (${improvement > 0 ? '+' : ''}${improvement.toFixed(1)}pp)`);
}

main().catch(console.error);
