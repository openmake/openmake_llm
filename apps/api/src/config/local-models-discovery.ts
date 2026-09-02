/**
 * 로컬 모델 자동 발견 — 게이트웨이 `/model/info` 선별 규칙 (순수 함수 + fetch).
 *
 * 카탈로그 상태(_cached)는 `config/local-models.ts` 가 소유하고, 이 모듈은 상태를 갖지 않는다
 * (파일 크기 게이트로 분리). 규칙·배경은 local-models.ts 헤더 "모델 발견" 참고.
 *
 * @module config/local-models-discovery
 */
import type { LocalModelEntry } from './local-models';

/** 게이트웨이 `/model/info` 한 항목 — 발견에 필요한 필드만 */
export interface GatewayModelInfoEntry {
    model_name: string;
    litellm_params?: { model?: string; api_base?: string };
    model_info?: { mode?: string };
}

/** 채팅 목록에서 제외하는 LiteLLM `model_info.mode` */
const NON_CHAT_MODES: ReadonlySet<string> = new Set([
    'image_generation', 'embedding', 'rerank', 'audio_transcription', 'audio_speech', 'moderation',
]);

/** id 패턴만으로 역할을 정하는 안전망 — `/model/info` 가 mode 를 비워 두는 커스텀 배포용 */
const EMBEDDING_ID_PATTERNS = ['bge', 'embed', 'embedding'];
const NON_CHAT_ID_PATTERNS = ['rerank', 'flux', 'sdxl', 'stable-diffusion', 'dall-e', 'dalle', 'whisper', 'tts', 'clip'];

function upstreamBasename(model: string | undefined): string | undefined {
    if (!model) return undefined;
    const i = model.indexOf('/');
    return i >= 0 ? model.slice(i + 1) : model;
}

/**
 * `/model/info` 응답에서 로컬 카탈로그 엔트리를 고른다 (순수 함수).
 *   - provider prefix(`openrouter/*` 등) 가 있는 항목 제외 → 로컬만
 *   - `mode` 또는 id 패턴이 비채팅이면 제외 (임베딩은 role='embedding' 으로 유지)
 *   - 같은 upstream(`litellm_params.model` + `api_base`) 을 가리키는 alias 는 하나로 접는다.
 *     정식 이름 = upstream 모델명과 같은 model_name (없으면 첫 항목)
 *   - `prev` 에 같은 id 가 있으면 프로브 실측치(가용성·능력·컨텍스트)를 보존한다
 *     (호출부가 현재 카탈로그 + 정적 기본 카탈로그를 합쳐 넘긴다)
 */
export function selectLocalEntriesFromModelInfo(
    data: ReadonlyArray<GatewayModelInfoEntry>,
    prev: ReadonlyArray<LocalModelEntry> = [],
): LocalModelEntry[] {
    const groups = new Map<string, GatewayModelInfoEntry[]>();
    for (const e of data) {
        const name = e.model_name;
        if (!name || name.includes('/')) continue;
        const mode = e.model_info?.mode;
        if (mode && NON_CHAT_MODES.has(mode) && mode !== 'embedding') continue;
        const lower = name.toLowerCase();
        if (NON_CHAT_ID_PATTERNS.some((p) => lower.includes(p))) continue;
        const key = `${e.litellm_params?.model ?? name}|${e.litellm_params?.api_base ?? ''}`;
        const g = groups.get(key);
        if (g) g.push(e); else groups.set(key, [e]);
    }
    const out: LocalModelEntry[] = [];
    for (const g of groups.values()) {
        const canonical = g.find((e) => e.model_name === upstreamBasename(e.litellm_params?.model)) ?? g[0];
        const id = canonical.model_name;
        const lower = id.toLowerCase();
        const isEmbedding = canonical.model_info?.mode === 'embedding'
            || EMBEDDING_ID_PATTERNS.some((p) => lower.includes(p));
        const old = prev.find((m) => m.id === id);
        out.push({
            id,
            displayName: id,
            description: old?.description ?? `로컬 vLLM (${id})`,
            role: isEmbedding ? 'embedding' : 'chat',
            contextLength: old?.contextLength,
            contextLengthProbed: old?.contextLengthProbed,
            available: old?.available,
            unavailableReason: old?.unavailableReason,
            probedCapabilities: old?.probedCapabilities,
        });
    }
    return out;
}


/** 게이트웨이 `/model/info` 조회 — 실패는 throw 하지 않고 undefined (호출부 fail-open) */
export async function fetchGatewayModelInfo(
    llmBaseUrl: string,
    apiKey: string | undefined,
    timeoutMs: number,
): Promise<{ ok: true; data: GatewayModelInfoEntry[] } | { ok: false; reason: string }> {
    const url = llmBaseUrl.replace(/\/$/, '') + '/model/info';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: controller.signal,
        });
        if (!res.ok) return { ok: false, reason: `${url} → ${res.status}` };
        const json = await res.json() as { data?: GatewayModelInfoEntry[] };
        return { ok: true, data: json.data ?? [] };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    } finally {
        clearTimeout(timer);
    }
}
