/**
 * ============================================================
 * 프롬프트 향상 유틸리티 (mcp-enhance-prompt 스타일)
 * ============================================================
 * 
 * 참조: https://github.com/FelixFoster/mcp-enhance-prompt
 * 
 * 기능:
 * 1. 사용자 프롬프트 분석 및 향상
 * 2. 프롬프트 품질 평가
 * 3. 맥락 정보 자동 추가
 */

import { PromptType, detectPromptType, getPromptTypeDescription } from './prompt';

// ============================================================
// 타입 정의
// ============================================================

export interface EnhancedPrompt {
    original: string;
    enhanced: string;
    suggestedMode: PromptType;
    modeDescription: string;
    context: PromptContext;
    qualityScore: QualityScore;
}

export interface PromptContext {
    hasCode: boolean;
    hasQuestion: boolean;
    hasCommand: boolean;
    language: 'ko' | 'en' | 'mixed';
    complexity: 'simple' | 'medium' | 'complex';
    topic: string | null;
}

export interface QualityScore {
    overall: number;  // 0-100
    clarity: number;
    specificity: number;
    context: number;
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
 * 프롬프트 향상 생성
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
 * 맥락 정보 추가
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
 * 프롬프트 향상 결과 포맷팅
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
