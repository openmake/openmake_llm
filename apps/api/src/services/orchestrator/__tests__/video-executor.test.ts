/** video.generate 실행기 — 저장본 즉시 반환 · 내려받기 재시도 · 내려받기 실패는 pending (2026-09-12 hasa 실측 대응) */
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => { throw new Error('no db'); } }));
const target = { capability: 'video.generate', fullId: 'hasa:Wan2.2-T2V', providerId: 'hasa', model: 'Wan2.2-T2V', baseUrl: 'https://open.hasa.re.kr/v1', endpoint: '/videos/generations', headers: { Authorization: 'Bearer k' }, params: {}, source: 'user', transport: 'direct' };
jest.mock('../capability-resolver', () => ({ resolveCapabilityTarget: async () => target }));
const download = jest.fn(); const callJson = jest.fn();
jest.mock('../http-call', () => ({ callJson: (...a: unknown[]) => callJson(...a), downloadProviderUrl: (...a: unknown[]) => download(...a) }));
const saveVideo = jest.fn(() => ({ kind: 'video', urlPath: '/generated/video-new.webm', markdown: '[🎬 영상 보기](/generated/video-new.webm)' }));
jest.mock('../media-io', () => ({ saveVideo: () => saveVideo() }));
const exists = jest.fn();
jest.mock('../../../tools/generated-media', () => ({ resolveGeneratedPath: (p: string) => exists(p) }));
jest.mock('../../../config/capabilities', () => ({
    ...jest.requireActual('../../../config/capabilities'),
    CAPABILITY_LIMITS: { ...jest.requireActual('../../../config/capabilities').CAPABILITY_LIMITS, VIDEO_WAIT_MS: 0, VIDEO_POLL_INTERVAL_MS: 1, VIDEO_DOWNLOAD_ATTEMPTS: 2 },
}));

import { videoGenerateExecutor, splitVideoNegations } from '../executors/video';
import type { ExecContext } from '../types';
import type { PlanTask } from '../plan-schema';

const task = (atts: string[]): PlanTask => ({ id: 't1', capability: 'video.generate', instruction: 'x', attachments: atts, refs: [], dependsOn: [], extra: {} } as unknown as PlanTask);
const ctx = (job: Record<string, unknown>): ExecContext => ({ lang: 'ko', userMessage: 'q', results: new Map(), userId: 'u1', attachments: new Map([['j1', { id: 'j1', kind: 'job', name: 'n', mime: '', job }]]) } as unknown as ExecContext);
beforeEach(() => { download.mockReset(); callJson.mockReset(); exists.mockReset(); saveVideo.mockClear(); });

test('저장본(resultPath)이 실재하면 provider 호출·다운로드 없이 완료로 반환', async () => {
    exists.mockReturnValue('/abs/video-old.webm');
    const r = await videoGenerateExecutor(task(['j1']), ctx({ capability: 'video.generate', providerId: 'hasa', jobId: 'vid_1', resultPath: '/generated/video-old.webm' }));
    expect(r.status).toBe('completed'); expect(r.media[0].urlPath).toBe('/generated/video-old.webm');
    expect(callJson).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
});

test('저장본 파일이 사라졌으면 재조회 경로로 — 첫 내려받기 실패 후 재시도 성공', async () => {
    exists.mockReturnValue(null);
    callJson.mockResolvedValue({ job_id: 'vid_1', status: 'COMPLETED', artifact_url: '/files/v.webm' });
    download.mockRejectedValueOnce(new Error('terminated')).mockResolvedValueOnce({ bytes: Buffer.from([1]), contentType: 'video/webm' });
    const r = await videoGenerateExecutor(task(['j1']), ctx({ capability: 'video.generate', providerId: 'hasa', jobId: 'vid_1', resultPath: '/generated/gone.webm' }));
    expect(r.status).toBe('completed'); expect(download).toHaveBeenCalledTimes(2); expect(saveVideo).toHaveBeenCalledTimes(1);
});

test('내려받기가 전부 실패하면 failed 가 아니라 pending(사유 포함)', async () => {
    exists.mockReturnValue(null);
    callJson.mockResolvedValue({ job_id: 'vid_1', status: 'COMPLETED', artifact_url: '/files/v.webm' });
    download.mockRejectedValue(new Error('terminated'));
    const r = await videoGenerateExecutor(task(['j1']), ctx({ capability: 'video.generate', providerId: 'hasa', jobId: 'vid_1', resultPath: null }));
    expect(r.ok).toBe(false); expect(r.status).toBe('pending'); expect(r.text).toMatch(/terminated/); expect(download).toHaveBeenCalledTimes(2);
});

