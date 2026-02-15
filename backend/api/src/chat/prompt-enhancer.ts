/**
 * ============================================================
 * Prompt Enhancer - 사용자 프롬프트 분석, 품질 평가 및 향상
 * ============================================================
 * 
 * 사용자가 입력한 프롬프트를 분석하여 품질 점수를 계산하고,
 * 최적의 역할 모드를 추천하며, 프롬프트 개선 제안을 제공합니다.
 * mcp-enhance-prompt 패턴을 참조하여 구현되었습니다.
 * 
 * @module chat/prompt-enhancer
 * @description
 * - 프롬프트 컨텍스트 분석: 코드 포함 여부, 질문 형태, 명령 감지, 언어, 복잡도, 주제
 * - 프롬프트 품질 평가: 명확성, 구체성, 맥락 각 100점 기준 점수 산출
 * - 프롬프트 향상: 복잡한 요청에 구조화 힌트 추가
 * - 역할 모드 추천: detectPromptType() 연동으로 최적 PromptType 제안
 * 
 * @see chat/prompt.ts - detectPromptType() 함수 참조
 * @see https://github.com/FelixFoster/mcp-enhance-prompt - 참조 구현
 */

import { PromptType, detectPromptType, getPromptTypeDescription } from './prompt';

// ============================================================
// 타입 정의
// ============================================================

/**
 * 프롬프트 향상 결과 인터페이스
 * enhancePrompt()의 반환 타입입니다.
 */
export interface EnhancedPrompt {
    /** 원본 프롬프트 */
    original: string;
    /** 향상된 프롬프트 (구조화 힌트 등 추가) */
    enhanced: string;
    /** 추천된 역할 모드 */
    suggestedMode: PromptType;
    /** 추천 모드의 한국어 설명 */
    modeDescription: string;
    /** 프롬프트 컨텍스트 분석 결과 */
    context: PromptContext;
    /** 프롬프트 품질 점수 */
    qualityScore: QualityScore;
}

/**
 * 프롬프트 컨텍스트 분석 결과 인터페이스
 * extractContext()가 프롬프트를 분석하여 반환합니다.
 */
export interface PromptContext {
    /** 코드 블록 또는 프로그래밍 키워드 포함 여부 */
    hasCode: boolean;
    /** 질문 형태 (물음표, 의문사) 포함 여부 */
    hasQuestion: boolean;
    /** 명령/요청 (해줘, create 등) 포함 여부 */
    hasCommand: boolean;
    /** 감지된 언어 */
    language: 'ko' | 'en' | 'mixed';
    /** 프롬프트 복잡도 (단어 수, 다중 질문, 코드 블록 기준) */
    complexity: 'simple' | 'medium' | 'complex';
    /** 추출된 주제 (programming, analysis, explanation, generation, 또는 null) */
    topic: string | null;
}

/**
 * 프롬프트 품질 점수 인터페이스
 * evaluatePromptQuality()가 산출하는 3축 품질 점수입니다.
 */
export interface QualityScore {
    /** 전체 평균 점수 (0-100) */
    overall: number;
    /** 명확성 점수: 길이, 구두점 기반 (0-100) */
    clarity: number;
    /** 구체성 점수: 구체적 요청, 예시, 형식 지정 기반 (0-100) */
    specificity: number;
    /** 맥락 점수: 배경 정보, 목적 포함 기반 (0-100) */
    context: number;
    /** 개선 제안 문자열 배열 */
    suggestions: string[];
}

// ============================================================
// 프롬프트 분석 함수
// ============================================================

/**
 * 프롬프트 언어 감지
 */
function detectLanguage(prompt: string): 'ko' | 'en' | 'mixed' {
    const koreanRegex = /[가-힣]/g;
    const englishRegex = /[a-zA-Z]/g;

    const koreanMatches = (prompt.match(koreanRegex) || []).length;
    const englishMatches = (prompt.match(englishRegex) || []).length;

    const total = koreanMatches + englishMatches;
    if (total === 0) return 'en';

    const koreanRatio = koreanMatches / total;

    if (koreanRatio > 0.7) return 'ko';
    if (koreanRatio < 0.3) return 'en';
    return 'mixed';
}

