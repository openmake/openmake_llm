/**
 * ============================================================
 * Language Policy - 다국어 응답 정책 관리
 * ============================================================
 * 
 * OpenMake LLM의 언어 감지, 응답 언어 결정, 다국어 템플릿 관리를 
 * 중앙에서 담당하는 언어 정책 시스템입니다.
 * 
 * 기존 한국어 강제 시스템을 사용자 언어 기반 동적 응답으로 전환하며,
 * 언어 감지 정확도와 문화적 적절성을 보장합니다.
 * 
 * @module chat/language-policy
 */

// ============================================================
// 타입 정의
// ============================================================

/**
 * 지원되는 언어 코드 (ISO 639-1 기반)
 */
export type SupportedLanguageCode = 
    | 'ko'  // 한국어
    | 'en'  // 영어
    | 'ja'  // 일본어
    | 'zh'  // 중국어 (간체)
    | 'es'  // 스페인어
    | 'fr'  // 프랑스어
    | 'de'  // 독일어
    | 'pt'  // 포르투갈어
    | 'ru'  // 러시아어
    | 'ar'  // 아랍어
    | 'hi'  // 힌디어
    | 'it'  // 이탈리아어
    | 'nl'  // 네덜란드어
    | 'sv'  // 스웨덴어
    | 'da'  // 덴마크어
    | 'no'  // 노르웨이어
    | 'fi'  // 핀란드어
    | 'th'  // 태국어
    | 'vi'  // 베트남어
    | 'tr'  // 터키어;

/**
 * 언어 감지 결과
 */
export interface LanguageDetectionResult {
    /** 감지된 언어 코드 */
    language: SupportedLanguageCode;
    /** 감지 신뢰도 (0.0 ~ 1.0) */
    confidence: number;
    /** 감지 방법 */
    method: 'regex' | 'statistical' | 'fallback' | 'user_setting';
    /** 원본 텍스트 길이 */
    textLength: number;
    /** 처리된 텍스트 길이 (코드블록/URL 제거 후) */
    processedLength: number;
}

/**
 * 언어 정책 결정 결과
 */
export interface LanguagePolicyDecision {
    /** 요청된 언어 (사용자 입력에서 감지된 언어) */
    requestedLanguage: SupportedLanguageCode;
    /** 최종 결정된 응답 언어 */
    resolvedLanguage: SupportedLanguageCode;
    /** 정책 적용 이유 */
    reason: 'exact_match' | 'fallback_applied' | 'user_preference' | 'system_default';
    /** 폴백이 적용되었는지 여부 */
    fallbackApplied: boolean;
    /** 언어 감지 결과 */
    detection: LanguageDetectionResult;
    /** 사용자 설정 언어 (있는 경우) */
    userPreference?: SupportedLanguageCode;
}

/**
 * 언어별 응답 템플릿 설정
 */
export interface LanguageResponseTemplate {
    /** 언어 규칙 지시문 */
    languageRule: string;
    /** 형식 지침 */
    formatGuidance: string;
    /** 문화적 톤 조정 */
    culturalTone: 'formal' | 'polite' | 'casual' | 'respectful';
    /** 날짜/시간 형식 */
    dateFormat: string;
    /** 숫자 형식 */
    numberFormat: string;
}

/**
 * 언어 정책 설정
 */
export interface LanguagePolicyConfig {
    /** 기본 응답 언어 */
    defaultLanguage: SupportedLanguageCode;
    /** 동적 언어 응답 활성화 여부 */
    enableDynamicResponse: boolean;
    /** 언어 감지 최소 신뢰도 임계값 */
    minConfidenceThreshold: number;
    /** 짧은 텍스트 최소 길이 (이하는 폴백) */
    shortTextThreshold: number;
    /** 폴백 언어 */
    fallbackLanguage: SupportedLanguageCode;
    /** 지원 언어 목록 */
    supportedLanguages: SupportedLanguageCode[];
}

// ============================================================
// 언어별 템플릿 데이터
// ============================================================

/**
 * 언어별 응답 템플릿 매핑
 */
