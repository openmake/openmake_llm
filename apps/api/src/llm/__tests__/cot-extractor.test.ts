/**
 * cot-extractor unit tests (2026-05-26).
 *
 * 검증 영역:
 *   1. CoT sentinel 감지 (true/false)
 *   2. 결론 마커 ([Output], Final:, etc.) 기반 분리
 *   3. 마커 없을 때 마지막 한국어 줄 추출
 *   4. false-positive 방지 (일반 답변은 변경 없음)
 */
import { extractCoTFromContent } from '../cot-extractor';

describe('extractCoTFromContent', () => {
    it('CoT 시작 sentinel 없으면 detected=false (변경 없음)', () => {
        const content = '현재 대한민국 대통령은 윤석열 대통령입니다.';
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(false);
        expect(r.answer).toBe(content);
        expect(r.thinking).toBe('');
    });

    it('짧은 응답 (100자 미만) 은 detected=false', () => {
        const r = extractCoTFromContent('Here\'s a thinking process: x');
        expect(r.detected).toBe(false);
    });

    it('"Here\'s a thinking process" + [Output] 마커 분리', () => {
        const content = `Here's a thinking process:

Analyze User Input: User asks who is the president.
Constraint check: One line in Korean.
Draft: 현재 대한민국 대통령은 윤석열 대통령입니다.
Verify: Match constraints.

[Output] 현재 대한민국 대통령은 윤석열 대통령입니다.
(Note: One line only.)`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열 대통령입니다.');
        expect(r.thinking).toContain('Analyze User Input');
        expect(r.thinking).toContain('Draft');
    });

    it('Final: 마커 + 마지막 한국어 결론', () => {
        const content = `Let me think step by step.

This is the Korean president question.
Analysis: search results show Yoon Suk Yeol.
Self-Correction: Confirmed.

Final: 현재 대한민국 대통령은 윤석열입니다.`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열입니다.');
    });

    it('마커 없으면 마지막 한국어 줄 추출', () => {
        const content = `Here's a thinking process:

Step 1: Analyze the question.
Step 2: Check the constraints.
Step 3: Formulate response.

현재 대한민국 대통령은 윤석열 대통령입니다.`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열 대통령입니다.');
        expect(r.thinking).toContain('Step 1');
    });

    it('Self-Correction 메타 라인은 결론 후보에서 제외', () => {
        const content = `Here's a thinking process:

Reasoning about the question.
Self-Correction: I missed a detail.
Output matches expectation.
[Done.]

현재 대한민국 대통령은 윤석열 대통령입니다.`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열 대통령입니다.');
        expect(r.answer).not.toContain('Self-Correction');
    });

    it('한국어 결론 마커 (답변:, 결론:) 인식', () => {
        const content = `Analyze the question:

The question asks who is the president.
Looking at search results...
Found relevant info.

답변: 현재 대한민국 대통령은 윤석열입니다.`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열입니다.');
    });

    it('실제 reported case — 매우 긴 CoT + 마지막 결론', () => {
        const content = `Here's a thinking process:

Analyze User Input:
User asks: "한국 대통령이 누구야 ?" (Who is the President of South Korea?)
Context provided: Web search results dated 2026.05.26.
Search results explicitly mention: "[단독] 민주당 AI 챗봇에 대한민국 대통령 물으니…"윤석열입니다""

Constraint check: "한 줄로 답할 수 있으면 한 줄로 종료한다."

Formulate Response:
The President of South Korea is Yoon Suk Yeol.
Draft: 현재 대한민국 대통령은 윤석열 대통령입니다.

Verify Constraints:
One line? Yes. Korean? Yes.
Proceed.

[Output] 현재 대한민국 대통령은 윤석열 대통령입니다.
(Note: I will strictly follow the "one line" rule.)
All good.
Proceeds.
[Done.]`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열 대통령입니다.');
        expect(r.thinking.length).toBeGreaterThan(300);
    });

    it('시작 sentinel "The user is asking" 도 감지 (2026-05-26 보강)', () => {
        const content = `The user is asking about the President of South Korea.
Constraint check: Korean answer, one line.
Looking at the search results...
Verify Constraints: Match.
[Output] 현재 대한민국 대통령은 윤석열 대통령입니다.`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열 대통령입니다.');
    });

    it('시작 sentinel 없어도 inner marker 2+ 면 감지', () => {
        const content = `OpenMake.AI 의 로컬 LLM 서비스입니다. The question is about Korean president.
Some analysis here without standard CoT start.
Constraint check: One line.
Self-Correction: Confirmed.
Verify Constraints: Yes.

답변: 현재 대한민국 대통령은 윤석열입니다.`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(true);
        expect(r.answer).toBe('현재 대한민국 대통령은 윤석열입니다.');
    });

    it('일반 markdown 답변은 영향 없음 (false-positive 방지)', () => {
        const content = `# 한국 대통령

현재 대한민국 대통령은 **윤석열 대통령** 입니다.

관련 정보:
- 임기: 2022년 5월 ~
- 정당: 국민의힘`;
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(false);
        expect(r.answer).toBe(content);
    });

    it('코드 응답은 영향 없음', () => {
        const content = '```python\ndef hello():\n    print("hi")\n```\n\n위 함수는 hi 를 출력합니다.';
        const r = extractCoTFromContent(content);
        expect(r.detected).toBe(false);
    });
});
