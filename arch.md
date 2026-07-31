# 아키텍처 결정 기록 — LiteLLM 통합 게이트웨이와 vLLM 역할 분리 (2026-07-31)

> **[2026-07-31 실행 완료 부기]** 본 문서의 계획은 같은 날 실행·라이브 검증 완료됐습니다. 실측으로 계획과 달라진 결정 3건:
>
> 1. **BYOK 헤더 계약 (§5-1 교정)**: LiteLLM 1.89.4 실측 결과, 사용자 upstream 키를 `Authorization` 에 실으면 upstream 에 "Missing Authentication header" 401 이 발생. 검증된 계약은 **`Authorization: Bearer <LITELLM_MASTER_KEY>`(게이트웨이 인증, upstream 미전달) + `x-api-key: <사용자 BYOK>`(upstream 인증으로 전달)**. `x-litellm-api-key` 헤더는 사용하지 않음. openrouter·ollama-cloud·nvidia 3사 200 확인.
> 2. **로컬 모델 namespace (§4-2 단순화)**: `local/` prefix rename 은 채택하지 않음 — 로컬 모델명(`qwen3.6-35b-a3b`·`bge-m3`·`flux2-klein`·`gpt-3.5-turbo` alias)은 외부 wildcard prefix(`openrouter/*` 등)와 충돌하지 않아 **무프리픽스 유지**. 앱 콜사이트(LLM_DEFAULT_MODEL·IMAGE_GEN_MODEL·searchRerankEmbedModel·DB 프리셋) 변경 0 으로 이전 완료.
> 3. **Ollama Local 은 게이트웨이 미편입 (§4-3 예외 확정)**: 사용자별 동적 endpoint 라 정적 deployment 로 표현 불가 — 코드 레벨에서 direct 고정(`GATEWAY_EXCLUDED_PROVIDERS`).
> 4. **ChatGPT OAuth 는 direct 영구 예외로 확정 (§5-3·Phase 6 종결, 2026-07-31 P1 스파이크)**: LiteLLM 1.89.4 chatgpt provider 는 `chatgpt/*` 로드 시 **프로세스 공용 device-code 로그인**을 스스로 시작하고 인증을 `~/.config/litellm/chatgpt/auth.json` 단일 파일에 저장하는 구조로(소스 확인: `llms/chatgpt/authenticator.py`), 요청별 access token 수용 경로가 없다. 이 구조를 쓰면 전 사용자가 한 계정을 공유하게 되어 §5-3 금지사항을 정면 위반한다. 대안인 custom auth hook(Python) 은 단일 TypeScript 스택에 신규 유지보수 부담 대비 이점(관측 통합, provider 1개 한정)이 작아 반려. **결정: ChatGPT OAuth inference 는 OpenMake direct 호출을 최종 아키텍처의 명시적 예외로 유지한다** — 사용자별 세션 격리는 direct 경로가 이미 충족(§12-2·§14 해당 항목 이 결정으로 개정). LiteLLM 버전업 시 per-request 인증이 지원되면 재검토.
>
> 구현: 앱 전환 지점은 `LLM_GATEWAY_PROVIDERS` env(콤마 목록, provider별 롤백) + `providers/provider-router.ts` `resolveGatewayRoute` + `OpenAICompatProvider` gateway 옵션(카탈로그/credential 검증은 direct 유지). PR #413. 운영 반영: Mac LiteLLM PM2+launchd, DGX vLLM Tailscale 바인딩·1M 제거·FLUX PM2 편입·key env 주입/로테이션·pm2-logrotate, DGX LiteLLM 제거.

DGX의 역할을 vLLM 모델 서빙으로 한정하고, LiteLLM을 OpenMake 운영 서버로 이전해 로컬 모델과 외부 provider 호출을 하나의 LLM gateway로 통합하는 결정과 실행 조건을 기록합니다.

**결론: 조건부 승인.** 장비 간 Tailscale 사설 전송 경로는 확인됐지만, 단순히 LiteLLM 프로세스를 Mac mini로 옮기는 것만으로는 이전 목적을 달성하지 못합니다. 이전 완료는 다음 두 결과를 모두 충족해야 합니다.

1. DGX는 Qwen·BGE·FLUX 등 vLLM serve만 담당하는 inference plane이 됩니다.
2. OpenMake가 실행하는 로컬·외부 LLM 요청은 모두 Mac mini의 LiteLLM을 통과합니다.

외부 provider 직접 호출이 유지된다면 LiteLLM 이전의 핵심 목적이 달성되지 않은 것입니다. 직접 호출 경로는 단계적 전환과 롤백 기간에만 임시로 허용하며 최종 토폴로지에는 포함하지 않습니다.

에이전트·워크플로 오케스트레이션은 현재 OpenMake 자체 구현을 유지합니다. Mastra는 이번 이전의 필수 구성요소가 아니며 전면 도입하지 않습니다. Qwen-Agent도 production orchestration에 도입하지 않습니다. 향후 선언형 워크플로가 실제 운영 요구가 될 때에만 Mastra를 신규 워크플로 한 건에 제한해 별도 PoC할 수 있습니다.

## 1. 목적과 결정 범위

### 1-1. 이전 목적

- OpenMake의 모든 지원 LLM 호출에 단일 OpenAI 호환 gateway 제공
- 로컬 vLLM과 외부 provider의 모델 이름·오류·usage·관측 경로 통합
- provider별 retry와 동일 provider 내부 load balancing을 LiteLLM에 집중
- 사용자 정책과 cross-provider fallback 결정은 OpenMake에 유지하되 실제 호출은 항상 LiteLLM을 통과
- DGX에서 애플리케이션·gateway 책임을 제거하고 GPU 추론만 운영
- OpenMake와 DGX 사이 모델 트래픽을 공인 DDNS·포트포워딩이 아닌 Tailscale로 제한

### 1-2. 역할 정의

| 계층 | 책임 |
|---|---|
| OpenMake policy plane | 사용자 인증, provider 사용 권한, BYOK 암호화 보관, logical model 선택, 비용·데이터 전송 동의, cross-provider fallback 정책, 도구 실행 |
| LiteLLM gateway | logical model을 실제 deployment로 변환, provider 프로토콜 변환, 동일 provider retry/load balancing, 오류·usage 정규화, gateway 관측 |
| DGX inference plane | vLLM·vLLM-Omni 모델 serve와 GPU 자원 관리 |
| 외부 provider | OpenRouter, Ollama Cloud, NVIDIA NIM, ChatGPT 등 원격 추론 API |

LiteLLM이 사용자의 제품 권한이나 데이터 전송 동의를 결정하지는 않습니다. 반대로 OpenMake가 provider endpoint를 직접 호출해서도 안 됩니다. OpenMake는 정책을 결정하고, LiteLLM은 허용된 호출을 실행합니다.

### 1-3. 근거 범위와 보안 원칙

