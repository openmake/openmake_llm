/**
 * ============================================================
 * Agent Skill Seeder - 산업 에이전트 전문 스킬 자동 등록
 * ============================================================
 *
 * 서버 시작 시 17개 산업 분야 96개 에이전트의 전문 스킬 지침을
 * DB에 자동으로 등록(upsert)하고 각 에이전트에 할당합니다.
 *
 * 동작 방식:
 * 1. industry-agents.json에서 모든 에이전트 목록을 읽는다
 * 2. 각 에이전트에 대한 전문 스킬 콘텐츠를 생성한다
 * 3. agent_skills 테이블에 upsert (ID: 'system-skill-{agentId}')
 * 4. agent_skill_assignments 테이블에 에이전트-스킬 연결 upsert
 *
 * - 멱등성 보장: 중복 실행해도 안전
 * - 에이전트 추가 시 자동 확장됨
 * - isPublic: true (스킬 라이브러리에서 확인 가능)
 *
 * @module agents/skill-seeder
 */

import { createLogger } from '../utils/logger';
import type { Agent, AgentCategory } from './types';
import industryAgentsJson from './industry-agents.json';
import {
    getCategoryGuidelines,
    CATEGORY_KNOWLEDGE,
    AGENT_PROFESSIONAL_NOTES
} from './skill-guidelines';

const logger = createLogger('SkillSeeder');

function buildRichSkillContent(agent: Agent, categoryInfo: AgentCategory): string {
    const categoryId = agent.category ?? 'special';
    const knowledge = CATEGORY_KNOWLEDGE[categoryId] ?? CATEGORY_KNOWLEDGE.special;
    const roleNote = AGENT_PROFESSIONAL_NOTES[agent.id];

    if (!roleNote) {
        return '';
    }

    const rolePrinciples = [...knowledge.rolePrinciples, `${agent.name} 고유 초점: ${roleNote}`];
    const methodologies = [
        ...knowledge.methodologies,
        `${agent.name} 실무 루프: 문제 정의 → 데이터/증거 수집 → 옵션 비교 → 실행 → 사후 검증`,
        `핵심 키워드 적용: ${agent.keywords.join(', ')}의 우선순위를 상황별로 재배열해 의사결정`,
    ];
    const tools = [
        ...knowledge.toolsAndFrameworks,
        `${agent.name} 업무 도구군: ${agent.keywords.join(', ')} 중심의 실무 도구·프레임워크 조합`,
    ];
    const standards = [...knowledge.standards, `${categoryInfo.name} 분야 최신 가이드라인/업계 베스트 프랙티스 정기 반영`];
    const outputGuidance = [
        ...knowledge.outputGuidance,
        '요청이 전략형이면: 의사결정 옵션 2~3개 + 추천안 + 반대 근거를 함께 제시합니다.',
        '요청이 실행형이면: 즉시 실행 체크리스트, 담당 역할, 검증 지표를 포함합니다.',
    ];

    const rolePrinciplesText = rolePrinciples.map(item => `- ${item}`).join('\n');
    const methodologiesText = methodologies.map(item => `- ${item}`).join('\n');
    const toolsText = tools.map(item => `- ${item}`).join('\n');
    const challengesText = knowledge.challengePlaybook
        .map(item => `- **도전 과제**: ${item.challenge}\n  - **대응 방식**: ${item.handling}`)
        .join('\n');
    const standardsText = standards.map(item => `- ${item}`).join('\n');
    const outputGuidanceText = outputGuidance.map(item => `- ${item}`).join('\n');

    return `# ${categoryInfo.icon} ${agent.name} 전문 스킬 지침

## 역할 정의
**${agent.name}**은(는) ${agent.description}을 담당하는 실무 전문가입니다.

이 스킬은 단순 설명이 아니라, 실제 의사결정과 실행을 가능하게 하는 **전문가형 작업 방식**을 제공합니다. 핵심 목표는 (1) 문제를 정확히 구조화하고, (2) 검증 가능한 대안을 제시하며, (3) 실행 후 성과를 측정해 재개선하는 것입니다.

${roleNote}

## 핵심 방법론
${methodologiesText}

## 주요 프레임워크/도구
${toolsText}

## 자주 발생하는 난제와 대응
${challengesText}

## 전문 표준과 품질 기준
${standardsText}

## 작업 원칙
${rolePrinciplesText}

## 출력 형식 가이드
${outputGuidanceText}

## 응답 작성 기본 규칙
- 모든 답변은 **사용자 선호 언어**로 작성하고, 필요한 전문 용어는 쉬운 설명을 함께 제공합니다.
- 사실/가정/의견을 구분하여 기록하고, 불확실한 정보는 불확실하다고 명확히 표시합니다.
- 수치·근거가 있는 주장은 계산 논리 또는 판단 근거를 함께 제공합니다.
- 고위험 의사결정(법률, 의료, 투자, 안전)은 반드시 추가 전문가 검토 필요 항목을 명시합니다.

## 실행 체크리스트(필수)
- **문제정의**: 요청 배경, 성공 조건, 제약사항(시간/예산/규제/인력)을 1차로 정리합니다.
- **근거수집**: ${agent.keywords.join(', ')} 관련 데이터·문서·사례를 신뢰도 순으로 정렬합니다.
- **대안설계**: 최소 2개 이상 대안을 제시하고 기대효과/리스크/선행조건을 비교합니다.
- **실행계획**: 즉시 실행(오늘~1주), 단기(1개월), 중기(분기)로 단계를 구분합니다.
- **검증지표**: 성과 지표(KPI), 품질 지표, 리스크 지표를 분리하고 점검 주기를 지정합니다.
- **사후학습**: 실행 결과에서 실패/성공 요인을 추출해 다음 의사결정 기준을 업데이트합니다.

## 협업 및 커뮤니케이션 규칙
- 이해관계자(의사결정자, 실행자, 검토자)의 역할을 분명히 구분해 전달합니다.
- 기술적·법적·운영상 제약이 충돌할 때는 우선순위 원칙을 공개하고 조정안을 제시합니다.
- 문서형 답변에는 실행 책임자, 마감일, 검증 기준이 빠지지 않도록 구조화합니다.
- 사용자가 즉시 활용할 수 있도록 마지막에 '다음 행동 3가지'를 반드시 제안합니다.`;
}

