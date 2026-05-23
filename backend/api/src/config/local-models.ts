/**
 * ============================================================
 * Local Models Catalog — 서버 PC 의 vLLM/LiteLLM proxy 가 노출하는 모델
 * ============================================================
 *
 * 운영 컨텍스트:
 *   - LLM 은 외부 서버 PC 에서 vLLM/LiteLLM 으로 호스팅
 *   - 클라이언트 PC 는 단일 proxy endpoint (LLM_BASE_URL) 로 호출
 *   - proxy 가 model 명 기반으로 백엔드 라우팅 (server 의 8002/8003/8004/8005)
 *
 * 본 카탈로그는 클라이언트 PC 가 알아야 할 **모델 ID + role + 표시 정보** 만 정의.
 * 실제 endpoint host:port 는 proxy 가 캡슐화 — 클라이언트는 model 명만 사용.
 *
 * 외부화 (No-Hardcoding L2):
 *   - 본 파일이 기본 카탈로그 (개발자 튜닝)
 *   - 환경변수 override: `LLM_LOCAL_MODELS_JSON` (runtime tweaking)
 *
 * 새 모델 추가 가이드:
 *   1. 서버 PC 의 vLLM 에 모델 띄움
 *   2. 본 카탈로그에 entry 추가 + 클라이언트 PC PM2 reload
 *   3. (선택) MODEL_CAPABILITY_PRESETS (model-defaults.ts) 에 capability 추가
 *
 * @module config/local-models
 */
import { createLogger } from '../utils/logger';

const logger = createLogger('LocalModels');

export type LocalModelRole = 'chat' | 'embedding';

export interface LocalModelEntry {
    /** model ID — proxy 가 라우팅 key 로 사용 (LLM_BASE_URL 의 body.model 필드) */
    id: string;
    /** UI 표시 이름 (selector dropdown) */
    displayName: string;
    /** 짧은 설명 — selector 의 보조 텍스트 */
    description: string;
    /** chat: 일반 채팅 / embedding: /v1/embeddings 전용 (selector 에서 분리) */
    role: LocalModelRole;
    /** context window (tokens) — UI 표시 + selector 우선순위 보조 */
    contextLength?: number;
    /** 선택적 — false 면 selector 에서 hidden (가용성 동적 체크 후속) */
    available?: boolean;
}

/**
 * 기본 카탈로그 — 사용자 환경 (2026-05 기준):
 *   - qwen3.6-35b-a3b      : 기본 채팅 (262K)
 *   - qwen3.6-35b-a3b-1m   : 대용량 context (1M, 선택적)
 *   - gemma-4-31b          : Vision + 32K
 *   - gpt-3.5-turbo        : OpenAI 호환 alias (→ qwen3.6 라우팅)
 *   - bge-m3               : embedding (multilingual, 1024-dim)
 */
const DEFAULT_LOCAL_MODELS: LocalModelEntry[] = [
    {
        id: 'qwen3.6-35b-a3b',
        displayName: 'Qwen 3.6 (35B-A3B)',
        description: '기본 채팅 — 262K context',
        role: 'chat',
        contextLength: 262144,
    },
    {
        id: 'qwen3.6-35b-a3b-1m',
        displayName: 'Qwen 3.6 (1M context)',
        description: '대용량 문서/research — 1M context (서버 PC 의 8004 가동 시에만)',
        role: 'chat',
        contextLength: 1048576,
        // 8004 백엔드가 선택적 — 기본 비활성. 운영자가 8004 가동 후 startup
        // health check (probeLocalModelAvailability) 가 available=true 로 전환.
        available: false,
    },
    {
        id: 'gemma-4-31b',
        displayName: 'Gemma 4 (31B)',
        description: 'Vision + 32K context',
        role: 'chat',
        contextLength: 32768,
    },
    {
        id: 'gpt-3.5-turbo',
        displayName: 'GPT-3.5 (alias)',
        description: 'OpenAI 호환 alias → Qwen 3.6 로 라우팅',
        role: 'chat',
    },
    {
        id: 'bge-m3',
        displayName: 'BGE-M3',
        description: 'Multilingual embedding (1024-dim)',
        role: 'embedding',
    },
];