- 저장소 근거: `apps/api/src/`, `scripts/vllm/`, `openmake_llm.sh`, `ecosystem.config.js`, `db/migrations/`
- 운영 확인: 2026-07-31 현재 OpenMake 운영 서버와 DGX가 같은 tailnet에서 온라인
- 실제 Tailscale IP, MagicDNS FQDN, 키, 계정, 운영 환경 파일은 공개 저장소에 기록하지 않음
- 이 문서에서는 다음 placeholder를 사용
  - `<OPENMAKE_TAILSCALE_HOST>`: OpenMake 운영 서버의 Tailscale 주소 또는 MagicDNS 이름
  - `<VLLM_TAILSCALE_HOST>`: DGX의 Tailscale 주소 또는 MagicDNS 이름
- 네트워크·tailnet 정책·provider catalog·LiteLLM 버전이 변경되면 이 결정을 다시 검증

## 2. 2026-07-31 실측 현황

### 2-1. 호스트와 연결 상태

| 항목 | 확인 결과 |
|---|---|
| OpenMake 운영 서버 | macOS ARM64, 16GiB RAM, PostgreSQL·Redis·OpenMake API 정상, 앱은 PM2 운영 |
| OpenMake Python 도구 | 시스템 Python 3.14.6, `uv` 설치, LiteLLM 미설치. 이전용 Python 3.12 venv 필요 |
| OpenMake 부팅 복구 | PM2 dump는 있으나 PM2 launchd 등록은 확인되지 않음. 이전 전에 자동 기동 보완 필요 |
| DGX | Ubuntu 24.04.4 LTS ARM64, NVIDIA DGX Spark, Tailscale peer 온라인 |
| Tailscale 경로 | 최초 DERP 후 직접 연결로 전환, 실측 직접 ping 약 10ms |
| DGX SSH | 실제 로그인 성공. 서비스·프로세스·설정·버전·로그를 읽기 전용으로 확인 |
| 현재 OpenMake 로컬 LLM 경로 | `.env`가 HTTP 외부/DDNS host `:13401`을 사용. 아직 Tailscale endpoint로 전환되지 않음 |
| 현재 외부 provider 경로 | 사용자 BYOK를 복호화한 뒤 OpenMake의 provider adapter가 각 provider endpoint를 직접 호출 |
| tailnet 정책 | 중앙 ACL/Grants는 이번 SSH 점검에서 확인할 수 없었음. 이전 전에 관리자 정책 별도 검증 필요 |
| DGX LiteLLM `:13401` | `0.0.0.0` listen, Tailscale에서 TCP 및 HTTP 접근 가능 |
| DGX vLLM `:8002/:8003/:8005` | `127.0.0.1` listen, Tailscale에서는 연결 거부 |
| DGX `:8004` | listener 없음 |

### 2-2. DGX 실제 프로세스와 버전

저장소의 개별 `openmake-*.service`와 달리 실제 DGX는 `pm2-<DGX_USER>.service` 하나를 systemd에 등록하고, 그 아래에서 PM2가 Qwen·BGE·LiteLLM을 관리합니다. 이 PM2 systemd service는 enabled/active 상태입니다.

| 프로세스 | 실제 관리자·상태 | listen | 런타임 |
|---|---|---|---|
| `vllm-chat` | PM2 online, restart 0 | `127.0.0.1:8002` | Python 3.12.3, vLLM 0.23.0 |
| `vllm-embed` | PM2 online, restart 0 | `127.0.0.1:8003` | Python 3.12.3, vLLM 0.21.1 개발 빌드 |
| `vllm-1m` | PM2 `waiting restart`, restart 19 | 없음 (`:8004` 미기동) | Qwen과 같은 vLLM 0.23.0 환경 |
| `litellm` | PM2 online, restart 0 | `0.0.0.0:13401` | Python 3.12.3, LiteLLM 1.89.4 |
| `flux2-klein` | PM2/systemd 밖의 수동 프로세스 | `127.0.0.1:8005` | Python 3.12.3, vLLM 0.22.0 + vLLM-Omni 0.22.0 |

FLUX는 로그인 세션에서 시작된 shell의 자식으로 10일 이상 실행 중이지만 PM2 dump·systemd·cron에 자동 시작 항목이 없습니다. 현재 프로세스가 종료되거나 DGX가 재부팅되면 자동 복구되지 않습니다.

### 2-3. DGX LiteLLM과 로컬 모델 API 검증

운영 LiteLLM은 다음 probe에 정상 응답했습니다.

- `GET /health/liveliness` → HTTP 200
- `GET /health/readiness` → HTTP 200, `db: Not connected`
- 인증된 `GET /v1/models`와 `/v1/model/info` → 모델 카탈로그 반환

OpenMake 운영 서버에서 Tailscale을 통해 DGX LiteLLM에 실제 요청한 결과:

| 시나리오 | 결과 |
|---|---|
| Qwen non-stream chat | HTTP 200, `OK`, 총 19 tokens, 약 0.16초 |
| Qwen streaming chat | HTTP 200, SSE 5 events, `STREAM_OK`, 총 21 tokens, 약 0.15초 |
| Qwen 강제 tool call | HTTP 200, `health_check({ service: "openmake" })`, `finish_reason=tool_calls`, 약 0.33초 |
| `gpt-3.5-turbo` alias | HTTP 200, `OK`, 총 19 tokens, 약 0.15초 |
| BGE-M3 embedding | HTTP 200, 1024차원, L2 norm 1.0, 약 0.05초 |
| FLUX 이미지 생성 | HTTP 200, 512×512 PNG, 787,271 bytes, 약 17.06초 |
| 1M model chat | HTTP 500, upstream connection failure, 약 4.54초 |

위 지연은 단일 요청 시점의 smoke 수치이며 성능 SLO가 아닙니다. Qwen·BGE·FLUX의 loopback `/health`는 각각 HTTP 200이었고 잘못된 vLLM bearer key는 각각 HTTP 401로 거부됐습니다. 현재 LiteLLM은 잘못된 master key 요청을 거부하지만 DB 미연결 상태 때문에 HTTP 401이 아니라 HTTP 400 `no_db_connection`을 반환합니다.

`/health/liveliness`와 `/health/readiness`는 gateway 프로세스 상태만 확인합니다. 모델별 실제 chat·embedding·image 요청이 별도로 성공해야 정상으로 판정합니다.

### 2-4. 현재 OpenMake provider 구조

현재 `apps/api/src/providers/provider-router.ts`는 다음과 같이 동작합니다.

1. `local-llm:<model>`은 `LocalLLMProvider`를 통해 기존 LiteLLM으로 전달합니다.
2. 외부 provider는 `user_external_api_keys`에서 사용자별 키 또는 OAuth 세션을 조회하고 복호화합니다.
3. API key 방식은 `OpenAICompatProvider` 또는 `AnthropicProvider`를 생성해 외부 endpoint를 직접 호출합니다.
4. ChatGPT 구독 로그인은 `ChatGPTOAuthProvider`가 사용자별 OAuth 세션을 갱신하며 Codex backend를 직접 호출합니다.

활성 외부 provider catalog는 다음과 같습니다.

