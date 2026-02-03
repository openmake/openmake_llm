/**
 * 쿼리 내용에 따라 최적의 모델 자동 선택
 * - 모든 질문에 Gemini 모델 사용
 */
export function selectOptimalModel(query: string): { model: string; reason: string } {
    const koreanPattern = /[\uAC00-\uD7A3]/g;
    const koreanChars = query.match(koreanPattern) || [];
    const koreanRatio = koreanChars.length / query.length;

    const koreanModel = process.env.OLLAMA_KOREAN_MODEL || 'gemini-3-flash-preview:cloud';
    const defaultModel = process.env.OLLAMA_MODEL || 'gemini-3-flash-preview:cloud';

    // 한국어 비율이 30% 이상이면 한국어 특화 모델 사용
    if (koreanRatio > 0.3) {
        return {
            model: koreanModel,
            reason: `한국어 ${(koreanRatio * 100).toFixed(0)}% → Gemini 사용`
        };
    }

    // 코딩/기술 키워드 감지
    const codingKeywords = ['code', 'function', 'class', 'import', 'export', 'const', 'let', 'var', '```', 'debug', 'error', 'bug'];
    const hasCodingContext = codingKeywords.some(kw => query.toLowerCase().includes(kw));

    if (hasCodingContext) {
        return {
            model: defaultModel,
            reason: '코딩/기술 질문 → Gemini 사용'
        };
    }

    return {
        model: defaultModel,
        reason: '범용 질문 → Gemini 사용'
    };
}