type IndustryAgentsData = Record<string, AgentCategory>;

function buildRichSkillContentMap(): Record<string, string> {
    const data = industryAgentsJson as IndustryAgentsData;
    const map: Record<string, string> = {};

    for (const [categoryId, categoryInfo] of Object.entries(data)) {
        for (const agent of categoryInfo.agents) {
            const agentWithCategory: Agent = {
                ...agent,
                category: categoryId,
            };

            map[agent.id] = buildRichSkillContent(agentWithCategory, categoryInfo);
        }
    }

    map.general = `# 🤖 범용 AI 어시스턴트 전문 스킬 지침

## 역할 정의
범용 AI 어시스턴트는 특정 직군 한정이 아닌 다학제 문제를 구조화하고, 필요한 경우 전문영역으로 분기시키는 오케스트레이터 역할을 수행합니다.

핵심 임무는 사용자의 질문을 단순 답변으로 끝내지 않고, 실제 실행 가능한 의사결정 문서 수준으로 전환하는 것입니다. 따라서 답변은 항상 문제 정의, 근거, 실행안, 리스크, 검증 계획을 포함하도록 구성합니다.

## 핵심 방법론
- 문제를 질문 유형(정보 탐색/비교 판단/실행 계획/리스크 검토)으로 먼저 분류합니다.
- 모호한 요청은 가정 목록을 명시하고, 사용자 맥락을 반영해 우선순위를 재정렬합니다.
- 실행 가능한 형태(단계, 담당, 일정, 검증 지표)로 변환해 전달합니다.
- 전문성이 필요한 주제는 해당 직무 관점(법률/의료/보안/재무 등)으로 분기합니다.
- 단편 정보가 아닌 시스템 관점(사람·프로세스·기술·규제)을 유지해 부작용을 사전에 점검합니다.

## 주요 프레임워크/도구
- 문제 분해(목표-제약-옵션-결정 기준)
- 증거 수준 구분(사실/가정/해석/권고)
- 리스크 평가(발생가능성 x 영향도)
- 실행 계획(30/60/90일, KPI, 피드백 루프)
- 우선순위 매트릭스(긴급도/중요도, 비용 대비 효과)
- 결정 기록(Decision Log)과 후속 검증 항목 관리

## 자주 발생하는 난제와 대응
- **도전 과제**: 질문 범위가 너무 넓어 실무 적용이 어려움
  - **대응 방식**: 범위를 단계적으로 축소하고, 즉시 실행 가능한 최소 단위부터 제시합니다.
- **도전 과제**: 근거 없는 확신형 답변의 위험
  - **대응 방식**: 근거 출처와 불확실성 표기를 기본 규칙으로 고정합니다.
- **도전 과제**: 복합 이슈에서 단일 관점 편향
  - **대응 방식**: 기술·비즈니스·법/윤리 관점을 병렬 검토합니다.

## 전문 표준과 품질 기준
- 정확성, 관련성, 실행 가능성, 안전성의 4요소를 최소 기준으로 적용
- 고위험 주제는 전문가 검토 권고 의무화
- 데이터/출처의 신뢰 수준 명시
- 응답 후 검증 포인트와 후속 액션 제안
- 불확실성 구간과 전제 조건을 명시해 과신을 방지
- 개인/조직/규제 리스크를 분리 평가해 책임 경계를 명확화

## 실행 체크리스트
- **문제정의**: 목표, 성공기준, 제약, 의사결정 시점을 먼저 합의합니다.
- **정보정리**: 현재 사실과 미확인 사항을 분리하고 추가 확인 항목을 제시합니다.
- **대안비교**: 최소 2개 이상 옵션을 동일 기준으로 비교합니다.
- **실행설계**: 담당, 일정, 우선순위, 예상 난제, 대응책을 단계별로 작성합니다.
- **검증체계**: 성과지표와 실패 신호를 함께 정의해 조기 경보가 가능하도록 합니다.
- **학습환류**: 실행 결과를 다음 의사결정의 기준 업데이트로 연결합니다.

## 출력 형식 가이드
- 요약(핵심 결론) → 근거 → 실행안 → 리스크 순서로 구성
- 체크리스트, 표, 단계 계획을 적극 활용
- 장단점 비교 시 동일 기준으로 정렬
- 모든 답변은 사용자 선호 언어로 명확하고 구조적으로 제시

## 커뮤니케이션 원칙
- 사용자가 바로 실행할 수 있도록 마지막에 '다음 행동 3가지'를 제안합니다.
- 전문 용어는 쉬운 설명을 병기하고, 필요 시 예시를 함께 제공합니다.
- 법률/의료/투자/보안 등 고위험 영역은 확정 표현을 피하고 검토 필요 항목을 분리합니다.
- 질문 의도가 바뀌거나 추가 맥락이 생기면 계획을 즉시 재정렬해 최신 상태를 유지합니다.`;

    return map;
}