| provider | 인증 | 현재 호출 방식 | 목표 호출 방식 |
|---|---|---|---|
| OpenRouter | 사용자 API key | OpenMake → OpenRouter 직접 | OpenMake → LiteLLM → OpenRouter |
| Ollama Local | endpoint + 사용자 입력 key | OpenMake → Ollama 직접 | OpenMake → LiteLLM → 승인된 Ollama endpoint |
| Ollama Cloud | 사용자 API key | OpenMake → Ollama Cloud 직접 | OpenMake → LiteLLM → Ollama Cloud |
| NVIDIA NIM | 사용자 API key | OpenMake → NVIDIA 직접 | OpenMake → LiteLLM → NVIDIA NIM |
| ChatGPT 구독 | 사용자별 OAuth 세션 | OpenMake → Codex backend 직접 | OpenMake → LiteLLM → Codex backend |

따라서 현재 LiteLLM을 Mac mini로 옮기는 것만으로는 외부 provider 통합이 일어나지 않습니다. OpenMake의 외부 provider adapter가 LiteLLM gateway를 사용하도록 전환되어야 합니다.

### 2-5. 실측으로 확인된 즉시 위험

1. `vllm-1m`은 active catalog와 PM2에 남아 있지만 실제 listener가 없고 요청이 실패합니다.
2. 1M 엔진은 시작 시 사용 가능 메모리 약 9GiB보다 요청 메모리 54.73GiB가 커서 초기화에 실패했습니다. 현재 Qwen·BGE·FLUX와 동시에 운영할 수 없습니다.
3. FLUX는 자동 재시작·재부팅 복구가 없는 수동 프로세스입니다.
4. LiteLLM 환경 파일과 백업 파일 권한이 `0664`이며 여러 API key가 들어 있습니다. 최소 `0600`으로 제한해야 합니다.
5. vLLM API key가 CLI 인자로 전달되어 같은 호스트의 프로세스 목록과 서비스 상태에 노출됩니다. 환경 변수 인증으로 전환하고 CLI 인자에서는 제거해야 합니다.
6. PM2 logrotate 모듈이 없고 로그가 Qwen 약 994MB, BGE 약 940MB, LiteLLM 약 456MB까지 증가했습니다. 합계 약 2.4GB이며 계속 증가할 수 있습니다.
7. 운영 설정·serve 인자·버전이 저장소의 `scripts/vllm/` 배포물과 일치하지 않습니다.
8. 모든 호출을 LiteLLM으로 통합하면 LiteLLM 설정 오류나 프로세스 장애가 로컬·외부 LLM 전체에 영향을 주는 단일 장애 지점이 됩니다.

## 3. 현재와 목표 토폴로지

### 3-1. 현재 토폴로지

```text
OpenMake 운영 서버
   ├─ local-llm ── HTTP/DDNS ──> DGX :13401 LiteLLM
   │                                  ├─ :8002 Qwen
   │                                  ├─ :8003 BGE-M3
   │                                  ├─ :8004 1M catalog only, listener 없음
   │                                  └─ :8005 FLUX, 수동 프로세스
   │
   └─ external provider adapters ──> 각 provider endpoint 직접 호출
```

### 3-2. 결정된 목표 토폴로지

```text
OpenMake 운영 서버 (macOS)
   ├─ OpenMake API / Web / workers                         [PM2]
   ├─ PostgreSQL / Redis
   └─ LiteLLM unified gateway :13401                       [127.0.0.1 only]
          ├─ local chat/embedding/image
          │      └─ Tailscale encrypted overlay
          │             ├─ <VLLM_TAILSCALE_HOST>:8002/v1  Qwen
          │             ├─ <VLLM_TAILSCALE_HOST>:8003/v1  BGE-M3
          │             └─ <VLLM_TAILSCALE_HOST>:8005/v1  FLUX
          │
          └─ external provider HTTPS egress
                 ├─ OpenRouter
                 ├─ Ollama Cloud
                 ├─ approved Ollama Local endpoint
                 ├─ NVIDIA NIM
                 └─ ChatGPT/Codex backend

DGX (Linux)
   └─ vLLM serve 인스턴스만 운영                          [Tailscale interface only]
```

목표 상태에서는 OpenMake 프로세스가 외부 provider endpoint로 직접 LLM 요청을 보내지 않습니다. 모델 목록 확인, credential 검증, chat, streaming, tool call, embedding, image generation을 포함해 LLM provider 트래픽은 정의된 LiteLLM 경로를 사용합니다. OAuth 시작·토큰 교환처럼 추론 호출이 아닌 인증 제어 트래픽은 OpenMake가 계속 담당할 수 있습니다.

## 4. 통합 오케스트레이션 설계

### 4-1. 요청 흐름

```text
사용자 요청
   → OpenMake 인증·provider gate·model role 결정
   → 사용자 BYOK/OAuth 권한 확인
   → logical full model id를 LiteLLM model name으로 변환
   → 127.0.0.1:13401 LiteLLM
       ├─ local deployment → Tailscale → DGX vLLM
       └─ external deployment → HTTPS → provider
   → LiteLLM의 표준 응답·오류·usage
   → OpenMake tool loop·UI·감사 이벤트 처리
```

도구 호출의 실행 주체는 OpenMake입니다. LiteLLM은 모델이 반환한 tool call을 정규화해 전달하지만 MCP 또는 애플리케이션 도구를 직접 실행하지 않습니다.

### 4-2. 모델 namespace

앱의 기존 `provider:model` full ID는 사용자 설정·DB·UI의 논리 식별자로 유지할 수 있습니다. LiteLLM에 전달할 때 충돌 없는 gateway model name으로 변환합니다.

| OpenMake full ID 예시 | LiteLLM model name 예시 | upstream |
|---|---|---|
| `local-llm:qwen3.6-35b-a3b` | `local/qwen3.6-35b-a3b` | DGX `:8002` |
| `local-llm:bge-m3` | `local/bge-m3` | DGX `:8003` |
| `local-llm:flux2-klein` | `local/flux2-klein` | DGX `:8005` |
| `openrouter:openai/gpt-5` | `openrouter/openai/gpt-5` | OpenRouter |
| `ollama-cloud:gpt-oss:120b-cloud` | `ollama-cloud/gpt-oss:120b-cloud` | Ollama Cloud |
| `nvidia:meta/llama-3.3-70b-instruct` | `nvidia/meta/llama-3.3-70b-instruct` | NVIDIA NIM |
| `chatgpt:gpt-5.4` | `chatgpt/gpt-5.4` | ChatGPT/Codex backend |

정확한 문자열은 구현 시 회귀 테스트로 고정하되 다음 조건을 지켜야 합니다.

- 같은 provider의 임의 model ID를 지원할 수 있도록 provider별 wildcard deployment 사용
- 로컬 model name과 외부 provider prefix가 충돌하지 않음
- app-facing full ID와 served model을 로그·usage에서 함께 추적 가능
- `/v1/models` 결과만 믿지 않고 실제 upstream 추론 성공 여부를 probe

### 4-3. LiteLLM이 담당하는 라우팅

- provider별 wildcard model group과 고정 upstream base URL
- 로컬 model group을 DGX의 Tailscale 주소로 연결
- 같은 provider·같은 credential 범위의 retry와 deployment load balancing
- provider별 요청/응답 형식 변환
- OpenAI 호환 오류, token usage, latency metadata 정규화
- 허용된 provider header와 metadata 전달

