/**
 * music-runtime — 외부 음악 모델(Gemini Lyria). 배정 허용 범위·요청 조립·응답 오디오 추출.
 * Lyria 는 게이트웨이가 프록시하지 못하는 Gemini 네이티브 API(`/interactions`)라 직결(native)로 선언한다.
 */
import { musicGenerateHandler } from '../generate';
import { buildLyriaRequest, extractLyriaAudio, isLyriaModel, LYRIA_OPERATION } from '../providers/lyria';
import type { CapabilityContext } from '../../../capability-contract/types';
import type { PlanTask } from '../../../services/orchestrator/plan-schema';

const invokes: Array<{ operation: string; payload: Record<string, unknown> }> = [];
const saved: Array<{ ext: string; mime: string; bytes: Buffer }> = [];
let response: unknown;

const MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
const audioReply = (bytes = MP3, extra: Record<string, unknown> = {}) => ({
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'lyrics…' }, { type: 'audio', data: bytes.toString('base64'), ...extra }] }],
});

function ctx(model = 'lyria-3.5'): CapabilityContext {
    return {
        lang: 'ko', userMessage: 'q', attachments: new Map(), results: new Map(), userId: 'u1',
        invocation: { taskId: 't1', capability: 'music.generate', owner: { addonId: 'music-runtime', addonVersion: '1.0.0', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 0, deadline: 1e15 },
        model: {
            describe: () => ({ providerId: 'gemini', model, fullId: `gemini:${model}`, source: 'user', costOwner: 'user', transport: 'direct', params: {} }),
            invokeJson: async (req) => { invokes.push({ operation: req.operation, payload: req.payload as Record<string, unknown> }); return response as never; },
            invokeBinary: async () => { throw new Error('unused'); }, download: async () => { throw new Error('unused'); },
        },
        artifacts: { save: async (i) => { saved.push({ ext: i.ext, mime: i.mime, bytes: i.bytes }); return { id: '1', mimeType: i.mime, fileName: `tts-1.${i.ext}`, sizeBytes: i.bytes.length, urlPath: `/generated/tts-1.${i.ext}` }; }, read: async () => { throw new Error('unused'); } },
        jobs: { submit: async () => { throw new Error('unused'); }, get: async () => null, findByExternal: async () => null, advance: async () => null },
        traceId: 't',
    };
}
const task = (o: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', capability: 'music.generate', instruction: 'dreamy indie pop', text: '', attachments: [], refs: [], dependsOn: [], extra: {}, ...o });

beforeEach(() => { invokes.length = 0; saved.length = 0; response = audioReply(); });

test('배정: gemini 의 lyria 모델만 직결(native)로 허용 — 실시간 모델·다른 gemini 모델·다른 provider 는 거절', () => {
    const support = (fullId: string, providerId: string) => musicGenerateHandler.describeProviderSupport!({ fullId, providerId, isExternal: true });
    expect(support('gemini:lyria-3.5', 'gemini')).toEqual({ supported: true, direct: { endpoint: '/interactions', api: 'native' } });
    expect(support('gemini:lyria-3-clip-preview', 'gemini')).toMatchObject({ supported: true });
    expect(support('gemini:lyria-realtime-exp', 'gemini')).toMatchObject({ supported: false });
    expect(support('gemini:gemini-2.5-flash', 'gemini')).toMatchObject({ supported: false });
    expect(support('openrouter:lyria-3.5', 'openrouter')).toMatchObject({ supported: false });
    expect(isLyriaModel('gemini', 'lyria-3-pro-preview')).toBe(true);
});

test('요청: 선언한 연산 1회, 설명·가사·길이는 input 한 문장에 담는다', async () => {
    const r = await musicGenerateHandler.execute(task({ extra: { lyrics: '[Verse]\n바람이 분다', duration: '120' } }), ctx());
    expect(invokes).toHaveLength(1);
    expect(invokes[0].operation).toBe(LYRIA_OPERATION);
    expect(invokes[0].payload.model).toBe('lyria-3.5');
    const input = String(invokes[0].payload.input);
    expect(input).toContain('dreamy indie pop');
    expect(input).toContain('[Verse]\n바람이 분다');
    expect(input).toContain('120');
    expect(input).not.toMatch(/instrumental/i);
    expect(r.ok).toBe(true);
    expect(r.model).toBe('gemini:lyria-3.5');
    expect(r.media[0].urlPath).toBe('/generated/tts-1.mp3');
    expect(saved[0].bytes.equals(MP3)).toBe(true);
});

test('가사가 없으면 연주곡으로 요청한다 · 길이를 말하지 않으면 길이를 적지 않는다', () => {
    const body = buildLyriaRequest('lyria-3.5', 'calm piano', '', null);
    expect(String(body.input)).toMatch(/Instrumental only, no vocals/);
    expect(String(body.input)).not.toMatch(/second/);
});

test('30초 고정 모델(clip)에는 길이를 적지 않는다', () => {
    expect(String(buildLyriaRequest('lyria-3-clip-preview', 'calm piano', '', 120).input)).not.toMatch(/second/);
    expect(String(buildLyriaRequest('lyria-3.5', 'calm piano', '', 120).input)).toMatch(/120 seconds/);
});

test('응답: 마지막 오디오 블록을 쓴다 · mime 이 wav 면 wav 로 저장', async () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]);
    expect(extractLyriaAudio(audioReply(wav, { mime_type: 'audio/wav' }))?.bytes.equals(wav)).toBe(true);
    const two = { steps: [{ type: 'model_output', content: [{ type: 'audio', data: Buffer.from('a').toString('base64') }] }, { type: 'model_output', content: [{ type: 'audio', data: MP3.toString('base64') }] }] };
    expect(extractLyriaAudio(two)?.bytes.equals(MP3)).toBe(true);
    response = audioReply(wav, { mime_type: 'audio/wav' });
    await musicGenerateHandler.execute(task(), ctx());
    expect(saved[0].ext).toBe('wav');
});

test('오디오가 없는 응답은 명시 실패 — 모델이 남긴 글을 사유로 붙인다', async () => {
    expect(extractLyriaAudio({ steps: [] })).toBeNull();
    expect(extractLyriaAudio(null)).toBeNull();
    response = { steps: [{ type: 'model_output', content: [{ type: 'text', text: '요청이 안전 정책에 걸렸습니다' }] }] };
    await expect(musicGenerateHandler.execute(task(), ctx())).rejects.toThrow(/오디오가 없습니다 — 요청이 안전 정책에 걸렸습니다/);
});

test('lyria 가 아닌 외부 모델은 실행 단계에서도 거절', async () => {
    await expect(musicGenerateHandler.execute(task(), ctx('gemini-2.5-flash'))).rejects.toThrow(/외부 provider/);
    expect(invokes).toHaveLength(0);
});
