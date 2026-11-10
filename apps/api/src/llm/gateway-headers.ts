/**
 * 게이트웨이(LiteLLM) 요청 공통 헤더 — 게이트웨이로 나가는 외부 provider 호출은 이 상수를 싣는다.
 * 사용처: capability 호출(services/orchestrator/http-call — gateway transport), 외부 채팅·배정 probe
 * (providers/openai-compat-provider — 게이트웨이 경유 inference client). 새 게이트웨이 경로도 여기서 가져다 쓴다.
 *
 * 왜 재시도를 끄나: LiteLLM 기본 재시도(2회)는 provider 가 거절한 요청(403 동시 요청 한도 등)과 앱이 타임아웃으로 끊은 요청을
 * upstream 에 다시 보낸다. 거절 뒤 반복 호출에 경고·차단을 누적하는 provider 에서는 호출 한 번이 경고 여러 개가 된다.
 * 재시도 판단은 앱이 한다(withProviderSlot 은 조용히 재시도하지 않고, 429 는 Retry-After 를 지키는 앱 쪽 백오프만).
 *
 * 이 헤더가 끄는 것은 LiteLLM Router 재시도뿐이다(LiteLLM 1.100.1~1.108.4 소스 기준, 가짜 upstream 으로 도달 횟수 확인).
 * 게이트웨이 안 OpenAI SDK 재시도는 경로마다 다르다 — 채팅·음성은 0 이라 헤더로 upstream 1회, 임베딩은 게이트웨이 프로세스
 * 환경 DEFAULT_MAX_RETRIES=0 이 있어야 1회(scripts/env/omk.sh 가 litellm.env 에 넣는다), 이미지 생성은 LiteLLM 이 2 로 고정해
 * 헤더·본문·모델 등록·환경 변수 어느 것으로도 끌 수 없다(5xx·429 면 upstream 3회) — 그래서 hasa 이미지는 게이트웨이를 거치지 않고
 * 직결한다(addons/image-runtime/providers/hasa).
 */
export const GATEWAY_NO_RETRY_HEADERS: Readonly<Record<string, string>> = Object.freeze({ 'x-litellm-num-retries': '0' });