let _cached: LocalModelEntry[] | null = null;

/**
 * 환경변수 `LLM_LOCAL_MODELS_JSON` 또는 default 카탈로그 반환.
 * env 가 JSON 배열로 셋팅돼 있으면 그것을 사용 (default 덮어쓰기).
 */
export function getLocalModels(): LocalModelEntry[] {
    if (_cached) return _cached;

    const envJson = process.env.LLM_LOCAL_MODELS_JSON;
    if (envJson) {
        try {
            const parsed = JSON.parse(envJson) as LocalModelEntry[];
            if (Array.isArray(parsed) && parsed.every(m => m.id && m.role && m.displayName)) {
                logger.info(`LLM_LOCAL_MODELS_JSON override: ${parsed.length} models`);
                _cached = parsed;
                return _cached;
            }
            logger.warn('LLM_LOCAL_MODELS_JSON 유효성 실패 — DEFAULT_LOCAL_MODELS 사용');
        } catch (e) {
            logger.warn(`LLM_LOCAL_MODELS_JSON parse 실패 — DEFAULT_LOCAL_MODELS 사용: ${e instanceof Error ? e.message : e}`);
        }
    }

    _cached = DEFAULT_LOCAL_MODELS;
    return _cached;
}

/**
 * chat 역할 모델만 반환 — selector 표시용.
 */
export function getLocalChatModels(): LocalModelEntry[] {
    return getLocalModels().filter(m => m.role === 'chat' && m.available !== false);
}

/**
 * embedding 역할 모델만 반환 — embed() 호출용.
 */
export function getLocalEmbeddingModels(): LocalModelEntry[] {
    return getLocalModels().filter(m => m.role === 'embedding' && m.available !== false);
}

/**
 * 테스트 / 환경변수 핫 리로드용 — 캐시 초기화.
 */
export function resetLocalModelsCache(): void {
    _cached = null;
}

/**
 * 단일 chat 모델 connectivity ping — 1 token completion 호출.
 * 200 응답 + completion content/reasoning 있으면 가용.
 * 500 / timeout / connection error 면 미가용.
 */
