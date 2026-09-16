/**
 * 재현 번들(F24.7) — 마스킹·이미지 생략·provider 식별자만·절단 순서(도구 결과 → 오래된 대화, system·마지막 user 유지)·세션 보관.
 */
import { buildReplayBundle, captureReplay, takeReplayBundle, clearReplayStore, type ReplayInput } from '../replay-capture';

const provider = { providerId: 'local-llm', modelId: 'qwen3.8-27b', fullId: 'qwen3.8-27b', provider: { apiKey: 'sk-should-not-leak-000000000000' } } as unknown as ReplayInput['provider'];
const input = (over: Partial<ReplayInput> = {}): ReplayInput => ({
    requestId: 'req-1', provider,
    messages: [
        { role: 'system', content: 'SYSTEM GUARD' },
        { role: 'user', content: '예전 질문' },
        { role: 'assistant', content: '예전 답' },
        { role: 'tool', content: 'x'.repeat(5000), tool_call_id: 'c1', tool_name: 'web_search' },
        { role: 'user', content: '키는 OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz 야', images: ['AAAA', 'BBBBBB'] },
    ],
    ...over,
});

beforeEach(() => clearReplayStore());

describe('buildReplayBundle', () => {
    it('자격증명 마스킹, 이미지는 개수·길이만, provider 는 식별자 3개만', () => {
        const b = buildReplayBundle(input());
        const json = JSON.stringify(b);
        expect(json).not.toContain('sk-abcdefghijklmnop');
        expect(json).not.toContain('sk-should-not-leak');
        expect(b.provider).toEqual({ providerId: 'local-llm', modelId: 'qwen3.8-27b', fullId: 'qwen3.8-27b' });
        expect(b.messages[4].images_omitted).toEqual({ count: 2, bytes: 10 });
        expect(b.truncated).toBe(false);
    });

    it('상한을 넘으면 도구 결과부터, 그다음 오래된 대화를 자르고 system·마지막 user 는 남긴다', () => {
        const b = buildReplayBundle(input(), 800);
        expect(b.truncated).toBe(true);
        expect(b.messages[3].content).toMatch(/^\[truncated tool result/);
        expect(b.messages[0].content).toBe('SYSTEM GUARD');
        expect(b.messages[4].content).toContain('야');
        const small = buildReplayBundle(input(), 1500);
        expect(small.messages[1].content).toBe('예전 질문'); // 도구 결과만 잘라도 들어가면 대화는 유지
    });
});

describe('captureReplay / takeReplayBundle', () => {
    it('세션별 최근 번들을 돌려주고, 신고 문장이 마지막 user 와 다르면 붙이지 않는다', () => {
        captureReplay('s1', input({ requestId: 'r-old' }));
        captureReplay('s1', input({ requestId: 'r-new', messages: [{ role: 'user', content: '두 번째 질문입니다' }] }));
        expect(takeReplayBundle('s1')?.requestId).toBe('r-new');
        expect(takeReplayBundle('s1', '두 번째 질문입니다')?.requestId).toBe('r-new');
        expect(takeReplayBundle('s1', '전혀 다른 질문')).toBeUndefined();
        expect(takeReplayBundle('none')).toBeUndefined();
    });

    it('세션 없는 요청은 보관하지 않고, 보관 시간이 지나면 없다', () => {
        captureReplay(undefined, input());
        const t0 = Date.now();
        captureReplay('s2', input(), t0);
        expect(takeReplayBundle('s2', undefined, t0 + 60_000)).toBeDefined();
        expect(takeReplayBundle('s2', undefined, t0 + 31 * 60_000)).toBeUndefined();
    });

    it('보관 뒤 원래 배열에 push 해도 번들은 캡처 시점 그대로(얕은 복사)', () => {
        const msgs = [{ role: 'user', content: 'q' }];
        captureReplay('s3', input({ messages: msgs }));
        msgs.push({ role: 'assistant', content: 'later' });
        expect(takeReplayBundle('s3')?.messages).toHaveLength(1);
    });
});
