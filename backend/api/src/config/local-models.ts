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
        description: '대용량 문서/research — 1M context',
        role: 'chat',
        contextLength: 1048576,
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