외부 provider의 `api_base`는 클라이언트 요청에서 임의로 받지 않습니다. gateway 설정 또는 승인된 동적 catalog에서만 결정해 LiteLLM이 SSRF 우회 지점이 되는 것을 방지합니다. 특히 Ollama Local은 운영자가 허용한 host만 deployment로 등록합니다.

### 4-4. OpenMake가 담당하는 정책

- 사용자가 해당 provider와 모델을 사용할 권한이 있는지 확인
- BYOK 또는 OAuth 세션 조회·복호화
- 사용자의 비용·외부 데이터 전송 동의 확인
- role과 capability에 맞는 logical model 선택
- cross-provider fallback 순서 결정
- fallback 시 실제 응답 모델과 사유를 사용자에게 고지
- tool execution, conversation state, audit event 처리

cross-provider fallback은 OpenMake가 다음 모델과 해당 사용자의 credential을 선택해 LiteLLM에 새 요청을 보내는 방식으로 실행합니다. 이렇게 하면 정책은 OpenMake에 남으면서도 fallback 호출까지 모두 LiteLLM을 통과합니다.

LiteLLM 자체 fallback은 동일 provider 또는 동일 credential로 접근 가능한 deployment 안에서만 사용합니다. 앱과 LiteLLM 양쪽에 동일한 cross-provider fallback 체인을 중복 설정하지 않습니다.

### 4-5. 오케스트레이션 플랫폼 결정

**결정: OpenMake 자체 오케스트레이션을 유지하고 Mastra와 Qwen-Agent는 production에 도입하지 않습니다.**

현재 OpenMake에는 이미 다음 운영 기능이 구현되어 있습니다.

- `AgentTaskService`: 다중 턴 도구 실행, checkpoint, 취소, 실행 한도, sandbox, 승인, steering, 코드 산출물 검증
- agent task queue·boot recovery·schedule runner: 동시성 제한, 재시작 복구, 예약 실행과 실패 처리
- discussion engine·`spawn_agents`: 다중 에이전트 토론, 교차 검토, 역할·모델 기반 병렬 위임
- MCP tool router·user pool: built-in·external·사용자별 MCP 도구와 접근 격리
- 사용자별 장기 메모리와 OpenTelemetry 관측

Mastra는 TypeScript 기반 agent·workflow framework이며 선언형 graph, suspend/resume snapshot, Studio, eval, MCP client/server 같은 기능을 제공합니다. 이는 향후 정형 워크플로 개발에는 유용할 수 있지만 현재 핵심 실행 경로를 교체할 근거는 되지 않습니다.

전면 도입을 보류하는 이유:

1. 기존 agent task, checkpoint, approval, sandbox, MCP 사용자 격리, streaming event 계약과 기능이 크게 중복됩니다.
2. 기존 구현을 교체하면 DB 상태, API, UI, 복구, 감사, 보안 경계를 다시 통합해야 하므로 마이그레이션과 회귀 위험이 큽니다.
3. Mastra의 model router와 provider 간 fallback을 사용하면 OpenMake 정책·LiteLLM gateway와 라우팅 책임이 중복됩니다.
4. Mastra의 Durable Agents, Goals, Schedules, Signals, Agent Controller 등 일부 장기 실행 기능은 검토 시점의 공식 문서에서 Beta입니다.
5. Mastra core 대부분은 Apache-2.0이지만 `ee/` 경로는 production 사용에 별도 enterprise license가 필요하므로 기능별 검토가 필요합니다.

금지되는 이중 라우팅:

```text
OpenMake policy
   → Mastra model router의 provider 선택·fallback
      → LiteLLM provider 선택·fallback
         → 외부 provider 또는 DGX vLLM
```

목표 상태에서는 OpenMake가 사용자 정책과 logical model을 결정하고 LiteLLM이 유일한 inference gateway가 됩니다. Mastra가 향후 제한적으로 사용되더라도 workflow 실행만 담당해야 하며, 모델 endpoint는 LiteLLM으로 고정하고 Mastra에서 provider 직접 호출이나 cross-provider fallback을 구성하지 않습니다.

Mastra 재검토 조건:

- 신규 정형·다단계 workflow가 반복적으로 늘어나 명령형 구현 유지비가 커짐
- workflow graph 시각화, step replay/time travel, 체계적인 eval이 실제 운영 요구가 됨
- 현재 단일 프로세스 task queue를 넘어서는 durable multi-instance 실행이 필요함
- 기존 구현과 비교한 PoC에서 코드·운영 복잡도가 감소하고 restart/resume, streaming, approval, sandbox, 사용자별 MCP 격리가 동등하게 검증됨

PoC를 승인할 경우의 경계:

1. 기존 `AgentTaskService`, chat, discussion, deep-research 경로는 변경하지 않습니다.
2. 새로 만드는 정형 workflow 한 건과 별도 저장 namespace에만 적용합니다.
3. 모든 Mastra LLM 요청은 OpenMake의 logical model 정책을 거쳐 LiteLLM endpoint만 사용합니다.
4. Mastra의 provider 직접 연결과 cross-provider model fallback을 사용하지 않습니다.
5. 기존 MCP tool router, approval, sandbox, user context, OpenTelemetry를 adapter로 재사용합니다.
6. production 전 Apache-2.0 범위만으로 요구사항을 충족하는지 확인합니다.

Qwen-Agent는 Qwen의 instruction following, tool use, planning, memory와 Qwen 계열별 tool-call parsing을 중심으로 한 Python framework입니다. OpenAI-compatible vLLM과 연결할 수 있지만 현재 TypeScript OpenMake에 도입하면 별도 Python service, 상태·streaming bridge, 도구·MCP·sandbox 중복이 생깁니다. 따라서 production 오케스트레이터로 사용하지 않고 필요 시 Qwen tool-call parser와 prompt 호환성을 확인하는 offline/CI 평가 도구로만 사용할 수 있습니다.

## 5. BYOK와 OAuth 인증 설계

### 5-1. API key provider

사용자 BYOK의 저장 주체는 계속 OpenMake입니다.

1. OpenMake DB에는 provider key를 암호화해 저장합니다.
2. 요청 시점에만 해당 사용자의 key를 복호화합니다.
3. OpenMake는 LiteLLM 인증과 upstream provider 인증을 서로 다른 header로 전달합니다.
4. LiteLLM은 upstream provider key를 요청 범위에서만 사용하고 영속 저장하지 않습니다.

LiteLLM 1.89.4 기준으로 검증할 header 계약:

| 목적 | header |
|---|---|
| OpenMake → LiteLLM gateway 인증 | `x-litellm-api-key` |
| LiteLLM이 사용할 사용자 upstream key | `x-api-key` |

LiteLLM의 `general_settings.forward_llm_provider_auth_headers`를 활성화해야 하며, provider별 실제 전달 결과를 통합 테스트로 확인합니다. `Authorization` 하나에 LiteLLM master key와 provider key를 혼용하지 않습니다.

보안 조건:

