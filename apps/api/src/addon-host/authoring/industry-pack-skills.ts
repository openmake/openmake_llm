/**
 * industry-pack 스킬 생성기 — 저작 도구 (Add-on 전환 P2, 2026-09-19).
 *
 * 산업 에이전트 정의(`industry-agents.json`)와 분야 지침(`data/*.json`)에서 에이전트별 전문 스킬 본문을 만든다.
 * **런타임은 이 모듈을 부르지 않는다** — 결과물 `addons/builtin/industry-pack/skills.json` 이 설치 SoT 이고
 * (addon-host/pack-skills.ts), 입력 JSON 을 고친 뒤 `npm run addons:build --workspace=apps/api` 로 다시 만든다.
 * 산출물이 입력과 어긋나면 `authoring/__tests__/industry-pack-skills.test.ts` 가 실패한다.
 * 종전에는 부팅마다 agents/skill-seeder.ts 가 같은 본문을 생성해 upsert 했다.
 *
 * @module addon-host/authoring/industry-pack-skills
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Agent, AgentCategory, IndustryAgentsData } from '../../agents/types';
import { builtinAddonDir } from '../builtin-registry';
import type { PackSkillDef } from '../pack-skills';

const PACK_DIR = builtinAddonDir('industry-pack');

function loadJson<T>(relPath: string): T {
    return JSON.parse(fs.readFileSync(path.join(PACK_DIR, relPath), 'utf-8')) as T;
}

interface RichCategoryKnowledge {
    rolePrinciples: string[];
    methodologies: string[];
    toolsAndFrameworks: string[];
    challengePlaybook: Array<{ challenge: string; handling: string }>;
    standards: string[];
    outputGuidance: string[];
}

const guidelines: Record<string, string> = loadJson('data/category-guidelines.json');
const CATEGORY_KNOWLEDGE: Record<string, RichCategoryKnowledge> = loadJson('data/category-knowledge.json');
const AGENT_PROFESSIONAL_NOTES: Record<string, string> = loadJson('data/agent-professional-notes.json');

function getCategoryGuidelines(categoryId: string): string {
    return guidelines[categoryId] ?? guidelines.special;
}

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

/** 에이전트별 핵심 역량 콘텐츠 생성 */
function generateAgentSkillContent(agent: Agent, categoryInfo: AgentCategory): string {
    const override = buildRichSkillContent(agent, categoryInfo);
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

/** 산업 팩의 전체 스킬 정의 — id·이름·source_path 규칙은 종전 시더와 같다(DB 행이 그대로 유지된다). */
export function buildIndustryPackSkills(): PackSkillDef[] {
    const industryData: IndustryAgentsData = loadJson('industry-agents.json');
    const skills: PackSkillDef[] = [];
    for (const [categoryId, categoryInfo] of Object.entries(industryData)) {
        for (const agent of categoryInfo.agents) {
            skills.push({
                id: `system-skill-${agent.id}`,
                name: `${agent.name} 전문 스킬`,
                ...(agent.nameEn ? { nameEn: `${agent.nameEn} Skill` } : {}),
                description: agent.description,
                category: categoryId,
                sourcePath: `agents/prompts/${categoryId}/${agent.id}.md`,
                assignToAgent: agent.id,
                content: generateAgentSkillContent({ ...agent, category: categoryId }, categoryInfo),
            });
        }
    }
    return skills;
}
