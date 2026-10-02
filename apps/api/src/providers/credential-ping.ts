/**
 * @module providers/credential-ping
 * @description 외부 키 확인용 1토큰 호출.
 *
 * 모델 목록 조회는 키를 따지지 않는 provider 가 있다(2026-10-03 hasa: 무효 키에도 200, 실제 호출은
 * 403 invalid_api_key). 첫 채팅 모델에 1토큰을 요청해 키를 확인한다. **키 거절만** 실패로 본다 —
 * 구독 전용·잔액·시간 초과 등 키와 무관한 실패는 검증을 떨어뜨리지 않는다(종전 판정 유지).
 */
import type OpenAI from 'openai';
import { isChatCapableModel } from '../config/role-model-filter';
import { LLM_TIMEOUTS } from '../config/timeouts';
import type { ProviderError } from './provider-errors';

/** @returns 키 거절 사유. 키가 받아들여졌거나 판단할 수 없으면 null */
export async function pingCredential(
    client: OpenAI,
    providerId: string,
    modelIds: string[],
    mapError: (err: unknown) => ProviderError,
): Promise<string | null> {
    // Gemini API 는 목록에서 id 를 'models/gemini-…' 로 준다 — 호출에는 접두사 없는 id 를 쓴다
    const model = modelIds.map((id) => id.replace(/^models\//, '')).find((id) => isChatCapableModel({ modelId: `${providerId}:${id}` }));
    if (!model) return null;
    try {
        await client.chat.completions.create(
            { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 },
            { timeout: LLM_TIMEOUTS.CREDENTIAL_PING_TIMEOUT_MS, maxRetries: 0 },
        );
        return null;
    } catch (err) {
        if (mapError(err).code !== 'INVALID_API_KEY') return null;
        return `API 키가 거절되었습니다(무효 또는 만료): ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`;
    }
}