- gateway·provider 인증 header를 application·PM2·LiteLLM 로그에 기록하지 않음
- key를 request body, model name, query string, trace attribute에 넣지 않음
- external key는 LiteLLM config 또는 공용 환경 파일에 사용자별로 복제하지 않음
- key 복호화 실패, provider 불일치, guest 요청은 LiteLLM 호출 전에 fail closed
- provider credential 검증 요청도 가능하면 LiteLLM을 통과시켜 직접 egress를 남기지 않음

### 5-2. 로컬 vLLM key

로컬 vLLM key는 사용자 BYOK가 아니라 운영용 upstream credential입니다.

- DGX의 `0600` 환경 파일에서 `VLLM_API_KEY`로 주입
- LiteLLM 전용 환경 파일에서 같은 upstream key 참조
- CLI `--api-key` 인자에서 실제 key 제거
- LiteLLM master key, vLLM key, 사용자 provider key를 모두 분리
- Tailscale Grant와 vLLM bearer 인증을 함께 적용

### 5-3. ChatGPT OAuth 차이와 완료 조건

현재 OpenMake는 사용자마다 access token·refresh token·account ID를 암호화해 저장하고 필요할 때 갱신합니다. 반면 LiteLLM 1.89.4의 기본 ChatGPT authenticator는 프로세스의 공용 auth 파일을 읽고 갱신하는 구조이므로 현재 OpenMake의 다중 사용자 OAuth 계약을 그대로 대체하지 못합니다.

따라서 다음 중 하나를 구현하고 실제 사용자별 격리를 검증해야 합니다.

- OpenMake가 요청별 OAuth access token과 account ID를 안전하게 전달하고 LiteLLM의 custom provider/auth hook이 이를 사용하는 방식
- LiteLLM이 OpenMake의 credential resolver를 호출해 요청 사용자에 맞는 OAuth 세션을 얻는 방식
- 사용자별 credential 격리와 refresh 결과 영속화를 제공하는 별도 gateway adapter

금지 사항:

- 여러 사용자가 하나의 LiteLLM `auth.json` 또는 하나의 ChatGPT 계정을 공유
- refresh token을 일반 request header로 매 요청 전달
- OAuth 세션을 LiteLLM 공용 환경 파일에 저장
- ChatGPT만 영구적으로 직접 호출하면서 통합 이전 완료로 판정

~~ChatGPT OAuth gateway 경로가 구현·검증되기 전에는 직접 호출을 임시 호환 경로로 유지할 수 있지만, 이는 마이그레이션 중간 상태이며 최종 아키텍처가 아닙니다.~~
**[2026-07-31 개정]** P1 스파이크 결과 위 세 가지 대안 중 실현 가능한 것은 custom hook 뿐이며 비용 대비 이점이 작아 반려 — **direct 호출을 최종 아키텍처의 명시적 예외로 확정** (문서 상단 부기 4 참고). 이 절의 금지 사항(공용 auth 파일·계정 공유 금지 등)은 그대로 유효하며, direct 경로가 이를 충족한다.

## 6. 네트워크와 프로세스 보안

### 6-1. LiteLLM은 loopback 전용

OpenMake API와 LiteLLM이 같은 호스트에서 실행되므로 LiteLLM은 `127.0.0.1:13401`에만 바인딩합니다.

- OpenMake gateway URL: `http://127.0.0.1:13401`
- 외부 DDNS와 LiteLLM `:13401` 포트포워딩 제거
- 브라우저·외부 클라이언트에 LiteLLM 직접 노출 금지
- 외부 provider HTTPS egress는 Mac mini의 LiteLLM 프로세스에서만 발생

### 6-2. vLLM은 Tailscale 인터페이스 전용

현재 serve 스크립트의 `--host 127.0.0.1`은 원격 LiteLLM에서 접근할 수 없습니다. 이전 시 각 vLLM 인스턴스는 DGX의 Tailscale IPv4에만 바인딩합니다.

- 권장: serve script의 host를 환경 변수화하고 운영 환경에서 Tailscale IPv4 주입
- 금지: 공인 포트포워딩을 유지한 채 `--host 0.0.0.0` 사용
- `pm2-<DGX_USER>.service`가 `network-online.target`과 `tailscaled.service` 이후 시작하도록 구성
- LiteLLM `api_base`에는 실제 주소를 하드코딩하지 않고 전용 환경에서 `<VLLM_TAILSCALE_HOST>` 주입

### 6-3. tailnet 최소 권한

- OpenMake 운영 서버: `tag:openmake-runtime`
- DGX: `tag:vllm-inference`
- 허용: `tag:openmake-runtime` → `tag:vllm-inference`의 `tcp:8002`, `tcp:8003`, `tcp:8005`
- 실패 중인 `:8004`는 열지 않음
- 더 넓은 기존 ACL/Grant가 같은 접근을 허용하지 않는지 함께 검토
- SSH 관리 권한은 추론 포트 권한과 별도로 유지

개념 예시:

```json
{
  "grants": [
    {
      "src": ["tag:openmake-runtime"],
      "dst": ["tag:vllm-inference"],
      "ip": ["tcp:8002", "tcp:8003", "tcp:8005"]
    }
  ]
}
```

Grants는 허용 규칙이므로 더 넓은 기존 규칙을 자동으로 무효화하지 않습니다. 실제 정책에는 tag owner와 기존 allow 규칙 검토가 함께 필요합니다.

## 7. Mac mini의 LiteLLM 운영 방식

저장소의 `scripts/vllm/openmake-litellm.service`는 Linux systemd와 Linux 절대 경로를 전제로 하므로 macOS에 그대로 사용할 수 없습니다.

### 7-1. 권장 런타임

- `uv`로 Python 3.12 전용 venv 생성. 시스템 Python 3.14를 직접 사용하지 않음
- 최초 이전은 실측 버전 LiteLLM 1.89.4로 고정
- 로컬·외부 provider 회귀 검증 없이 버전을 동시에 업그레이드하지 않음
- 전용 config와 `chmod 600` 환경 파일 사용
- LiteLLM을 독립 PM2 프로세스로 등록
- PM2 dump와 macOS launchd 부팅 등록을 모두 확인
- liveness/readiness 및 실제 provider probe 구성
- `pm2-logrotate` 또는 동등한 로그 회전과 보존 정책 적용
- 앱 배포와 gateway 업그레이드를 독립적으로 롤백할 수 있도록 경로·버전 분리

PM2에는 Python 바이너리를 직접 실행하는 방식으로 등록하고 비밀값을 `ecosystem.config.js`에 작성하지 않습니다.

### 7-2. LiteLLM config 원칙

- local model deployment: 고정 model name + Tailscale `api_base` + 운영용 `VLLM_API_KEY`
- external provider deployment: provider별 wildcard model group + 서버가 통제하는 `api_base`
- 사용자 key: 정적 config에 저장하지 않고 요청 header로 전달
- `drop_params` 정책은 provider별 회귀 결과를 기준으로 결정
- timeout은 OpenMake의 가장 긴 승인된 요청보다 길거나 같게 설정
- retry는 무제한으로 두지 않고 provider별 상한과 backoff 설정
- prompt·response 원문 logging은 기본 비활성화

