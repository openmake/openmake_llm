/**
 * ============================================================
 * Model Selector - 질문 유형별 자동 모델 라우팅
 * ============================================================
 * 
 * 사용자 질문을 분석하여 9가지 QueryType으로 분류하고,
 * 최적의 Ollama 모델 프리셋을 자동 선택합니다.
 * Brand model alias(openmake_llm_auto)를 통한 스마트 자동 라우팅도 지원합니다.
 * 
 * @module chat/model-selector
 * @description
 * - 질문 유형 분류: 정규식 패턴 매칭 + 키워드 가중치 스코어링 알고리즘
 * - 모델 프리셋 선택: QueryType별 최적 모델 매칭 (우선순위 기반)
 * - Brand Model 지원: pipeline-profile.ts의 프로파일 기반 ModelSelection 생성
 * - Auto-Routing: openmake_llm_auto 요청 시 질문 유형에 따라 brand profile 자동 선택
 * - 모델별 파라미터 조정: 모델 특성에 맞는 temperature, top_p, num_ctx 자동 튜닝
 * 
 * 자동 라우팅 알고리즘 흐름:
 * 1. classifyQuery() - 정규식/키워드로 QueryType 분류 + 신뢰도 계산
 * 2. selectOptimalModel() - QueryType에 맞는 ModelPreset 선택
 * 3. selectModelForProfile() - Brand model alias인 경우 프로파일 기반 선택
 * 4. selectBrandProfileForAutoRouting() - auto 모드 시 brand profile ID 결정
 * 5. adjustOptionsForModel() - 선택된 모델에 맞게 옵션 미세 조정
 * 
 * @see chat/pipeline-profile.ts - 브랜드 모델 프로파일 정의
 * @see services/ChatService.ts - 최종 모델 선택 결과 소비
 */

import { getConfig } from '../config/env';
import { ModelOptions } from '../ollama/types';
import { isValidBrandModel, getProfiles } from './pipeline-profile';

// ============================================================
// 질문 유형 정의
// ============================================================

/**
 * 질문 유형 분류 결과 (9가지)
 * classifyQuery()가 사용자 질문을 분석하여 이 중 하나로 분류합니다.
 */
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

/**
 * 질문 분류 결과 인터페이스
 * classifyQuery()의 반환 타입으로, 분류된 유형과 신뢰도 정보를 포함합니다.
 */
export interface QueryClassification {
    /** 분류된 질문 유형 */
    type: QueryType;
    /** 분류 신뢰도 (0.0 ~ 1.0, 높을수록 확실) */
    confidence: number;
    /** 보조 유형 (예: 한국어 비율이 30% 이상이면 'korean') */
    subType?: string;
    /** 매칭된 패턴/키워드 목록 (최대 5개) */
    matchedPatterns: string[];
}

/**
 * 모델 선택 결과 인터페이스
 * selectOptimalModel() 또는 selectModelForProfile()의 반환 타입입니다.
 */
export interface ModelSelection {
    /** 선택된 모델 ID (예: 'gemini-3-flash-preview:cloud') */
    model: string;
    /** 모델에 적용할 옵션 (temperature, top_p 등) */
    options: ModelOptions;
    /** 선택 사유 설명 (한국어) */
    reason: string;
    /** 분류된 질문 유형 */
    queryType: QueryType;
    /** 도구 호출(Tool Calling) 지원 여부 */
    supportsToolCalling: boolean;
    /** 사고(Thinking) 모드 지원 여부 */
    supportsThinking: boolean;
    /** 비전(이미지 분석) 지원 여부 */
    supportsVision: boolean;
}

// ============================================================
// 모델 프리셋 정의
// ============================================================

/**
 * 모델 프리셋 정의 인터페이스
 * 각 모델의 기본 설정, 기능, 적합한 질문 유형을 정의합니다.
 */
