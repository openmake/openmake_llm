/**
 * ============================================================
 * Video Tools — 영상 생성 내장 도구 (비동기 작업)
 * ============================================================
 *
 * 모델은 모달리티 배정(`video_gen`)으로 정하고, 호출은 LiteLLM 게이트웨이 하나로만 간다.
 *  - OpenAI 규격 provider: `POST /v1/videos` → `GET /v1/videos/{id}` → `GET /v1/videos/{id}/content`
 *  - jobs-v1 어댑터(hasa 등, config/modality VIDEO_PROVIDER_ADAPTERS): 게이트웨이가 프록시 못 하는
 *    커스텀 API 라 사용자 키로 provider 직결(SSRF 고정 fetch) `POST /videos/generations` → `GET /jobs/{id}` → artifact_url
 *
 * 생성은 수 분이 걸리므로 `generate_video` 는 상한(VIDEO_WAIT_MS)까지만 기다리고, 미완이면
 * 작업 id 를 돌려준다 — `get_video` 로 이어서 확인한다. 노출은 의도 턴에만.
 *
 * @module mcp/video-tools
 */
import { MCPToolDefinition, MCPToolResult } from './types';
import {
    MODALITY_LIMITS, VIDEO_GEN_DEFAULT_SECONDS, VIDEO_GEN_DEFAULT_SIZE,
    VIDEO_DONE_STATUSES, VIDEO_TERMINAL_STATUSES, videoAdapterFor, type VideoProviderAdapter,
} from '../config/modality';
import { resolveModalityTarget, ModalityUnavailableError, type ModalityTarget } from '../services/modality-resolver';
import { withProviderSlot } from '../llm/external-throttle';
import { saveGeneratedFile } from './generated-media';
import { safeFetch } from '../security/ssrf-guard';
import { createLogger } from '../utils/logger';

