/**
 * 외부 provider 직결 요청 규칙 · 문자열 본문 · 아티팩트 표시 펼치기 (2026-09-26 — hasa Planner 전 실패 대응).
 */
import { buildExtraBody } from '../reasoning-adapter';
import { coerceChatCompletion } from '../nonstream-body';
import { expandArtifactPlaceholders } from '../artifact-parser';
import { MalformedLLMResponseError } from '../../errors/malformed-llm-response.error';

describe('buildExtraBody — 외부 직결(providerId)', () => {
    const prev = process.env.LLM_ENABLE_REASONING_EFFORT;
    afterEach(() => { process.env.LLM_ENABLE_REASONING_EFFORT = prev; });

    test('로컬은 종전 그대로 enable_thinking 을 보낸다', () => {
        expect(buildExtraBody(false, 'qwen3.8-27b')).toMatchObject({ chat_template_kwargs: { enable_thinking: false } });
    });

    test('외부는 chat_template_kwargs 를 보내지 않는다 — 추론을 끌 수 없는 모델(프로필 선언)은 최저 강도로', () => {
        expect(buildExtraBody(false, 'gpt-oss-120b', 'hasa')).toEqual({ reasoning_effort: 'low' });
    });

    test('외부 + 프로필 없는 모델의 think:false 는 아무것도 보내지 않는다', () => {
        expect(buildExtraBody(false, 'kanana-2-30b-a3b', 'hasa')).toBeUndefined();
        expect(buildExtraBody(undefined, 'kanana-2-30b-a3b', 'hasa')).toBeUndefined();
    });

    test('외부 강도 지정은 LLM_ENABLE_REASONING_EFFORT 일 때만, provider 기준 정규화 — 템플릿 변수는 없다', () => {
        process.env.LLM_ENABLE_REASONING_EFFORT = 'true';
        const body = buildExtraBody('high', 'gpt-oss-120b', 'hasa');
        expect(body).toEqual({ reasoning_effort: 'high' });
        process.env.LLM_ENABLE_REASONING_EFFORT = 'false';
        expect(buildExtraBody('high', 'gpt-oss-120b', 'hasa')).toBeUndefined();
    });
});

describe('coerceChatCompletion', () => {
    const completion = { id: 'chat-1', choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }] };

    test('객체는 그대로', () => {
        expect(coerceChatCompletion(completion, 'm')).toBe(completion);
    });

    test('Content-Type 이 JSON 이 아니라 문자열로 온 정상 본문은 파싱해 쓴다 (2026-09-26 hasa)', () => {
        expect(coerceChatCompletion<typeof completion>(JSON.stringify(completion), 'gpt-oss-120b').choices[0].message.content).toBe('{"ok":true}');
    });

    test('choices 가 없거나 JSON 이 아니면 재시도 가능한 502', () => {
        expect(() => coerceChatCompletion({ error: { message: 'bad' } }, 'm')).toThrow(MalformedLLMResponseError);
        expect(() => coerceChatCompletion('<html>gateway</html>', 'm')).toThrow(/choices 가 없습니다/);
        expect(() => coerceChatCompletion('"just a string"', 'm')).toThrow(MalformedLLMResponseError);
    });
});

describe('expandArtifactPlaceholders', () => {
    test('아는 id 는 내용으로, 모르는 id 는 표시 그대로 (버전 표기 포함)', () => {
        const out = expandArtifactPlaceholders('앞\n[[artifact:lyrics]]\n[[artifact:lyrics:v2]]\n[[artifact:none]]', (id) => (id === 'lyrics' ? '## Verse\n가사' : undefined));
        expect(out).toBe('앞\n## Verse\n가사\n## Verse\n가사\n[[artifact:none]]');
    });
});
