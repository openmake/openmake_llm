/**
 * ============================================================
 * Context Engineering - 4-Pillar Framework 기반 시스템 프롬프트 생성
 * ============================================================
 * 
 * 차세대 LLM 서비스를 위한 시스템 프롬프트 아키텍처 핵심 모듈입니다.
 * 4가지 기둥(Role, Constraints, Goal, OutputFormat)을 Builder 패턴으로 조합하여
 * 구조화된 시스템 프롬프트를 생성합니다.
 * 
 * @module chat/context-engineering
 * @description
 * - 4-Pillar Framework: Role(역할), Constraints(제약), Goal(목표), OutputFormat(출력형식)
 * - XML 태깅 구획화: 각 섹션을 XML 태그로 분리하여 LLM의 지시 준수율 향상
 * - 메타데이터 동적 주입: 날짜, 지식 기준일, 세션ID, 언어, 모델명 자동 삽입
 * - 위치 공학 (Position Engineering): 중요 지시를 프롬프트 시작/끝에 배치
 * - 소프트 인터락 (Soft Interlock): 답변 전 사고 프로세스 강제
 * - 인식적 구배 (Epistemic Gradient): 확실성/불확실성 수준 명시
 * - 프롬프트 인젝션 방어: escapeXml()로 사용자 입력 이스케이프
 * 
 * 프리셋 프롬프트 빌더:
 * - buildAssistantPrompt(): 친절한 AI 어시스턴트
 * - buildCoderPrompt(): 시니어 풀스택 개발자
 * - buildReasoningPrompt(): 논리적 추론 전문가
 * 
 * @see chat/prompt.ts - 이 모듈의 프리셋을 활용하여 최종 시스템 프롬프트 생성
 * @see chat/prompt-enhancer.ts - 사용자 프롬프트 품질 향상
 */

// Re-export types from context-types
export type {
    FourPillarPrompt,
    RoleDefinition,
    Constraint,
    OutputFormat,
    PromptMetadata,
    RAGContext,
    RAGDocument
} from './context-types';

import type {
    FourPillarPrompt,
    RoleDefinition,
    Constraint,
    OutputFormat,
    PromptMetadata,
    RAGContext,
} from './context-types';

// Re-export XML helpers from context-xml-helpers
export {
    xmlTag,
    systemRulesSection,
    contextSection,
    examplesSection,
    thinkingSection
} from './context-xml-helpers';

import { xmlTag, examplesSection } from './context-xml-helpers';

// ============================================================
// 4-Pillar 프롬프트 빌더
// ============================================================

/**
 * 4-Pillar 프롬프트 빌더 클래스
 * 
 * Builder 패턴으로 시스템 프롬프트를 단계적으로 구성합니다.
 * build() 호출 시 위치 공학(Position Engineering)을 적용하여 최종 프롬프트를 생성합니다.
 * 
 * 빌드 순서 (위치 공학 적용):
 * 1. [Primacy] 메타데이터 + 역할 정의 (정체성 확립)
 * 2. [Context] RAG 문서 + 예시 + 추가 섹션 (사실 기반 지식 주입)
 * 3. [Recency] 제약 조건 + 출력 형식 + 소프트 인터락 (제어 및 실행)
 * 
 * @class ContextEngineeringBuilder
 * @example
 * const prompt = new ContextEngineeringBuilder()
 *   .setRole({ persona: '시니어 개발자', expertise: ['TypeScript'] })
 *   .addConstraint({ rule: '한국어 답변', priority: 'critical', category: 'language' })
 *   .setGoal('프로덕션 수준의 코드 제공')
 *   .setOutputFormat({ type: 'code' })
 *   .build();
 */
export class ContextEngineeringBuilder {
    private metadata: PromptMetadata;
    private pillars: Partial<FourPillarPrompt> = {};
    private ragContext?: RAGContext;
    private additionalSections: string[] = [];
    private enableThinking: boolean = true;
    private examples: Array<{ input: string; output: string }> = [];

    constructor() {
        // 기본 메타데이터 설정
        const now = new Date();
        this.metadata = {
            currentDate: now.toISOString().split('T')[0],
            knowledgeCutoff: '2024-12',
            userLanguage: 'ko',
            requestTimestamp: now.toISOString()
        };
    }

