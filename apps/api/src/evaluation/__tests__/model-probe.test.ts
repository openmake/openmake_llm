/**
 * 모델 프로필 실측 프로브의 판정 — "확정한 것만 프로필에 넣는다" (S2).
 */
import { judgeProbe, runProbe, PROBE_TOOL_NAME, type ProbeHttpResult, type ProbeObservations } from '../model-probe';

const okMsg = (message: Record<string, unknown>): ProbeHttpResult => ({ status: 200, body: { choices: [{ message }] } });
const http = (status: number): ProbeHttpResult => ({ status, body: null });
const toolCall = okMsg({ content: null, tool_calls: [{ function: { name: PROBE_TOOL_NAME, arguments: '{"city":"Seoul"}' } }] });

function obs(over: Partial<ProbeObservations> = {}): ProbeObservations {
    return {
        basic: okMsg({ content: 'OK' }),
        stream: { status: 200, body: null, sseChunks: 5 },
        tools: toolCall,
        vision: okMsg({ content: '7' }),
        efforts: { low: okMsg({ content: '391', reasoning_content: '17*23…' }), medium: okMsg({ content: '391' }), high: http(400), xhigh: okMsg({ content: '391' }) },
        ...over,
    };
}

describe('judgeProbe', () => {
    it('전부 확정이면 capabilities 와 수락한 강도 목록을 낸다 (qwen3.8-27b 모양: high 만 400)', () => {
        const v = judgeProbe(obs(), '7');
        expect(v.unreachable).toBe(false);
        expect(v.profile.capabilities).toEqual({ toolCalling: true, thinking: true, vision: true, streaming: true });
        expect(v.profile.reasoningEfforts).toEqual(['low', 'medium', 'xhigh']);
    });

    it('기본 호출 실패면 아무것도 판정하지 않는다 — 401 을 "도구 미지원" 으로 읽지 않는다', () => {
        const v = judgeProbe(obs({ basic: http(401) }), '7');
        expect(v.unreachable).toBe(true);
        expect(v.profile).toEqual({});
    });

    it('도구를 안 부른 200 은 미확정이다 — capabilities 전체를 프로필에 넣지 않는다', () => {
        const v = judgeProbe(obs({ tools: okMsg({ content: 'It is sunny.' }) }), '7');
        expect(v.profile.capabilities).toBeUndefined();
        expect(v.notes.join('\n')).toContain('toolCalling 미확정');
        expect(v.profile.reasoningEfforts).toEqual(['low', 'medium', 'xhigh']); // 다른 필드는 그대로 확정
    });

    it('이미지를 버리고 200 을 주는 서버 — 정답을 못 맞히면 vision 미확정, 400 이면 false', () => {
        expect(judgeProbe(obs({ vision: okMsg({ content: 'I cannot see images.' }) }), '7').profile.capabilities).toBeUndefined();
        expect(judgeProbe(obs({ vision: http(400) }), '7').profile.capabilities?.vision).toBe(false);
    });

    it('429·5xx 가 섞인 강도는 목록을 확정하지 않는다 (한도를 거절로 읽지 않는다)', () => {
        const v = judgeProbe(obs({ efforts: { low: okMsg({ content: '391', reasoning: 'x' }), medium: http(429), high: http(400), xhigh: okMsg({ content: '391' }) } }), '7');
        expect(v.profile.reasoningEfforts).toBeUndefined();
        expect(v.notes.join('\n')).toContain('medium');
    });

    it('강도를 전부 거절하고 추론 필드도 없으면 thinking=false, 강도 목록은 없다', () => {
        const v = judgeProbe(obs({ efforts: { low: http(400), medium: http(400), high: http(422), xhigh: http(400) } }), '7');
        expect(v.profile.capabilities?.thinking).toBe(false);
        expect(v.profile.reasoningEfforts).toBeUndefined();
    });

    it('강도를 받기만 하고 추론 필드가 한 번도 없으면 thinking=false 이고 강도 목록을 내지 않는다 (수락은 사다리의 증거가 아니다)', () => {
        const plain = okMsg({ content: '391' });
        const v = judgeProbe(obs({ efforts: { low: plain, medium: plain, high: plain, xhigh: plain } }), '7');
        expect(v.profile.capabilities).toEqual({ toolCalling: true, thinking: false, vision: true, streaming: true });
        expect(v.profile.reasoningEfforts).toBeUndefined();
    });

    it('추론 필드가 없는데 강도 일부가 429 면 thinking 은 미확정이다', () => {
        const plain = okMsg({ content: '391' });
        const v = judgeProbe(obs({ efforts: { low: plain, medium: http(429), high: plain, xhigh: plain } }), '7');
        expect(v.profile.capabilities).toBeUndefined();
        expect(v.notes.join('\n')).toContain('thinking 미확정');
    });
});

describe('runProbe', () => {
    it('순차로 보내고, 기본 호출이 실패하면 나머지를 보내지 않는다', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const payloads: Array<Record<string, unknown>> = [];
        const post = async (p: Record<string, unknown>): Promise<ProbeHttpResult> => {
            inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
            payloads.push(p);
            await new Promise((r) => setImmediate(r));
            inFlight--;
            return okMsg({ content: 'OK' });
        };
        await runProbe(post, 'm', 'AAAA', 'q');
        expect(maxInFlight).toBe(1);
        expect(payloads).toHaveLength(8); // basic·stream·tools·vision + 강도 4
        expect(payloads.every((p) => p.model === 'm' && typeof p.max_tokens === 'number')).toBe(true);

        const failing: Array<Record<string, unknown>> = [];
        const o = await runProbe(async (p) => { failing.push(p); return http(401); }, 'm', 'AAAA', 'q');
        expect(failing).toHaveLength(1);
        expect(payloads.filter((p) => 'reasoning_effort' in p)).toHaveLength(4);
        expect(o.efforts).toEqual({});
    });
});