async function pingChatModel(
    baseUrl: string,
    apiKey: string | undefined,
    modelId: string,
    timeoutMs: number,
): Promise<{ ok: boolean; reason?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(baseUrl.replace(/\/$/, '') + '/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: 'hi' }],
                max_tokens: 1,
                stream: false,
                // thinking 모델은 reasoning 으로 토큰 소비 → enable_thinking=false 강제
                chat_template_kwargs: { enable_thinking: false },
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            return { ok: false, reason: `HTTP ${res.status}` };
        }
        // 200 이면 가용 — content 가 비었더라도 backend 도달 자체가 검증됨
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 단일 embedding 모델 connectivity ping — 1 string embedding 호출.
 */
async function pingEmbeddingModel(
    baseUrl: string,
    apiKey: string | undefined,
    modelId: string,
    timeoutMs: number,
): Promise<{ ok: boolean; reason?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(baseUrl.replace(/\/$/, '') + '/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify({ model: modelId, input: 'hi' }),
            signal: controller.signal,
        });
        if (!res.ok) {
            return { ok: false, reason: `HTTP ${res.status}` };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 서버 PC proxy 의 실제 가용성 검증 — 2단계 probe.
 *
 * Stage 1: `/v1/models` 호출 → 등록된 모델 ID 매칭 (빠른 fail)
 * Stage 2: 매칭된 모델 별 1-token chat/embedding ping → backend 실제 connectivity 검증
 *
 * Stage 1 만으로는 부족한 이유:
 *   - LiteLLM/vLLM proxy 의 `/v1/models` 는 config 기반 model 등록만 반환
 *   - backend (예: 8004 vLLM 인스턴스) 미가동이어도 model 명은 list 에 노출
 *   - 클라이언트가 "모델 있는 줄 알고" 호출 → 500 InternalServerError
 *   - 1m 모델 (qwen3.6-35b-a3b-1m / 8004) 케이스가 정확히 이 패턴
 *
 * Stage 2 가 connectivity 까지 검증해 실제 호출 가능한 모델만 카탈로그 활성화.
 *
 * 비용:
 *   - chat ping: model 수 × 1 request × max_tokens=1 ≈ 모델당 수십 ms
 *   - embedding ping: 1 string × 1024-dim 응답 ≈ 수십 ms
 *   - 전체: 5-6 모델 × ~50ms = 시작 시 ~300ms (병렬화 시 ~50ms)
 *
 * 동작:
 *   - probe 미가용 (네트워크 timeout, proxy 미가용): 카탈로그 그대로 유지 (보수적)
 *   - Stage 2 ping 실패한 모델: available=false (demote)
 *   - 카탈로그의 explicit available=false 모델: ping 시도조차 안 함 (운영자가 명시적 비활성)
 *
 * @param llmBaseUrl proxy base URL (예: http://rockyhan.duckdns.org:13401)
 * @param apiKey proxy API key (LLM_API_KEY)
 * @param timeoutMs ping 호출 timeout (default 8초)
 */
export async function probeLocalModelAvailability(
    llmBaseUrl: string,
    apiKey: string | undefined,
    timeoutMs: number = 8000,
): Promise<{ probed: boolean; available: string[]; missing: string[]; skipped: string[] }> {
    // Stage 1: /v1/models 빠른 fail
    const modelsUrl = llmBaseUrl.replace(/\/$/, '') + '/v1/models';
    const stage1Controller = new AbortController();
    const stage1Timer = setTimeout(() => stage1Controller.abort(), Math.min(timeoutMs, 5000));
    let proxyIds: Set<string>;
    try {
        const res = await fetch(modelsUrl, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: stage1Controller.signal,
        });
        if (!res.ok) {
            logger.warn(`probe stage1 ${modelsUrl} → ${res.status}, 카탈로그 변경 없음`);
            return { probed: false, available: [], missing: [], skipped: [] };
        }
        const json = await res.json() as { data?: Array<{ id: string }> };
        proxyIds = new Set((json.data || []).map(m => m.id));
    } catch (e) {
        logger.warn(`probe stage1 실패 — 카탈로그 변경 없음: ${e instanceof Error ? e.message : e}`);
        return { probed: false, available: [], missing: [], skipped: [] };
    } finally {
        clearTimeout(stage1Timer);
    }

    // Stage 2: chat/embedding 별 1-token ping (병렬)
    const list = getLocalModels();
    const skipped: string[] = [];
    const pingTargets: LocalModelEntry[] = [];
    for (const m of list) {
        if (m.available === false) {
            skipped.push(m.id);
            continue;
        }
        const inProxy = proxyIds.has(m.id)
            || Array.from(proxyIds).some(pid => pid.split(':')[0] === m.id);
        if (!inProxy) {
            m.available = false;
            skipped.push(m.id);
            continue;
        }
        pingTargets.push(m);
    }

    const pingResults = await Promise.all(pingTargets.map(async m => {
        const r = m.role === 'embedding'
            ? await pingEmbeddingModel(llmBaseUrl, apiKey, m.id, timeoutMs)
            : await pingChatModel(llmBaseUrl, apiKey, m.id, timeoutMs);
        return { model: m, result: r };
    }));

    const available: string[] = [];
    const missing: string[] = [];
    for (const { model, result } of pingResults) {
        if (result.ok) {
            model.available = true;
            available.push(model.id);
        } else {
            model.available = false;
            missing.push(`${model.id} (${result.reason})`);
        }
    }
    logger.info(
        `probe 완료: available=${available.length} [${available.join(',')}] ` +
        `missing=${missing.length} [${missing.join(' | ')}] ` +
        `skipped=${skipped.length} [${skipped.join(',')}]`,
    );
    return { probed: true, available, missing, skipped };
}
