/**
 * 외부 모델 정책(5단계) — 글롭·deny 우선·allow 화이트리스트.
 */
import { parseExternalModelPolicy, isExternalModelAllowed, resolveExternalModelPolicy } from '../external-model-policy';

describe('parseExternalModelPolicy', () => {
    it('JSON 을 읽고, 빈 값·불량 JSON·잘못된 형태는 빈 정책(전부 허용)', () => {
        expect(parseExternalModelPolicy('{"deny":["openrouter:*"],"allow":[]}')).toEqual({ allow: [], deny: ['openrouter:*'] });
        expect(parseExternalModelPolicy(undefined)).toEqual({ allow: [], deny: [] });
        expect(parseExternalModelPolicy('not json')).toEqual({ allow: [], deny: [] });
        expect(parseExternalModelPolicy('{"deny":"openrouter:*"}')).toEqual({ allow: [], deny: [] });
        expect(parseExternalModelPolicy('{"deny":[" x ", "", 3]}')).toEqual({ allow: [], deny: ['x'] });
    });
});

describe('isExternalModelAllowed', () => {
    it('deny 글롭이 이긴다', () => {
        const p = parseExternalModelPolicy('{"deny":["openrouter:*"],"allow":["openrouter:qwen/*"]}');
        expect(isExternalModelAllowed('openrouter:qwen/qwen3.8-max', p)).toBe(false);
        expect(isExternalModelAllowed('nvidia:meta/llama', p)).toBe(false); // allow 가 있으니 목록 밖도 차단
    });
    it('allow 가 있으면 목록에 맞는 것만, 없으면 deny 만 본다', () => {
        const only = parseExternalModelPolicy('{"allow":["chatgpt:*","nvidia:meta/*"]}');
        expect(isExternalModelAllowed('chatgpt:gpt-5.5', only)).toBe(true);
        expect(isExternalModelAllowed('nvidia:meta/llama-4', only)).toBe(true);
        expect(isExternalModelAllowed('openrouter:x/y', only)).toBe(false);
        const denyOnly = parseExternalModelPolicy('{"deny":["*:*-free"]}');
        expect(isExternalModelAllowed('openrouter:qwen/qwen3-free', denyOnly)).toBe(false);
        expect(isExternalModelAllowed('openrouter:qwen/qwen3', denyOnly)).toBe(true);
    });
    it('대소문자 무시, 정규식 메타문자는 문자 그대로', () => {
        const p = parseExternalModelPolicy('{"deny":["OpenRouter:Qwen/Qwen3.8+"]}');
        expect(isExternalModelAllowed('openrouter:qwen/qwen3.8+', p)).toBe(false);
        expect(isExternalModelAllowed('openrouter:qwen/qwen3x8+', p)).toBe(true);
    });
});

describe('resolveExternalModelPolicy', () => {
    it('같은 원문이면 같은 객체(캐시), 바뀌면 재파싱', () => {
        const a = resolveExternalModelPolicy('{"deny":["a:*"]}');
        expect(resolveExternalModelPolicy('{"deny":["a:*"]}')).toBe(a);
        expect(resolveExternalModelPolicy('{"deny":["b:*"]}')).not.toBe(a);
    });
});
