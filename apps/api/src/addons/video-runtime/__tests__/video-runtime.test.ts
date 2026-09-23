/**
 * video-runtime (P08) — 저장본은 자격증명 없이(T15)·미완료 job 은 같은 id 재조회·다운로드 실패는 재수집 대기(T12)·
 * 응답 유실은 재제출 없이 pending(T13)·hasa 직결 선언·원문 길이·비율 hook.
 */
jest.mock('../../../tools/generated-media', () => ({ resolveGeneratedPath: (p: string) => (p === '/generated/ok.webm' ? '/abs/ok.webm' : null) }));
jest.mock('../../../config/capabilities', () => ({ ...jest.requireActual('../../../config/capabilities'), CAPABILITY_LIMITS: { ...jest.requireActual('../../../config/capabilities').CAPABILITY_LIMITS, VIDEO_WAIT_MS: 0, VIDEO_DOWNLOAD_ATTEMPTS: 1 } }));

import { videoGenerateHandler, splitVideoNegations } from '../generate';
import { normalizeVideoPlanInput } from '../plan-input';
import { videoJobDriver } from '../driver';
import { VIDEO_OPERATIONS } from '../providers/adapters';
import { startVideoRuntime } from '../boot';
import { validateOperationSpecs } from '../../../runtime-ports/model-invoker';
import type { CapabilityContext } from '../../../capability-contract/types';
import type { PlanTask } from '../../../services/orchestrator/plan-schema';
import type { SubmitOutcome } from '../../../runtime-ports/job-runtime';

type Call = { operation: string; payload?: unknown; pathParams?: Record<string, string> };
const calls: Call[] = [];
const downloads: string[] = [];
const advances: Array<[string, string, unknown]> = [];
let statusResponse: Record<string, unknown> = { id: 'ext-1', status: 'completed', seconds: 4 };
let downloadFails = false;
let submitOutcome: (send: () => Promise<{ externalJobId: string }>) => Promise<SubmitOutcome>;
const describeCalls = { n: 0 };

function ctx(providerId = 'openrouter', over: Partial<CapabilityContext> = {}): CapabilityContext {
    return {
        lang: 'ko', userMessage: 'q', attachments: new Map(), results: new Map(), userId: 'u1', sessionId: 's1',
        invocation: { taskId: 't1', capability: 'video.generate', owner: { addonId: 'video-runtime', addonVersion: '1.0.0', source: 'builtin' }, registryRevision: 1, stateRevision: 1, issuedAt: 0, deadline: 1e15 },
        model: {
            describe: () => { describeCalls.n++; return { providerId, model: `${providerId}/wan`, fullId: `${providerId}:wan`, source: 'user', costOwner: 'user', transport: 'gateway', params: {} }; },
            invokeJson: async (req) => { calls.push({ operation: req.operation, payload: req.payload, pathParams: req.pathParams as Record<string, string> }); return (req.operation.endsWith('.submit') ? { id: 'ext-1', status: 'queued' } : statusResponse) as never; },
            invokeBinary: async () => { throw new Error('unused'); },
            download: async (url) => { downloads.push(url); if (downloadFails) throw new Error('terminated'); return { bytes: Buffer.from('VID'), contentType: 'video/mp4' }; },
        },
        artifacts: { save: async (i) => ({ id: '42', mimeType: i.mime, fileName: `video-1.${i.ext}`, sizeBytes: i.bytes.length, urlPath: `/generated/video-1.${i.ext}` }), read: async () => { throw new Error('unused'); } },
        jobs: {
            submit: async (_input, send) => submitOutcome(send),
            get: async () => null,
            findByExternal: async (_p, ext) => ({ id: '9', externalJobId: ext, state: 'running' } as never),
            advance: async (id, to, patch) => { advances.push([id, to, patch]); return null; },
        },
        traceId: 't', ...over,
    };
}
const task = (o: Partial<PlanTask> = {}): PlanTask => ({ id: 't1', capability: 'video.generate', instruction: 'a cat running on the beach, no text on screen', text: '', attachments: [], refs: [], dependsOn: [], extra: {}, ...o });