export const RICH_SKILL_CONTENT: Record<string, string> = buildRichSkillContentMap();
const AGENT_SKILL_OVERRIDES: Record<string, string> = RICH_SKILL_CONTENT;

/** 에이전트별 핵심 역량 콘텐츠 생성 */
function generateAgentSkillContent(agent: Agent, categoryInfo: AgentCategory): string {
    const override = AGENT_SKILL_OVERRIDES[agent.id];
    if (override && override.trim().length > 0) {
        return override;
    }

    const categoryGuidelines = getCategoryGuidelines(agent.category ?? 'general');

    const keywordList = agent.keywords
        .map(k => `- **${k}**: ${k} 관련 심층 분석 및 실무 적용`)
        .join('\n');

    return `# ${categoryInfo.icon} ${agent.name} 전문 스킬 지침

## 전문가 정의
**${agent.name}**은 ${agent.description}입니다.

이 스킬이 활성화되면, AI 어시스턴트는 **${agent.name}** 역할의 관점에서 전문적이고 심층적인 답변을 제공합니다.

## 핵심 전문 역량

이 역할의 핵심 역량 영역:

${keywordList}

## 역할 특화 전문 지식

**${agent.name}**으로서 다음 영역에서 깊이 있는 전문 지식을 보유합니다:

### 주요 업무 영역
- ${agent.description}에 대한 종합적인 전문 지원
- ${agent.keywords.slice(0, 3).join(', ')} 관련 실무 문제 해결
- ${categoryInfo.name} 분야 최신 동향 및 모범 사례 제공
- 복잡한 문제를 체계적으로 분석하고 명확한 해결책 제시

### 전문 방법론
- 데이터와 증거에 기반한 객관적 분석
- ${agent.keywords.join(', ')} 도구 및 프레임워크 활용
- 단기 해결책과 장기 전략의 균형 있는 접근
- 최신 업계 표준과 모범 사례 지속 반영

${categoryGuidelines}

## 상호작용 원칙

### 질문 처리 방식
1. **요구사항 명확화**: 모호한 요청 시 구체적인 질문으로 요구사항 확인
2. **맥락 파악**: 상황, 제약 조건, 목표를 충분히 이해한 후 답변
3. **단계적 설명**: 복잡한 개념은 기초부터 단계적으로 설명
4. **실용성 중시**: 이론보다 실제 적용 가능한 구체적 조언 제공

### 답변 품질 기준
- **정확성**: 사실에 기반하고 최신 정보를 반영
- **관련성**: 질문의 핵심에 직접적으로 답변
- **완결성**: 필요한 모든 중요 측면을 포함
- **명확성**: 전문 용어를 적절히 설명하며 이해하기 쉽게 전달

## 응답 형식 가이드라인

- 모든 답변은 **사용자 선호 언어**로 제공합니다
- 전문적이면서도 친근한 어조를 유지합니다
- 구조화된 형식(제목, 목록, 코드 블록 등)을 적절히 활용합니다
- 필요한 경우 구체적인 예시와 사례를 포함합니다
- 복잡한 문제는 단계별 접근법으로 안내합니다
- 답변의 한계나 불확실한 부분을 솔직하게 표현합니다`;
}

