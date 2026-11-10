/**
 * 게이트웨이(LiteLLM) 요청 공통 헤더 — 게이트웨이로 나가는 외부 provider 호출은 이 상수를 싣는다.
 * 사용처: capability 호출(services/orchestrator/http-call — gateway transport), 외부 채팅·배정 probe
 * (providers/openai-compat-provider — 게이트웨이 경유 inference client). 새 게이트웨이 경로도 여기서 가져다 쓴다.
 *
 * 왜 재시도를 끄나: LiteLLM 기본 재시도(2회)는 provider 가 거절한 요청(403 concurrent_limit 등)과 앱이 타임아웃으로 끊은 요청을
 * upstream 에 다시 보낸다. 2026-11-11 hasa: 배정 probe 1회가 경고(strike) 2~3개를 쌓았다(4→7→9/10). 재시도 판단은 앱이 한다
 * (withProviderSlot 은 조용히 재시도하지 않고, 429 는 Retry-After 를 지키는 앱 쪽 백오프만).
 * 헤더 지원은 LiteLLM 1.103.0 소스로 확인 — 다른 설치본은 게이트웨이 오류 로그의 `Max Retries: 0` 으로 확인한다.
 */
export const GATEWAY_NO_RETRY_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'x-litellm-num-retries': '0' });