describe('3·4. job 저장 보장 · 저장본은 자격증명 없이 반환', () => {
    it('제출 후 저장 실패면 "보존됨" 대신 id 보관 안내(재제출 없음)', async () => {
        // repo 는 getPool 이 throw → null → persisted=false 경로
        exists.mockReturnValue(null);
        callJson.mockResolvedValue({ job_id: 'vid_new', status: 'GENERATING' });
        const r = await videoGenerateExecutor(task([]), { ...ctx({}), attachments: new Map() } as never);
        expect(r.status).toBe('pending'); expect(r.text).toMatch(/저장하지 못했습니다|could not be saved/); expect(r.text).toMatch(/vid_new/);
        expect(callJson).toHaveBeenCalledTimes(1);
    });
});

describe('제출 인자 — 계획의 길이·크기·제외 요소 (2026-09-22)', () => {
    const submitBody = () => (callJson.mock.calls[0][1] as { body: Record<string, unknown> }).body;
    const newTask = (extra: Record<string, unknown>) => ({ ...task([]), extra } as PlanTask);
    const noAtt = { ...ctx({}), attachments: new Map() } as never;

    it('계획의 seconds·size 를 싣고, negative_prompt 는 기본 제외 목록과 합쳐 중복 없이', async () => {
        callJson.mockResolvedValue({ job_id: 'vid_a', status: 'GENERATING' });
        await videoGenerateExecutor(newTask({ seconds: '5', size: '720x1280', negative_prompt: 'text, Subtitles' }), noAtt);
        expect(submitBody()).toMatchObject({ seconds: '5', size: '720x1280', negative_prompt: 'subtitles, captions, watermark, text' });
    });

    it('인자가 없으면 기본 4초·가로 크기', async () => {
        callJson.mockResolvedValue({ job_id: 'vid_b', status: 'GENERATING' });
        await videoGenerateExecutor(newTask({}), noAtt);
        expect(submitBody()).toMatchObject({ seconds: '4', size: '1280x720', negative_prompt: 'subtitles, captions, watermark' });
    });

    it('negative_prompt 를 모르는 provider(OpenAI /v1/videos)엔 싣지 않고 부정 표현도 그대로 둔다', async () => {
        callJson.mockResolvedValue({ id: 'vid_c', status: 'queued' });
        const openai = { ...target, fullId: 'openrouter:sora', providerId: 'openrouter', model: 'openrouter/sora' };
        await videoGenerateExecutor({ ...newTask({ negative_prompt: 'text' }), instruction: 'Sunset beach, no text on screen' } as PlanTask, { ...ctx({}), attachments: new Map(), targets: new Map([['t1', openai]]) } as never);
        expect(submitBody()).not.toHaveProperty('negative_prompt');
        expect(submitBody().prompt).toBe('Sunset beach, no text on screen');
    });

    it('negative_prompt 를 받는 provider 면 프롬프트의 부정 표현을 걷어내 제외 목록으로 옮긴다', async () => {
        callJson.mockResolvedValue({ job_id: 'vid_d', status: 'GENERATING' });
        await videoGenerateExecutor({ ...newTask({}), instruction: 'A serene sunset over the ocean with gentle waves lapping the shore, no text on screen' } as PlanTask, noAtt);
        expect(submitBody()).toMatchObject({ prompt: 'A serene sunset over the ocean with gentle waves lapping the shore', negative_prompt: 'subtitles, captions, watermark, text' });
    });
});

describe('splitVideoNegations', () => {
    it.each([
        ['Sunset beach, warm light, no text', 'Sunset beach, warm light', ['text']],
        ['A cat on snow, vertical format, without subtitles or logos.', 'A cat on snow, vertical format.', ['subtitles', 'logos']],
        ['City at night with no on-screen text, cinematic', 'City at night, cinematic', ['text']],
        ['A piano on a stage, casino lights', 'A piano on a stage, casino lights', []],
        ['no text', 'no text', ['text']],
    ])('%s', (input, prompt, excluded) => {
        expect(splitVideoNegations(input)).toEqual({ prompt, excluded });
    });
});
