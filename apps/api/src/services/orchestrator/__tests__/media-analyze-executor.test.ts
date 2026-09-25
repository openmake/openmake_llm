/**
 * audio.analyze / music.analyze / video.analyze 실행기 — 네이티브 콘텐츠 파트 모양과 레지스트리 등록(2026-09-25).
 *
 * 배경: 이 셋은 종전 `UNSUPPORTED_CAPABILITIES` 라 실행이 명시 실패했다. 이제 media-analyze 실행기로 처리한다:
 *   - audio(음악 포함) → input_audio{data,format},  - video → video_url{url}.  로컬은 thinking OFF.
 */
const callJson = jest.fn();
jest.mock('../http-call', () => ({
    callJson: (...args: unknown[]) => callJson(...args),
    extractChatText: () => 'analysis observation',
    extractUsage: () => undefined,
}));
jest.mock('../capability-resolver', () => ({
    resolveCapabilityTarget: jest.fn(),
    CapabilityUnavailableError: class extends Error {},
}));
const loadAttachment = jest.fn();
jest.mock('../media-io', () => ({ loadAttachment: (...args: unknown[]) => loadAttachment(...args) }));

import { mediaAnalyzeExecutor } from '../executors/media-analyze';
import { getMediaAnalyzeSystemPrompt } from '../../../prompts/svc-orchestrator-executors';
import { ensureLegacyCapabilityBridge, resetLegacyCapabilityBridgeForTest } from '../../../addon-host/legacy-capability-bridge';
import { getCapabilityRegistry, resetCapabilityRuntimeForTest } from '../../../runtime-ports/capability-runtime';

const target = (providerId: string, model = 'm', fullId = `${providerId}:${model}`) => ({ fullId, providerId, model, params: {} });

function makeTask(capability: string) {
    return { id: 't1', capability, instruction: 'Analyze this', text: '', attachments: ['a1'], refs: [], extra: {} };
}
function makeCtx(kind: 'audio' | 'video', tgt: ReturnType<typeof target>, lang = 'ko') {
    return {
        lang, userMessage: 'what is this', results: new Map(),
        attachments: new Map([['a1', { id: 'a1', kind, name: `x.${kind}`, mime: '', base64: 'x' }]]),
        targets: new Map([['t1', tgt]]),
    };
}
function body(): Record<string, unknown> {
    return callJson.mock.calls[0][1].body;
}

beforeEach(() => { callJson.mockReset().mockResolvedValue({}); loadAttachment.mockReset(); });

describe('mediaAnalyzeExecutor — 콘텐츠 파트 모양', () => {
    it('audio.analyze(로컬) — input_audio 파트 + mime→format + thinking OFF', async () => {
        loadAttachment.mockResolvedValue({ bytes: Buffer.from('abc'), mime: 'audio/wav', name: 'a.wav', dataUrl: 'data:audio/wav;base64,YWJj' });
        await mediaAnalyzeExecutor(makeTask('audio.analyze') as never, makeCtx('audio', target('local-llm', 'qwen')) as never);
        const b = body();
        expect(b.model).toBe('qwen');
        expect((b.messages as { content: unknown }[])[0].content).toBe(getMediaAnalyzeSystemPrompt('audio.analyze', 'ko'));
        const parts = (b.messages as { content: Record<string, unknown>[] }[])[1].content;
        expect(parts[1]).toEqual({ type: 'input_audio', input_audio: { data: Buffer.from('abc').toString('base64'), format: 'wav' } });
        // 로컬은 thinking 명시 OFF
        expect(b.chat_template_kwargs).toEqual({ enable_thinking: false });
    });

    it('music.analyze — audio/mpeg 는 format mp3, 음악 system prompt', async () => {
        loadAttachment.mockResolvedValue({ bytes: Buffer.from('m'), mime: 'audio/mpeg', name: 's.mp3', dataUrl: 'd' });
        await mediaAnalyzeExecutor(makeTask('music.analyze') as never, makeCtx('audio', target('local-llm', 'qwen')) as never);
        const parts = (body().messages as { content: Record<string, unknown>[] }[])[1].content;
        expect((parts[1].input_audio as { format: string }).format).toBe('mp3');
        expect((body().messages as { content: string }[])[0].content).toBe(getMediaAnalyzeSystemPrompt('music.analyze', 'ko'));
    });

    it('video.analyze(외부) — video_url 파트, 외부는 thinking 미전송', async () => {
        loadAttachment.mockResolvedValue({ bytes: Buffer.from('vid'), mime: 'video/mp4', name: 'v.mp4', dataUrl: 'data:video/mp4;base64,dmlk' });
        await mediaAnalyzeExecutor(makeTask('video.analyze') as never, makeCtx('video', target('hasa', 'hasa/m', 'hasa:m')) as never);
        const b = body();
        const parts = (b.messages as { content: Record<string, unknown>[] }[])[1].content;
        expect(parts[1]).toEqual({ type: 'video_url', video_url: { url: 'data:video/mp4;base64,dmlk' } });
        expect(b.chat_template_kwargs).toBeUndefined();
    });

    it('영어 턴은 머리글에 한글이 없다', async () => {
        loadAttachment.mockResolvedValue({ bytes: Buffer.from('m'), mime: 'audio/wav', name: 'a.wav', dataUrl: 'd' });
        await mediaAnalyzeExecutor(makeTask('audio.analyze') as never, makeCtx('audio', target('local-llm', 'q'), 'en') as never);
        const parts = (body().messages as { content: { text: string }[] }[])[1].content;
        expect(parts[0].text).toContain('## Instruction');
        expect(/\p{Script=Hangul}/u.test(parts[0].text)).toBe(false);
    });

    it('필요한 미디어 첨부가 없으면 호출 없이 실패한다', async () => {
        const t = { ...makeTask('audio.analyze'), attachments: [] };
        const c = { lang: 'ko', userMessage: 'q', results: new Map(), attachments: new Map(), targets: new Map([['t1', target('local-llm')]]) };
        await expect(mediaAnalyzeExecutor(t as never, c as never)).rejects.toThrow(/오디오 첨부/);
        expect(callJson).not.toHaveBeenCalled();
    });
});

describe('레지스트리 — 분석 계열이 더는 unsupported 로 던지지 않는다', () => {
    beforeEach(() => { resetCapabilityRuntimeForTest(); resetLegacyCapabilityBridgeForTest(); ensureLegacyCapabilityBridge(); });

    it('세 capability 가 등록돼 있고 handler 가 실행기로 위임한다', async () => {
        const reg = getCapabilityRegistry();
        for (const cap of ['audio.analyze', 'music.analyze', 'video.analyze']) expect(reg.has(cap)).toBe(true);

        loadAttachment.mockResolvedValue({ bytes: Buffer.from('m'), mime: 'audio/mpeg', name: 's.mp3', dataUrl: 'd' });
        const out = await reg.get('music.analyze')!.handler.execute(makeTask('music.analyze') as never, makeCtx('audio', target('local-llm', 'q')) as never);
        expect(out.ok).toBe(true);
        expect(callJson).toHaveBeenCalledTimes(1);
    });
});