개념적인 model group은 다음과 같습니다. 실제 config 문법과 provider prefix는 LiteLLM 1.89.4 환경에서 smoke test 후 확정합니다.

```yaml
model_list:
  - model_name: local/qwen3.6-35b-a3b
    litellm_params:
      model: openai/qwen3.6-35b-a3b
      api_base: os.environ/QWEN_VLLM_API_BASE
      api_key: os.environ/VLLM_API_KEY

  - model_name: openrouter/*
    litellm_params:
      model: openrouter/*

  - model_name: ollama-cloud/*
    litellm_params:
      model: openai/*
      api_base: https://ollama.com/v1

  - model_name: nvidia/*
    litellm_params:
      model: nvidia_nim/*

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  forward_llm_provider_auth_headers: true
```

### 7-3. LiteLLM DB 분리

현재 운영 LiteLLM readiness는 `db: Not connected`이며 저장소 config는 `database_url: os.environ/DATABASE_URL`을 포함합니다. Mac의 OpenMake 루트 `.env`를 LiteLLM에 그대로 주입하면 애플리케이션 DB에 잘못 연결될 수 있습니다.

- LiteLLM 전용 환경 파일 사용
- 초기 gateway 전환에 DB 기능이 필요하지 않으면 `DATABASE_URL`을 주입하지 않음
- virtual key·spend DB 기능을 도입하면 OpenMake 앱 DB와 분리된 LiteLLM 전용 DB 사용
- DB 활성화 전 migration·backup·restore와 개인정보 보존 범위 검증

## 8. 모델 카탈로그와 provider 호환성

### 8-1. DGX 로컬 모델

| 모델 | 운영 상태·실제 요청 | 결정 |
|---|---|---|
| `qwen3.6-35b-a3b` | PM2 online, health/chat/stream/tool call 성공 | 유지 |
| `qwen3.6-35b-a3b-1m` | catalog와 PM2에는 있으나 listener 없음, HTTP 500 | active catalog와 PM2 dump에서 제거 |
| `bge-m3` | PM2 online, health 및 1024차원 embedding 성공 | 유지 |
| `gpt-3.5-turbo` | `:8002` alias chat 성공 | 필요 시 호환 alias 유지 |
| `flux2-klein` | 수동 프로세스, health 및 512×512 PNG 생성 성공 | 유지, PM2 영속화 |

1M 엔진은 현재 Qwen·BGE·FLUX가 점유한 상태에서 약 54.73GiB를 추가 확보하지 못해 반복 실패합니다. active production profile에서 제거하고 필요하면 다른 모델을 중지한 뒤 사용하는 배타적 실험 profile로만 보존합니다.

### 8-2. 외부 provider 회귀 항목

현재 provider adapter의 동작을 gateway 전환 후에도 보존해야 합니다.

| 기능 | 검증 내용 |
|---|---|
| 모델 목록 | provider별 catalog와 fallback catalog가 기존 UI에 동일하게 노출 |
| streaming | 첫 token, 중단, SSE 종료, usage chunk 정상 |
| tool calling | tool ID·name·arguments와 `finish_reason` 보존 |
| vision | image content 변환과 capability gate 유지 |
| reasoning | reasoning/thinking channel이 본문과 혼합되지 않음 |
| prompt caching | OpenRouter의 `cache_control` 및 관련 header 보존 |
| provider metadata | OpenRouter referer/title/category 등 승인된 header 보존 |
| usage/cost | prompt/completion token과 provider cost가 이중 집계되지 않음 |
| 오류 | 401·403·404·429·5xx·timeout이 OpenMake fallback 정책에 필요한 형태로 정규화 |
| SSRF | 사용자 입력 base URL이 gateway의 임의 egress로 이어지지 않음 |

## 9. 장애와 fallback 의미

| 장애 | 목표 상태의 영향 |
|---|---|
| Mac LiteLLM 장애 | 로컬·외부 LLM 요청 전체 중단. 가장 중요한 단일 장애 지점 |
| DGX 또는 vLLM 장애 | 로컬 chat·embedding·image만 실패. 외부 provider는 LiteLLM을 통해 계속 사용 가능 |
| Tailscale 경로 장애 | DGX 로컬 모델만 접근 불가. 외부 HTTPS 경로는 유지 |
| 특정 외부 provider 장애 | 해당 provider 실패. 정책상 허용된 경우 OpenMake가 다음 모델을 LiteLLM으로 재요청 |
| Mac 운영 서버 장애 | 앱과 LiteLLM이 함께 중단되어 서비스 전체 중단 |
| LiteLLM config 오류 | 잘못된 wildcard·credential·fallback 설정이 여러 provider에 동시에 영향 |

단일 장애 지점 완화책:

- PM2 자동 재시작과 launchd 재부팅 복구
- loopback liveness와 provider별 synthetic probe 분리
- 마지막 정상 config의 checksum과 즉시 복원 가능한 복사본 유지
- config 반영 전 별도 포트에서 parallel smoke test
- 외부 direct mode와 기존 DGX LiteLLM을 관찰 기간 동안 롤백 대상으로 유지
- 안정화 후 필요하면 두 번째 LiteLLM 인스턴스 또는 별도 gateway host를 HA 과제로 검토

## 10. 마이그레이션 실행 순서

### Phase 0 — 현재 로컬 경로의 공인 WAN 의존 제거

현재 OpenMake의 로컬 `LLM_BASE_URL`은 외부/DDNS HTTP endpoint를 가리킵니다. 전체 이전 전에 DGX LiteLLM의 Tailscale `:13401` 주소로 먼저 전환해 prompt와 key가 공인 WAN 평문 경로를 지나지 않게 합니다.

### Phase 1 — 기준선과 롤백 자료 확보

- 기존 DGX PM2 ecosystem, LiteLLM config, serve script, PM2 dump의 checksum과 복구 사본 확보
- 현재 direct provider별 chat·stream·tool·vision·reasoning·usage/error 기준선 기록
- 사용자 BYOK 등록·검증·삭제와 ChatGPT OAuth login/refresh 기준선 기록
- 외부 provider별 실제 egress host와 요청 header의 비밀값 비기록 여부 확인
- 로컬 Qwen·BGE·FLUX smoke와 1M 실패 기준선 보존

### Phase 2 — DGX를 vLLM 전용으로 준비

1. Qwen/BGE/FLUX serve script의 host를 환경 변수화
2. 실패 중인 `vllm-1m`을 active PM2 dump와 최종 LiteLLM catalog에서 제거
3. 수동 FLUX를 PM2 ecosystem에 등록하고 재부팅 복구 설정
4. 새 vLLM API key를 `0600` 환경 파일에 적용하고 CLI 인자에서 제거
5. Qwen/BGE/FLUX를 Tailscale 인터페이스에 바인딩
6. tailnet Grant 적용 후 OpenMake 서버만 포트에 접근 가능한지 확인
7. 공인망과 일반 LAN에서 vLLM 포트가 도달 불가능한지 확인
8. PM2 logrotate와 보존 정책 적용

이 단계에서는 기존 DGX LiteLLM을 중지하지 않습니다.