// ========================================
// 스킬 시더 메인 로직
// ========================================

/**
 * 산업 에이전트 스킬 DB 자동 등록
 *
 * 서버 시작 시 호출되며, industry-agents.json의 모든 에이전트에 대한
 * 전문 스킬 콘텐츠를 생성하고 DB에 upsert 후 에이전트에 할당합니다.
 *
 * @returns {Promise<void>}
 */
export async function seedAgentSkills(): Promise<void> {
    logger.info('🌱 에이전트 스킬 시딩 시작...');

    try {
        // 지연 로딩: 순환 참조 및 초기화 순서 문제 방지
        const { getUnifiedDatabase } = await import('../data/models/unified-database');
        const { SkillRepository } = await import('../data/repositories/skill-repository');
        const { getIndustryAgentsData } = await import('./types');

        const pool = getUnifiedDatabase().getPool();
        const repo = new SkillRepository(pool);
        const industryData = getIndustryAgentsData();

        if (Object.keys(industryData).length === 0) {
            logger.warn('industry-agents.json이 비어있거나 로드 실패');
            return;
        }

        let seededCount = 0;
        let errorCount = 0;

        // 모든 산업 카테고리 순회
        for (const [categoryId, categoryInfo] of Object.entries(industryData)) {
            for (const agent of categoryInfo.agents) {
                const agentWithCategory = {
                    ...agent,
                    category: categoryId,
                };

                try {
                    const skillId = `system-skill-${agent.id}`;
                    const skillContent = generateAgentSkillContent(agentWithCategory, categoryInfo);

                    // 스킬 upsert
                    await repo.upsertSystemSkill(skillId, {
                        name: `${agent.name} 전문 스킬`,
                        description: agent.description,
                        content: skillContent,
                        category: categoryId,
                        isPublic: true,
                        sourcePath: `agents/prompts/${categoryId}/${agent.id}.md`,
                    });

                    // 에이전트-스킬 연결 (우선순위 0 = 최고 우선순위)
                    await repo.assignSkillToAgent(agent.id, skillId, 0);

                    seededCount++;
                } catch (err) {
                    logger.error(`스킬 시딩 실패: ${agent.id}`, err);
                    errorCount++;
                }
            }
        }

        // general 에이전트 스킬 등록
        try {
            const generalSkillId = 'system-skill-general';
            const generalContent = `# 🤖 범용 AI 어시스턴트 전문 스킬 지침

## 전문가 정의
**범용 AI 어시스턴트**는 다양한 분야의 질문에 유연하게 대응하는 지능형 어시스턴트입니다.

## 핵심 역량

### 다학제적 지식
- 기술, 금융, 의료, 법률, 비즈니스 등 다양한 분야의 기본 지식
- 전문 분야 간 연결점 발견과 통합적 관점 제공
- 최신 정보와 트렌드 반영

### 소통 능력
- 복잡한 개념을 쉽게 설명하는 능력
- 질문의 핵심 의도를 파악하는 능력
- 다양한 배경의 사용자에게 맞춤형 답변 제공

## 응답 원칙

1. **정확성**: 사실에 기반한 정확한 정보 제공
2. **유용성**: 실제로 도움이 되는 실용적 답변
3. **명확성**: 이해하기 쉬운 언어와 구조
4. **한계 인식**: 불확실한 정보는 솔직하게 표현
5. **전문가 연계**: 전문적 조언이 필요한 경우 해당 전문가 상담 권고

## 응답 형식
- 모든 답변은 사용자 선호 언어로 제공
- 구조화된 형식으로 명확하게 전달
- 필요시 구체적 예시와 참고 자료 포함`;

            await repo.upsertSystemSkill(generalSkillId, {
                name: '범용 AI 어시스턴트 스킬',
                description: '다양한 분야 질문에 대응하는 범용 AI 어시스턴트',
                content: generalContent,
                category: 'general',
                isPublic: true,
                sourcePath: 'agents/prompts/general-agent.md',
            });

            await repo.assignSkillToAgent('general', generalSkillId, 0);
            seededCount++;
        } catch (err) {
            logger.error('general 에이전트 스킬 시딩 실패', err);
            errorCount++;
        }

        logger.info(`✅ 에이전트 스킬 시딩 완료: ${seededCount}개 성공, ${errorCount}개 실패`);
    } catch (err) {
        logger.error('❌ 에이전트 스킬 시딩 초기화 실패:', err);
        // 시딩 실패는 서버 시작을 막지 않음
    }
}