beforeEach(() => {
    calls.length = 0; downloads.length = 0; advances.length = 0; describeCalls.n = 0; downloadFails = false;
    statusResponse = { id: 'ext-1', status: 'completed', seconds: 4 };
    submitOutcome = async (send) => { const { externalJobId } = await send(); return { kind: 'submitted', job: { id: '9', externalJobId, state: 'running' } as never, externalJobId, persisted: true }; };
});

describe('videoGenerateHandler', () => {
    it('새 제출 → Job Runtime submit → 상태 조회 → 수집 → 저장 → completed(같은 job record 로 기록)', async () => {
        const r = await videoGenerateHandler.execute(task({ extra: { seconds: '6' } }), ctx());
        expect(r).toMatchObject({ ok: true, status: 'completed', job: { providerId: 'openrouter', jobId: 'ext-1' }, usage: { units: { kind: 'video_seconds', count: 4 } } });
        expect(calls.map((c) => c.operation)).toEqual(['videos.openai.submit', 'videos.openai.status']);
        expect(calls[0].payload).toMatchObject({ model: 'openrouter/wan', seconds: '6', size: '1280x720' });
        expect(calls[0].payload).not.toHaveProperty('negative_prompt'); // OpenAI /v1/videos 는 모르는 필드
        expect(downloads).toEqual(['/v1/videos/ext-1/content']);
        expect(advances.map((a) => a[1])).toEqual(['collecting', 'completed']);
        expect(advances[1][2]).toMatchObject({ resultPath: '/generated/video-1.mp4', artifactIds: ['42'] });
    });

    it('hasa 는 부정 표현을 걷어 negative_prompt 로 옮기고 jobs-v1 연산을 쓴다 · 직결 선언', async () => {
        statusResponse = { id: 'ext-1', status: 'COMPLETED', artifact_url: '/files/ext-1.mp4' };
        await videoGenerateHandler.execute(task(), ctx('hasa'));
        expect(calls.map((c) => c.operation)).toEqual(['videos.hasa.submit', 'videos.hasa.status']);
        expect(calls[0].payload).toMatchObject({ prompt: 'a cat running on the beach', negative_prompt: 'subtitles, captions, watermark, text' });
        expect(calls[1].pathParams).toEqual({ id: 'ext-1' });
        expect(downloads).toEqual(['/files/ext-1.mp4']);
        expect(videoGenerateHandler.describeProviderSupport!({ fullId: 'hasa:wan', providerId: 'hasa', isExternal: true })).toEqual({ supported: true, direct: { endpoint: '/videos/generations' } });
        expect(videoGenerateHandler.describeProviderSupport!({ fullId: 'openrouter:m', providerId: 'openrouter', isExternal: true })).toEqual({ supported: true });
    });

    it('T15: 저장본이 있는 job 첨부는 모델 포트를 건드리지 않고 반환(키 삭제와 무관)', async () => {
        const c = ctx();
        c.attachments.set('j1', { id: 'j1', kind: 'job', name: 'n', mime: '', job: { capability: 'video.generate', providerId: 'hasa', jobId: 'vid_1', resultPath: '/generated/ok.webm', sameConversation: true } });
        const r = await videoGenerateHandler.execute(task({ attachments: ['j1'] }), c);
        expect(r).toMatchObject({ ok: true, status: 'completed', media: [{ urlPath: '/generated/ok.webm' }] });
        expect(describeCalls.n).toBe(0);
        expect(calls).toHaveLength(0);
    });

    it('미완료 job 첨부는 같은 id 만 재조회(새 제출 0) · provider 가 바뀌면 명시 실패', async () => {
        const c = ctx('hasa');
        c.attachments.set('j1', { id: 'j1', kind: 'job', name: 'n', mime: '', job: { capability: 'video.generate', providerId: 'hasa', jobId: 'vid_9', resultPath: null } });
        statusResponse = { id: 'vid_9', status: 'RUNNING', progress: 30 };
        const r = await videoGenerateHandler.execute(task({ attachments: ['j1'] }), c);
        expect(r.status).toBe('pending');
        expect(r.text).toMatch(/30%/);
        expect(calls.map((x) => x.operation)).toEqual(['videos.hasa.status']);
        await expect(videoGenerateHandler.execute(task({ attachments: ['j1'] }), ctx('openrouter', { attachments: c.attachments }))).rejects.toThrow(/provider.*달라/);
    });

    it('T12: 완성 후 다운로드 실패는 collecting 으로 남기고 pending — 재제출 없음', async () => {
        downloadFails = true;
        const r = await videoGenerateHandler.execute(task(), ctx());
        expect(r.status).toBe('pending');
        expect(r.text).toMatch(/내려받기가 실패/);
        expect(calls.filter((c) => c.operation.endsWith('.submit'))).toHaveLength(1);
        expect(advances.at(-1)).toEqual(['9', 'collecting', { errorCode: 'collect_failed', stage: 'collect_failed', incrementRetry: true }]);
    });

    it('T13: 제출 응답 유실은 재제출 없이 pending 안내 · 거절은 명시 실패', async () => {
        submitOutcome = async () => ({ kind: 'unknown', job: { id: '9' } as never, error: 'socket hang up' });
        const r = await videoGenerateHandler.execute(task(), ctx());
        expect(r.status).toBe('pending');
        expect(r.text).toMatch(/다시 제출하지 않았습니다/);
        expect(calls).toHaveLength(0);
        submitOutcome = async () => ({ kind: 'rejected', error: 'HTTP 400' });
        await expect(videoGenerateHandler.execute(task(), ctx())).rejects.toThrow(/거절/);
    });

    it('provider 실패 상태는 failed 로 기록하고 throw', async () => {
        statusResponse = { id: 'ext-1', status: 'failed' };
        await expect(videoGenerateHandler.execute(task(), ctx())).rejects.toThrow(/영상 생성 실패/);
        expect(advances.at(-1)?.[1]).toBe('failed');
    });
});

