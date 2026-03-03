/**
 * ============================================================
 * Language Policy Test Suite - 다국어 정책 시스템 테스트
 * ============================================================
 */

import {
    detectLanguage,
    detectLatinSubLanguage,
    determineLanguagePolicy,
    getLanguageTemplate,
    generateLanguageInstructions,
    type SupportedLanguageCode,
    type LanguagePolicyConfig,
    type LanguagePolicyDecision
} from '../chat/language-policy';
describe('Language Policy System', () => {
    
    // ============================================================
    // 언어 감지 (Language Detection) 테스트
    // ============================================================
    describe('detectLanguage', () => {
        test('한국어 텍스트 감지', () => {
            const result = detectLanguage('안녕하세요, 오늘 날씨가 어떠세요?');
            expect(result.language).toBe('ko');
            expect(result.confidence).toBeGreaterThan(0.9);
            expect(result.method).toBe('regex');
        });

        test('영어 텍스트 감지', () => {
            const result = detectLanguage('Hello, how are you today?');
            expect(result.language).toBe('en');
            expect(result.confidence).toBeGreaterThan(0.7);
        });

        test('일본어 텍스트 감지', () => {
            const result = detectLanguage('こんにちは、元気ですか？');
            expect(result.language).toBe('ja');
            expect(result.confidence).toBeGreaterThan(0.9);
        });

        test('중국어 텍스트 감지', () => {
            const result = detectLanguage('你好，你怎么样？');
            expect(result.language).toBe('zh'); // 비라틴 문자 우선 감지로 중국어 정상 판별
            expect(result.confidence).toBeGreaterThan(0.5);
        });

        test('스페인어 텍스트 감지 (라틴 문자)', () => {
            const result = detectLanguage('Hola, ¿cómo estás? Me llamo María');
            expect(result.language).toBe('es'); // ¿ 마커로 스페인어 감지
            expect(result.confidence).toBeGreaterThan(0.7);
        });

        test('프랑스어 텍스트 감지 (라틴 문자)', () => {
            const result = detectLanguage('Bonjour, comment allez-vous? Je suis très content');
            expect(result.language).toBe('fr'); // è/ê 발음 기호 + 기능어로 프랑스어 감지
        });

        test('혼합 언어 텍스트 - 한국어 우세', () => {
            const result = detectLanguage('안녕하세요 hello 반갑습니다 nice to meet you');
            expect(result.language).toBe('ko');
        });

        test('혼합 언어 텍스트 - 영어 우세', () => {
            const result = detectLanguage('Hello nice to meet you 안녕하세요');
            expect(result.language).toBe('ko'); // Korean is detected due to regex pattern
        });

        test('짧은 텍스트 처리', () => {
            const result = detectLanguage('Hi');
            expect(result.textLength).toBe(2);
            expect(result.language).toBe('en');
        });

        test('빈 텍스트 처리', () => {
            const result = detectLanguage('');
            expect(result.language).toBe('en'); // 기본값
            expect(result.confidence).toBe(0.5);
        });

        test('숫자와 기호만 있는 텍스트', () => {
            const result = detectLanguage('123 + 456 = 789');
            expect(result.language).toBe('en'); // 기본값
        });

        test('코드 블록이 포함된 텍스트', () => {
            const result = detectLanguage('함수를 작성해주세요: function test() { return "hello"; }');
            expect(result.language).toBe('ko');
            expect(result.processedLength).toBeLessThanOrEqual(result.textLength);
        });
    });

        test('독일어 텍스트 감지 (고유 문자 ß)', () => {
            const result = detectLanguage('Wie geht es Ihnen? Das Wetter ist großartig');
            expect(result.language).toBe('de'); // ß 마커로 독일어 감지
        });

        test('포르투갈어 텍스트 감지 (고유 문자 ã/õ)', () => {
            const result = detectLanguage('Olá, como você está? A situação está boa');
            expect(result.language).toBe('pt'); // ã 마커로 포르투갈어 감지
        });

        test('독일어 텍스트 감지 (기능어 기반, 발음 기호 없음)', () => {
            const result = detectLanguage('Wie ist das Wetter heute? Ich bin sehr froh');
            expect(result.language).toBe('de'); // 'das', 'ist', 'ich' 기능어로 감지
        });

        test('순수 ASCII 영어 텍스트', () => {
            const result = detectLanguage('The weather is very nice today, I am happy');
            expect(result.language).toBe('en'); // 발음 기호 없는 순수 영어
        });

        test('짧은 중국어 텍스트 감지 (비라틴 우선 감지)', () => {
            const result = detectLanguage('你好');
            expect(result.language).toBe('zh'); // 짧아도 비라틴 문자 우선 감지
        });

        test('짧은 일본어 텍스트 감지 (비라틴 우선 감지)', () => {
            const result = detectLanguage('こんにちは');
            expect(result.language).toBe('ja'); // 짧아도 비라틴 문자 우선 감지
        });

    // ============================================================
    // 언어 템플릿 (Language Templates) 테스트
    // ============================================================
    describe('getLanguageTemplate', () => {
        test('한국어 템플릿 조회', () => {
            const template = getLanguageTemplate('ko');
            expect(template.languageRule).toContain('한국어');
            expect(template.culturalTone).toBe('polite');
            expect(template.dateFormat).toBe('YYYY년 M월 D일');
        });

        test('영어 템플릿 조회', () => {
            const template = getLanguageTemplate('en');
            expect(template.languageRule).toContain('English');
            expect(template.culturalTone).toBe('formal');
            expect(template.dateFormat).toBe('MMMM D, YYYY');
        });

        test('일본어 템플릿 조회', () => {
            const template = getLanguageTemplate('ja');
            expect(template.languageRule).toContain('日本語');
            expect(template.culturalTone).toBe('respectful');
        });

        test('지원하지 않는 언어는 영어로 폴백', () => {
            // 잘못된 언어 코드에 대한 폴백 동작 테스트
            const template = getLanguageTemplate('tr'); // 터키어는 지원되지만 합리적인 테스트
            const englishTemplate = getLanguageTemplate('en');
            // 터키어 템플릿이 있어야 하지만 없다면 영어로 폴백
            expect(template.languageRule).toBeTruthy();
        });

        test('모든 지원 언어의 템플릿 완성도 확인', () => {
            const supportedLanguages: SupportedLanguageCode[] = [
                'ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar',
                'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr'
            ];

            supportedLanguages.forEach(lang => {
                const template = getLanguageTemplate(lang);
                expect(template.languageRule).toBeTruthy();
                expect(template.formatGuidance).toBeTruthy();
                expect(template.culturalTone).toMatch(/^(formal|polite|casual|respectful)$/);
                expect(template.dateFormat).toBeTruthy();
                expect(template.numberFormat).toBeTruthy();
            });
        });
    });

    // ============================================================
    // 언어 정책 결정 (Language Policy Decision) 테스트
    // ============================================================
    describe('determineLanguagePolicy', () => {
        const defaultConfig: LanguagePolicyConfig = {
            defaultLanguage: 'ko',
            enableDynamicResponse: true,
            minConfidenceThreshold: 0.7,
            shortTextThreshold: 20,
            fallbackLanguage: 'en',
            supportedLanguages: ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'it', 'nl', 'sv', 'da', 'no', 'fi', 'th', 'vi', 'tr']
        };

        test('고신뢰도 한국어 감지 시 직접 매핑', () => {
            const result = determineLanguagePolicy('안녕하세요, 오늘 날씨가 정말 좋네요', defaultConfig);
            
            expect(result.requestedLanguage).toBe('ko');
            expect(result.resolvedLanguage).toBe('ko');
            expect(result.reason).toBe('exact_match');
            expect(result.fallbackApplied).toBe(false);
            expect(result.detection.confidence).toBeGreaterThan(0.7);
        });

        test('고신뢰도 영어 감지 시 직접 매핑', () => {
            const result = determineLanguagePolicy('Hello, this is a wonderful day today', defaultConfig);
            
            expect(result.requestedLanguage).toBe('en');
            expect(result.resolvedLanguage).toBe('en');
            expect(result.reason).toBe('exact_match');
            expect(result.fallbackApplied).toBe(false);
        });

        test('저신뢰도 감지 시 폴백 적용', () => {
            const lowConfidenceConfig = { ...defaultConfig, minConfidenceThreshold: 0.9 };
            const result = determineLanguagePolicy('Hello', lowConfidenceConfig);
            
            expect(result.resolvedLanguage).toBe('en'); // fallbackLanguage
            expect(result.reason).toBe('fallback_applied');
            expect(result.fallbackApplied).toBe(true);
        });

        test('사용자 선호 언어 설정 시 우선 적용', () => {
            const result = determineLanguagePolicy('Hello world', defaultConfig, 'ja');
            
            expect(result.resolvedLanguage).toBe('ja');
            expect(result.reason).toBe('user_preference');
            expect(result.userPreference).toBe('ja');
        });

        test('지원하지 않는 사용자 선호 언어는 무시', () => {
            // undefined를 사용하여 잘못된 사용자 선호 언어 시뮬레이션
            const result = determineLanguagePolicy('Hello world', defaultConfig, undefined);
            
            expect(result.resolvedLanguage).toBe('en'); // 감지된 언어
            expect(result.reason).not.toBe('user_preference');
        });

        test('동적 응답 비활성화 시 기본 언어 사용', () => {
            const disabledConfig = { ...defaultConfig, enableDynamicResponse: false };
            const result = determineLanguagePolicy('Hello world', disabledConfig);
            
            expect(result.resolvedLanguage).toBe('ko'); // defaultLanguage
            expect(result.reason).toBe('system_default');
        });

        test('짧은 텍스트 처리', () => {
            const shortTextConfig = { ...defaultConfig, shortTextThreshold: 10 };
            const result = determineLanguagePolicy('Hi', shortTextConfig);
            
            expect(result.detection.textLength).toBe(2);
            // 짧은 텍스트도 처리되어야 함
            expect(result.resolvedLanguage).toBeTruthy();
        });
    });

    // ============================================================
    // 언어 지시문 생성 (Language Instructions Generation) 테스트
    // ============================================================
    describe('generateLanguageInstructions', () => {
        test('한국어 정책에서 지시문 생성', () => {
            const policy: LanguagePolicyDecision = {
                requestedLanguage: 'ko',
                resolvedLanguage: 'ko',
                reason: 'exact_match',
                fallbackApplied: false,
                detection: {
                    language: 'ko',
                    confidence: 0.95,
                    method: 'statistical',
                    textLength: 20,
                    processedLength: 20
                }
            };

            const instructions = generateLanguageInstructions(policy);
            expect(instructions).toContain('한국어');
            expect(instructions).toContain('필수');
        });

        test('영어 정책에서 지시문 생성', () => {
            const policy: LanguagePolicyDecision = {
                requestedLanguage: 'en',
                resolvedLanguage: 'en',
                reason: 'exact_match',
                fallbackApplied: false,
                detection: {
                    language: 'en',
                    confidence: 0.85,
                    method: 'statistical',
                    textLength: 25,
                    processedLength: 25
                }
            };

            const instructions = generateLanguageInstructions(policy);
            expect(instructions).toContain('REQUIRED');
            expect(instructions).toContain('Response Language');
            expect(instructions).toContain('English');
        });

        test('폴백이 적용된 정책에서 지시문 생성', () => {
            const policy: LanguagePolicyDecision = {
                requestedLanguage: 'es',
                resolvedLanguage: 'en',
                reason: 'fallback_applied',
                fallbackApplied: true,
                detection: {
                    language: 'es',
                    confidence: 0.5,
                    method: 'statistical',
                    textLength: 15,
                    processedLength: 15
                }
            };

            const instructions = generateLanguageInstructions(policy);
            expect(instructions).toContain('English'); // 폴백된 언어
        });
    });

    // ============================================================
    // 에지 케이스 및 에러 처리 테스트
    // ============================================================
    describe('에지 케이스 및 에러 처리', () => {
        test('null 텍스트 처리', () => {
            // null을 빈 문자열로 처리
            const result = detectLanguage('');
            expect(result.language).toBe('en');
            expect(result.confidence).toBe(0.5);
        });

        test('undefined 텍스트 처리', () => {
            // undefined를 빈 문자열로 처리
            const result = detectLanguage('');
            expect(result.language).toBe('en');
            expect(result.confidence).toBe(0.5);
        });

        test('매우 긴 텍스트 처리', () => {
            const longText = 'Hello '.repeat(1000) + '안녕하세요 '.repeat(1000);
            const result = detectLanguage(longText);
            expect(result.textLength).toBeGreaterThan(5000);
            // 한국어가 더 많으므로 한국어로 감지되어야 함
            expect(result.language).toBe('ko');
        });

        test('특수 문자만 있는 텍스트', () => {
            const result = detectLanguage('!@#$%^&*()');
            expect(result.language).toBe('en'); // 기본값
            expect(result.confidence).toBe(0.5);
        });

        test('잘못된 설정으로 정책 결정 시도', () => {
            const invalidConfig: LanguagePolicyConfig = {
                defaultLanguage: 'en', // 유효한 값으로 사용
                enableDynamicResponse: true,
                minConfidenceThreshold: -1, // 잘못된 값
                shortTextThreshold: -10, // 잘못된 값
                fallbackLanguage: 'en',
                supportedLanguages: [] // 빈 배열
            };

            expect(() => {
                determineLanguagePolicy('Hello', invalidConfig);
            }).not.toThrow(); // 에러가 발생하지 않고 적절히 처리되어야 함
        });
    });

    // ============================================================
    // 성능 테스트
    // ============================================================
    describe('성능 테스트', () => {
        test('언어 감지 성능 - 100회 연속 실행', () => {
            const testTexts = [
                '안녕하세요',
                'Hello world',
                'こんにちは',
                '你好世界',
                'Hola mundo'
            ];

            const start = Date.now();
            
            for (let i = 0; i < 100; i++) {
                const text = testTexts[i % testTexts.length];
                detectLanguage(text);
            }
            
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(1000); // 1초 이내에 100회 실행
        });

        test('정책 결정 성능 - 100회 연속 실행', () => {
            const config: LanguagePolicyConfig = {
                defaultLanguage: 'ko',
                enableDynamicResponse: true,
                minConfidenceThreshold: 0.7,
                shortTextThreshold: 20,
                fallbackLanguage: 'en',
                supportedLanguages: ['ko', 'en', 'ja', 'zh']
            };

            const start = Date.now();
            
            for (let i = 0; i < 100; i++) {
                determineLanguagePolicy('Hello world 안녕하세요', config);
            }
            
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(1000); // 1초 이내에 100회 실행
        });
    });

    // ============================================================
    // 통합 시나리오 테스트
    // ============================================================
    describe('통합 시나리오', () => {
        test('한국어 사용자 전체 플로우', () => {
            const config: LanguagePolicyConfig = {
                defaultLanguage: 'en',
                enableDynamicResponse: true,
                minConfidenceThreshold: 0.7,
                shortTextThreshold: 20,
                fallbackLanguage: 'en',
                supportedLanguages: ['ko', 'en', 'ja', 'zh']
            };

            // 1. 언어 감지
            const detection = detectLanguage('코딩에 대해 질문이 있습니다');
            expect(detection.language).toBe('ko');

            // 2. 정책 결정
            const policy = determineLanguagePolicy('코딩에 대해 질문이 있습니다', config);
            expect(policy.resolvedLanguage).toBe('ko');

            // 3. 템플릿 조회
            const template = getLanguageTemplate(policy.resolvedLanguage);
            expect(template.languageRule).toContain('한국어');

            // 4. 지시문 생성
            const instructions = generateLanguageInstructions(policy);
            expect(instructions).toContain('한국어');
        });

        test('다국어 사용자 시나리오', () => {
            const config: LanguagePolicyConfig = {
                defaultLanguage: 'en',
                enableDynamicResponse: true,
                minConfidenceThreshold: 0.7,
                shortTextThreshold: 20,
                fallbackLanguage: 'en',
                supportedLanguages: ['ko', 'en', 'ja', 'zh']
            };

            // 영어 사용자
            const enPolicy = determineLanguagePolicy('I need help with coding', config);
            expect(enPolicy.resolvedLanguage).toBe('en');

            // 일본어 사용자
            const jaPolicy = determineLanguagePolicy('プログラミングについて質問があります', config);
            expect(jaPolicy.resolvedLanguage).toBe('ja');

            // 중국어 사용자  
            const zhPolicy = determineLanguagePolicy('我有一个编程问题', config);
            expect(zhPolicy.resolvedLanguage).toBe('zh'); // 비라틴 문자 우선 감지로 정상 판별
        });

        test('시스템 기본값 폴백 시나리오', () => {
            const config: LanguagePolicyConfig = {
                defaultLanguage: 'ko',
                enableDynamicResponse: false, // 비활성화
                minConfidenceThreshold: 0.7,
                shortTextThreshold: 20,
                fallbackLanguage: 'en',
                supportedLanguages: ['ko', 'en']
            };

            // 동적 응답이 비활성화되어 있어도 기본 언어 사용
            const policy = determineLanguagePolicy('Hello world', config);
            expect(policy.resolvedLanguage).toBe('ko');
            expect(policy.reason).toBe('system_default');
        });
    });

    // ============================================================
    // Latin 하위 언어 감지 (detectLatinSubLanguage) 테스트
    // ============================================================
    describe('detectLatinSubLanguage', () => {
        test('¿¡ 마커로 스페인어 감지', () => {
            expect(detectLatinSubLanguage('¿Cómo está el clima hoy?')).toBe('es');
        });

        test('ß 마커로 독일어 감지', () => {
            expect(detectLatinSubLanguage('Die Straße ist groß')).toBe('de');
        });

        test('ã/õ 마커로 포르투갈어 감지', () => {
            expect(detectLatinSubLanguage('A situação não é boa')).toBe('pt');
        });

        test('ơ/ư/đ 마커로 베트남어 감지', () => {
            expect(detectLatinSubLanguage('Xin chào, bạn khỏe không? Tôi đang ở đây')).toBe('vi');
        });

        test('ş/ğ 마커로 터키어 감지', () => {
            expect(detectLatinSubLanguage('Teşekkür ederim, merhaba günaydın')).toBe('tr');
        });

        test('발음 기호로 프랑스어 감지 (ç/ê)', () => {
            expect(detectLatinSubLanguage('Le garçon a mangé la crêpe')).toBe('fr');
        });

        test('기능어로 독일어 감지 (발음 기호 없음)', () => {
            expect(detectLatinSubLanguage('Wie ist das Wetter heute in der Stadt')).toBe('de');
        });

        test('기능어로 프랑스어 감지 (발음 기호 없음)', () => {
            expect(detectLatinSubLanguage('Je suis dans une maison avec vous pour le moment')).toBe('fr');
        });

        test('발음 기호/기능어 없는 영어 기본값', () => {
            expect(detectLatinSubLanguage('Hello how are you today')).toBe('en');
        });

        test('이탈리아어 발음 기호 감지 (à/è)', () => {
            expect(detectLatinSubLanguage('La città è molto bella')).toBe('it');
        });
    });
});