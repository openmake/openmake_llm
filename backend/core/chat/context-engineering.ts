/**
 * ============================================================
 * 컨텍스트 엔지니어링 핵심 모듈
 * ============================================================
 * 
 * 참조: 차세대 LLM 서비스를 위한 시스템 프롬프트 아키텍처 및 
 *       컨텍스트 엔지니어링 심층 분석 보고서
 * 
 * 핵심 원칙:
 * 1. 4-Pillar Framework (역할, 제약, 목표, 출력형식)
 * 2. XML 태깅 및 구획화
 * 3. 메타데이터 동적 주입
 * 4. 위치 공학 (Position Engineering)
 * 5. 소프트 인터락 (Soft Interlock)
 * 6. 인식적 구배 (Epistemic Gradient)
 */

// ============================================================
// 타입 정의
// ============================================================

/**
 * 4-Pillar Framework 구조
 */
export interface FourPillarPrompt {
    /** 역할 및 페르소나 */
    role: RoleDefinition;
    /** 제약 조건 */
    constraints: Constraint[];
    /** 목표 */
    goal: string;
    /** 출력 형식 */
    outputFormat: OutputFormat;
}

export interface RoleDefinition {
    persona: string;
    expertise: string[];
    behavioralTraits?: string[];
    toneStyle?: 'formal' | 'casual' | 'professional' | 'friendly';
}

export interface Constraint {
    rule: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    category: 'security' | 'language' | 'format' | 'content' | 'behavior';
}

export interface OutputFormat {
    type: 'json' | 'markdown' | 'plain' | 'code' | 'table' | 'structured';
    schema?: object;
    examples?: string[];
}

/**
 * 메타데이터 주입을 위한 컨텍스트
 */
export interface PromptMetadata {
    currentDate: string;
    knowledgeCutoff: string;
    sessionId?: string;
    userLanguage: 'ko' | 'en' | 'mixed';
    requestTimestamp: string;
    modelName?: string;
}

/**
 * RAG 컨텍스트 정보
 */
export interface RAGContext {
    documents: RAGDocument[];
    searchQuery: string;
    relevanceThreshold: number;
}

export interface RAGDocument {
    content: string;
    source: string;
    timestamp?: string;
    relevanceScore: number;
}

// ============================================================
// XML 태그 헬퍼 함수
// ============================================================

/**
 * XML 태그로 콘텐츠 래핑
 */
export function xmlTag(tagName: string, content: string, attributes?: Record<string, string>): string {
    const attrStr = attributes
        ? ' ' + Object.entries(attributes).map(([k, v]) => `${k}="${v}"`).join(' ')
        : '';
    return `<${tagName}${attrStr}>\n${content}\n</${tagName}>`;
}

/**
 * 시스템 규칙 섹션 생성
 */
export function systemRulesSection(rules: string[]): string {
    const content = rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n');
    return xmlTag('system_rules', content);
}

/**
 * 컨텍스트 섹션 생성 (RAG 결과 등)
 */
export function contextSection(context: string): string {
    return xmlTag('context', context);
}

/**
 * 예시 섹션 생성 (Few-shot)
 */
export function examplesSection(examples: Array<{ input: string; output: string }>): string {
    const content = examples.map((ex, i) =>
        `### 예시 ${i + 1}\n입력: ${ex.input}\n출력: ${ex.output}`
    ).join('\n\n');
    return xmlTag('examples', content);
}

/**
 * 사고 과정 섹션 (Soft Interlock)
 */
export function thinkingSection(): string {
    return `<thinking>
[이 섹션에서 문제를 분석하고 답변 전략을 수립하세요]
1. 문제 분석: 사용자가 무엇을 요구하는가?
2. 접근 전략: 어떤 방법으로 해결할 것인가?
3. 안전성 검증: 이 답변이 안전한가?
4. 출력 계획: 어떤 형식으로 제공할 것인가?
</thinking>`;
}

// ============================================================
// 4-Pillar 프롬프트 빌더
// ============================================================

/**
 * 4-Pillar 프롬프트 빌더 클래스
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
     * 최종 프롬프트 빌드
     * 위치 공학 (Positional Engineering) 적용: 
     * - 시작(Primacy): 페르소나와 핵심 맥락 배치
     * - 끝(Recency): 절대 규칙, 출력 형식, 최종 리마인더 배치
     */
    build(): string {
        const sections: string[] = [];

        // 1. [Primacy Section] 메타데이터 + 역할 정의 (정체성 확립)
        sections.push(this.buildMetadataSection());
        sections.push(this.buildRoleSection());

        // 2. [Context Section] RAG + 예시 + 도구 (사실 기반 지식 주입)
        if (this.ragContext) {
            sections.push(this.buildRAGSection());
        }

        if (this.examples.length > 0) {
            sections.push(examplesSection(this.examples));
        }

        // 추가 동적 섹션 (에이전틱 상태 등)
        sections.push(...this.additionalSections);

        // 과업 목표
        if (this.pillars.goal) {
            sections.push(xmlTag('goal', this.pillars.goal));
        }

        // 3. [Recency Section] 🔒 보안/제약 + 출력 형식 + 소프트 인터락 (제어 및 실행)
        // 중요도가 높은 규칙들을 마지막에 배치하여 지침 준수율 극대화
        sections.push(this.buildConstraintsSection());
        sections.push(this.buildOutputFormatSection());

        // 소프트 인터락 (Thinking Process)
        if (this.enableThinking) {
            sections.push(this.buildSoftInterlockSection());
        }

        // 최종 강조 리마인더 (Double Recency)
        sections.push(this.buildFinalReminder());

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
 * 유틸리티: 동적 메타데이터 생성
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
 * 언어 감지 및 메타데이터 업데이트
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
