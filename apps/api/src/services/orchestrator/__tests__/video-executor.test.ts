/** video.generate 실행기 — 저장본 즉시 반환 · 내려받기 재시도 · 내려받기 실패는 pending (2026-09-12 hasa 실측 대응) */
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => { throw new Error('no db'); } }));
const target = { capability: 'video.generate', fullId: 'hasa:Wan2.2-T2V', providerId: 'hasa', model: 'Wan2.2-T2V', baseUrl: 'https://open.hasa.re.kr/v1', endpoint: '/videos/generations', headers: { Authorization: 'Bearer k' }, params: {}, source: 'user', transport: 'direct' };
jest.mock('../capability-resolver', () => ({ resolveCapabilityTarget: async () => target }));
const download = jest.fn(); const callJson = jest.fn();
jest.mock('../http-call', () => ({ callJson: (...a: unknown[]) => callJson(...a), downloadProviderUrl: (...a: unknown[]) => download(...a) }));
const saveVideo = jest.fn(() => ({ kind: 'video', urlPath: '/generated/video-new.webm', markdown: '[🎬 영상 보기](/generated/video-new.webm)' }));
jest.mock('../media-io', () => ({ saveVideo: () => saveVideo() }));
const exists = jest.fn();
jest.mock('../../../mcp/generated-media', () => ({ resolveGeneratedPath: (p: string) => exists(p) }));
jest.mock('../../../config/capabilities', () => ({
    ...jest.requireActual('../../../config/capabilities'),
    CAPABILITY_LIMITS: { ...jest.requireActual('../../../config/capabilities').CAPABILITY_LIMITS, VIDEO_WAIT_MS: 0, VIDEO_POLL_INTERVAL_MS: 1, VIDEO_DOWNLOAD_ATTEMPTS: 2 },
}));

import { videoGenerateExecutor } from '../executors/video';
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
