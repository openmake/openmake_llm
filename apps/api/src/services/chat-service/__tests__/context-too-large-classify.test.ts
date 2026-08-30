/**
 * 컨텍스트 초과를 UPSTREAM_ERROR 로 오분류하지 않는다 (2026-08-31).
 *
 * 실측: HWP 첨부가 깨진 텍스트로 전송돼 프롬프트가 262,145 토큰이 되자 vLLM 이 400
 * `ContextWindowExceededError` 를 냈는데, upstream 이 `code` 를 주지 않아 UPSTREAM_ERROR
 * ("일시적인 오류 — 잠시 후 다시 시도") 로 안내됐다. 재시도해도 같은 실패라 오안내다.
 *
 * 분류는 external-provider 의 catch 에 있고 스트리밍 의존이 커서, 여기서는 그 판정에 쓰는
 * 패턴 자체를 고정한다(구현이 바뀌어도 이 형태들은 계속 걸려야 한다).
 */
import { WS_PROVIDER_ERROR_MESSAGES } from '../../../sockets/ws-chat-locales';

/** external-provider.ts 의 판정과 동일한 패턴 — 바뀌면 두 곳을 함께 고쳐야 한다. */
const CONTEXT_PATTERN = /ContextWindowExceeded|maximum context length|context_length_exceeded|too many tokens/i;

describe('컨텍스트 초과 분류', () => {
    it('LiteLLM / OpenAI 호환 / vLLM 의 실제 문구를 모두 잡는다', () => {
        const samples = [
            'litellm.ContextWindowExceededError: litellm.BadRequestError: ContextWindowExceededError: OpenAIException',
            "This model's maximum context length is 262144 tokens. However, you requested 0 output tokens and your prompt contains at least 262145 input tokens",
            'Error code: 400 - context_length_exceeded',
            'Request contains too many tokens',
        ];
        for (const s of samples) expect(CONTEXT_PATTERN.test(s)).toBe(true);
    });

    it('무관한 upstream 오류는 걸리지 않는다 (오탐 방지)', () => {
        const samples = [
            'InternalServerError: OpenAIException - Connection error.',
            'Rate limit exceeded',
            'invalid api key',
            '502 Bad Gateway',
        ];
        for (const s of samples) expect(CONTEXT_PATTERN.test(s)).toBe(false);
    });

    it('모든 로케일에 CONTEXT_TOO_LARGE 안내가 있고 재시도를 권하지 않는다', () => {
        const locales = Object.keys(WS_PROVIDER_ERROR_MESSAGES) as Array<keyof typeof WS_PROVIDER_ERROR_MESSAGES>;
        expect(locales.length).toBeGreaterThanOrEqual(5);
        for (const loc of locales) {
            const msg = WS_PROVIDER_ERROR_MESSAGES[loc].CONTEXT_TOO_LARGE;
            expect(typeof msg).toBe('string');
            expect(msg.length).toBeGreaterThan(10);
            // "잠시 후 다시" 류의 재시도 권유가 들어가면 오안내가 재발한다.
            expect(msg).not.toMatch(/잠시 후|try again later|später erneut|plus tard|稍后重试|しばらくして/i);
        }
    });
});
