/**
 * Exact Tokenizer — 모델 자신의 토크나이저로 입력 토큰을 정확히 센다.
 *
 * 왜 필요한가: `estimateTokens` 는 문자 클래스 가중치라 BPE 병합률을 모른다.
 * 2026-08-31 실측(qwen3.6, vLLM `/tokenize`) — 추정/실제 비율:
 *   산문 101~123% · TS 코드 106% (보수적, 문제 없음)
 *   JSON 로그 61% · 바이너리 as-text 40~50% · base64 36% · hex 30% (과소추정)
 * 고엔트로피·구두점 밀집 텍스트는 BPE 가 병합하지 못해 문자당 실제 비용이
 * 0.25 가 아니라 0.4~0.97 토큰이다. 과소추정은 안전망을 통과시켜 upstream 400
 * (ContextWindowExceeded) 으로 이어지므로, 임계 근처에서만 이 모듈로 재계산한다.
 *
 * 게이트웨이(LiteLLM) 의 `/utils/token_counter` 는 쓰지 않는다 — openai_tokenizer(cl100k)
 * 기반이라 같은 실측에서 한국어 157%(과대) · hex 64%(과소) 로 어긋났다.
 *
 * 전 구간 fail-open: 미설정·실패·타임아웃은 null 을 돌려 문자 추정을 그대로 쓴다.
 *
 * @module llm/exact-tokenizer
 */
import { MODEL_POOL_CONFIG } from '../config/model-pool';
import { createLogger } from '../utils/logger';
import type { ChatMessage } from './types';

const logger = createLogger('ExactTokenizer');

/** tokenize 대상 payload — 이미지는 base64 라 보내지 않고 별도 가산한다. */
interface TokenizePayloadMessage {
    role: string;
    content: string;
}

/** 설정이 갖춰졌는지 — 미설정이면 기능 off (기존 동작 유지). */
export function isExactTokenizeEnabled(): boolean {
    return MODEL_POOL_CONFIG.tokenizeUrl.length > 0;
}

/**
 * assistant.tool_calls / tool 메시지는 content 가 비어 있어도 실제 payload 에는
 * 함수명·인자 JSON 이 실린다. 누락하면 도구 루프에서 과소추정이 되므로 직렬화해 합친다.
 */
function toPayloadMessage(m: ChatMessage): TokenizePayloadMessage {
    let content = m.content || '';
    if (m.tool_calls?.length) {
        // arguments 는 Record 라 템플릿 연결 시 "[object Object]" 가 된다 — 직렬화 필수.
        content += m.tool_calls
            .map((tc) => `${tc.function?.name ?? ''}${JSON.stringify(tc.function?.arguments ?? {})}`)
            .join('');
    }
    return { role: m.role, content };
}

/**
 * 실제 입력 토큰 수 — 챗 템플릿 오버헤드 포함. 실패 시 null (fail-open).
 *
 * 이미지는 payload 에서 제외하고 `tokensPerImage` 로 가산한다 (추정기와 동일 규약).
 */
export async function countExactTokens(
    messages: ChatMessage[],
    model: string,
): Promise<number | null> {
    if (!isExactTokenizeEnabled()) return null;

    const imageTokens = messages.reduce(
        (sum, m) => sum + (m.images?.length ?? 0) * MODEL_POOL_CONFIG.tokensPerImage,
        0,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_POOL_CONFIG.tokenizeTimeoutMs);
    try {
        const res = await fetch(MODEL_POOL_CONFIG.tokenizeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(MODEL_POOL_CONFIG.tokenizeApiKey
                    ? { Authorization: `Bearer ${MODEL_POOL_CONFIG.tokenizeApiKey}` }
                    : {}),
            },
            body: JSON.stringify({ model, messages: messages.map(toPayloadMessage) }),
            signal: controller.signal,
        });
        if (!res.ok) {
            logger.warn(`[ExactTokenize] HTTP ${res.status} — 문자 추정 유지 (fail-open)`);
            return null;
        }
        const data = (await res.json()) as { count?: number };
        if (typeof data.count !== 'number' || !Number.isFinite(data.count)) {
            logger.warn('[ExactTokenize] count 필드 없음 — 문자 추정 유지 (fail-open)');
            return null;
        }
        return data.count + imageTokens;
    } catch (err) {
        const reason = err instanceof Error && err.name === 'AbortError' ? 'timeout' : String(err);
        logger.warn(`[ExactTokenize] 실패 (${reason}) — 문자 추정 유지 (fail-open)`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}
