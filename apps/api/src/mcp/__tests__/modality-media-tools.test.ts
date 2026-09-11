/** 오디오·영상 도구 — 해석기·fetch mock 으로 wire(게이트웨이 1곳·헤더·본문)·형식 판별·비동기 작업 흐름 고정 */
const mockResolve = jest.fn();
jest.mock('../../services/modality-resolver', () => {
    const actual = jest.requireActual('../../services/modality-resolver');
    return { ...actual, resolveModalityTarget: (...a: unknown[]) => mockResolve(...a) };
});
jest.mock('../../data/models/unified-database', () => ({ getPool: () => ({}) }));
const saved: Array<{ prefix: string; ext: string; size: number }> = [];
jest.mock('../generated-media', () => ({
    saveGeneratedFile: (prefix: string, ext: string, data: Buffer) => {
        saved.push({ prefix, ext, size: data.length });
        return { filename: `${prefix}.${ext}`, urlPath: `/generated/${prefix}.${ext}`, absPath: '/x' };
    },
    resolveGeneratedPath: () => null,
}));
jest.mock('../../security/ssrf-guard', () => ({ safeFetch: (url: string, init?: RequestInit) => (global.fetch as typeof fetch)(url, init) }));
jest.mock('../../config/modality', () => {
    const actual = jest.requireActual('../../config/modality');
    return { ...actual, MODALITY_LIMITS: { ...actual.MODALITY_LIMITS, VIDEO_WAIT_MS: 50, VIDEO_POLL_INTERVAL_MS: 5 } };
});

import { textToSpeechTool, transcribeAudioTool, sniffAudioExt } from '../audio-tools';
import { generateVideoTool, getVideoTool } from '../video-tools';
import { ModalityUnavailableError } from '../../services/modality-resolver';
import { MODALITY_TOOL_INTENT_GATES } from '../../config/modality';

const gwTarget = (modality: string, extra: Partial<Record<string, unknown>> = {}) => ({
    modality, fullId: 'hasa/x', providerId: 'hasa', model: 'hasa/x', baseUrl: 'http://gw', endpoint: '/v1/audio/speech',
    headers: { Authorization: 'Bearer m', 'x-api-key': 'k' }, params: {}, source: 'global', transport: 'gateway', ...extra,
});
const realFetch = global.fetch;
afterEach(() => { global.fetch = realFetch; mockResolve.mockReset(); saved.length = 0; });

describe('text_to_speech', () => {
    it('미배정이면 안내 오류', async () => {
        mockResolve.mockRejectedValue(new ModalityUnavailableError('tts 미배정', 'MODALITY_UNASSIGNED'));
        const r = await textToSpeechTool.handler({ text: 'hi' }, { userId: 'u1', role: 'user' });
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toContain('tts 미배정');
    });

    it('게이트웨이 1곳으로 model·voice(params)·format 을 싣고, 바이트로 확장자를 확정한다', async () => {
        mockResolve.mockResolvedValue(gwTarget('tts', { params: { voice: 'KR', format: 'wav' } }));
        const wav = Buffer.concat([Buffer.from('RIFF....WAVE'), Buffer.alloc(8)]);
        const f = jest.fn(async () => ({
            ok: true, status: 200, text: async () => '',
            arrayBuffer: async () => wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length),
        }));
        global.fetch = f as unknown as typeof fetch;
        const r = await textToSpeechTool.handler({ text: '안녕' }, { userId: 'u1', role: 'user' });
        expect(r.isError).toBeFalsy();
        expect(r.content[0].text).toContain('/generated/tts.wav');
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('http://gw/v1/audio/speech');
        expect(JSON.parse(init.body as string)).toEqual({ model: 'hasa/x', input: '안녕', voice: 'KR', response_format: 'wav' });
        expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
        expect(mockResolve).toHaveBeenCalledWith('tts', 'u1');
    });

    it('sniffAudioExt — RIFF/WAVE→wav, ID3→mp3, 모르면 요청 형식', () => {
        expect(sniffAudioExt(Buffer.from('RIFFxxxxWAVEfmt '), 'mp3')).toBe('wav');
        expect(sniffAudioExt(Buffer.from('ID3'), 'wav')).toBe('mp3');
        expect(sniffAudioExt(Buffer.from('zzzz'), 'opus')).toBe('opus');
    });
});

describe('transcribe_audio', () => {
    it('base64 입력을 multipart(model·file·language) 로 보내고 text 를 돌려준다', async () => {
        mockResolve.mockResolvedValue(gwTarget('stt', { endpoint: '/v1/audio/transcriptions', params: { language: 'ko' } }));
        const f = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ text: ' 안녕하세요 ' }), text: async () => '' }));
        global.fetch = f as unknown as typeof fetch;
        const r = await transcribeAudioTool.handler(
            { audio_base64: Buffer.from('abc').toString('base64'), filename: 'a.wav' },
            { userId: 'u1', role: 'user' },
        );
        expect(r.isError).toBeFalsy();
        expect(r.content[0].text).toContain('안녕하세요');
        const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('http://gw/v1/audio/transcriptions');
        const fd = init.body as FormData;
        expect(fd.get('model')).toBe('hasa/x');
        expect(fd.get('language')).toBe('ko');
        expect((fd.get('file') as File).name).toBe('a.wav');
        expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });

    it('허용되지 않는 확장자·입력 없음은 오류', async () => {
        mockResolve.mockResolvedValue(gwTarget('stt'));
        expect((await transcribeAudioTool.handler({ audio_base64: 'AA', filename: 'a.exe' }, undefined)).isError).toBe(true);
        expect((await transcribeAudioTool.handler({}, undefined)).isError).toBe(true);
    });
});

