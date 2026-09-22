/** music.generate 실행기 — ACE-Step 제출·폴링·결과 경로 재부착·가사/연주곡·실패 (2026-09-22) */
const target = { capability: 'music.generate', fullId: 'local-llm:acestep-v15-turbo', providerId: 'local-llm', model: 'acestep-v15-turbo', baseUrl: 'http://dgx:13401/music', endpoint: '/release_task', headers: { Authorization: 'Bearer outer' }, params: {}, source: 'default', costOwner: 'local', transport: 'gateway' };
jest.mock('../capability-resolver', () => ({ resolveCapabilityTarget: async () => target }));
const callJson = jest.fn(); const callBinary = jest.fn();
jest.mock('../http-call', () => ({ callJson: (...a: unknown[]) => callJson(...a), callBinary: (...a: unknown[]) => callBinary(...a) }));
const saveAudio = jest.fn((_b: Buffer, ext: string) => ({ kind: 'audio', urlPath: `/generated/tts-1.${ext}`, markdown: '' }));
jest.mock('../media-io', () => ({ saveAudio: (...a: [Buffer, string]) => saveAudio(...a), sniffAudioExt: (_b: Buffer, f: string) => f }));
jest.mock('../../../config/capabilities', () => ({
    ...jest.requireActual('../../../config/capabilities'),
    CAPABILITY_LIMITS: { ...jest.requireActual('../../../config/capabilities').CAPABILITY_LIMITS, MUSIC_POLL_INTERVAL_MS: 1, MUSIC_WAIT_MS: 50 },
}));

import { musicGenerateExecutor, musicDuration, musicFileUrl } from '../executors/music';
import type { ExecContext, TaskResult } from '../types';
import type { PlanTask } from '../plan-schema';

const task = (o: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', capability: 'music.generate', instruction: 'upbeat lo-fi, piano', text: '', attachments: [], refs: [], dependsOn: [], extra: {}, ...o } as unknown as PlanTask);
const ctx = (o: Partial<ExecContext> = {}): ExecContext => ({ lang: 'ko', userMessage: 'q', results: new Map(), attachments: new Map(), userId: 'u1', ...o } as unknown as ExecContext);
const done = (file = '/v1/audio?path=%2Ftmp%2Fa.mp3') => ({ data: [{ task_id: 'mt1', status: 1, result: JSON.stringify([{ file, status: 1 }]) }] });
const submitBody = () => (callJson.mock.calls[0][1] as { body: Record<string, unknown> }).body;
beforeEach(() => {
    callJson.mockReset(); callBinary.mockReset(); saveAudio.mockClear();
    callBinary.mockResolvedValue({ bytes: Buffer.from([1, 2]), contentType: 'audio/mpeg' });
});

test('제출 → 진행 중 → 완료 순으로 폴링하고, 결과 경로를 음악 서버 base 에 붙여 받는다', async () => {
    callJson.mockResolvedValueOnce({ data: { task_id: 'mt1', status: 'queued' } })
        .mockResolvedValueOnce({ data: [{ task_id: 'mt1', status: 0 }] })
        .mockResolvedValueOnce(done());
    const r = await musicGenerateExecutor(task({ extra: { duration: '45' } }), ctx());
    expect(r.ok).toBe(true); expect(r.media[0].urlPath).toBe('/generated/tts-1.mp3'); expect(r.text).toMatch(/45초, 연주곡/);
    expect(submitBody()).toMatchObject({ model: 'acestep-v15-turbo', prompt: 'upbeat lo-fi, piano', lyrics: '[Instrumental]', audio_duration: 45, audio_format: 'mp3', batch_size: 1 });
    expect(submitBody()).not.toHaveProperty('vocal_language');
    expect(callJson.mock.calls[1][1]).toMatchObject({ url: 'http://dgx:13401/music/query_result', body: { task_id_list: ['mt1'] } });
    expect(callBinary.mock.calls[0][1]).toMatchObject({ method: 'GET', url: 'http://dgx:13401/music/v1/audio?path=%2Ftmp%2Fa.mp3' });
});

test('가사는 lyrics > text > refs 본문 순, 가사 언어를 vocal_language 로', async () => {
    callJson.mockResolvedValueOnce({ data: { task_id: 'mt1' } }).mockResolvedValueOnce(done());
    const results = new Map<string, TaskResult>([['t0', { taskId: 't0', capability: 'text.reason', ok: true, status: 'completed', text: '[Verse]\n바람이 분다 오늘도', media: [], ms: 1 }]]);
    await musicGenerateExecutor(task({ refs: ['t0'] }), ctx({ results }));
    expect(submitBody()).toMatchObject({ lyrics: '[Verse]\n바람이 분다 오늘도', vocal_language: 'ko' });
});

test('응답이 절대 URL 을 줘도 경로·쿼리만 음악 서버 base 에 붙인다', () => {
    expect(musicFileUrl('http://dgx:13401/music', 'http://127.0.0.1:8004/v1/audio?path=x')).toBe('http://dgx:13401/music/v1/audio?path=x');
});

test('길이는 ACE-Step 허용 범위(10~600초)로 자르고 없으면 30초', () => {
    expect(musicDuration(undefined)).toBe(30); expect(musicDuration('3')).toBe(10); expect(musicDuration('9999')).toBe(600); expect(musicDuration('abc')).toBe(30);
});

test('실패 상태·대기 상한 초과·오디오가 아닌 응답은 명시 실패', async () => {
    callJson.mockResolvedValueOnce({ data: { task_id: 'mt1' } }).mockResolvedValueOnce({ data: [{ task_id: 'mt1', status: 2, result: '[]' }] });
    await expect(musicGenerateExecutor(task(), ctx())).rejects.toThrow(/음악 생성 실패/);

    callJson.mockReset();
    callJson.mockResolvedValueOnce({ data: { task_id: 'mt1' } }).mockResolvedValue({ data: [{ task_id: 'mt1', status: 0 }] });
    await expect(musicGenerateExecutor(task(), ctx())).rejects.toThrow(/초 안에 끝나지 않았습니다/);

    callJson.mockReset();
    callJson.mockResolvedValueOnce({ data: { task_id: 'mt1' } }).mockResolvedValueOnce(done());
    callBinary.mockResolvedValueOnce({ bytes: Buffer.from('{}'), contentType: 'application/json' });
    await expect(musicGenerateExecutor(task(), ctx())).rejects.toThrow(/음악 파일 형식이 아닙니다/);
});

test('외부 provider 배정은 실행하지 않는다', async () => {
    const ext = { ...target, providerId: 'openrouter', fullId: 'openrouter:m' };
    await expect(musicGenerateExecutor(task(), ctx({ targets: new Map([['t1', ext]]) } as never))).rejects.toThrow(/외부 provider/);
    expect(callJson).not.toHaveBeenCalled();
});