export const LANGUAGE_TEMPLATES: Record<SupportedLanguageCode, LanguageResponseTemplate> = {
    ko: {
        languageRule: '한국어로 응답 (언어 혼용 금지)',
        formatGuidance: '정중하고 전문적인 어투를 사용합니다. 존댓말을 사용합니다.',
        culturalTone: 'polite',
        dateFormat: 'YYYY년 M월 D일',
        numberFormat: '1,234,567'
    },
    en: {
        languageRule: 'Respond in English (no code-switching)',
        formatGuidance: 'Use clear, professional tone. Be concise and helpful.',
        culturalTone: 'formal',
        dateFormat: 'MMMM D, YYYY',
        numberFormat: '1,234,567'
    },
    ja: {
        languageRule: '日本語で回答してください（言語混用禁止）',
        formatGuidance: '丁寧語を使用し、敬語を適切に使い分けます。',
        culturalTone: 'respectful',
        dateFormat: 'YYYY年M月D日',
        numberFormat: '1,234,567'
    },
    zh: {
        languageRule: '请用中文回答（禁止语言混用）',
        formatGuidance: '使用简洁、专业的表达方式。保持礼貌和正式的语调。',
        culturalTone: 'formal',
        dateFormat: 'YYYY年M月D日',
        numberFormat: '1,234,567'
    },
    es: {
        languageRule: 'Responde en español (sin mezcla de idiomas)',
        formatGuidance: 'Use un tono profesional y cortés. Sea claro y útil.',
        culturalTone: 'polite',
        dateFormat: 'D de MMMM de YYYY',
        numberFormat: '1.234.567'
    },
    fr: {
        languageRule: 'Répondez en français (pas de mélange de langues)',
        formatGuidance: 'Utilisez un ton professionnel et poli. Soyez clair et utile.',
        culturalTone: 'formal',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '1 234 567'
    },
    de: {
        languageRule: 'Antworten Sie auf Deutsch (keine Sprachmischung)',
        formatGuidance: 'Verwenden Sie einen professionellen und höflichen Ton. Seien Sie klar und hilfreich.',
        culturalTone: 'formal',
        dateFormat: 'D. MMMM YYYY',
        numberFormat: '1.234.567'
    },
    pt: {
        languageRule: 'Responda em português (sem mistura de idiomas)',
        formatGuidance: 'Use um tom profissional e cortês. Seja claro e útil.',
        culturalTone: 'polite',
        dateFormat: 'D de MMMM de YYYY',
        numberFormat: '1.234.567'
    },
    ru: {
        languageRule: 'Отвечайте на русском языке (без смешения языков)',
        formatGuidance: 'Используйте профессиональный и вежливый тон. Будьте ясными и полезными.',
        culturalTone: 'formal',
        dateFormat: 'D MMMM YYYY г.',
        numberFormat: '1 234 567'
    },
    ar: {
        languageRule: 'أجب باللغة العربية (بدون خلط اللغات)',
        formatGuidance: 'استخدم نبرة مهنية ومهذبة. كن واضحاً ومفيداً.',
        culturalTone: 'respectful',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '١٬٢٣٤٬٥٦٧'
    },
    hi: {
        languageRule: 'हिंदी में उत्तर दें (भाषा मिश्रण नहीं)',
        formatGuidance: 'पेशेवर और विनम्र टोन का उपयोग करें। स्पष्ट और सहायक बनें।',
        culturalTone: 'respectful',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '12,34,567'
    },
    it: {
        languageRule: 'Rispondi in italiano (nessun mixing linguistico)',
        formatGuidance: 'Usa un tono professionale e cortese. Sii chiaro e utile.',
        culturalTone: 'polite',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '1.234.567'
    },
    nl: {
        languageRule: 'Antwoord in het Nederlands (geen taalmixen)',
        formatGuidance: 'Gebruik een professionele en beleefde toon. Wees duidelijk en behulpzaam.',
        culturalTone: 'formal',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '1.234.567'
    },
    sv: {
        languageRule: 'Svara på svenska (ingen språkblandning)',
        formatGuidance: 'Använd en professionell och artig ton. Var tydlig och hjälpsam.',
        culturalTone: 'formal',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '1 234 567'
    },
    da: {
        languageRule: 'Svar på dansk (ingen sprogblanding)',
        formatGuidance: 'Brug en professionel og høflig tone. Vær klar og hjælpsom.',
        culturalTone: 'formal',
        dateFormat: 'D. MMMM YYYY',
        numberFormat: '1.234.567'
    },
    no: {
        languageRule: 'Svar på norsk (ingen språkblanding)',
        formatGuidance: 'Bruk en profesjonell og høflig tone. Vær tydelig og hjelpsom.',
        culturalTone: 'formal',
        dateFormat: 'D. MMMM YYYY',
        numberFormat: '1 234 567'
    },
    fi: {
        languageRule: 'Vastaa suomeksi (ei kielten sekoittamista)',
        formatGuidance: 'Käytä ammattimaista ja kohteliasta sävyä. Ole selkeä ja avulias.',
        culturalTone: 'formal',
        dateFormat: 'D. MMMM YYYY',
        numberFormat: '1 234 567'
    },
    th: {
        languageRule: 'ตอบเป็นภาษาไทย (ไม่ผสมภาษา)',
        formatGuidance: 'ใช้น้ำเสียงที่สุภาพและเป็นมืออาชีพ เป็นประโยชน์และชัดเจน',
        culturalTone: 'respectful',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '1,234,567'
    },
    vi: {
        languageRule: 'Trả lời bằng tiếng Việt (không trộn ngôn ngữ)',
        formatGuidance: 'Sử dụng giọng điệu chuyên nghiệp và lịch sự. Hãy rõ ràng và hữu ích.',
        culturalTone: 'polite',
        dateFormat: 'Ngày D tháng M năm YYYY',
        numberFormat: '1.234.567'
    },
    tr: {
        languageRule: 'Türkçe cevap verin (dil karıştırma yok)',
        formatGuidance: 'Profesyonel ve kibar bir ton kullanın. Net ve yardımcı olun.',
        culturalTone: 'polite',
        dateFormat: 'D MMMM YYYY',
        numberFormat: '1.234.567'
    }
};

