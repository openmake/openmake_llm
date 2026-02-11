/**
 * ============================================================
 * Model Selector - 질문 유형별 자동 모델 라우팅
 * ============================================================
 * 
 * 질문 유형(코딩/분석/창작/비전/한국어 등)에 따라 최적의 Ollama 모델을
 * 자동 선택하고, 각 모델 API 특성에 맞춰 파라미터를 조정합니다.
 * 
 * @module chat/model-selector
 */

import { getConfig } from '../config/env';
import { ModelOptions } from '../ollama/types';

// ============================================================
// 질문 유형 정의
// ============================================================

export type QueryType = 
    | 'code'           // 코딩/개발 관련
    | 'analysis'       // 데이터 분석/논리적 추론
    | 'creative'       // 창작/글쓰기/브레인스토밍
    | 'vision'         // 이미지 분석/멀티모달
    | 'korean'         // 한국어 특화
    | 'math'           // 수학/과학 계산
    | 'chat'           // 일반 대화
    | 'document'       // 문서 분석/요약
    | 'translation';   // 번역

export interface QueryClassification {
    type: QueryType;
    confidence: number;
    subType?: string;
    matchedPatterns: string[];
}

export interface ModelSelection {
    model: string;
    options: ModelOptions;
    reason: string;
    queryType: QueryType;
    supportsToolCalling: boolean;
    supportsThinking: boolean;
    supportsVision: boolean;
}

// ============================================================
// 모델 프리셋 정의
// ============================================================

interface ModelPreset {
    name: string;
    envKey: string;           // .env 변수명
    defaultModel: string;     // 기본 모델명
    options: ModelOptions;
    capabilities: {
        toolCalling: boolean;
        thinking: boolean;
        vision: boolean;
        streaming: boolean;
        contextLength: number;
    };
    bestFor: QueryType[];
    priority: number;         // 우선순위 (낮을수록 높음)
}