/**
 * 프롬프트 복잡도 분석
 */
function analyzeComplexity(prompt: string): 'simple' | 'medium' | 'complex' {
    const wordCount = prompt.split(/\s+/).length;
    const hasMultipleQuestions = (prompt.match(/\?/g) || []).length > 1;
    const hasCodeBlock = prompt.includes('```');
    const hasMultipleTasks = /그리고|또한|추가로|and|also|additionally/i.test(prompt);

    if (wordCount < 10 && !hasMultipleQuestions && !hasCodeBlock) {
        return 'simple';
    }
    if (wordCount > 50 || hasMultipleTasks || hasCodeBlock) {
        return 'complex';
    }
    return 'medium';
}

/**
 * 프롬프트 주제 추출
 */
function extractTopic(prompt: string): string | null {
    // 코드 관련
    if (/코드|프로그래밍|함수|클래스|code|programming|function|class/i.test(prompt)) {
        return 'programming';
    }
    // 분석 관련
    if (/분석|리뷰|검토|analyze|review/i.test(prompt)) {
        return 'analysis';
    }
    // 설명 관련
    if (/설명|뭐야|왜|어떻게|explain|what|why|how/i.test(prompt)) {
        return 'explanation';
    }
    // 생성 관련
    if (/만들어|생성|create|generate|build/i.test(prompt)) {
        return 'generation';
    }
    return null;
}

/**
 * 프롬프트 컨텍스트 분석
 */
