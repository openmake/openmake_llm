/**
 * ============================================================
 * Provider Gate — ChatService 진입점 모델 ID 검증
 * ============================================================
 *
 * 사용자가 요청한 모델 ID(executionPlan.requestedModel 또는 fallback)를
 * fullId('provider:model') 형식으로 정규화하고, ProviderRouter.resolve()로
 * INVALID_MODEL_ID / GUEST_NOT_ALLOWED / NOT_SUPPORTED 등을 strategy 실행
 * 이전에 조기 차단합니다.
 *
 * 모델 태그 컨벤션('name:tag', 예: 'gemma4:e4b')과 fullId('provider:model')
 * 의 충돌을 해결하기 위해 known-provider-prefix 허용목록을 사용합니다.
 *
 * 동작:
 * - 'local-llm:*' 또는 'openrouter:*' → fullId 그대로 통과
 * - 그 외 (콜론 없음 또는 알려지지 않은 prefix) → 'local-llm:' prefix 자동 보강
 * - 외부 provider (openrouter 외) → ProviderError 조기 throw
 *
 * 2026-05-08 외부 카탈로그(EXTERNAL_PROVIDER_CATALOG)가 openrouter 단독으로
 * 축소됨에 따라, anthropic 등 기타 prefix 는 로컬 모델 태그로 간주되어 보강 후
 * 다운스트림에서 거부됩니다.
 *
 * @module services/chat-service/provider-gate
 */
import { buildFullModelId } from '../../providers/i-provider';
import { ProviderError } from '../../providers/provider-errors';
import type {
    ProviderRouter,
    ResolvedProvider,
    ProviderRouterContext,
} from '../../providers/provider-router';

/**
 * fullId 첫 콜론 prefix가 이 목록에 있으면 그대로 fullId로 취급, 아니면
 * 로컬 LLM 모델명(태그 포함)으로 간주하고 'local-llm:' prefix 를 자동 보강합니다.
 *
 * 카탈로그(EXTERNAL_PROVIDER_CATALOG) 와 동기화 필수 — 새 provider 추가 시 양쪽 갱신.
 */
const KNOWN_FULLID_PREFIXES: readonly string[] = [
    'local-llm',
    'openrouter',
    'ollama-local',
    'ollama-cloud',
    'nvidia',
];

export interface ProviderGateInput {
    /** 사용자가 명시한 모델 ID (executionPlan.requestedModel) — undefined면 fallback 사용 */
    requestedModel?: string;
    /** 클러스터가 할당한 기본 LLMClient 모델 — requestedModel 미지정 시 사용 */
    fallbackModel: string;
    /** 사용자 컨텍스트 (게스트 가드 판정용) */
    ctx: ProviderRouterContext;
}

/**
 * 모델 ID를 fullId 형식으로 정규화합니다.
 *
 * @throws {ProviderError} INVALID_MODEL_ID — 입력이 빈 문자열인 경우
 */
export function normalizeToFullId(
    requestedModel: string | undefined,
    fallbackModel: string,
): string {
    // requestedModel 이 빈 문자열/공백이어도 fallbackModel 로 대체 (?? 는 '' 를 통과시켜
    // model 미지정 REST 요청이 INVALID_MODEL_ID 로 떨어지던 문제 방지).
    const raw = ((requestedModel ?? '').trim() || (fallbackModel ?? '').trim());
    if (!raw) {
        throw new ProviderError('INVALID_MODEL_ID', '모델 ID가 비어있습니다');
    }
    const colonIdx = raw.indexOf(':');
    const prefix = colonIdx > 0 ? raw.slice(0, colonIdx) : '';
    if (KNOWN_FULLID_PREFIXES.includes(prefix)) {
        return raw;
    }
    return buildFullModelId('local-llm', raw);
}

/**
 * ProviderRouter를 통해 요청된 모델을 검증/해석합니다.
 *
 * @throws {ProviderError} INVALID_MODEL_ID / GUEST_NOT_ALLOWED / NOT_SUPPORTED
 */
export async function runProviderGate(
    router: ProviderRouter,
    input: ProviderGateInput,
): Promise<ResolvedProvider> {
    const fullId = normalizeToFullId(input.requestedModel, input.fallbackModel);
    return router.resolve(fullId, input.ctx);
}
