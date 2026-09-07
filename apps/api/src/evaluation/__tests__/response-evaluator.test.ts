/**
 * 응답 평가기 — 실패 케이스는 응답 앞부분(responsePreview)을 결과에 남긴다.
 * 2026-09-04~07 nightly 에서 response-003/012 가 반복 실패했는데 결과 파일엔 길이만 있어
 * 원인(모델 편차 vs 게이트 결함)을 사후에 가를 수 없었다.
 */
import { evaluateResponseCase } from '../response-evaluator';
import type { GoldenCase } from '../types';

const base: GoldenCase = {
    id: 'response-012',
    category: 'response-pattern',
    query: 'Python으로 hello world 예제 보여줘',
    mustContainAny: ['Python', '파이썬', 'print('],
    language: 'ko',
} as GoldenCase;

describe('evaluateResponseCase', () => {
    it('통과 케이스는 길이만 남기고 preview 를 싣지 않는다', async () => {
        const r = await evaluateResponseCase(base, async () => '```python\nprint("Hello, world!")\n```');
        expect(r.passed).toBe(true);
        expect(r.actual?.responseLength).toBe(36);
        expect(r.actual).not.toHaveProperty('responsePreview');
    });

    it('실패 케이스는 원문(정규화 전) 앞부분을 responsePreview 로 남긴다', async () => {
        const long = 'Hello World 를 출력하는 예제는 다음과 같습니다. ' + 'x'.repeat(1000);
        const r = await evaluateResponseCase(base, async () => long);
        expect(r.passed).toBe(false);
        expect(r.failureReason).toContain('OR 후보 substring 모두 누락');
        const preview = r.actual?.responsePreview as string;
        expect(preview.startsWith('Hello World 를 출력하는')).toBe(true);
        expect(preview.length).toBe(600);
    });

    it('대소문자·아포스트로피 정규화는 종전대로 동작한다', async () => {
        const c: GoldenCase = { ...base, id: 'x', mustContain: ["can't", 'Python'], mustContainAny: undefined } as GoldenCase;
        const r = await evaluateResponseCase(c, async () => 'I can’t run PYTHON here.');
        expect(r.passed).toBe(true);
    });
});