describe('generate_video / get_video', () => {
    const jobsTarget = () => gwTarget('video_gen', {
        fullId: 'hasa:Wan2.2-T2V', model: 'Wan2.2-T2V', baseUrl: 'https://open.hasa.re.kr/v1',
        endpoint: '/videos/generations', headers: { Authorization: 'Bearer byok' }, transport: 'direct',
    });

    it('jobs-v1(hasa): 직결(safeFetch) 제출 → 상태 폴링 → artifact_url(상대) 다운로드 → 링크', async () => {
        mockResolve.mockResolvedValue(jobsTarget());
        const calls: string[] = [];
        let polls = 0;
        global.fetch = (async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method ?? 'GET'} ${url}`);
            if (url.endsWith('/videos/generations')) return { ok: true, status: 200, json: async () => ({ job_id: 'vid_1', status: 'LOADING' }) };
            if (url.endsWith('/jobs/vid_1')) {
                polls++;
                return { ok: true, status: 200, json: async () => (polls < 2
                    ? { job_id: 'vid_1', status: 'GENERATING', progress: 50 }
                    : { job_id: 'vid_1', status: 'COMPLETED', artifact_url: '/files/v.webm' }) };
            }
            if (url.endsWith('/files/v.webm')) {
                return { ok: true, status: 200, headers: new Headers({ 'content-type': 'video/webm' }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
            }
            throw new Error('unexpected ' + url);
        }) as unknown as typeof fetch;
        const r = await generateVideoTool.handler({ prompt: 'a red circle' }, { userId: 'u1', role: 'user' });
        expect(r.isError).toBeFalsy();
        expect(r.content[0].text).toContain('/generated/video.webm');
        expect(calls[0]).toBe('POST https://open.hasa.re.kr/v1/videos/generations');
        expect(calls).toContain('GET https://open.hasa.re.kr/v1/jobs/vid_1');
        expect(calls).toContain('GET https://open.hasa.re.kr/v1/files/v.webm');
        expect(saved[0]).toMatchObject({ prefix: 'video', ext: 'webm', size: 3 });
    });

    it('상한 안에 안 끝나면 작업 id 를 돌려주고, get_video 가 이어받는다', async () => {
        mockResolve.mockResolvedValue(jobsTarget());
        global.fetch = (async (url: string) => {
            if (url.endsWith('/videos/generations')) return { ok: true, status: 200, json: async () => ({ job_id: 'vid_2', status: 'LOADING' }) };
            if (url.endsWith('/jobs/vid_2')) return { ok: true, status: 200, json: async () => ({ job_id: 'vid_2', status: 'GENERATING', progress: 10 }) };
            throw new Error('unexpected ' + url);
        }) as unknown as typeof fetch;
        const r = await generateVideoTool.handler({ prompt: 'x' }, undefined);
        expect(r.isError).toBeFalsy();
        expect(r.content[0].text).toContain('vid_2');
        expect(r.content[0].text).toContain('get_video');
        const g = await getVideoTool.handler({ video_id: 'vid_2' }, undefined);
        expect(g.content[0].text).toContain('진행 중');
    });

    it('OpenAI 규격: /v1/videos → /v1/videos/{id} → /content, 실패 status 는 오류', async () => {
        mockResolve.mockResolvedValue(gwTarget('video_gen', { providerId: 'openrouter', model: 'openrouter/sora', baseUrl: 'http://gw', endpoint: '/v1/videos' }));
        global.fetch = (async (url: string) => {
            if (url === 'http://gw/v1/videos') return { ok: true, status: 200, json: async () => ({ id: 'v9', status: 'queued' }) };
            if (url === 'http://gw/v1/videos/v9') return { ok: true, status: 200, json: async () => ({ id: 'v9', status: 'completed' }) };
            if (url === 'http://gw/v1/videos/v9/content') {
                return { ok: true, status: 200, headers: new Headers({ 'content-type': 'video/mp4' }), arrayBuffer: async () => new Uint8Array([9]).buffer };
            }
            throw new Error('unexpected ' + url);
        }) as unknown as typeof fetch;
        const r = await generateVideoTool.handler({ prompt: 'x' }, undefined);
        expect(r.content[0].text).toContain('/generated/video.mp4');
        global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ id: 'v9', status: 'failed', error: 'nsfw' }) })) as unknown as typeof fetch;
        expect((await getVideoTool.handler({ video_id: 'v9' }, undefined)).isError).toBe(true);
    });
});

describe('MODALITY_TOOL_INTENT_GATES', () => {
    const hit = (tool: string, msg: string) =>
        MODALITY_TOOL_INTENT_GATES.find((g) => g.tool === tool)!.patterns.some((re) => re.test(msg));
    it('의도 문장에만 맞고 일반 질문엔 안 맞는다', () => {
        expect(hit('text_to_speech', '이 문단 읽어줘')).toBe(true);
        expect(hit('text_to_speech', '음성으로 만들어줘')).toBe(true);
        expect(hit('transcribe_audio', '이 녹음 파일을 텍스트로 옮겨줘')).toBe(true);
        expect(hit('generate_video', '바다 위 일출 영상 만들어줘')).toBe(true);
        expect(hit('get_video', '아까 영상 다 됐어?')).toBe(true);
        for (const t of ['text_to_speech', 'transcribe_audio', 'generate_video', 'get_video']) {
            expect(hit(t, '오늘 서울 날씨 어때?')).toBe(false);
            expect(hit(t, 'TypeScript 제네릭 설명해줘')).toBe(false);
        }
    });
});
