/** music.generate 실행기 — ACE-Step OpenRouter 호환 단일 호출·가사/연주곡·base64 디코드·실패 (2026-09-23) */
const target = { capability: 'music.generate', fullId: 'local-llm:acestep-v15-xl-turbo', providerId: 'local-llm', model: 'acestep-v15-xl-turbo', baseUrl: 'http://127.0.0.1:13401', endpoint: '/music/v1/chat/completions', headers: { Authorization: 'Bearer master' }, params: {}, source: 'default', costOwner: 'local', transport: 'gateway' };
jest.mock('../capability-resolver', () => ({ resolveCapabilityTarget: async () => target }));
const callJson = jest.fn();
jest.mock('../http-call', () => ({ callJson: (...a: unknown[]) => callJson(...a) }));
const saveAudio = jest.fn((_b: Buffer, ext: string) => ({ kind: 'audio', urlPath: `/generated/tts-1.${ext}`, markdown: '' }));
jest.mock('../media-io', () => ({ saveAudio: (...a: [Buffer, string]) => saveAudio(...a), sniffAudioExt: (_b: Buffer, f: string) => f }));

import { musicGenerateExecutor, musicDuration, decodeAudioDataUrl } from '../executors/music';
import type { ExecContext, TaskResult } from '../types';
import type { PlanTask } from '../plan-schema';

const task = (o: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', capability: 'music.generate', instruction: 'upbeat lo-fi, piano', text: '', attachments: [], refs: [], dependsOn: [], extra: {}, ...o } as unknown as PlanTask);
const ctx = (o: Partial<ExecContext> = {}): ExecContext => ({ lang: 'ko', userMessage: 'q', results: new Map(), attachments: new Map(), userId: 'u1', ...o } as unknown as ExecContext);
/** ACE-Step 성공 응답 — 오디오는 base64 data URL, 메타데이터는 content */
const done = (b64 = Buffer.from([0xff, 0xfb, 0x90, 0x00]).toString('base64')) => ({
    choices: [{ message: { content: '## Metadata\n**BPM:** 75', audio: [{ type: 'audio_url', audio_url: { url: `data:audio/mpeg;base64,${b64}` } }] } }],
});
const sentBody = () => (callJson.mock.calls[0][1] as { body: Record<string, unknown> }).body;
beforeEach(() => { callJson.mockReset(); saveAudio.mockClear(); });

test('호출 1회로 끝나고, 길이·형식은 audio_config 로 간다 (가사 없으면 instrumental)', async () => {
    callJson.mockResolvedValueOnce(done());
    const r = await musicGenerateExecutor(task({ extra: { duration: '45' } }), ctx());
    expect(r.ok).toBe(true); expect(r.media[0].urlPath).toBe('/generated/tts-1.mp3'); expect(r.text).toMatch(/45초, 연주곡/);
    expect(callJson).toHaveBeenCalledTimes(1);
    expect(sentBody()).toMatchObject({
        model: 'acestep-v15-xl-turbo',
        messages: [{ role: 'user', content: 'upbeat lo-fi, piano' }],
        modalities: ['audio', 'text'],
        audio_config: { duration: 45, format: 'mp3', instrumental: true },
    });
    expect(sentBody()).not.toHaveProperty('lyrics');
    expect((sentBody().audio_config as Record<string, unknown>)).not.toHaveProperty('vocal_language');
    // 게이트웨이 기본 경로로 간다 — 전용 주소·별도 다운로드 없음
    expect(callJson.mock.calls[0][1]).not.toHaveProperty('url');
});

test('가사는 lyrics > text > refs 본문 순, 가사 언어를 audio_config.vocal_language 로', async () => {
    callJson.mockResolvedValueOnce(done());
    const results = new Map<string, TaskResult>([['t0', { taskId: 't0', capability: 'text.reason', ok: true, status: 'completed', text: '[Verse]\n바람이 분다 오늘도', media: [], ms: 1 }]]);
    await musicGenerateExecutor(task({ refs: ['t0'] }), ctx({ results }));
    expect(sentBody()).toMatchObject({ lyrics: '[Verse]\n바람이 분다 오늘도', audio_config: { vocal_language: 'ko' } });
    expect((sentBody().audio_config as Record<string, unknown>)).not.toHaveProperty('instrumental');
});

test('오디오 data URL 만 받는다 — 외부 URL·빈 본문은 거절(뒤따라가지 않는다)', () => {
    expect(decodeAudioDataUrl('data:audio/mpeg;base64,//uQ')?.length).toBeGreaterThan(0);
    expect(decodeAudioDataUrl('https://evil.example/a.mp3')).toBeNull();
    expect(decodeAudioDataUrl('data:text/html;base64,PGI+')).toBeNull();
    expect(decodeAudioDataUrl('data:audio/mpeg;base64,')).toBeNull();
    expect(decodeAudioDataUrl(undefined)).toBeNull();
});

test('길이는 ACE-Step 허용 범위(10~600초)로 자르고 없으면 30초', () => {
    expect(musicDuration(undefined)).toBe(30); expect(musicDuration('3')).toBe(10); expect(musicDuration('9999')).toBe(600); expect(musicDuration('abc')).toBe(30);
});

test('오디오 없는 응답은 명시 실패하고 본문 앞부분을 사유로 붙인다', async () => {
    callJson.mockResolvedValueOnce({ choices: [{ message: { content: '생성에 실패했습니다' } }] });
    await expect(musicGenerateExecutor(task(), ctx())).rejects.toThrow(/오디오가 없습니다 — 생성에 실패했습니다/);

    callJson.mockReset();
    callJson.mockResolvedValueOnce({ choices: [] });
    await expect(musicGenerateExecutor(task(), ctx())).rejects.toThrow(/오디오가 없습니다/);
});

test('외부 provider 배정은 실행하지 않는다', async () => {
    const ext = { ...target, providerId: 'openrouter', fullId: 'openrouter:m' };
    await expect(musicGenerateExecutor(task(), ctx({ targets: new Map([['t1', ext]]) } as never))).rejects.toThrow(/외부 provider/);
    expect(callJson).not.toHaveBeenCalled();
});
