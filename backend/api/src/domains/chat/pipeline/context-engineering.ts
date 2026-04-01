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
 * 모듈 구조:
 * - context-types.ts - 타입 정의 (FourPillarPrompt, RoleDefinition 등)
 * - context-xml-helpers.ts - XML 태그 헬퍼 함수
 * - context-engineering-locales.ts - i18n 상수 (7개 언어)
 * - context-engineering-presets.ts - 프리셋 빌더 함수
 * - context-engineering.ts (이 파일) - Builder 클래스 + re-export hub
 *
 * @see chat/prompt.ts - 이 모듈의 프리셋을 활용하여 최종 시스템 프롬프트 생성
 */

// Re-export types from context-types
export type {
    FourPillarPrompt,
    RoleDefinition,
    Constraint,
    OutputFormat,
    PromptMetadata,
} from './context-types';

import type {
    FourPillarPrompt,
    RoleDefinition,
    Constraint,
    OutputFormat,
    PromptMetadata,
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

// Presets (buildAssistantPrompt, buildCoderPrompt, buildReasoningPrompt, createDynamicMetadata)
// are exported directly from './context-engineering-presets' to avoid circular dependency.
// Import them from './context-engineering-presets' instead of this file.

import {
    generateLanguageInstructions,
    getLanguageTemplate,
    resolvePromptLocale,
    LANGUAGE_DISPLAY_NAMES,
    type PromptLocaleCode
} from './language-policy';

import {
    SECTION_LABELS,
    FORMAT_DESCRIPTIONS,
    SOFT_INTERLOCK_CONTENT,
    FINAL_REMINDER_CONTENT,
    TONE_STYLE_DESCRIPTIONS,
    DEFAULT_TONE_DESCRIPTIONS,
} from './context-engineering-locales';

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
 * 2. [Context] 예시 + 추가 섹션 (사실 기반 지식 주입)
 * 3. [Recency] 제약 조건 + 출력 형식 + 소프트 인터락 (제어 및 실행)
 *
 * @class ContextEngineeringBuilder
 * @example
 * const prompt = new ContextEngineeringBuilder()
 *   .setRole({ persona: '시니어 개발자', expertise: ['TypeScript'] })
 *   .addConstraint({ rule: '사용자 언어에 맞춰 답변', priority: 'critical', category: 'language' })
 *   .setGoal('프로덕션 수준의 코드 제공')
 *   .setOutputFormat({ type: 'code' })
 *   .build();
 */
export class ContextEngineeringBuilder {
    private metadata: PromptMetadata;
    private pillars: Partial<FourPillarPrompt> = {};
    private additionalSections: string[] = [];
    private enableThinking: boolean = true;
    private examples: Array<{ input: string; output: string }> = [];

    constructor() {
        // 기본 메타데이터 설정
        const now = new Date();
        this.metadata = {
            currentDate: now.toISOString().split('T')[0],
            knowledgeCutoff: '2024-12',
            userLanguage: 'en',
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
     * - Phase 2 (DYNAMIC): Metadata → Examples → CustomSections → Goal
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

        // 7. [Examples] Few-shot 예시
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
        const L = this.getLabels();
        const languageInstructions = this.metadata.languagePolicy
            ? generateLanguageInstructions(this.metadata.languagePolicy)
            : `${LANGUAGE_DISPLAY_NAMES[this.metadata.userLanguage] || this.metadata.userLanguage}: ${getLanguageTemplate(this.metadata.userLanguage).languageRule}`;

        return `<metadata>
${L.currentDate}: ${this.metadata.currentDate}
${L.knowledgeCutoff}: ${this.metadata.knowledgeCutoff}
${L.responseLang}: ${languageInstructions}
${this.metadata.modelName ? `${L.model}: ${this.metadata.modelName}` : ''}
</metadata>`;
    }

    private getLocale(): PromptLocaleCode {
        return resolvePromptLocale(this.metadata.userLanguage);
    }

    private getLabels() {
        return SECTION_LABELS[this.getLocale()];
    }

    /**
     * 역할 섹션 생성
     */
    private buildRoleSection(): string {
        if (!this.pillars.role) return '';
        const { role } = this.pillars;
        const L = this.getLabels();
        const traits = role.behavioralTraits?.map(t => `- ${t}`).join('\n') || '';
        const expertise = role.expertise.map(e => `- ${e}`).join('\n');
        return `<role>\n## ${L.persona}\n${role.persona}\n\n## ${L.expertise}\n${expertise}\n\n${traits ? `## ${L.behavioralTraits}\n${traits}` : ''}\n\n## ${L.conversationStyle}\n${this.getToneStyleDescription(role.toneStyle)}\n</role>`;
    }

    /**
     * 톤 스타일을 사용자 언어에 맞는 설명으로 변환
     */
    private getToneStyleDescription(toneStyle: string | undefined): string {
        const lang = this.getLocale();
        const langTones = TONE_STYLE_DESCRIPTIONS[lang] || DEFAULT_TONE_DESCRIPTIONS;
        return langTones[toneStyle || 'friendly'] || DEFAULT_TONE_DESCRIPTIONS[toneStyle || 'friendly'] || DEFAULT_TONE_DESCRIPTIONS['friendly']!;
    }

    /**
     * 제약 조건 섹션 생성
     */
    private buildConstraintsSection(): string {
        if (!this.pillars.constraints || this.pillars.constraints.length === 0) return '';
        const L = this.getLabels();
        const sortedConstraints = [...this.pillars.constraints].sort((a, b) => {
            const priority = { critical: 0, high: 1, medium: 2, low: 3 };
            return priority[a.priority] - priority[b.priority];
        });
        const criticalRules = sortedConstraints
            .filter(c => c.priority === 'critical')
            .map(c => `🚫 [${L.requiredLabel}] ${c.rule}`)
            .join('\n');
        const otherRules = sortedConstraints
            .filter(c => c.priority !== 'critical')
            .map(c => `⚠️ [${c.priority.toUpperCase()}] ${c.rule}`)
            .join('\n');
        return `<constraints>\n## ${L.criticalRules}\n${criticalRules}\n\n## ${L.generalConstraints}\n${otherRules}\n</constraints>`;
    }

    /**
     * 출력 형식 섹션 생성
     */
    private buildOutputFormatSection(): string {
        if (!this.pillars.outputFormat) return '';
        const { outputFormat } = this.pillars;
        const locale = this.getLocale();
        const L = this.getLabels();
        const formatDescs = FORMAT_DESCRIPTIONS[locale];
        let formatDesc = '';
        switch (outputFormat.type) {
            case 'json':
                formatDesc = `${formatDescs.json}\n${outputFormat.schema ? `Schema:\n\`\`\`json\n${JSON.stringify(outputFormat.schema, null, 2)}\n\`\`\`` : ''}`;
                break;
            case 'markdown':
                formatDesc = formatDescs.markdown;
                break;
            case 'table':
                formatDesc = formatDescs.table;
                break;
            case 'code':
                formatDesc = formatDescs.code;
                break;
            default:
                formatDesc = formatDescs.default;
        }
        return `<output_format>\n## ${L.outputFormat}\n${formatDesc}\n\n${outputFormat.examples?.length ? `### ${L.outputExamples}\n${outputFormat.examples.join('\n\n')}` : ''}\n</output_format>`;
    }

    /**
     * 소프트 인터락 섹션 (사고 과정 강제)
     */
    private buildSoftInterlockSection(): string {
        const L = this.getLabels();
        const content = SOFT_INTERLOCK_CONTENT[this.getLocale()];
        const steps = content.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
        const gradients = content.gradientItems.map((item) => `- ${item}`).join('\n');

        return `<instruction>
## ${L.softInterlock}

${content.processIntro}

${steps}

## ${L.epistemicGradient}

${content.gradientIntro}
${gradients}

${content.warning}
</instruction>`;
    }

    /**
     * 최종 강조 규칙 (위치 공학: 끝에 반복)
     */
    private buildFinalReminder(): string {
        const L = this.getLabels();
        const content = FINAL_REMINDER_CONTENT[this.getLocale()];
        const languageRule = this.metadata.languagePolicy
            ? generateLanguageInstructions(this.metadata.languagePolicy)
            : getLanguageTemplate(this.metadata.userLanguage).languageRule;

        return `<final_reminder>
## ${L.finalReminder}

1. **${content.languageRule}**: ${languageRule}
2. **${content.noHallucination}**
3. **${content.structure}**
4. **${content.completeness}**

${content.closing}
</final_reminder>`;
    }
}

export default ContextEngineeringBuilder;
