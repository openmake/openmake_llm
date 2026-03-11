/**
 * 모델 라우팅 자동 평가셋 데이터
 *
 * 9가지 QueryType에 대해 각각 쉬움/경계/어려움 난이도의 쿼리를 포함합니다.
 * 경계 케이스는 두 유형이 혼재되는 쿼리로, 기대 분류와 허용 대안을 모두 명시합니다.
 *
 * @module __tests__/routing-eval-data
 */

import type { QueryType } from '../domains/chat/pipeline/model-selector-types';

export interface EvalCase {
    query: string;
    expected: QueryType;
    /** 허용 가능한 대안 유형 (경계 케이스용) */
    acceptable?: QueryType[];
    /** 난이도 */
    difficulty: 'easy' | 'boundary' | 'hard';
    /** 분류 의도 설명 */
    note?: string;
}

export const ROUTING_EVAL_DATASET: EvalCase[] = [
    // ═══════════════════════════════════════════
    // CODE (15 cases)
    // ═══════════════════════════════════════════
    { query: '```python\ndef fibonacci(n):\n    return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)\n```', expected: 'code', difficulty: 'easy' },
    { query: 'React useEffect에서 cleanup 함수는 어떻게 작성하나요?', expected: 'code', difficulty: 'easy' },
    { query: 'TypeError: Cannot read properties of undefined (reading "map") 에러가 발생합니다', expected: 'code', difficulty: 'easy' },
    { query: 'SELECT u.name, COUNT(o.id) FROM users u LEFT JOIN orders o ON u.id = o.user_id GROUP BY u.name', expected: 'code', difficulty: 'easy' },
    { query: 'Docker compose에서 서비스 간 네트워킹을 설정하는 방법', expected: 'code', difficulty: 'easy' },
    { query: 'git rebase와 merge의 차이점을 설명해주세요', expected: 'code', difficulty: 'boundary', acceptable: ['analysis'] },
    { query: 'Express 미들웨어 체인에서 async 에러 핸들링 패턴', expected: 'code', difficulty: 'easy' },
    { query: '이 API 설계를 리뷰해줘', expected: 'code', difficulty: 'boundary', acceptable: ['analysis', 'document'] },
    { query: 'Kubernetes pod이 CrashLoopBackOff 상태인데 어떻게 해결하나요?', expected: 'code', difficulty: 'easy' },
    { query: 'TypeScript에서 제네릭 유틸리티 타입 만드는 법', expected: 'code', difficulty: 'easy' },
    { query: 'CI/CD 파이프라인에서 테스트 속도를 올리고 싶어', expected: 'code', difficulty: 'boundary', acceptable: ['analysis'] },
    { query: 'Next.js App Router에서 서버 컴포넌트와 클라이언트 컴포넌트의 차이', expected: 'code', difficulty: 'easy' },
    { query: 'PostgreSQL 인덱스 최적화 전략', expected: 'code', difficulty: 'boundary', acceptable: ['analysis'] },
    { query: 'WebSocket 연결이 자꾸 끊기는 문제 디버깅', expected: 'code', difficulty: 'easy' },
    { query: 'Python 데코레이터 패턴으로 캐싱 구현', expected: 'code', difficulty: 'easy' },

    // ═══════════════════════════════════════════
    // MATH (10 cases)
    // ═══════════════════════════════════════════
    { query: '∫ x² dx를 계산해주세요', expected: 'math', difficulty: 'easy' },
    { query: '3x + 7 = 22, x의 값은?', expected: 'math', difficulty: 'easy' },
    { query: '행렬 A = [[1,2],[3,4]]의 역행렬을 구해줘', expected: 'math', difficulty: 'easy' },
    { query: 'prove that √2 is irrational', expected: 'math', difficulty: 'easy' },
    { query: '이항분포 B(10, 0.3)에서 P(X >= 4)를 구하시오', expected: 'math', difficulty: 'easy' },
    { query: '피보나치 수열의 일반항 공식을 유도해줘', expected: 'math', difficulty: 'boundary', acceptable: ['code'], note: '수학이지만 코딩으로 혼동 가능' },
    { query: 'calculate the derivative of sin(x) * e^x', expected: 'math', difficulty: 'easy' },
    { query: '두 벡터 (1,2,3)과 (4,5,6)의 외적', expected: 'math', difficulty: 'easy' },
    { query: '라그랑주 승수법으로 최적화 문제 풀기', expected: 'math', difficulty: 'easy' },
    { query: '확률변수 X의 기대값과 분산 구하기', expected: 'math', difficulty: 'easy' },

    // ═══════════════════════════════════════════
    // ANALYSIS (10 cases)
    // ═══════════════════════════════════════════
    { query: 'AWS와 GCP의 가격 정책을 비교 분석해줘', expected: 'analysis', difficulty: 'easy' },
    { query: '한국 출생률 하락의 원인과 영향을 분석해줘', expected: 'analysis', difficulty: 'easy' },
    { query: '이 데이터에서 유의미한 추세를 찾아줘', expected: 'analysis', difficulty: 'easy' },
    { query: 'analyze the impact of remote work on productivity', expected: 'analysis', difficulty: 'easy' },
    { query: 'SWOT 분석을 해줘', expected: 'analysis', difficulty: 'easy' },
    { query: '전기차 시장의 성장 전망을 평가해줘', expected: 'analysis', difficulty: 'boundary', acceptable: ['chat'] },
    { query: 'why does inflation affect interest rates?', expected: 'analysis', difficulty: 'easy' },
    { query: 'pros and cons of microservices vs monolith', expected: 'analysis', difficulty: 'boundary', acceptable: ['code'], note: '개발 주제이지만 비교 분석' },
    { query: '이 실험 결과를 해석해주세요', expected: 'analysis', difficulty: 'boundary', acceptable: ['document'] },
    { query: '두 논문의 연구 방법론 차이를 비교해줘', expected: 'analysis', difficulty: 'boundary', acceptable: ['document'] },

    // ═══════════════════════════════════════════
    // CREATIVE (10 cases)
    // ═══════════════════════════════════════════
    { query: '우주를 배경으로 한 단편 소설을 써줘', expected: 'creative', difficulty: 'easy' },
    { query: 'write a haiku about autumn', expected: 'creative', difficulty: 'easy' },
    { query: '새로운 모바일 앱 아이디어를 브레인스토밍 해줘', expected: 'creative', difficulty: 'easy' },
    { query: '환경보호 캠페인 슬로건을 10개 만들어줘', expected: 'creative', difficulty: 'easy' },
    { query: '카페 창업을 위한 컨셉 이름을 제안해줘', expected: 'creative', difficulty: 'boundary', acceptable: ['chat'] },
    { query: 'compose a professional email declining a meeting', expected: 'creative', difficulty: 'easy' },
    { query: '판타지 세계관 설정을 만들어줘', expected: 'creative', difficulty: 'easy' },
    { query: '제품 런칭 보도자료 초안을 작성해줘', expected: 'creative', difficulty: 'boundary', acceptable: ['document'] },
    { query: '생일 축하 편지를 감동적으로 써줘', expected: 'creative', difficulty: 'easy' },
    { query: 'create a funny dialogue between a cat and a dog', expected: 'creative', difficulty: 'easy' },

    // ═══════════════════════════════════════════
    // VISION (8 cases)
    // ═══════════════════════════════════════════
    { query: '[IMAGE] 이 그래프에서 가장 높은 값은 무엇인가요?', expected: 'vision', difficulty: 'easy' },
    { query: '[image_attached] describe what you see', expected: 'vision', difficulty: 'easy' },
    { query: '이 사진에서 텍스트를 추출해줘', expected: 'vision', difficulty: 'easy' },
    { query: '이 스크린샷의 UI를 분석해줘', expected: 'vision', difficulty: 'easy' },
    { query: '[IMAGE] 이 코드 스크린샷의 버그를 찾아줘', expected: 'vision', difficulty: 'easy', note: 'code와 겹치지만 IMAGE 메타데이터가 강제' },
    { query: '이 이미지를 설명해줘', expected: 'vision', difficulty: 'easy' },
    { query: 'OCR로 이 문서를 텍스트로 변환해줘', expected: 'vision', difficulty: 'easy' },
    { query: '[IMAGE] what breed is this dog?', expected: 'vision', difficulty: 'easy' },

    // ═══════════════════════════════════════════
    // DOCUMENT (8 cases)
    // ═══════════════════════════════════════════
    { query: '이 논문을 3줄로 요약해줘', expected: 'document', difficulty: 'easy' },
    { query: 'summarize the key points of this article', expected: 'document', difficulty: 'easy' },
    { query: '이 보고서의 핵심 내용을 정리해줘', expected: 'document', difficulty: 'easy' },
    { query: 'PDF 문서에서 중요한 수치를 뽑아줘', expected: 'document', difficulty: 'easy' },
    { query: 'give me a summary of this research paper', expected: 'document', difficulty: 'easy' },
    { query: '이 계약서의 주요 조항을 정리해줘', expected: 'document', difficulty: 'easy' },
    { query: '회의록 요약해줘', expected: 'document', difficulty: 'easy' },
    { query: '이 기사의 핵심 포인트를 정리해줘', expected: 'document', difficulty: 'easy' },

    // ═══════════════════════════════════════════
    // TRANSLATION (8 cases)
    // ═══════════════════════════════════════════
    { query: '이 문장을 일본어로 번역해줘: 오늘 날씨가 좋습니다', expected: 'translation', difficulty: 'easy' },
    { query: 'translate the following paragraph to Korean', expected: 'translation', difficulty: 'easy' },
    { query: '영어로 번역: 인공지능은 우리 생활을 변화시키고 있습니다', expected: 'translation', difficulty: 'easy' },
    { query: '이 이메일을 중국어로 번역해주세요', expected: 'translation', difficulty: 'easy' },
    { query: 'translate to French: The weather is beautiful today', expected: 'translation', difficulty: 'easy' },
    { query: '한국어로 번역해줘: Machine learning is a subset of AI', expected: 'translation', difficulty: 'easy' },
    { query: '스페인어로 번역: 좋은 아침입니다', expected: 'translation', difficulty: 'easy' },
    { query: 'この文を韓国語に翻訳してください', expected: 'translation', difficulty: 'boundary', acceptable: ['chat', 'korean'], note: '일본어 원문이라 regex가 번역 키워드 못 잡을 수 있음' },

    // ═══════════════════════════════════════════
    // CHAT (10 cases)
    // ═══════════════════════════════════════════
    { query: '안녕하세요!', expected: 'chat', difficulty: 'easy' },
    { query: 'hello, how are you today?', expected: 'chat', difficulty: 'easy' },
    { query: '오늘 점심 뭐 먹을까?', expected: 'chat', difficulty: 'easy' },
    { query: '좋은 영화 추천해줘', expected: 'chat', difficulty: 'easy' },
    { query: 'what is the meaning of life?', expected: 'chat', difficulty: 'easy' },
    { query: '고마워, 잘 됐어!', expected: 'chat', difficulty: 'easy' },
    { query: '너는 어떤 AI야?', expected: 'chat', difficulty: 'easy' },
    { query: '내일 서울 날씨 어때?', expected: 'chat', difficulty: 'easy' },
    { query: 'tell me a joke', expected: 'chat', difficulty: 'easy' },
    { query: '제일 좋아하는 색깔이 뭐야?', expected: 'chat', difficulty: 'easy' },

    // ═══════════════════════════════════════════
    // BOUNDARY / HARD CASES (15 cases)
    // ═══════════════════════════════════════════
    { query: '머신러닝 모델의 정확도를 높이려면 어떻게 해야 하나요?', expected: 'code', difficulty: 'hard', acceptable: ['analysis'], note: 'ML은 코드이면서 분석' },
    { query: '이 데이터를 파이썬으로 시각화해줘', expected: 'code', difficulty: 'hard', acceptable: ['analysis'], note: '시각화=분석 + 파이썬=코드' },
    { query: 'explain how transformer architecture works', expected: 'analysis', difficulty: 'hard', acceptable: ['code', 'chat'], note: 'CS 개념 설명' },
    { query: '주식 가격 예측 알고리즘을 만들어줘', expected: 'code', difficulty: 'hard', acceptable: ['math', 'analysis'] },
    { query: '이력서를 영어로 작성해줘', expected: 'creative', difficulty: 'hard', acceptable: ['translation'], note: '작성=creative, 영어로=translation' },
    { query: 'write a Python script to analyze CSV data', expected: 'code', difficulty: 'hard', acceptable: ['analysis'], note: '스크립트 작성=code, 분석=analysis' },
    { query: '블록체인 기술의 미래에 대한 에세이를 써줘', expected: 'creative', difficulty: 'hard', acceptable: ['analysis'] },
    { query: 'REST API와 GraphQL 중 어떤 것이 더 나은지 설명해줘', expected: 'analysis', difficulty: 'hard', acceptable: ['code'] },
    { query: '수학 공식을 LaTeX로 변환해줘', expected: 'math', difficulty: 'hard', acceptable: ['code', 'translation'] },
    { query: '이 코드의 시간 복잡도를 분석해줘', expected: 'code', difficulty: 'hard', acceptable: ['analysis', 'math'] },
    { query: '영어 문법 실수를 고쳐줘: I goed to store', expected: 'translation', difficulty: 'hard', acceptable: ['chat', 'creative'] },
    { query: 'what are the best practices for securing a Node.js API?', expected: 'code', difficulty: 'hard', acceptable: ['analysis'] },
    { query: '한국 전통 요리 레시피를 영어로 써줘', expected: 'creative', difficulty: 'hard', acceptable: ['translation'] },
    { query: '이 데이터셋에서 아웃라이어를 찾는 R 코드를 짜줘', expected: 'code', difficulty: 'hard', acceptable: ['analysis', 'math'] },
    { query: '물리학에서 E=mc² 공식의 의미를 설명해줘', expected: 'math', difficulty: 'hard', acceptable: ['analysis', 'chat'] },
];