const logger = createLogger('VideoTools');

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}
function userIdOf(context?: { userId?: string | number }): string | undefined {
    return context?.userId !== undefined ? String(context.userId) : undefined;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 게이트웨이(loopback)는 fetch, provider 직결(jobs-v1)은 SSRF 고정 fetch */
function fetchFor(target: ModalityTarget): (url: string, init?: RequestInit) => Promise<Response> {
    return target.transport === 'direct' ? (url, init) => safeFetch(url, init) : (url, init) => fetch(url, init);
}

interface JobView { id: string; status: string; progress?: number; artifactUrl?: string; raw: Record<string, unknown> }

/** provider 응답 형태 차이를 한 형태로 — OpenAI(id/status) · jobs-v1(job_id/status/progress/artifact_url) */
function toJobView(json: Record<string, unknown>, adapter: VideoProviderAdapter): JobView {
    const id = String(json.id ?? json.job_id ?? '');
    const status = String(json.status ?? '').toLowerCase();
    const artifactField = adapter.artifactField ?? 'artifact_url';
    const artifactUrl = typeof json[artifactField] === 'string' ? String(json[artifactField]) : undefined;
    const progress = typeof json.progress === 'number' ? json.progress : undefined;
    return { id, status, progress, artifactUrl, raw: json };
}

function isDone(view: JobView, adapter: VideoProviderAdapter): boolean {
    const done = new Set([...(adapter.doneStatuses ?? []).map((s) => s.toLowerCase()), ...VIDEO_DONE_STATUSES]);
    return done.has(view.status);
}
function isTerminal(view: JobView, adapter: VideoProviderAdapter): boolean {
    const t = new Set([
        ...(adapter.doneStatuses ?? []).map((s) => s.toLowerCase()),
        ...(adapter.failStatuses ?? []).map((s) => s.toLowerCase()),
        ...VIDEO_TERMINAL_STATUSES,
    ]);
    return t.has(view.status);
}

function statusUrl(target: ModalityTarget, adapter: VideoProviderAdapter, id: string): string {
    const path = adapter.kind === 'jobs-v1' && adapter.statusPath
        ? adapter.statusPath.replace('{id}', encodeURIComponent(id))
        : `/v1/videos/${encodeURIComponent(id)}`;
    return `${target.baseUrl}${path}`;
}

function contentUrl(target: ModalityTarget, adapter: VideoProviderAdapter, view: JobView): string | null {
    if (adapter.kind === 'jobs-v1') {
        if (!view.artifactUrl) return null;
        // 표준 URL 해석 — 절대 URL 은 그대로, `/files/..` 같은 루트 상대 경로는 **origin** 기준
        // (hasa 실측: `/v1/files/..` 404, `https://open.hasa.re.kr/files/..` 200 — base 뒤에 붙이면 404)
        return new URL(view.artifactUrl, `${target.baseUrl}/`).toString();
    }
    return `${target.baseUrl}/v1/videos/${encodeURIComponent(view.id)}/content`;
}

async function fetchJob(target: ModalityTarget, adapter: VideoProviderAdapter, id: string): Promise<JobView> {
    const res = await fetchFor(target)(statusUrl(target, adapter, id), {
        headers: { ...target.headers },
        signal: AbortSignal.timeout(MODALITY_LIMITS.VIDEO_SUBMIT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`작업 조회 실패 (HTTP ${res.status}) ${(await res.text().catch(() => '')).slice(0, 160)}`);
    return toJobView(await res.json() as Record<string, unknown>, adapter);
}

async function downloadAndSave(target: ModalityTarget, adapter: VideoProviderAdapter, view: JobView): Promise<string> {
    const url = contentUrl(target, adapter, view);
    if (!url) throw new Error('완료됐지만 산출물 URL 이 없습니다');
    const res = await fetchFor(target)(url, { headers: { ...target.headers }, signal: AbortSignal.timeout(MODALITY_LIMITS.VIDEO_DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`영상 다운로드 실패 (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) throw new Error('영상 파일이 비어 있습니다');
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    const extFromUrl = (new URL(url).pathname.split('.').pop() ?? '').toLowerCase();
    const ext = ct.includes('webm') || extFromUrl === 'webm' ? 'webm' : 'mp4';
    const { urlPath } = saveGeneratedFile('video', ext, buf);
    logger.info(`영상 저장: ${urlPath} (${target.fullId}/${target.source}, ${buf.length}B)`);
    return urlPath;
}

/** 완료까지 waitMs 안에서 폴링. 미완이면 마지막 상태 반환 */
async function waitForJob(target: ModalityTarget, adapter: VideoProviderAdapter, id: string, waitMs: number): Promise<JobView> {
    const deadline = Date.now() + waitMs;
    let view = await fetchJob(target, adapter, id);
    while (!isTerminal(view, adapter) && Date.now() < deadline) {
        await sleep(Math.min(MODALITY_LIMITS.VIDEO_POLL_INTERVAL_MS, Math.max(1000, deadline - Date.now())));
        view = await fetchJob(target, adapter, id);
    }
    return view;
}

function pendingText(view: JobView): string {
    const pct = view.progress !== undefined ? ` (${view.progress}%)` : '';
    return `영상 생성이 아직 진행 중입니다${pct}. 작업 id: \`${view.id}\` — 잠시 후 get_video 도구로 video_id 를 넘겨 확인하세요.`;
}

async function finishOrPending(target: ModalityTarget, adapter: VideoProviderAdapter, view: JobView): Promise<MCPToolResult> {
    if (isDone(view, adapter)) {
        const urlPath = await downloadAndSave(target, adapter, view);
        return textResult(`영상이 생성되었습니다. 아래 링크를 답변에 그대로 포함하세요:\n\n[🎬 영상 보기](${urlPath})`);
    }
    if (isTerminal(view, adapter)) {
        return textResult(`영상 생성 실패 (status=${view.status}). ${JSON.stringify(view.raw).slice(0, 200)}`, true);
    }
    return textResult(pendingText(view));
}

export const generateVideoTool: MCPToolDefinition = {
    tool: {
        name: 'generate_video',
        description:
            '텍스트 프롬프트로 짧은 영상을 생성합니다. 사용자가 "영상/비디오/동영상 만들어줘" 라고 하면 사용하세요. ' +
            '생성은 수 분이 걸릴 수 있어 완료되지 않으면 작업 id 를 돌려주며, get_video 로 이어서 확인합니다. ' +
            '결과 마크다운 링크는 답변에 그대로 포함하세요. 프롬프트는 영어로 구체적으로 쓸수록 좋습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: { type: 'string', description: '영상 프롬프트 (영어 권장)' },
                seconds: { type: 'string', description: `길이(초). 기본 ${VIDEO_GEN_DEFAULT_SECONDS}` },
                size: { type: 'string', description: `해상도 WxH. 기본 ${VIDEO_GEN_DEFAULT_SIZE}` },
            },
            required: ['prompt'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const prompt = String(args.prompt || '').trim();
        if (!prompt) return textResult('prompt 가 필요합니다.', true);
        let target: ModalityTarget;
        try {
            target = await resolveModalityTarget('video_gen', userIdOf(context));
        } catch (e) {
            if (e instanceof ModalityUnavailableError) return textResult(`영상 생성 불가: ${e.message}`, true);
            throw e;
        }
        const adapter = videoAdapterFor(target.providerId);
        const seconds = String(args.seconds || target.params.seconds || VIDEO_GEN_DEFAULT_SECONDS);
        const size = String(args.size || target.params.size || VIDEO_GEN_DEFAULT_SIZE);
        try {
            const res = await withProviderSlot(target.providerId, () => fetchFor(target)(`${target.baseUrl}${target.endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...target.headers },
                body: JSON.stringify({ model: target.model, prompt, seconds, size }),
                signal: AbortSignal.timeout(MODALITY_LIMITS.VIDEO_SUBMIT_TIMEOUT_MS),
            }));
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                logger.warn(`영상 생성 제출 실패: HTTP ${res.status} ${body.slice(0, 200)}`);
                return textResult(`영상 생성 실패 (HTTP ${res.status}). ${body.slice(0, 160)}`, true);
            }
            const view = toJobView(await res.json() as Record<string, unknown>, adapter);
            if (!view.id) return textResult('영상 생성 응답에 작업 id 가 없습니다.', true);
            logger.info(`영상 생성 제출: id=${view.id} status=${view.status} (${target.fullId}/${target.source})`);
            const finalView = isTerminal(view, adapter) ? view : await waitForJob(target, adapter, view.id, MODALITY_LIMITS.VIDEO_WAIT_MS);
            return await finishOrPending(target, adapter, finalView);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`영상 생성 오류: ${msg}`);
            return textResult(/timeout/i.test(msg) ? '영상 생성 요청 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.' : `영상 생성 중 오류: ${msg}`, true);
        }
    },
};

export const getVideoTool: MCPToolDefinition = {
    tool: {
        name: 'get_video',
        description: 'generate_video 가 돌려준 작업 id 로 영상 생성 상태를 확인하고, 완료됐으면 영상 링크를 가져옵니다.',
        inputSchema: {
            type: 'object',
            properties: { video_id: { type: 'string', description: 'generate_video 가 돌려준 작업 id' } },
            required: ['video_id'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        const id = String(args.video_id || '').trim();
        if (!id) return textResult('video_id 가 필요합니다.', true);
        let target: ModalityTarget;
        try {
            target = await resolveModalityTarget('video_gen', userIdOf(context));
        } catch (e) {
            if (e instanceof ModalityUnavailableError) return textResult(`영상 조회 불가: ${e.message}`, true);
            throw e;
        }
        const adapter = videoAdapterFor(target.providerId);
        try {
            const view = await fetchJob(target, adapter, id);
            return await finishOrPending(target, adapter, view);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.warn(`영상 조회 오류: ${msg}`);
            return textResult(`영상 조회 중 오류: ${msg}`, true);
        }
    },
};

export const videoTools: MCPToolDefinition[] = [generateVideoTool, getVideoTool];