interface ModelPreset {
    /** 모델 표시 이름 (예: 'Gemini 3 Flash') */
    name: string;
    /** .env 변수명 (예: 'OLLAMA_MODEL_1') */
    envKey: string;
    /** 기본 모델명 (env 미설정 시 사용) */
    defaultModel: string;
    /** 모델 기본 옵션 (temperature, top_p 등) */
    options: ModelOptions;
    /** 모델 기능 플래그 */
    capabilities: {
        /** 도구 호출 지원 */
        toolCalling: boolean;
        /** 사고 모드 지원 */
        thinking: boolean;
        /** 비전(이미지) 지원 */
        vision: boolean;
        /** 스트리밍 지원 */
        streaming: boolean;
        /** 최대 컨텍스트 길이 (토큰) */
        contextLength: number;
    };
    /** 이 모델이 최적인 질문 유형 목록 */
    bestFor: QueryType[];
    /** 선택 우선순위 (낮을수록 높음, 동일 QueryType 내에서 비교) */
    priority: number;
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

/**
 * 질문 유형 분류 패턴 인터페이스
 * 정규식과 키워드를 조합하여 질문 유형을 판별합니다.
 */
interface QueryPattern {
    /** 분류 대상 질문 유형 */
    type: QueryType;
    /** 매칭할 정규식 패턴 배열 (매칭 시 weight * 2 점수) */
    patterns: RegExp[];
    /** 매칭할 키워드 배열 (매칭 시 weight * 1 점수) */
    keywords: string[];
    /** 가중치 (유형별 중요도 조정, 기본 1.0) */
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
 * 사용자 쿼리를 분석하여 질문 유형을 분류합니다.
 * 
 * 분류 알고리즘:
 * 1. 모든 QueryPattern에 대해 정규식 매칭 (weight * 2 점수) + 키워드 매칭 (weight * 1 점수)
 * 2. 가장 높은 점수의 유형을 선택 (동점 시 먼저 발견된 유형)
 * 3. [IMAGE] 메타데이터가 있으면 vision으로 강제 전환
 * 4. 한국어 비율 30% 이상이면 subType='korean' 추가
 * 5. 신뢰도 = min(bestScore / 5, 1.0)
 * 
 * @param query - 분류할 사용자 질문 텍스트
 * @returns 분류 결과 (유형, 신뢰도, 매칭된 패턴)
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
// LLM 기반 질문 분류 함수
// ============================================================

/**
 * LLM 기반 질문 분류 (Ollama Structured Output)
 * 
 * 코드 엔진 모델을 사용하여 질문을 분류합니다.
 * 실패 시 정규식 기반 classifyQuery()로 폴백합니다.
 * 
 * @param query - 사용자 질문
 * @returns 분류 결과 (LLM 또는 regex 폴백)
 */
async function classifyQueryWithLLM(query: string): Promise<QueryClassification> {
    // 매우 짧은 쿼리(20자 미만)는 regex로 충분
    if (query.length < 20) {
        return classifyQuery(query);
    }

    try {
        const config = getConfig();
        const engineModel = config.omkEngineCode || config.ollamaModel;

        // Ollama에 직접 HTTP 요청 (createClient 없이 경량 호출)
        const ollamaHost = config.ollamaHost;
        const response = await fetch(`${ollamaHost}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: engineModel,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a query classifier. Classify the user query into exactly one category. Respond ONLY with the JSON object.'
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ],
                format: {
                    type: 'object',
                    properties: {
                        category: {
                            type: 'string',
                            enum: ['code', 'analysis', 'creative', 'vision', 'korean', 'math', 'chat', 'document', 'translation']
                        },
                        confidence: {
                            type: 'number',
                            description: 'Classification confidence between 0.0 and 1.0'
                        }
                    },
                    required: ['category', 'confidence']
                },
                stream: false,
                options: { temperature: 0, num_predict: 50 }
            }),
            signal: AbortSignal.timeout(3000) // 3초 타임아웃
        });

        if (!response.ok) {
            throw new Error(`Ollama responded with ${response.status}`);
        }

        const result = await response.json() as { message?: { content?: string } };
        const content = result?.message?.content;
        if (!content) {
            throw new Error('Empty response from Ollama');
        }

        const parsed = JSON.parse(content) as { category: string; confidence: number };
        const validTypes: QueryType[] = ['code', 'analysis', 'creative', 'vision', 'korean', 'math', 'chat', 'document', 'translation'];

        if (!validTypes.includes(parsed.category as QueryType)) {
            throw new Error(`Invalid category: ${parsed.category}`);
        }

        console.log(`[ModelSelector] LLM 분류: ${parsed.category} (confidence=${(parsed.confidence * 100).toFixed(0)}%)`);

        return {
            type: parsed.category as QueryType,
            confidence: Math.max(0, Math.min(1, parsed.confidence)),
            matchedPatterns: ['llm-structured-output'],
        };
    } catch (error) {
        // LLM 실패 → regex 폴백 (silent)
        console.debug(`[ModelSelector] LLM 분류 실패, regex 폴백:`, error instanceof Error ? error.message : String(error));
        return classifyQuery(query);
    }
}

// ============================================================
// 모델 선택 함수
// ============================================================

/**
 * 질문 유형에 따라 최적의 모델 프리셋을 선택합니다.
 * 
 * 선택 알고리즘:
 * 1. classifyQueryWithLLM()으로 질문 유형 분류 (LLM 우선, regex 폴백)
 * 2. 이미지 첨부 시 vision으로 강제 전환
 * 3. MODEL_PRESETS에서 해당 유형의 bestFor에 포함된 프리셋 검색
 * 4. priority가 가장 낮은(=우선순위 높은) 프리셋 선택
 * 5. 매칭 실패 시 gemini-flash 폴백
 * 6. .env에서 실제 모델명 resolve
 * 
 * @param query - 사용자 질문 텍스트
 * @param hasImages - 이미지 첨부 여부 (true면 vision 모델 강제 선택)
 * @returns 모델 선택 결과 (모델명, 옵션, 사유, 기능 플래그)
 */
export async function selectOptimalModel(query: string, hasImages?: boolean): Promise<ModelSelection> {
    const config = getConfig();
    const classification = await classifyQueryWithLLM(query);

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
 * MODEL_PRESETS에서 모델명을 검색하여 해당 기능 플래그를 반환합니다.
 * 
 * @param modelName - 확인할 모델명
 * @param capability - 확인할 기능 ('toolCalling' | 'thinking' | 'vision' | 'streaming')
 * @returns 해당 기능 지원 여부
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
 * 모델의 최대 컨텍스트 길이(토큰)를 반환합니다.
 * MODEL_PRESETS에서 검색하며, 미발견 시 기본값 32768을 반환합니다.
 * 
 * @param modelName - 확인할 모델명
 * @returns 최대 컨텍스트 길이 (토큰 단위)
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
 * 특정 모델과 질문 유형에 맞게 모델 옵션을 미세 조정합니다.
 * 
 * 모델별 조정:
 * - Qwen Coder: temperature <= 0.3, repeat_penalty = 1.0
 * - Kimi: num_ctx >= 65536 (긴 문서 지원)
 * - Vision 모델: temperature = 0.6
 * 
 * 질문 유형별 조정:
 * - code: temperature <= 0.3 (정확성 우선)
 * - creative: temperature >= 0.85 (창의성 우선)
 * - math: temperature = 0.1 (결정적 응답)
 * - translation: temperature = 0.3, repeat_penalty = 1.2
 * 
 * @param modelName - 대상 모델명
 * @param baseOptions - 기본 모델 옵션
 * @param queryType - 질문 유형
 * @returns 조정된 모델 옵션 (원본 불변)
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
// §9 Brand Model Alias 지원
// ============================================================

/**
 * Brand model alias를 감지하여 프로파일 기반 ModelSelection을 반환합니다.
 * Brand model이 아닌 경우 null을 반환합니다.
 * 
 * @param requestedModel - 요청된 모델명 (예: "openmake_llm_pro")
 * @returns ModelSelection 또는 null
 */
export async function selectModelForProfile(requestedModel: string, query?: string, hasImages?: boolean): Promise<ModelSelection | null> {
    if (!isValidBrandModel(requestedModel)) {
        return null;
    }

    const profiles = getProfiles();
    const profile = profiles[requestedModel];
    if (!profile) return null;

    // __auto__ 엔진: brand model 프로파일 자동 라우팅
    // 이 함수에서는 brand model 프로파일 ID만 반환 (실제 라우팅은 ChatService에서 buildExecutionPlan 사용)
    if (profile.engineModel === '__auto__') {
        const targetProfile = await selectBrandProfileForAutoRouting(query || '', hasImages);
        const targetProfiles = getProfiles();
        const resolvedProfile = targetProfiles[targetProfile];
        if (resolvedProfile) {
            console.log(`[ModelSelector] §9 Auto-Routing: ${requestedModel} → ${targetProfile} (engine=${resolvedProfile.engineModel})`);
            return {
                model: resolvedProfile.engineModel,
                options: {
                    temperature: resolvedProfile.thinking === 'high' ? 0.3 : resolvedProfile.thinking === 'off' ? 0.7 : 0.5,
                    num_ctx: resolvedProfile.contextStrategy === 'full' ? 65536 : 32768,
                },
                reason: `Auto-Routing → ${resolvedProfile.displayName} → ${resolvedProfile.engineModel}`,
                queryType: resolvedProfile.promptStrategy === 'force_coder' ? 'code'
                    : resolvedProfile.promptStrategy === 'force_reasoning' ? 'math'
                    : resolvedProfile.promptStrategy === 'force_creative' ? 'creative'
                    : 'chat',
                supportsToolCalling: true,
                supportsThinking: resolvedProfile.thinking !== 'off',
                supportsVision: resolvedProfile.requiredTools.includes('vision'),
            };
        }
        // Fallback: 프로파일을 못 찾으면 기존 자동 선택
        const autoSelection = await selectOptimalModel(query || '', hasImages);
        console.log(`[ModelSelector] §9 Auto-Routing Fallback: ${requestedModel} → ${autoSelection.model}`);
        return autoSelection;
    }

    console.log(`[ModelSelector] §9 Brand Model: ${requestedModel} → engine=${profile.engineModel}`);

    return {
        model: profile.engineModel,
        options: {
            temperature: profile.thinking === 'high' ? 0.3 : profile.thinking === 'off' ? 0.7 : 0.5,
            num_ctx: profile.contextStrategy === 'full' ? 65536 : 32768,
        },
        reason: `Brand model ${profile.displayName} → ${profile.engineModel}`,
        queryType: profile.promptStrategy === 'force_coder' ? 'code'
            : profile.promptStrategy === 'force_reasoning' ? 'math'
            : profile.promptStrategy === 'force_creative' ? 'creative'
            : 'chat',
        supportsToolCalling: true,
        supportsThinking: profile.thinking !== 'off',
        supportsVision: profile.requiredTools.includes('vision'),
    };
}

// ============================================================
// §9 Auto-Routing: Brand Model 프로파일 자동 라우팅
// ============================================================

/**
 * openmake_llm_auto 사용 시 질문 유형에 따라 적합한 brand model 프로파일 ID를 반환합니다.
 * 
 * 내부 엔진 모델이 아닌 brand model 프로파일(openmake_llm_pro, _fast, _think, _code, _vision)로
 * 라우팅하여 해당 프로파일의 전체 ExecutionPlan(에이전트 루프, thinking, 프롬프트 전략 등)을 적용합니다.
 * 
 * 매핑 (5개 대상 모델: pro/fast/think/code/vision):
 *   code           → openmake_llm_code    (코드 전문)
 *   math           → openmake_llm_think   (심층 추론)
 *   creative       → openmake_llm_pro     (프리미엄 창작)
 *   analysis       → openmake_llm_pro     (복잡한 분석)
 *   document       → openmake_llm_pro     (문서 분석)
 *   vision         → openmake_llm_vision  (멀티모달)
 *   translation    → openmake_llm_pro     (고품질 번역)
 *   korean         → openmake_llm_pro     (한국어 고품질)
 *   chat (간단)    → openmake_llm_fast    (빠른 응답)
 *   chat (복잡)    → openmake_llm_pro     (프리미엄 대화)
 * 
 * @param query - 사용자 질문 텍스트
 * @param hasImages - 이미지 첨부 여부
 * @returns brand model 프로파일 ID (예: 'openmake_llm_code')
 */
export async function selectBrandProfileForAutoRouting(query: string, hasImages?: boolean): Promise<string> {
    // 이미지가 첨부되면 무조건 vision 프로파일
    if (hasImages) {
        console.log('[ModelSelector] §9 Auto-Routing: 이미지 감지 → openmake_llm_vision');
        return 'openmake_llm_vision';
    }

    const classification = await classifyQueryWithLLM(query);
    let targetProfile: string;

    switch (classification.type) {
        case 'code':
            targetProfile = 'openmake_llm_code';
            break;
        case 'math':
            targetProfile = 'openmake_llm_think';
            break;
        case 'creative':
        case 'analysis':
        case 'document':
            targetProfile = 'openmake_llm_pro';
            break;
        case 'vision':
            targetProfile = 'openmake_llm_vision';
            break;
        case 'chat':
            // 짧은 인사/간단한 질문은 fast, 복잡한 대화는 pro
            if (classification.confidence < 0.3 && query.length < 50) {
                targetProfile = 'openmake_llm_fast';
            } else {
                targetProfile = 'openmake_llm_pro';
            }
            break;
        case 'translation':
        case 'korean':
            targetProfile = 'openmake_llm_pro';
            break;
        default:
            targetProfile = 'openmake_llm_fast';
            break;
    }

    console.log(`[ModelSelector] §9 Auto-Routing: ${classification.type} (confidence=${(classification.confidence * 100).toFixed(0)}%) → ${targetProfile}`);
    return targetProfile;
}

// ============================================================
// 레거시 호환성 (기존 함수 유지)
// ============================================================

/**
 * @deprecated selectOptimalModel() 사용 권장
 */
export async function selectOptimalModelLegacy(query: string): Promise<{ model: string; reason: string }> {
    const selection = await selectOptimalModel(query);
    return {
        model: selection.model,
        reason: selection.reason,
    };
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 사용 가능한 모든 모델 프리셋 목록을 반환합니다.
 * 
 * @returns 프리셋 ID, 이름, 적합한 질문 유형 배열
 */
export function getAvailablePresets(): Array<{ id: string; name: string; bestFor: QueryType[] }> {
    return Object.entries(MODEL_PRESETS).map(([id, preset]) => ({
        id,
        name: preset.name,
        bestFor: preset.bestFor,
    }));
}

/**
 * 질문 유형별 추천 모델명을 반환합니다.
 * bestFor 배열의 첫 번째 항목이 일치하는 프리셋의 defaultModel을 반환합니다.
 * 
 * @param queryType - 질문 유형
 * @returns 추천 모델명 (폴백: gemini-flash의 defaultModel)
 */
export function getRecommendedModel(queryType: QueryType): string {
    for (const preset of Object.values(MODEL_PRESETS)) {
        if (preset.bestFor[0] === queryType) {
            return preset.defaultModel;
        }
    }
    return MODEL_PRESETS['gemini-flash'].defaultModel;
}
