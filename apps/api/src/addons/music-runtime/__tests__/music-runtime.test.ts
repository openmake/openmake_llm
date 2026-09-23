/**
 * music-runtime (P06) — ACE-Step 단일 호출·가사/연주곡·data URL 디코드·외부 배정 거절·원문 길이 hook. 종전 music-executor 테스트의 기대값 보존.
 */
import { musicGenerateHandler } from '../generate';
import { normalizeMusicPlanInput } from '../plan-input';
import { decodeAudioDataUrl, musicDuration } from '../providers/acestep';
import { startMusicRuntime } from '../boot';
import type { CapabilityContext } from '../../../capability-contract/types';
import type { PlanTask } from '../../../services/orchestrator/plan-schema';
import type { TaskResult } from '../../../services/orchestrator/types';

const invokes: Array<{ operation: string; payload: Record<string, unknown> }> = [];
const saved: Array<{ ext: string; bytes: Buffer }> = [];
let response: unknown;

function ctx(providerId = 'local-llm', over: Partial<CapabilityContext> = {}): CapabilityContext {
    return {
        lang: 'ko', userMessage: 'q', attachments: new Map(), results: new Map(), userId: 'u1',
        invocation: { taskId: 't1', capability: 'music.generate', owner: { addonId: 'music-runtime', addonVersion: '1.0.0', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 0, deadline: 1e15 },
        model: {
            describe: () => ({ providerId, model: 'acestep-v15-xl-turbo', fullId: `${providerId}:acestep-v15-xl-turbo`, source: 'default', costOwner: 'local', transport: 'gateway', params: {} }),
            invokeJson: async (req) => { invokes.push({ operation: req.operation, payload: req.payload as Record<string, unknown> }); return response as never; },
            invokeBinary: async () => { throw new Error('unused'); }, download: async () => { throw new Error('unused'); },
        },
        artifacts: { save: async (i) => { saved.push({ ext: i.ext, bytes: i.bytes }); return { id: '1', mimeType: i.mime, fileName: `tts-1.${i.ext}`, sizeBytes: i.bytes.length, urlPath: `/generated/tts-1.${i.ext}` }; }, read: async () => { throw new Error('unused'); } },
        traceId: 't', ...over,
    };
}
const task = (o: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', capability: 'music.generate', instruction: 'upbeat lo-fi, piano', text: '', attachments: [], refs: [], dependsOn: [], extra: {}, ...o });
const done = (b64 = Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString('base64')) => ({ choices: [{ message: { content: '## Metadata\n**BPM:** 75', audio: [{ type: 'audio_url', audio_url: { url: `data:audio/mpeg;base64,${b64}` } }] } }] });

beforeEach(() => { invokes.length = 0; saved.length = 0; response = done(); });

test('pass-through 연산 1회, 길이·형식은 audio_config, 가사 없으면 instrumental', async () => {
    const r = await musicGenerateHandler.execute(task({ extra: { duration: '45' } }), ctx());
    expect(r.ok).toBe(true); expect(r.media[0].urlPath).toBe('/generated/tts-1.mp3'); expect(r.text).toMatch(/45초, 연주곡/);
    expect(invokes).toHaveLength(1);
    expect(invokes[0].operation).toBe('music.chat_completions');
    expect(invokes[0].payload).toMatchObject({ model: 'acestep-v15-xl-turbo', messages: [{ role: 'user', content: 'upbeat lo-fi, piano' }], modalities: ['audio', 'text'], audio_config: { duration: 45, format: 'mp3', instrumental: true } });
    expect(invokes[0].payload).not.toHaveProperty('lyrics');
});

test('가사는 lyrics > text > refs 본문 순, 언어를 vocal_language 로', async () => {
    const results = new Map<string, TaskResult>([['t0', { taskId: 't0', capability: 'text.reason', ok: true, status: 'completed', text: '[Verse]\n바람이 분다 오늘도', media: [], ms: 1 }]]);
    await musicGenerateHandler.execute(task({ refs: ['t0'] }), ctx('local-llm', { results }));
    expect(invokes[0].payload).toMatchObject({ lyrics: '[Verse]\n바람이 분다 오늘도', audio_config: { vocal_language: 'ko' } });
    expect(invokes[0].payload.audio_config).not.toHaveProperty('instrumental');
});

test('오디오 data URL 만 받는다 · 길이 범위 · 오디오 없는 응답은 명시 실패', async () => {
    expect(decodeAudioDataUrl('data:audio/mpeg;base64,//uQ')?.length).toBeGreaterThan(0);
    expect(decodeAudioDataUrl('https://evil.example/a.mp3')).toBeNull();
    expect(decodeAudioDataUrl('data:text/html;base64,PGI+')).toBeNull();
    expect(musicDuration(undefined)).toBe(30); expect(musicDuration('3')).toBe(10); expect(musicDuration('9999')).toBe(600);
    response = { choices: [{ message: { content: '생성에 실패했습니다' } }] };
    await expect(musicGenerateHandler.execute(task(), ctx())).rejects.toThrow(/오디오가 없습니다 — 생성에 실패했습니다/);
});

test('외부 provider 는 배정 단계(describeProviderSupport)와 실행 단계 모두 거절 — 자동 외부 전환 없음', async () => {
    expect(musicGenerateHandler.describeProviderSupport!({ fullId: 'openrouter:m', providerId: 'openrouter', isExternal: true })).toMatchObject({ supported: false });
    expect(musicGenerateHandler.describeProviderSupport!({ fullId: 'local-llm:acestep', providerId: 'local-llm', isExternal: false })).toEqual({ supported: true });
    await expect(musicGenerateHandler.execute(task(), ctx('openrouter'))).rejects.toThrow(/외부 provider/);
    expect(invokes).toHaveLength(0);
});

test('T07: 원문 길이가 계획값보다 우선하고, 원문에 없으면 계획값 유지 — 가사 참조 정규화는 Base 검증이 유지', () => {
    expect(normalizeMusicPlanInput(task(), '5분짜리 발라드 만들어줘').extra).toEqual({ duration: '300' });
    expect(normalizeMusicPlanInput(task({ extra: { duration: '30' } }), '3분 곡').extra).toEqual({ duration: '180' });
    expect(normalizeMusicPlanInput(task({ extra: { duration: '60' } }), '발라드 만들어줘').extra).toEqual({ duration: '60' });
});

test('startMusicRuntime 은 music.generate 하나를 게시한다', async () => {
    const ids: string[] = [];
    await startMusicRuntime({ owner: { addonId: 'music-runtime', addonVersion: '1.0.0', source: 'builtin' }, registerCapabilities: (e) => { ids.push(...e.map((x) => x.definition.id)); } });
    expect(ids).toEqual(['music.generate']);
});
