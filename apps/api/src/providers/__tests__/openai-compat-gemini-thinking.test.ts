/**
 * Google 직접 provider(`gemini`) 사고 요약 — 요청 조립·스트림 가르개 단위 테스트.
 * 실측(2026-11-15): 직접 경로는 `extra_body.google.thinking_config.include_thoughts`, 게이트웨이(LiteLLM)는 한 겹 더 감싼다.
 * 사고는 `delta.content` 맨 앞의 `<thought>…</thought>` 로 온다(게이트웨이는 extra_content 표시를 지운다 — 태그로만 가른다).
 */
import { buildGeminiThinkingParams, GeminiThoughtSplitter } from '../openai-compat-gemini-thinking';

describe('buildGeminiThinkingParams', () => {
    const thoughts = { google: { thinking_config: { include_thoughts: true } } };

    it('직접 경로 + thinking 켬 → extra_body.google.thinking_config.include_thoughts', () => {
        expect(buildGeminiThinkingParams('gemini', true, false)).toEqual({ extra_body: thoughts });
    });

    it('게이트웨이 경로 → extra_body 를 한 겹 더 감싼다(LiteLLM 이 한 겹 풀어 올린다)', () => {
        expect(buildGeminiThinkingParams('gemini', 'high', true)).toEqual({ extra_body: { extra_body: thoughts } });
    });

    it('강도·예산은 보내지 않는다(reasoning_effort 와 함께 보내면 400)', () => {
        const p = buildGeminiThinkingParams('gemini', { budget: 2048 }, false);
        expect(p).toEqual({ extra_body: thoughts });
        expect(JSON.stringify(p)).not.toMatch(/reasoning_effort|thinking_budget|thinking_level/);
    });

    it.each([undefined, false])('thinking %s → 빈 객체', (thinking: undefined | false) => {
        expect(buildGeminiThinkingParams('gemini', thinking, false)).toEqual({});
        expect(buildGeminiThinkingParams('gemini', thinking, true)).toEqual({});
    });

    it('gemini 가 아닌 provider → 빈 객체', () => {
        expect(buildGeminiThinkingParams('hasa', true, true)).toEqual({});
        expect(buildGeminiThinkingParams('openrouter', true, false)).toEqual({});
    });
});

/** 조각을 차례로 넣고 flush 까지 모은다 */
function run(chunks: string[]): { thinking: string; content: string; thinkingParts: string[]; contentParts: string[] } {
    const s = new GeminiThoughtSplitter();
    const thinkingParts: string[] = [];
    const contentParts: string[] = [];
    for (const c of [...chunks.map((x) => s.feed(x)), s.flush()]) {
        if (c.thinking) thinkingParts.push(c.thinking);
        if (c.content) contentParts.push(c.content);
    }
    return { thinking: thinkingParts.join(''), content: contentParts.join(''), thinkingParts, contentParts };
}

describe('GeminiThoughtSplitter', () => {
    it('한 조각 안에 사고와 본문', () => {
        expect(run(['<thought>생각</thought>답'])).toMatchObject({ thinking: '생각', content: '답' });
    });

    it('실측 모양 — 첫 조각이 <thought> 로, 답의 첫 조각이 </thought> 로 시작', () => {
        const r = run(['<thought>**계획**\n', '두 수를 더한다.', '</thought>2 더하기 3은 ', '5입니다.']);
        expect(r.thinking).toBe('**계획**\n두 수를 더한다.');
        expect(r.content).toBe('2 더하기 3은 5입니다.');
    });

    it('사고 조각은 받은 대로 바로 내보낸다(스트리밍)', () => {
        const s = new GeminiThoughtSplitter();
        expect(s.feed('<thought>가')).toEqual({ thinking: '가', content: '' });
        expect(s.feed('나')).toEqual({ thinking: '나', content: '' });
    });

    it('여는 태그가 조각 경계에서 잘림', () => {
        expect(run(['<th', 'ou', 'ght>생각</thought>답'])).toMatchObject({ thinking: '생각', content: '답' });
    });

    it('닫는 태그가 조각 경계에서 잘림 — 접두는 붙들었다 판정', () => {
        const r = run(['<thought>생각</th', 'ought>답']);
        expect(r).toMatchObject({ thinking: '생각', content: '답' });
        expect(r.thinkingParts.join('')).not.toContain('<');
    });

    it('사고 안의 닫는 태그 아닌 < 는 사고로 낸다', () => {
        expect(run(['<thought>a </', 'b 와 </x', '></thought>답'])).toMatchObject({ thinking: 'a </b 와 </x>', content: '답' });
    });

    it('태그 없음 — 전부 본문(사고 미지원 모델)', () => {
        expect(run(['안녕', '하세요'])).toMatchObject({ thinking: '', content: '안녕하세요' });
    });

    it('닫힘 없이 끝 — 받은 것 전부 사고, 본문 빈 값(끝의 미완 닫는 태그 접두도 사고)', () => {
        expect(run(['<thought>생각 중', '</tho'])).toMatchObject({ thinking: '생각 중</tho', content: '' });
    });

    it('본문이 시작된 뒤의 <thought> 는 글자 그대로 본문', () => {
        expect(run(['<thought>생각</thought>답: ', '<thought>태그는 ', '이렇게</thought>'])).toMatchObject({
            thinking: '생각',
            content: '답: <thought>태그는 이렇게</thought>',
        });
    });

    it('맨 앞이 아닌 <thought> 는 본문', () => {
        expect(run(['안녕 <thought>x</thought>'])).toMatchObject({ thinking: '', content: '안녕 <thought>x</thought>' });
    });

    it('미완 여는 태그 접두로 끝나면 flush 에서 본문으로 낸다', () => {
        const s = new GeminiThoughtSplitter();
        expect(s.feed('<thou')).toEqual({ thinking: '', content: '' });
        expect(s.flush()).toEqual({ thinking: '', content: '<thou' });
    });

    it('여는 태그 접두처럼 시작하다 어긋나면 본문', () => {
        expect(run(['<th', 'ink>답'])).toMatchObject({ thinking: '', content: '<think>답' });
    });

    it('닫힌 직후 바로 다시 열리는 연속 구간은 사고', () => {
        expect(run(['<thought>하나</thought>', '<thought>둘</thought>답'])).toMatchObject({ thinking: '하나둘', content: '답' });
    });

    it('닫힌 직후 다시 여는 태그가 조각 경계에서 잘려도 사고', () => {
        expect(run(['<thought>하나</thought><tho', 'ught>둘</thought>답'])).toMatchObject({ thinking: '하나둘', content: '답' });
    });

    it('닫힌 직후 스트림이 끝나면 본문은 빈 값', () => {
        expect(run(['<thought>생각</thought>'])).toMatchObject({ thinking: '생각', content: '' });
    });

    it('빈 조각은 아무것도 내지 않는다', () => {
        const s = new GeminiThoughtSplitter();
        expect(s.feed('')).toEqual({ thinking: '', content: '' });
        expect(s.flush()).toEqual({ thinking: '', content: '' });
    });
});
