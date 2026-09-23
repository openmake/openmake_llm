/**
 * video-runtime — provider 어댑터 (P08). 종전 `config/capabilities.ts` 의 `VIDEO_PROVIDER_ADAPTERS` 를 이 add-on 으로 옮겼다.
 *  - openai-videos: 게이트웨이 `/v1/videos` 제출 → `/v1/videos/{id}` 상태 → `/v1/videos/{id}/content` 결과
 *  - jobs-v1(hasa): `POST /videos/generations` → `GET /jobs/{id}` → `artifact_url`. 게이트웨이가 프록시하지 못하고 hasa 는
 *    `Authorization: Bearer` 만 받아 사용자 키로 provider **직결**(driver descriptor 의 `direct`, SSRF 고정 fetch — 2026-09-12 실측)
 * 연산 경로는 `operations` 로 선언하고 origin·자격증명은 Base 포트가 붙인다.
 * @module addons/video-runtime/providers/adapters
 */
import type { OperationSpec } from '../../../runtime-ports/model-invoker';

export interface VideoAdapter {
    kind: 'openai-videos' | 'jobs-v1';
    submitOp: string;
    statusOp: string;
    artifactField?: string;
    doneStatuses: readonly string[];
    failStatuses: readonly string[];
    /** 제출 본문에 `negative_prompt` 를 받는지 — OpenAI `/v1/videos` 에는 없는 필드 */
    negativePrompt: boolean;
    /** 직결 provider 의 제출 경로(resolver 가 target.endpoint 로 쓴다) */
    directEndpoint?: string;
}

const DONE = ['completed', 'succeeded'];
const TERMINAL_FAIL = ['failed', 'cancelled', 'canceled', 'error'];

const OPENAI: VideoAdapter = {
    kind: 'openai-videos', submitOp: 'videos.openai.submit', statusOp: 'videos.openai.status',
    doneStatuses: DONE, failStatuses: TERMINAL_FAIL, negativePrompt: false,
};

const ADAPTERS: Record<string, VideoAdapter> = {
    hasa: {
        kind: 'jobs-v1', submitOp: 'videos.hasa.submit', statusOp: 'videos.hasa.status', artifactField: 'artifact_url',
        doneStatuses: [...DONE, 'done'], failStatuses: TERMINAL_FAIL,
        // hasa 포털 플레이그라운드가 같은 엔드포인트에 negative_prompt 를 보낸다(portal-model-playground.js, 2026-09-22)
        negativePrompt: true, directEndpoint: '/videos/generations',
    },
};

export function videoAdapterFor(providerId: string): VideoAdapter {
    return ADAPTERS[providerId] ?? OPENAI;
}

export const VIDEO_OPERATIONS: Readonly<Record<string, OperationSpec>> = {
    'videos.openai.submit': { method: 'POST', path: '/v1/videos', body: 'json', response: 'json' },
    'videos.openai.status': { method: 'GET', path: '/v1/videos/{id}', body: 'none', response: 'json' },
    'videos.hasa.submit': { method: 'POST', path: '/videos/generations', body: 'json', response: 'json' },
    'videos.hasa.status': { method: 'GET', path: '/jobs/{id}', body: 'none', response: 'json' },
};
