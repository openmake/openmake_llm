/**
 * ============================================================
 * Query Classifier - 질문 유형 분류 (정규식 + 키워드 스코어링)
 * ============================================================
 * 
 * 사용자 질문을 분석하여 9가지 QueryType으로 분류합니다.
 * 정규식 패턴 매칭과 키워드 가중치 스코어링 알고리즘을 사용합니다.
 * 
 * @module chat/query-classifier
 * @see chat/model-selector - classifyQuery()를 사용하는 메인 모듈
 * @see chat/model-selector-types - QueryType, QueryClassification 타입 정의
 */

import type { QueryType, QueryClassification } from './model-selector-types';

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