    /**
     * 메타데이터 설정
     */
    setMetadata(metadata: Partial<PromptMetadata>): this {
        this.metadata = { ...this.metadata, ...metadata };
        return this;
    }

    /**
     * 역할 정의 (Pillar 1)
     */
    setRole(role: RoleDefinition): this {
        this.pillars.role = role;
        return this;
    }

    /**
     * 제약 조건 추가 (Pillar 2)
     */
    addConstraint(constraint: Constraint): this {
        if (!this.pillars.constraints) {
            this.pillars.constraints = [];
        }
        this.pillars.constraints.push(constraint);
        return this;
    }

    /**
     * 목표 설정 (Pillar 3)
     */
    setGoal(goal: string): this {
        this.pillars.goal = goal;
        return this;
    }

    /**
     * 출력 형식 설정 (Pillar 4)
     */
    setOutputFormat(format: OutputFormat): this {
        this.pillars.outputFormat = format;
        return this;
    }

    /**
     * RAG 컨텍스트 설정
     */
    setRAGContext(context: RAGContext): this {
        this.ragContext = context;
        return this;
    }

    /**
     * Few-shot 예시 추가
     */
    addExample(input: string, output: string): this {
        this.examples.push({ input, output });
        return this;
    }

    /**
     * 추가 섹션 추가
     */
    addSection(section: string): this {
        this.additionalSections.push(section);
        return this;
    }

    /**
     * 사고 과정 활성화/비활성화
     */
    setThinkingEnabled(enabled: boolean): this {
        this.enableThinking = enabled;
        return this;
    }

    /**
     * 4-Pillar Framework (Role, Constraints, Goal, OutputFormat)를 기반으로
     * 최종 시스템 프롬프트를 빌드합니다.
     * 
     * Prefix Cache 최적화 (Cloud LLM):
     * - Phase 1 (STATIC): Role → Constraints → OutputFormat → Interlock → Reminder
     *   요청 간 동일한 정적 섹션을 앞에 배치하여 implicit prefix caching 활용
     * - Phase 2 (DYNAMIC): Metadata → RAG → Examples → CustomSections → Goal
     *   요청마다 변하는 동적 섹션을 뒤에 배치
     * 
     * @returns 조립된 전체 시스템 프롬프트 문자열 (XML 태깅 구획화 적용)
     */
    build(): string {
        const sections: string[] = [];

        // ── Phase 1: STATIC sections (prefix-cacheable) ──
        // Cloud LLM의 implicit prefix caching을 활용하기 위해
        // 요청 간 변하지 않는 정적 콘텐츠를 프롬프트 앞부분에 배치

        // 1. [Identity] 역할 정의 — 페르소나 확립
        sections.push(this.buildRoleSection());

        // 2. [Rules] 제약 조건 — 보안/언어/행동 규칙
        sections.push(this.buildConstraintsSection());

        // 3. [Format] 출력 형식 — 응답 구조 지정
        sections.push(this.buildOutputFormatSection());

        // 4. [Process] 소프트 인터락 — 사고 프로세스 강제
        if (this.enableThinking) {
            sections.push(this.buildSoftInterlockSection());
        }

        // 5. [Reinforcement] 최종 리마인더 — Double Recency
        sections.push(this.buildFinalReminder());

        // ── Phase 2: DYNAMIC sections (per-request) ──
        // 요청마다 변하는 동적 콘텐츠 — 캐시 미스 영역

        // 6. [Context] 메타데이터 — 날짜, 세션, 모델 정보
        sections.push(this.buildMetadataSection());

        // 7. [Knowledge] RAG 컨텍스트 — 검색된 참조 문서
        if (this.ragContext) {
            sections.push(this.buildRAGSection());
        }

        // 8. [Examples] Few-shot 예시
        if (this.examples.length > 0) {
            sections.push(examplesSection(this.examples));
        }

        // 9. [Agentic] 추가 동적 섹션
        sections.push(...this.additionalSections);

        // 10. [Task] 과업 목표
        if (this.pillars.goal) {
            sections.push(xmlTag('goal', this.pillars.goal, undefined, false));
        }

        return sections.join('\n\n');
    }