/**
 * 기본 언어 정책 설정
 */
export const DEFAULT_LANGUAGE_POLICY: LanguagePolicyConfig = {
    defaultLanguage: 'ko',
    enableDynamicResponse: false, // Feature flag로 제어
    minConfidenceThreshold: 0.7,
    shortTextThreshold: 10,
    fallbackLanguage: 'en',
    supportedLanguages: [
        'ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 
        'ar', 'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr'
    ]
};

// ============================================================
// 언어 감지 및 정책 결정 함수
// ============================================================

/**
 * 텍스트에서 코드블록과 URL을 제거하여 순수 자연어 텍스트만 추출
 */
export function preprocessTextForLanguageDetection(text: string): string {
    return text
        // 코드블록 제거 (```code```, `inline code`)
        .replace(/```[\s\S]*?```/g, '')
        .replace(/`[^`]*`/g, '')
        // URL 제거
        .replace(/https?:\/\/[^\s]+/g, '')
        // 이메일 제거
        .replace(/\S+@\S+\.\S+/g, '')
        // 숫자만 있는 부분 제거
        .replace(/^\d+$/gm, '')
        // 특수문자만 있는 라인 제거
        .replace(/^[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+$/gm, '')
        // 여러 공백을 하나로
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 언어별 문자 패턴 정의
 */
export const LANGUAGE_PATTERNS = {
    ko: /[\uac00-\ud7af]/g,          // 한글
    ja: /[\u3040-\u309f\u30a0-\u30ff]/g, // 히라가나, 가타카나
    zh: /[\u4e00-\u9fff]/g,         // 중국어 한자
    ar: /[\u0600-\u06ff]/g,         // 아랍어
    hi: /[\u0900-\u097f]/g,         // 데바나가리 (힌디어)
    th: /[\u0e00-\u0e7f]/g,         // 태국어
    ru: /[\u0400-\u04ff]/g,         // 키릴 문자 (러시아어)
    // 라틴 알파벳 기반 언어들은 별도 처리
    latin: /[a-zA-ZÀ-ÿ]/g          // 라틴 알파벳 + 확장 문자
};

/**
 * 고급 언어 감지 함수 (기존 detectLanguageForMetadata 대체)
 */
export function detectLanguage(text: string): LanguageDetectionResult {
    const originalLength = text.length;
    const processedText = preprocessTextForLanguageDetection(text);
    const processedLength = processedText.length;
    
    // 빈 텍스트 또는 너무 짧은 텍스트 처리
    if (processedLength < DEFAULT_LANGUAGE_POLICY.shortTextThreshold) {
        return {
            language: DEFAULT_LANGUAGE_POLICY.fallbackLanguage,
            confidence: 0.5,
            method: 'fallback',
            textLength: originalLength,
            processedLength
        };
    }
    
    // 비라틴 문자 언어 우선 감지
    const nonLatinResults = [
        { lang: 'ko' as const, matches: processedText.match(LANGUAGE_PATTERNS.ko) },
        { lang: 'ja' as const, matches: processedText.match(LANGUAGE_PATTERNS.ja) },
        { lang: 'zh' as const, matches: processedText.match(LANGUAGE_PATTERNS.zh) },
        { lang: 'ar' as const, matches: processedText.match(LANGUAGE_PATTERNS.ar) },
        { lang: 'hi' as const, matches: processedText.match(LANGUAGE_PATTERNS.hi) },
        { lang: 'th' as const, matches: processedText.match(LANGUAGE_PATTERNS.th) },
        { lang: 'ru' as const, matches: processedText.match(LANGUAGE_PATTERNS.ru) }
    ];
    
    // 비라틴 문자 언어 체크
    for (const { lang, matches } of nonLatinResults) {
        if (matches && matches.length > 0) {
            const ratio = matches.length / processedLength;
            if (ratio > 0.3) { // 30% 이상이면 해당 언어로 판단
                return {
                    language: lang,
                    confidence: Math.min(ratio * 2, 1.0), // 최대 1.0으로 제한
                    method: 'regex',
                    textLength: originalLength,
                    processedLength
                };
            }
        }
    }
    
    // 라틴 알파벳 기반 언어 처리 (기존 로직 유지 + 확장)
    const latinMatches = processedText.match(LANGUAGE_PATTERNS.latin);
    if (!latinMatches || latinMatches.length === 0) {
        return {
            language: DEFAULT_LANGUAGE_POLICY.fallbackLanguage,
            confidence: 0.5,
            method: 'fallback',
            textLength: originalLength,
            processedLength
        };
    }
    
    // 기존 한국어-영어 비율 로직 (하위 호환성)
    const koreanMatches = processedText.match(LANGUAGE_PATTERNS.ko) || [];
    const total = koreanMatches.length + latinMatches.length;
    const koreanRatio = koreanMatches.length / total;
    
    if (koreanRatio > 0.7) {
        return {
            language: 'ko',
            confidence: koreanRatio,
            method: 'regex',
            textLength: originalLength,
            processedLength
        };
    } else if (koreanRatio < 0.1) {
        // 라틴 문자만 있는 경우 영어로 분류 (개선 가능)
        return {
            language: 'en',
            confidence: 0.8,
            method: 'regex',
            textLength: originalLength,
            processedLength
        };
    } else {
        // 혼합 텍스트의 경우 한국어 우선
        return {
            language: 'ko',
            confidence: 0.6,
            method: 'regex',
            textLength: originalLength,
            processedLength
        };
    }
}

/**
 * 언어 정책 결정 함수
 */
export function determineLanguagePolicy(
    text: string,
    config: LanguagePolicyConfig = DEFAULT_LANGUAGE_POLICY,
    userPreference?: SupportedLanguageCode
): LanguagePolicyDecision {
    const detection = detectLanguage(text);
    
    // 동적 응답이 비활성화된 경우 기본 언어 사용
    if (!config.enableDynamicResponse) {
        return {
            requestedLanguage: detection.language,
            resolvedLanguage: config.defaultLanguage,
            reason: 'system_default',
            fallbackApplied: true,
            detection,
            userPreference
        };
    }
    
    // 사용자 설정 언어가 있는 경우 우선 적용
    if (userPreference && config.supportedLanguages.includes(userPreference)) {
        return {
            requestedLanguage: detection.language,
            resolvedLanguage: userPreference,
            reason: 'user_preference',
            fallbackApplied: false,
            detection,
            userPreference
        };
    }
    
    // 감지된 언어가 지원되고 신뢰도가 충분한 경우
    if (config.supportedLanguages.includes(detection.language) && 
        detection.confidence >= config.minConfidenceThreshold) {
        return {
            requestedLanguage: detection.language,
            resolvedLanguage: detection.language,
            reason: 'exact_match',
            fallbackApplied: false,
            detection,
            userPreference
        };
    }
    
    // 폴백 언어 적용
    return {
        requestedLanguage: detection.language,
        resolvedLanguage: config.fallbackLanguage,
        reason: 'fallback_applied',
        fallbackApplied: true,
        detection,
        userPreference
    };
}

/**
 * 언어별 응답 템플릿 가져오기
 */
export function getLanguageTemplate(language: SupportedLanguageCode): LanguageResponseTemplate {
    return LANGUAGE_TEMPLATES[language] || LANGUAGE_TEMPLATES.en;
}

/**
 * 언어 정책을 기반으로 프롬프트용 언어 지시문 생성
 */
export function generateLanguageInstructions(policy: LanguagePolicyDecision): string {
    const template = getLanguageTemplate(policy.resolvedLanguage);
    
    return `**언어 규칙**: ${template.languageRule}
**형식 지침**: ${template.formatGuidance}`;
}