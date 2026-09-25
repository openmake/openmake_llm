/**
 * 미디어 입력 프로브(audio/video) 판정 — vision 과 같은 엄격함(정답을 맞혀야 true), 넘겼을 때만 실행 (2026-09-25, S2).
 */
import { judgeProbe, runProbe, PROBE_TOOL_NAME, type ProbeHttpResult, type ProbeObservations } from '../model-probe';

const okMsg = (message: Record<string, unknown>): ProbeHttpResult => ({ status: 200, body: { choices: [{ message }] } });
const http = (status: number): ProbeHttpResult => ({ status, body: null });
const toolCall = okMsg({ content: null, tool_calls: [{ function: { name: PROBE_TOOL_NAME, arguments: '{}' } }] });

/** 핵심 4능력이 전부 확정되는 기본 관찰(qwen 모양) — 미디어 필드만 갈아끼운다 */
function obs(over: Partial<ProbeObservations> = {}): ProbeObservations {
    return {
        basic: okMsg({ content: 'OK' }),
        stream: { status: 200, body: null, sseChunks: 5 },
        tools: toolCall,
        vision: okMsg({ content: '7' }),
        efforts: { low: okMsg({ content: '391', reasoning_content: 'x' }), medium: okMsg({ content: '391' }), high: http(400), xhigh: okMsg({ content: '391' }) },
        ...over,
    };
}

describe('judgeProbe — 미디어 입력', () => {
    it('프로브하지 않으면 audioInput/videoInput 키가 없다(구 프로필과 동일)', () => {
        const caps = judgeProbe(obs(), '7').profile.capabilities!;
        expect(caps).toEqual({ toolCalling: true, thinking: true, vision: true, streaming: true });
        expect('audioInput' in caps).toBe(false);
        expect('videoInput' in caps).toBe(false);
    });

    it('정답을 맞히면 audioInput/videoInput=true', () => {
        const caps = judgeProbe(
            obs({ audio: okMsg({ content: 'I hear a dog barking' }), video: okMsg({ content: 'a cat runs across' }) }),
            '7', { audio: 'dog', video: 'cat' },
        ).profile.capabilities!;
        expect(caps.audioInput).toBe(true);
        expect(caps.videoInput).toBe(true);
    });

    it('미디어 요청을 4xx 로 거절하면 false', () => {
        const caps = judgeProbe(obs({ audio: http(400), video: http(422) }), '7', { audio: 'dog', video: 'cat' }).profile.capabilities!;
        expect(caps.audioInput).toBe(false);
        expect(caps.videoInput).toBe(false);
    });

    it('200 이지만 정답을 못 맞히면/정답을 안 주면 미확정 — 키를 넣지 않는다', () => {
        const wrong = judgeProbe(obs({ audio: okMsg({ content: 'silence' }) }), '7', { audio: 'dog' });
        expect('audioInput' in wrong.profile.capabilities!).toBe(false);
        expect(wrong.notes.join('\n')).toContain('audioInput 미확정');

        const noAnswer = judgeProbe(obs({ audio: okMsg({ content: 'a dog' }) }), '7');
        expect('audioInput' in noAnswer.profile.capabilities!).toBe(false);
        expect(noAnswer.notes.join('\n')).toContain('정답을 안 줘서');
    });

    it('핵심 능력이 미확정이면 미디어를 확정해도 함께 넣지 못한다', () => {
        const v = judgeProbe(obs({ tools: okMsg({ content: 'sunny' }), audio: okMsg({ content: 'dog' }) }), '7', { audio: 'dog' });
        expect(v.profile.capabilities).toBeUndefined();
        expect(v.notes.join('\n')).toContain('핵심 능력이 미확정');
    });
});

describe('runProbe — 미디어 단계', () => {
    it('media 를 안 주면 종전 8회 그대로, audio/video 는 undefined', async () => {
        const o = await runProbe(async () => okMsg({ content: 'OK' }), 'm', 'AAAA', 'q');
        expect(o.audio).toBeUndefined();
        expect(o.video).toBeUndefined();
    });

    it('media 를 주면 input_audio·video_url 요청을 각 1회 추가한다(총 10회)', async () => {
        const payloads: Array<Record<string, unknown>> = [];
        const o = await runProbe(
            async (p) => { payloads.push(p); return okMsg({ content: 'OK' }); },
            'm', 'AAAA', 'q', {}, 0,
            { audio: { base64: 'QUJD', format: 'wav', question: 'qa', answer: 'x' }, video: { dataUrl: 'data:video/mp4;base64,QQ', question: 'qv' } },
        );
        expect(payloads).toHaveLength(10);
        expect(o.audio).toBeDefined();
        expect(o.video).toBeDefined();
        expect(payloads.some((p) => JSON.stringify(p).includes('"input_audio"'))).toBe(true);
        expect(payloads.some((p) => JSON.stringify(p).includes('"video_url"'))).toBe(true);
    });
});