### Phase 3 — Mac LiteLLM 병렬 기동

1. `uv`로 Python 3.12 venv와 LiteLLM 1.89.4 설치
2. `0600` 전용 환경 파일 생성. OpenMake 루트 `.env`를 source하지 않음
3. local Qwen/BGE/FLUX deployment를 Tailscale upstream으로 구성
4. 1M deployment는 추가하지 않음
5. external API key provider의 wildcard deployment와 고정 base URL 구성
6. BYOK forwarding을 활성화하고 auth header logging 비활성화 확인
7. PM2 ecosystem과 macOS launchd 부팅 복구 설정
8. 최종 포트와 다른 loopback 임시 포트에서 기동

### Phase 4 — 로컬 모델 gateway 검증

- Qwen non-stream·streaming·tool call
- BGE embedding
- FLUX image generation
- 필요한 경우 `gpt-3.5-turbo` alias
- catalog에서 1M 모델이 제거됐는지 확인
- 잘못된 LiteLLM master key와 vLLM key가 각각 거부되는지 확인
- DGX listener와 PM2 restart count 확인

### Phase 5 — API key 외부 provider를 LiteLLM으로 전환

OpenMake에 direct/gateway 전환 지점을 두고 provider별로 한 번에 하나씩 전환합니다.

1. OpenRouter
2. Ollama Cloud
3. NVIDIA NIM
4. 승인된 Ollama Local deployment
5. 향후 추가되는 API key provider

각 provider마다 모델 목록, credential 검증, non-stream, streaming, tool call, vision, reasoning, usage/cost, timeout, 4xx/429/5xx를 확인합니다. 성공한 provider도 관찰 기간에는 direct mode로 즉시 되돌릴 수 있어야 합니다.

### Phase 6 — ChatGPT OAuth gateway 전환

1. 요청 사용자와 OAuth 세션을 안전하게 연결하는 gateway credential 계약 확정
2. access token·account ID 전달과 refresh token 비전달 원칙 적용
3. token 만료 시 OpenMake 저장소 갱신 또는 명시적 재로그인 흐름 검증
4. 두 사용자 이상의 세션이 섞이지 않는 격리 테스트
5. Responses API streaming·tool call·reasoning·usage 회귀 테스트
6. direct ChatGPTOAuthProvider를 rollback mode로 전환

이 단계가 완료되지 않으면 외부 provider 통합 마이그레이션은 완료가 아닙니다.

### Phase 7 — 전체 cutover와 실제 사용자 흐름 검증

1. OpenMake의 local gateway URL을 `http://127.0.0.1:13401`로 전환
2. local·external provider adapter가 모두 같은 LiteLLM endpoint를 사용하도록 전환
3. OpenMake PM2 프로세스를 환경 갱신과 함께 재시작
4. 실제 UI에서 로컬·외부 모델 선택과 streaming 응답 확인
5. tool loop, discussion/deep-research role, reranker, embedding, image generation 확인
6. 외부 실패 → 로컬 fallback과 허용된 cross-provider fallback이 모두 LiteLLM을 통과하는지 확인
7. OpenMake 프로세스에서 provider inference endpoint로 직접 egress가 남지 않았는지 확인

### Phase 8 — 관찰과 기존 경로 제거

관찰 기간에는 DGX LiteLLM과 OpenMake direct provider mode를 즉시 삭제하지 않고 rollback 대상으로 유지합니다.

정상 관찰 후:

1. DGX PM2의 `litellm`을 stop/delete하고 `pm2 save`
2. 공인 `:13401` 포트포워딩과 DDNS 의존 제거
3. OpenMake external direct mode와 사용되지 않는 direct adapter를 별도 승인 후 제거
4. 사용하지 않는 DGX LiteLLM venv·환경 파일을 별도 승인 후 제거
5. 운영 문서·모니터링·on-call runbook을 통합 gateway 기준으로 갱신

## 11. 롤백 절차

마이그레이션은 로컬 모델 경로와 외부 provider 경로를 독립적으로 롤백할 수 있어야 합니다.

### 11-1. 로컬 모델 롤백

1. OpenMake local `LLM_BASE_URL`을 기존 DGX LiteLLM endpoint로 복원
2. 기존 LiteLLM master key 설정 복원
3. OpenMake PM2 재시작
4. `/v1/models`와 실제 Qwen chat 확인

### 11-2. 외부 provider 롤백

1. 문제가 발생한 provider만 gateway mode에서 direct mode로 복원
2. 기존 사용자 BYOK/OAuth 저장소와 provider adapter 사용
3. 실제 stream·tool·usage 확인
4. 다른 provider와 로컬 모델은 Mac LiteLLM을 계속 사용

### 11-3. 전체 gateway 롤백

1. 모든 외부 provider를 direct mode로 복원
2. 로컬 모델을 기존 DGX LiteLLM으로 복원
3. Mac LiteLLM을 중지하고 원인 분석
4. direct와 gateway 양쪽에서 중복 요청이 발생하지 않는지 확인

기존 DGX LiteLLM과 direct provider mode를 제거한 뒤에는 즉시 롤백이 불가능합니다. 제거는 실제 관찰 기간, rollback drill, 운영 승인 후 수행합니다.

## 12. 완료 기준

### 12-1. DGX와 네트워크

- [ ] DGX에서 LiteLLM·Backend·DB·Redis가 실행되지 않고 vLLM 인스턴스만 운영됨
- [ ] DGX PM2에는 Qwen·BGE·FLUX만 active production process로 등록됨
- [ ] 실패 중인 1M 모델이 LiteLLM catalog와 active PM2 dump에 없음
- [ ] FLUX가 수동 login session이 아니라 PM2로 재부팅 복구됨
- [ ] DGX vLLM 포트는 Tailscale 인터페이스에서만 listen
- [ ] OpenMake 운영 서버만 필요한 vLLM 포트에 접근 가능
- [ ] 공인 WAN 포트포워딩 `:13401/:8002/:8003/:8004/:8005` 없음

### 12-2. 통합 gateway

- [ ] Mac LiteLLM이 Python 3.12와 승인된 고정 버전으로 실행됨
- [ ] LiteLLM은 `127.0.0.1:13401`에서만 listen
- [ ] PM2와 launchd가 재부팅 후 LiteLLM·OpenMake 앱을 자동 복구
- [ ] LiteLLM이 OpenMake 앱의 `DATABASE_URL`을 잘못 상속하지 않음
- [ ] local·external model namespace와 실제 deployment가 일치
- [x] 모든 API key 외부 provider의 inference 요청이 LiteLLM을 통과 (ollama-local 은 §4-3 예외)
- [x] ~~ChatGPT OAuth inference 요청도 사용자별 격리를 유지하며 LiteLLM을 통과~~ → **direct 영구 예외로 개정** (부기 4 — LiteLLM 공용 인증 구조로 편입 시 오히려 격리 위반, 사용자별 격리는 direct 가 충족)
- [ ] provider credential 검증과 모델 목록 조회의 egress 경로가 문서화됨
- [ ] OpenMake 프로세스에 외부 inference endpoint 직접 호출이 남아 있지 않음