    /**
     * 메타데이터 섹션 생성
     */
    private buildMetadataSection(): string {
        return `<metadata>
현재 날짜: ${this.metadata.currentDate}
지식 기준일: ${this.metadata.knowledgeCutoff}
응답 언어: ${this.metadata.userLanguage === 'ko' ? '한국어' : '영어'}
${this.metadata.modelName ? `모델: ${this.metadata.modelName}` : ''}
</metadata>`;
    }

    /**
     * 역할 섹션 생성
     */
    private buildRoleSection(): string {
        if (!this.pillars.role) {
            return '';
        }

        const { role } = this.pillars;
        const traits = role.behavioralTraits?.map(t => `- ${t}`).join('\n') || '';
        const expertise = role.expertise.map(e => `- ${e}`).join('\n');

        return `<role>
## 페르소나
${role.persona}

## 전문 분야
${expertise}

${traits ? `## 행동 특성\n${traits}` : ''}

## 대화 스타일
${role.toneStyle === 'formal' ? '격식체 사용' :
                role.toneStyle === 'casual' ? '반말체, 친근한 어조' :
                    role.toneStyle === 'professional' ? '전문적이고 객관적인 어조' :
                        '친근하고 편안한 어조'}
</role>`;
    }

    /**
     * RAG 컨텍스트 섹션 생성
     */
    private buildRAGSection(): string {
        if (!this.ragContext || this.ragContext.documents.length === 0) {
            return '';
        }

        const docs = this.ragContext.documents
            .filter(d => d.relevanceScore >= this.ragContext!.relevanceThreshold)
            .map((d, i) => `### 문서 ${i + 1} (관련도: ${(d.relevanceScore * 100).toFixed(0)}%)
출처: ${d.source}
${d.timestamp ? `날짜: ${d.timestamp}` : ''}

${d.content}`)
            .join('\n\n');

        return `<context>
## 검색된 참조 문서
검색어: "${this.ragContext.searchQuery}"

${docs}

⚠️ 위 문서의 정보를 우선 참조하되, 최신 정보와 타임스탬프를 확인하세요.
</context>`;
    }

    /**
     * 제약 조건 섹션 생성
     */
    private buildConstraintsSection(): string {
        if (!this.pillars.constraints || this.pillars.constraints.length === 0) {
            return '';
        }

        // 우선순위별 정렬
        const sortedConstraints = [...this.pillars.constraints].sort((a, b) => {
            const priority = { critical: 0, high: 1, medium: 2, low: 3 };
            return priority[a.priority] - priority[b.priority];
        });

        const criticalRules = sortedConstraints
            .filter(c => c.priority === 'critical')
            .map(c => `🚫 [필수] ${c.rule}`)
            .join('\n');

        const otherRules = sortedConstraints
            .filter(c => c.priority !== 'critical')
            .map(c => `⚠️ [${c.priority.toUpperCase()}] ${c.rule}`)
            .join('\n');

        return `<constraints>
## 🔒 절대 규칙 (위반 불가)
${criticalRules}

## ⚠️ 일반 제약
${otherRules}
</constraints>`;
    }

    /**
     * 출력 형식 섹션 생성
     */
    private buildOutputFormatSection(): string {
        if (!this.pillars.outputFormat) {
            return '';
        }

        const { outputFormat } = this.pillars;
        let formatDesc = '';

        switch (outputFormat.type) {
            case 'json':
                formatDesc = `JSON 형식으로 출력하세요.
${outputFormat.schema ? `스키마:\n\`\`\`json\n${JSON.stringify(outputFormat.schema, null, 2)}\n\`\`\`` : ''}`;
                break;
            case 'markdown':
                formatDesc = '마크다운 형식으로 구조화하여 출력하세요. 헤더(##), 목록(-), 코드블록(\`\`\`)을 활용하세요.';
                break;
            case 'table':
                formatDesc = '정보를 표 형식으로 정리하세요. | 헤더 | 형식을 사용하세요.';
                break;
            case 'code':
                formatDesc = '코드 블록으로 출력하세요. 언어 태그를 포함하세요.';
                break;
            default:
                formatDesc = '자연스러운 문장으로 답변하세요.';
        }

        return `<output_format>
## 출력 형식 지침
${formatDesc}

${outputFormat.examples?.length ? `### 출력 예시\n${outputFormat.examples.join('\n\n')}` : ''}
</output_format>`;
    }

    /**
     * 소프트 인터락 섹션 (사고 과정 강제)
     */
    private buildSoftInterlockSection(): string {
        return `<instruction>
## 🧠 답변 전 사고 프로세스 (Soft Interlock)

답변을 생성하기 전에 반드시 다음 과정을 내부적으로 수행하세요:

1. **문제 분석**: 사용자가 정확히 무엇을 원하는가?
2. **정보 검증**: 내가 알고 있는 정보가 정확한가? 불확실한 부분은 무엇인가?
3. **접근 전략**: 어떤 방식으로 설명/해결할 것인가?
4. **안전성 검증**: 이 답변이 안전하고 윤리적인가?
5. **형식 결정**: 어떤 형식이 가장 효과적인가?

## 📊 인식적 구배 (Epistemic Gradient)

답변 시 정보의 확실성을 명확히 구분하세요:
- **확실한 사실**: 직접적으로 서술
- **높은 확신**: "~입니다" 또는 "~합니다"
- **중간 확신**: "제가 알기로는~" 또는 "일반적으로~"
- **낮은 확신**: "확인이 필요하지만~" 또는 "추측하건대~"
- **모름**: "이 부분은 정확한 정보가 없습니다"

⚠️ 환각(Hallucination) 방지: 모르는 것은 솔직히 인정하세요.
</instruction>`;
    }

    /**
     * 최종 강조 규칙 (위치 공학: 끝에 반복)
     */
    private buildFinalReminder(): string {
        return `<final_reminder>
## 🎯 최종 확인 사항 (반드시 준수)

1. **언어 규칙**: ${this.metadata.userLanguage === 'ko' ? '한국어로 답변 (언어 혼용 금지)' : '영어로 답변'}
2. **환각 금지**: 불확실한 정보는 명시적으로 표현
3. **구조화**: 복잡한 답변은 헤더와 목록으로 정리
4. **완전성**: 질문에 대한 완전한 답변 제공

위 규칙을 재확인한 후 답변을 생성하세요.
</final_reminder>`;
    }
}

// ============================================================
// 프리셋 프롬프트 빌더
// ============================================================

/**
 * 기본 어시스턴트 프롬프트 빌더
 */
export function buildAssistantPrompt(): string {
    return new ContextEngineeringBuilder()
        .setRole({
            persona: '친절하고 똑똑한 AI 어시스턴트',
            expertise: ['일반 지식', '문제 해결', '정보 정리', '대화'],
            behavioralTraits: [
                '친근하고 편안한 어조 사용',
                '어려운 용어는 쉽게 풀어서 설명',
                '이모지를 적절히 활용하여 친근감 표현'
            ],
            toneStyle: 'friendly'
        })
        .addConstraint({
            rule: '한국어 질문에는 반드시 한국어로 답변',
            priority: 'critical',
            category: 'language'
        })
        .addConstraint({
            rule: '언어 혼용(Code Switching) 절대 금지',
            priority: 'critical',
            category: 'language'
        })
        .addConstraint({
            rule: '확실하지 않은 정보는 명시적으로 인정',
            priority: 'high',
            category: 'content'
        })
        .setGoal('사용자의 질문에 친절하고 정확하게 답변하며, 이해하기 쉽게 설명')
        .setOutputFormat({
            type: 'markdown',
            examples: [
                '질문에 대한 핵심 답변을 먼저 제공한 후, 추가 설명을 덧붙이세요.'
            ]
        })
        .build();
}

/**
 * 코딩 전문가 프롬프트 빌더
 */
export function buildCoderPrompt(): string {
    return new ContextEngineeringBuilder()
        .setRole({
            persona: '15년 경력의 시니어 풀스택 개발자',
            expertise: [
                'TypeScript, Python, Go, Rust',
                'React, Next.js, FastAPI, Express',
                'Docker, Kubernetes, AWS',
                'Clean Code, SOLID, TDD'
            ],
            behavioralTraits: [
                '프로덕션 수준의 안전한 코드 작성',
                '에러 핸들링과 엣지 케이스 고려',
                '성능 최적화 관점에서 설계'
            ],
            toneStyle: 'professional'
        })
        .addConstraint({
            rule: '모든 설명과 주석은 한국어로 작성',
            priority: 'critical',
            category: 'language'
        })
        .addConstraint({
            rule: '완전하고 실행 가능한 코드만 제공 (TODO, ... 금지)',
            priority: 'critical',
            category: 'content'
        })
        .addConstraint({
            rule: '보안 취약점 없는 코드 작성 (OWASP Top 10 준수)',
            priority: 'high',
            category: 'security'
        })
        .setGoal('사용자의 요구사항을 분석하고 프로덕션 수준의 완전한 코드 제공')
        .setOutputFormat({
            type: 'structured',
            examples: [
                '### 1. 요구사항 분석\n### 2. 설계 방향\n### 3. 구현 코드\n### 4. 실행 방법\n### 5. 테스트'
            ]
        })
        .build();
}

/**
 * 추론 전문가 프롬프트 빌더
 */
export function buildReasoningPrompt(): string {
    return new ContextEngineeringBuilder()
        .setRole({
            persona: '논리적 분석 및 추론 전문가',
            expertise: [
                '복잡한 문제 분해 및 분석',
                '단계별 논리적 추론',
                '수학적 계산 및 비교',
                '의사결정 및 트레이드오프 분석'
            ],
            behavioralTraits: [
                '모든 문제에 Chain of Thought 적용',
                '각 단계의 논리를 명확히 설명',
                '결론에 도달한 과정을 투명하게 제시'
            ],
            toneStyle: 'professional'
        })
        .addConstraint({
            rule: '모든 추론과 답변은 한국어로 작성',
            priority: 'critical',
            category: 'language'
        })
        .addConstraint({
            rule: '복잡한 문제는 반드시 단계별로 분해하여 접근',
            priority: 'high',
            category: 'behavior'
        })
        .setGoal('복잡한 문제를 단계별로 분석하고 논리적인 결론 도출')
        .setOutputFormat({
            type: 'structured',
            examples: [
                '<think>\n1단계: 문제 이해\n2단계: 핵심 정보 파악\n3단계: 분석 실행\n4단계: 검증\n</think>\n\n### 결론\n[최종 답변]'
            ]
        })
        .setThinkingEnabled(true)
        .build();
}

/**
 * 현재 시점의 동적 메타데이터를 생성합니다.
 * 날짜, 지식 기준일, 세션 ID를 자동으로 설정합니다.
 * 
 * @returns 현재 시점 기준의 PromptMetadata 객체
 */
export function createDynamicMetadata(): PromptMetadata {
    const now = new Date();
    return {
        currentDate: now.toISOString().split('T')[0],
        knowledgeCutoff: '2024-12',
        userLanguage: 'ko',
        requestTimestamp: now.toISOString(),
        sessionId: `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    };
}

/**
 * 텍스트의 한국어/영어 비율을 분석하여 언어를 감지합니다.
 * 한국어 70% 초과면 'ko', 30% 미만이면 'en', 그 사이면 'mixed'를 반환합니다.
 * 
 * @param text - 언어를 감지할 텍스트
 * @returns 감지된 언어 코드
 */
export function detectLanguageForMetadata(text: string): 'ko' | 'en' | 'mixed' {
    const koreanRegex = /[가-힣]/g;
    const englishRegex = /[a-zA-Z]/g;

    const koreanMatches = (text.match(koreanRegex) || []).length;
    const englishMatches = (text.match(englishRegex) || []).length;

    const total = koreanMatches + englishMatches;
    if (total === 0) return 'en';

    const koreanRatio = koreanMatches / total;

    if (koreanRatio > 0.7) return 'ko';
    if (koreanRatio < 0.3) return 'en';
    return 'mixed';
}

// 기본 내보내기
export default ContextEngineeringBuilder;