// 사용 가능한 모델 프리셋
const MODEL_PRESETS: Record<string, ModelPreset> = {
    // Gemini 3 Flash - 범용/코딩/분석
    'gemini-flash': {
        name: 'Gemini 3 Flash',
        envKey: 'OLLAMA_MODEL_1',
        defaultModel: 'gemini-3-flash-preview:cloud',
        options: {
            temperature: 0.7,
            top_p: 0.9,
            top_k: 40,
            num_ctx: 32768,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: true,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['code', 'analysis', 'chat', 'korean', 'document'],
        priority: 1,
    },

    // GPT-OSS 120B - 고성능 추론/창작
    'gpt-oss': {
        name: 'GPT-OSS 120B',
        envKey: 'OLLAMA_MODEL_2',
        defaultModel: 'gpt-oss:120b-cloud',
        options: {
            temperature: 0.8,
            top_p: 0.95,
            top_k: 50,
            num_ctx: 32768,
            repeat_penalty: 1.15,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['creative', 'analysis', 'document'],
        priority: 2,
    },

    // Kimi K2.5 - 긴 컨텍스트/문서 분석
    'kimi': {
        name: 'Kimi K2.5',
        envKey: 'OLLAMA_MODEL_3',
        defaultModel: 'kimi-k2.5:cloud',
        options: {
            temperature: 0.5,
            top_p: 0.85,
            top_k: 30,
            num_ctx: 65536,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: 65536,
        },
        bestFor: ['document', 'analysis', 'translation'],
        priority: 3,
    },

    // Qwen3 Coder Next - 코딩 특화
    'qwen-coder': {
        name: 'Qwen3 Coder Next',
        envKey: 'OLLAMA_MODEL_4',
        defaultModel: 'qwen3-coder-next:cloud',
        options: {
            temperature: 0.2,
            top_p: 0.8,
            top_k: 20,
            num_ctx: 32768,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: false,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['code'],
        priority: 1,  // 코딩에 최우선
    },

    // Qwen3 VL 235B - 비전/멀티모달
    'qwen-vl': {
        name: 'Qwen3 VL 235B',
        envKey: 'OLLAMA_MODEL_5',
        defaultModel: 'qwen3-vl:235b-cloud',
        options: {
            temperature: 0.6,
            top_p: 0.9,
            top_k: 40,
            num_ctx: 32768,
            repeat_penalty: 1.1,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: true,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['vision'],
        priority: 1,  // 비전에 최우선
    },

    // 수학/과학 특화 프리셋
    'math-reasoning': {
        name: 'Math Reasoning',
        envKey: 'OLLAMA_DEFAULT_MODEL',
        defaultModel: 'gemini-3-flash-preview:cloud',
        options: {
            temperature: 0.2,
            top_p: 0.8,
            top_k: 15,
            num_ctx: 32768,
            repeat_penalty: 1.0,
        },
        capabilities: {
            toolCalling: true,
            thinking: true,
            vision: true,
            streaming: true,
            contextLength: 32768,
        },
        bestFor: ['math'],
        priority: 1,
    },
};

// ============================================================
// 질문 유형 분류 패턴
// ============================================================

interface QueryPattern {
    type: QueryType;
    patterns: RegExp[];
    keywords: string[];
    weight: number;
}

const QUERY_PATTERNS: QueryPattern[] = [
    {
        type: 'code',
        patterns: [
            /```[\w]*\n/,                    // 코드 블록
            /\b(function|class|const|let|var|def|import|export|return)\b/i,
            /\b(error|bug|debug|fix|compile|runtime)\b/i,
            /\.(js|ts|py|java|cpp|c|go|rs|rb|php|swift|kt)\b/i,
            /\b(react|vue|angular|node|express|django|flask|spring)\b/i,
            /\b(useState|useEffect|component|props|state)\b/i,
        ],
        keywords: [
            '코드', '코딩', '프로그래밍', '개발', '함수', '클래스', '버그', '에러', 
            '디버그', '컴파일', '구현', 'api', '서버', '백엔드', '프론트엔드',
            'code', 'function', 'class', 'debug', 'error', 'implement',
            '리팩토링', '최적화', '알고리즘', '자료구조', '라이브러리', '프레임워크',
            'react', 'vue', 'angular', 'python', 'javascript', 'typescript',
            '컴포넌트', 'component', 'useState', 'useEffect', '훅', 'hook'
        ],
        weight: 1.2,  // 코드 가중치 상향
    },
    {
        type: 'analysis',
        patterns: [
            /\b(분석|분석해|analyze|analysis)\b/i,
            /\b(통계|데이터|차트|그래프|추세|패턴)\b/i,
            /\b(비교|장단점|pros|cons|compare)\b/i,
        ],
        keywords: [
            '분석', '분석해', '통계', '데이터', '인사이트', '추세', '패턴',
            '비교', '장단점', '평가', '검토', '조사', '리서치',
            'analyze', 'analysis', 'statistics', 'data', 'compare', 'evaluate'
        ],
        weight: 0.9,
    },
    {
        type: 'creative',
        patterns: [
            /\b(이야기|스토리|시나리오|소설|시)\b.*\b(작성|써|만들)\b/i,
            /\b(작성|써|만들)\b.*\b(이야기|스토리|시나리오|소설|시)\b/i,
            /\b(아이디어|브레인스토밍|창의|상상)\b/i,
            /\b(creative|storytelling|fiction)\b/i,
        ],
        keywords: [
            '글쓰기', '이야기', '스토리', '소설', '시나리오',
            '카피', '광고문구', '슬로건', '아이디어', '브레인스토밍',
            'creative', 'story', 'brainstorm', 'imagine', '상상', '창작'
        ],
        weight: 0.75,  // 가중치 하향 (다른 유형 우선)
    },
    {
        type: 'vision',
        patterns: [
            /\b(이미지|사진|그림|picture|image|photo)\b/i,
            /\b(보여|봐|보이는|look|see|show)\b.*\b(이미지|사진|그림)\b/i,
            /\b(ocr|텍스트.*추출|extract.*text)\b/i,
        ],
        keywords: [
            '이미지', '사진', '그림', '스크린샷', '캡처', '시각', '비전',
            'image', 'picture', 'photo', 'screenshot', 'visual', 'ocr',
            '분석해줘', '설명해줘', '뭐가 보여', '뭐야 이거'
        ],
        weight: 1.0,
    },
    {
        type: 'math',
        patterns: [
            /\b(계산|수학|math|calculate|equation)\b/i,
            /[\d\+\-\*\/\^\=]+/,           // 수식 패턴
            /\b(미적분|미분|적분|행렬|선형대수|통계)\b/i,
        ],
        keywords: [
            '계산', '수학', '공식', '방정식', '미적분', '미분', '적분',
            '행렬', '선형대수', '확률', '통계', '기하', '삼각함수',
            'math', 'calculate', 'equation', 'formula', 'integral', 'derivative'
        ],
        weight: 0.95,
    },
    {
        type: 'document',
        patterns: [
            /\b(요약|summarize|summary)\b/i,
            /\b(문서|document|pdf|docx)\b/i,
            /\b(리포트|보고서|논문|report|paper)\b/i,
        ],
        keywords: [
            '요약', '요약해', '정리', '문서', '리포트', '보고서', '논문',
            'summarize', 'summary', 'document', 'report', 'paper',
            '핵심', '중요한', '포인트', 'key points'
        ],
        weight: 0.8,
    },
    {
        type: 'translation',
        patterns: [
            /\b(번역|translate|translation)\b/i,
            /\b(영어로|한국어로|일본어로|중국어로)\b/i,
            /\b(to english|to korean|to japanese)\b/i,
        ],
        keywords: [
            '번역', '번역해', '영어로', '한국어로', '일본어로', '중국어로',
            'translate', 'translation', 'to english', 'to korean'
        ],
        weight: 0.9,
    },
    {
        type: 'korean',
        patterns: [
            /[\uAC00-\uD7A3]/,  // 한글 감지
        ],
        keywords: [],
        weight: 0.1,  // 매우 낮은 가중치 (폴백 전용 - 다른 유형이 매칭되면 무시)
    },
    {
        type: 'chat',
        patterns: [
            /\b(안녕|하이|헬로|hello|hi|hey)\b/i,
            /\?$/,  // 질문 형태
        ],
        keywords: [
            '안녕', '하이', '헬로', '뭐해', '어때', '알려줘', '설명해',
            'hello', 'hi', 'hey', 'what', 'how', 'tell me'
        ],
        weight: 0.5,
    },
];

// ============================================================
// 질문 분류 함수
// ============================================================

/**
 * 쿼리를 분석하여 질문 유형을 분류합니다.
 */
export function classifyQuery(query: string): QueryClassification {
    const scores: Map<QueryType, { score: number; patterns: string[] }> = new Map();

    // 모든 유형에 대해 점수 계산
    for (const pattern of QUERY_PATTERNS) {
        let score = 0;
        const matchedPatterns: string[] = [];

        // 정규식 패턴 매칭
        for (const regex of pattern.patterns) {
            if (regex.test(query)) {
                score += pattern.weight * 2;
                matchedPatterns.push(regex.source.substring(0, 30));
            }
        }

        // 키워드 매칭
        const lowerQuery = query.toLowerCase();
        for (const keyword of pattern.keywords) {
            if (lowerQuery.includes(keyword.toLowerCase())) {
                score += pattern.weight;
                matchedPatterns.push(keyword);
            }
        }

        if (score > 0) {
            const existing = scores.get(pattern.type);
            if (!existing || existing.score < score) {
                scores.set(pattern.type, { score, patterns: matchedPatterns });
            }
        }
    }

    // 가장 높은 점수의 유형 선택
    let bestType: QueryType = 'chat';
    let bestScore = 0;
    let bestPatterns: string[] = [];

    for (const [type, data] of scores) {
        if (data.score > bestScore) {
            bestType = type;
            bestScore = data.score;
            bestPatterns = data.patterns;
        }
    }

    // 한국어 비율 체크 (30% 이상이면 korean 힌트 추가)
    const koreanPattern = /[\uAC00-\uD7A3]/g;
    const koreanChars = query.match(koreanPattern) || [];
    const koreanRatio = koreanChars.length / query.length;

    // 이미지 관련 메타데이터가 있으면 vision으로 강제
    if (query.includes('[IMAGE]') || query.includes('[image_attached]')) {
        bestType = 'vision';
        bestScore = 10;
        bestPatterns = ['image_metadata'];
    }

    // 신뢰도 계산 (0~1)
    const confidence = Math.min(bestScore / 5, 1.0);

    return {
        type: bestType,
        confidence,
        subType: koreanRatio > 0.3 ? 'korean' : undefined,
        matchedPatterns: bestPatterns.slice(0, 5),
    };
}

// ============================================================
// 모델 선택 함수
// ============================================================

/**
 * 질문 유형에 따라 최적의 모델을 선택합니다.
 */
export function selectOptimalModel(query: string, hasImages?: boolean): ModelSelection {
    const config = getConfig();
    const classification = classifyQuery(query);

    // 이미지가 첨부된 경우 비전 모델 강제 선택
    if (hasImages) {
        classification.type = 'vision';
    }

    console.log(`[ModelSelector] 질문 유형: ${classification.type} (신뢰도: ${(classification.confidence * 100).toFixed(0)}%)`);
    console.log(`[ModelSelector] 매칭 패턴: ${classification.matchedPatterns.join(', ')}`);

    // 질문 유형에 맞는 최적 모델 찾기
    let selectedPreset: ModelPreset | null = null;
    let lowestPriority = Infinity;

    for (const [, preset] of Object.entries(MODEL_PRESETS)) {
        if (preset.bestFor.includes(classification.type)) {
            if (preset.priority < lowestPriority) {
                lowestPriority = preset.priority;
                selectedPreset = preset;
            }
        }
    }

    // 폴백: Gemini Flash (기본)
    if (!selectedPreset) {
        selectedPreset = MODEL_PRESETS['gemini-flash'];
    }

    // .env에서 실제 모델명 가져오기 (기본 모델 사용)
    const actualModel = config.ollamaDefaultModel || selectedPreset.defaultModel;

    console.log(`[ModelSelector] 선택된 모델: ${selectedPreset.name} (${actualModel})`);

    return {
        model: actualModel,
        options: selectedPreset.options,
        reason: `${classification.type} 질문 → ${selectedPreset.name} 사용`,
        queryType: classification.type,
        supportsToolCalling: selectedPreset.capabilities.toolCalling,
        supportsThinking: selectedPreset.capabilities.thinking,
        supportsVision: selectedPreset.capabilities.vision,
    };
}

// ============================================================
// 모델 호환성 체크
// ============================================================

/**
 * 모델이 특정 기능을 지원하는지 확인합니다.
 */
export function checkModelCapability(
    modelName: string, 
    capability: 'toolCalling' | 'thinking' | 'vision' | 'streaming'
): boolean {
    const lowerModel = modelName.toLowerCase();

    // 모델명으로 프리셋 찾기
    for (const preset of Object.values(MODEL_PRESETS)) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) || 
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities[capability];
        }
    }

    // 알 수 없는 모델은 기본값 반환
    const defaults: Record<string, boolean> = {
        toolCalling: true,
        thinking: true,
        vision: false,
        streaming: true,
    };
    return defaults[capability] ?? false;
}

/**
 * 모델의 최대 컨텍스트 길이를 반환합니다.
 */
export function getModelContextLength(modelName: string): number {
    const lowerModel = modelName.toLowerCase();

    for (const preset of Object.values(MODEL_PRESETS)) {
        if (preset.defaultModel.toLowerCase().includes(lowerModel) ||
            lowerModel.includes(preset.defaultModel.split(':')[0].toLowerCase())) {
            return preset.capabilities.contextLength;
        }
    }

    // 기본값
    return 32768;
}

// ============================================================
// 모델별 파라미터 조정
// ============================================================

/**
 * 특정 모델에 맞게 옵션을 조정합니다.
 */
export function adjustOptionsForModel(
    modelName: string, 
    baseOptions: ModelOptions,
    queryType: QueryType
): ModelOptions {
    const lowerModel = modelName.toLowerCase();
    const adjustedOptions = { ...baseOptions };

    // Qwen Coder: 코딩에 특화된 낮은 temperature
    if (lowerModel.includes('qwen') && lowerModel.includes('coder')) {
        adjustedOptions.temperature = Math.min(adjustedOptions.temperature || 0.7, 0.3);
        adjustedOptions.repeat_penalty = 1.0;
    }

    // Kimi: 긴 문서에 적합한 설정
    if (lowerModel.includes('kimi')) {
        adjustedOptions.num_ctx = Math.max(adjustedOptions.num_ctx || 32768, 65536);
    }

    // Vision 모델: 이미지 분석에 적합한 설정
    if (lowerModel.includes('vl') || lowerModel.includes('vision')) {
        adjustedOptions.temperature = 0.6;
    }

    // 질문 유형별 추가 조정
    switch (queryType) {
        case 'code':
            adjustedOptions.temperature = Math.min(adjustedOptions.temperature || 0.7, 0.3);
            adjustedOptions.repeat_penalty = 1.0;
            break;
        case 'creative':
            adjustedOptions.temperature = Math.max(adjustedOptions.temperature || 0.7, 0.85);
            adjustedOptions.top_p = 0.95;
            break;
        case 'math':
            adjustedOptions.temperature = 0.1;
            adjustedOptions.top_p = 0.8;
            break;
        case 'translation':
            adjustedOptions.temperature = 0.3;
            adjustedOptions.repeat_penalty = 1.2;
            break;
    }

    return adjustedOptions;
}

// ============================================================
// 레거시 호환성 (기존 함수 유지)
// ============================================================

/**
 * @deprecated selectOptimalModel() 사용 권장
 */
export function selectOptimalModelLegacy(query: string): { model: string; reason: string } {
    const selection = selectOptimalModel(query);
    return {
        model: selection.model,
        reason: selection.reason,
    };
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 사용 가능한 모든 모델 프리셋 목록 반환
 */
export function getAvailablePresets(): Array<{ id: string; name: string; bestFor: QueryType[] }> {
    return Object.entries(MODEL_PRESETS).map(([id, preset]) => ({
        id,
        name: preset.name,
        bestFor: preset.bestFor,
    }));
}

/**
 * 질문 유형별 추천 모델 반환
 */
export function getRecommendedModel(queryType: QueryType): string {
    for (const preset of Object.values(MODEL_PRESETS)) {
        if (preset.bestFor[0] === queryType) {
            return preset.defaultModel;
        }
    }
    return MODEL_PRESETS['gemini-flash'].defaultModel;
}