### 12-3. 인증과 보안

- [ ] vLLM key, LiteLLM master key, 사용자 provider key가 분리됨
- [ ] 기존 운영 key가 교체되고 공개 저장소 값이 폐기됨
- [ ] key가 process argv·PM2 config·서비스 상태·로그에 노출되지 않음
- [ ] key 환경 파일과 백업 권한이 `0600`
- [ ] 사용자별 BYOK가 LiteLLM config 또는 환경 파일에 영속 저장되지 않음
- [ ] OAuth 세션이 사용자 간 공유되지 않음
- [ ] 임의 `api_base`가 LiteLLM을 통한 SSRF로 이어지지 않음

### 12-4. 기능과 운영

- [ ] OpenMake 자체 orchestration이 agent task·MCP·approval·memory·discussion의 기준 구현으로 유지됨
- [ ] Mastra와 Qwen-Agent를 도입하지 않아도 gateway 이전의 완료 조건을 충족함
- [ ] local chat·stream·tool·embedding·image 요청 성공
- [ ] 외부 provider별 chat·stream·tool·vision·reasoning 요청 성공
- [ ] usage·cost·오류가 중복 또는 누락 없이 기록됨
- [ ] cross-provider fallback 정책은 OpenMake가 결정하고 모든 실제 호출은 LiteLLM을 통과
- [ ] LLM provider 선택·fallback이 OpenMake와 LiteLLM 이외의 추가 framework에 중복 설정되지 않음
- [ ] fallback 시 사용자에게 실제 응답 모델과 사유가 표시됨
- [ ] Mac과 DGX 로그 회전·보존 정책 적용
- [ ] provider별 rollback과 전체 gateway rollback drill 완료
- [ ] DGX LiteLLM과 direct provider mode 제거 후 관찰 기간 완료

## 13. 별도 운영 리스크

### PostgreSQL 백업

`openmake_llm.sh deploy`는 build → migrate → restart를 수행하지만 배포 전 자동 백업은 실행하지 않습니다. 주기적 dump 또는 WAL 백업, 외부 복제, 보존 정책, 복구 테스트, RPO/RTO 기록이 필요합니다.

`db/migrations/010_feedback_schema_fixes.sql`의 "deploy가 실행 전 자동 백업" 주석은 현재 구현과 불일치하므로 별도 정정합니다.

### 운영 스크립트의 평문 DB 자격증명

저장소 밖 운영 스크립트에 실제 DB 자격증명이 남아 있다면 즉시 교체하고 `DATABASE_URL` 또는 권한 제한 secret 파일로 주입합니다. 공개 커밋 전 secret scan을 수행합니다.

### Gateway 고가용성

모든 LLM 요청을 LiteLLM으로 통합하면 gateway 장애 범위가 커집니다. 첫 이전에서는 Mac mini의 PM2·launchd·rollback을 우선 완성하고, 실제 장애·부하 지표를 기반으로 이중화 필요성을 별도 결정합니다.

## 14. 최종 결정표

| 항목 | 결정 |
|---|---|
| DGX에서 vLLM만 운영 | 승인 |
| LiteLLM을 OpenMake 운영 서버로 이전 | 통합 gateway 조건 충족 후 승인 |
| 로컬·외부 LLM inference를 LiteLLM으로 통합 | 승인, 이전의 핵심 목적 |
| 외부 provider 직접 inference 호출 | 전환·롤백 기간에만 임시 허용, 최종 상태에서는 금지 |
| OpenMake → DGX 통신 | Tailscale 전용 |
| vLLM 공인망 직접 노출 | 금지 |
| LiteLLM 외부 노출 | 금지, loopback 전용 |
| 사용자 BYOK 보관 | OpenMake DB의 암호화 저장 유지 |
| 사용자 BYOK 실행 전달 | 요청 단위로 LiteLLM에 전달, gateway config에 저장 금지 |
| ChatGPT OAuth | **direct 영구 예외 확정 (2026-07-31 P1 스파이크 No-Go)** — LiteLLM 공용 인증 구조로 편입 시 사용자별 격리 위반, direct 유지가 격리 충족. LiteLLM per-request 인증 지원 시 재검토 |
| 동일 provider retry/load balancing | LiteLLM 담당 |
| cross-provider fallback 정책 | OpenMake 담당, 실제 호출은 LiteLLM 담당 |
| agent·workflow orchestration | OpenMake 자체 구현 유지 |
| Mastra 전면 도입 | 보류, 현재 이전의 필수 구성요소가 아님 |
| Mastra 제한 PoC | 향후 신규 정형 workflow 한 건에만 조건부 허용 |
| Mastra model router·provider 직접 호출 | 금지, LiteLLM 단일 gateway 원칙 유지 |
| Qwen-Agent production 도입 | 보류, 필요 시 Qwen 호환성 offline/CI 평가에만 사용 |
| 1M 모델 | active catalog에서 제거, 필요 시 배타적 실험 profile로만 보존 |
| DGX 프로세스 관리자 | PM2 유지, Qwen·BGE·FLUX만 영속 운영 |

이전의 핵심 근거는 **DGX를 순수 inference plane으로 만들고, Mac mini의 LiteLLM을 로컬·외부 provider 전체의 단일 실행 gateway로 운영하는 것**입니다. 외부 provider가 LiteLLM을 우회하면 이 결정의 목표는 달성되지 않은 것입니다.

## 참고

- Tailscale MagicDNS: <https://tailscale.com/docs/features/magicdns>
- Tailscale Grants: <https://tailscale.com/docs/features/access-control/grants>
- vLLM OpenAI-compatible server: <https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/>
- vLLM `serve` CLI: <https://docs.vllm.ai/en/latest/cli/serve/>
- LiteLLM gateway overview: <https://docs.litellm.ai/>
- LiteLLM config: <https://docs.litellm.ai/docs/proxy/configs>
- LiteLLM health checks: <https://docs.litellm.ai/docs/proxy/health>
- LiteLLM 1.89.4 provider auth forwarding: <https://github.com/BerriAI/litellm/blob/7f7796906b29caf03b9d83f6e2562d342e9e6dd3/litellm/proxy/litellm_pre_call_utils.py>
- LiteLLM 1.89.4 ChatGPT authenticator: <https://github.com/BerriAI/litellm/blob/7f7796906b29caf03b9d83f6e2562d342e9e6dd3/litellm/llms/chatgpt/authenticator.py>
- Mastra repository and licensing: <https://github.com/mastra-ai/mastra>
- Mastra workflows: <https://mastra.ai/docs/workflows/overview>
- Mastra suspend and resume: <https://mastra.ai/docs/workflows/suspend-and-resume>
- Mastra model routing and custom endpoints: <https://mastra.ai/models>
- Mastra MCP: <https://mastra.ai/docs/mcp/overview>
- Qwen-Agent: <https://github.com/QwenLM/Qwen-Agent>

---

> 이 저장소는 공개 리포지토리입니다. 실제 Tailscale IP·MagicDNS FQDN·DDNS 주소·API key·계정·내부 환경 파일 경로를 이 문서나 커밋에 포함하지 마십시오.