describe('driver·연산·plan hook', () => {
    it('선언 연산은 포트 검증을 통과하고, collecting 재수집은 상태를 한 번 더 조회해 artifact 를 찾는다(재제출 아님)', async () => {
        expect(() => validateOperationSpecs(VIDEO_OPERATIONS)).not.toThrow();
        statusResponse = { id: 'ext-1', status: 'COMPLETED', artifact_url: 'https://cdn.hasa/x.webm' };
        const c = ctx('hasa');
        const file = await videoJobDriver.collect({ externalJobId: 'ext-1', model: c.model }, { status: 'done' });
        expect(file.ext).toBe('webm'); // URL 확장자 우선
        expect(calls.map((x) => x.operation)).toEqual(['videos.hasa.status']);
        expect(downloads).toEqual(['https://cdn.hasa/x.webm']);
    });

    it('원문 길이·비율이 계획값보다 우선, 원문에 없으면 그대로, 재조회 작업은 건드리지 않는다', () => {
        const extra = (message: string, input: Record<string, unknown> = {}, attachments: string[] = []) => normalizeVideoPlanInput(task({ extra: input, attachments }), message).extra;
        expect(extra('세로 쇼츠용으로 고양이가 뛰는 8초 영상 만들어줘', { size: '720x1280' })).toEqual({ seconds: '8', size: '720x1280' });
        expect(extra('Make a 6-second square video of a spinning cup')).toEqual({ seconds: '6', size: '720x720' });
        expect(extra('3초 뒤에 로고가 뜨는 10초 영상', { seconds: '3' }).seconds).toBe('10');
        expect(extra('도시 야경 타임랩스 영상 만들어줘', { seconds: '10', size: '1280x720' })).toEqual({ seconds: '10', size: '1280x720' });
        expect(extra('아까 그 5초 영상 보여줘', {}, ['j1'])).toEqual({});
        expect(extra('2분짜리 영상')).toEqual({ seconds: '120' });
    });

    it('부정 표현 분리 · 부팅은 video.generate 하나를 게시', async () => {
        expect(splitVideoNegations('sunset over sea, without subtitles or logos')).toEqual({ prompt: 'sunset over sea', excluded: ['subtitles', 'logos'] });
        const ids: string[] = [];
        await startVideoRuntime({ owner: { addonId: 'video-runtime', addonVersion: '1.0.0', source: 'builtin' }, registerCapabilities: (e) => { ids.push(...e.map((x) => x.definition.id)); } });
        expect(ids).toEqual(['video.generate']);
    });
});
