import { classifyQuery, selectOptimalModel, checkModelCapability } from '../chat/model-selector';

describe('Model Selector', () => {
    describe('classifyQuery', () => {
        test('코딩 질문 분류', () => {
            const result = classifyQuery('React 컴포넌트에서 useState 사용법 알려줘');
            expect(result.type).toBe('code');
            expect(result.confidence).toBeGreaterThan(0);
        });

        test('분석 질문 분류', () => {
            const result = classifyQuery('이 데이터를 분석해서 인사이트 뽑아줘');
            expect(result.type).toBe('analysis');
        });

        test('창작 질문 분류', () => {
            const result = classifyQuery('판타지 소설 아이디어 좀 브레인스토밍 해줘');
            expect(result.type).toBe('creative');
        });

        test('비전 질문 분류', () => {
            const result = classifyQuery('이 이미지에서 텍스트 추출해줘');
            expect(result.type).toBe('vision');
        });

        test('수학 질문 분류', () => {
            const result = classifyQuery('미적분 문제 풀어줘: ∫x²dx');
            expect(result.type).toBe('math');
        });

        test('문서 질문 분류', () => {
            const result = classifyQuery('이 문서 요약해줘');
            expect(result.type).toBe('document');
        });

        test('번역 질문 분류', () => {
            const result = classifyQuery('이 문장을 영어로 번역해줘');
            expect(result.type).toBe('translation');
        });
    });

    describe('selectOptimalModel', () => {
        test('코딩 질문에 적절한 모델 선택', () => {
            const result = selectOptimalModel('Python 함수 작성해줘');
            expect(result.queryType).toBe('code');
            expect(result.supportsToolCalling).toBe(true);
        });

        test('비전 질문에 비전 지원 모델 선택', () => {
            const result = selectOptimalModel('이미지 분석해줘', true);
            expect(result.queryType).toBe('vision');
            expect(result.supportsVision).toBe(true);
        });
    });

    describe('checkModelCapability', () => {
        test('Gemini 모델 도구 지원 확인', () => {
            expect(checkModelCapability('gemini-3-flash-preview:cloud', 'toolCalling')).toBe(true);
            expect(checkModelCapability('gemini-3-flash-preview:cloud', 'vision')).toBe(true);
        });

        test('Qwen Coder 모델 비전 미지원 확인', () => {
            expect(checkModelCapability('qwen3-coder-next:cloud', 'vision')).toBe(false);
        });
    });
});