export function extractContext(prompt: string): PromptContext {
    return {
        hasCode: /```|\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bvar\b|\bdef\b|\bimport\b/i.test(prompt),
        hasQuestion: prompt.includes('?') || /뭐|왜|어떻게|무엇|언제|어디|누구/i.test(prompt),
        hasCommand: /해줘|해주세요|하세요|make|create|generate|write|build/i.test(prompt),
        language: detectLanguage(prompt),
        complexity: analyzeComplexity(prompt),
        topic: extractTopic(prompt)
    };
}

// ============================================================
// 프롬프트 품질 평가
// ============================================================

/**
 * 프롬프트 품질 점수 계산
 */
export function evaluatePromptQuality(prompt: string): QualityScore {
    const suggestions: string[] = [];

    // 명확성 점수 (길이, 구두점)
    let clarity = 50;
    if (prompt.length > 20) clarity += 15;
    if (prompt.length > 50) clarity += 10;
    if (prompt.includes('?') || prompt.includes('.')) clarity += 10;
    if (prompt.length < 10) {
        clarity -= 20;
        suggestions.push('프롬프트를 더 자세하게 작성해 보세요');
    }

    // 구체성 점수 (구체적인 요청, 예시)
    let specificity = 40;
    if (/구체적|자세히|상세히|specifically|detailed/i.test(prompt)) specificity += 20;
    if (/예시|예를 들어|example|e\.g\./i.test(prompt)) specificity += 15;
    if (/형식|포맷|format/i.test(prompt)) specificity += 10;
    if (specificity < 60) {
        suggestions.push('원하는 출력 형식이나 예시를 추가하면 더 좋은 결과를 얻을 수 있습니다');
    }

    // 맥락 점수 (배경 정보, 목적)
    let context = 40;
    if (/왜냐하면|목적|이유|because|purpose|reason/i.test(prompt)) context += 20;
    if (/배경|상황|context|background/i.test(prompt)) context += 20;
    if (prompt.length > 100) context += 15;
    if (context < 60) {
        suggestions.push('작업의 목적이나 배경을 추가하면 더 관련성 높은 답변을 받을 수 있습니다');
    }

    clarity = Math.min(100, Math.max(0, clarity));
    specificity = Math.min(100, Math.max(0, specificity));
    context = Math.min(100, Math.max(0, context));

    const overall = Math.round((clarity + specificity + context) / 3);

    return { overall, clarity, specificity, context, suggestions };
}

// ============================================================
// 프롬프트 향상
// ============================================================

/**
 * 사용자 프롬프트를 분석하여 향상된 결과를 생성합니다.
 * 
 * 처리 단계:
 * 1. 컨텍스트 분석 (extractContext)
 * 2. 최적 역할 모드 감지 (detectPromptType)
 * 3. 품질 점수 평가 (evaluatePromptQuality)
 * 4. 복잡한 요청에 구조화 힌트 추가
 * 
 * @param userPrompt - 사용자 원본 프롬프트
 * @returns 향상된 프롬프트, 추천 모드, 품질 점수, 개선 제안을 포함한 결과
 */
export function enhancePrompt(userPrompt: string): EnhancedPrompt {
    const context = extractContext(userPrompt);
    const suggestedMode = detectPromptType(userPrompt);
    const qualityScore = evaluatePromptQuality(userPrompt);

    // 기본 향상 적용
    let enhanced = userPrompt.trim();

    // 언어별 친화적 접두어 추가 (옵션)
    if (context.language === 'ko' && !enhanced.endsWith('요') && !enhanced.endsWith('다')) {
        // 한국어 질문 형식 개선 (선택적)
    }

    // 복잡한 요청에 구조화 힌트 추가
    if (context.complexity === 'complex' && !enhanced.includes('단계별')) {
        enhanced = `${enhanced}\n\n(참고: 복잡한 요청이므로 단계별로 접근해 주세요)`;
    }

    return {
        original: userPrompt,
        enhanced,
        suggestedMode,
        modeDescription: getPromptTypeDescription(suggestedMode),
        context,
        qualityScore
    };
}

/**
 * 프롬프트에 맥락 정보 메타데이터를 접두사로 추가합니다.
 * 
 * @param prompt - 원본 프롬프트
 * @param additionalContext - 추가할 맥락 정보 (topic, complexity)
 * @returns 맥락 정보가 접두사로 추가된 프롬프트
 */
export function addContext(prompt: string, additionalContext: Partial<PromptContext>): string {
    const contextLines: string[] = [];

    if (additionalContext.topic) {
        contextLines.push(`[주제: ${additionalContext.topic}]`);
    }
    if (additionalContext.complexity) {
        contextLines.push(`[복잡도: ${additionalContext.complexity}]`);
    }

    if (contextLines.length > 0) {
        return `${contextLines.join(' ')}\n\n${prompt}`;
    }
    return prompt;
}

/**
 * 프롬프트 향상 결과를 마크다운 형식으로 포맷팅합니다.
 * 품질 점수 표, 추천 모드, 컨텍스트 요약, 개선 제안을 포함합니다.
 * 
 * @param result - enhancePrompt()의 결과
 * @returns 마크다운 형식의 분석 결과 문자열
 */
export function formatEnhancementResult(result: EnhancedPrompt): string {
    return `## 프롬프트 분석 결과

### 📊 품질 점수
| 항목 | 점수 |
|------|------|
| 전체 | ${result.qualityScore.overall}/100 |
| 명확성 | ${result.qualityScore.clarity}/100 |
| 구체성 | ${result.qualityScore.specificity}/100 |
| 맥락 | ${result.qualityScore.context}/100 |

### 🎯 추천 모드
**${result.suggestedMode}** - ${result.modeDescription}

### 📝 컨텍스트
- 언어: ${result.context.language === 'ko' ? '한국어' : result.context.language === 'en' ? '영어' : '혼합'}
- 복잡도: ${result.context.complexity}
- 코드 포함: ${result.context.hasCode ? '예' : '아니오'}
${result.context.topic ? `- 주제: ${result.context.topic}` : ''}

### 💡 개선 제안
${result.qualityScore.suggestions.length > 0
            ? result.qualityScore.suggestions.map(s => `- ${s}`).join('\n')
            : '- 프롬프트가 충분히 잘 작성되었습니다!'}
`;
}
