<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>오픈 웨이트 모델과 BYOK 모델을 위한, 오픈소스·로컬 우선·셀프 호스팅 AI 워크스페이스.</strong><br/>
  vLLM/LiteLLM 추론 · 자율 AI 에이전트 · MCP 도구 · 딥 리서치 · Docker 샌드박스.
</p>

<p align="center">
  <a href="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml"><img src="https://github.com/openmake/openmake_llm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/github/package-json/v/openmake/openmake_llm?label=version&color=green" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D24%20%3C25-brightgreen.svg" alt="Node >=24 <25" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/Next.js-16-black.svg" alt="Next.js 16" />
</p>

<p align="center">
  <a href="https://openmake.cc/ko/">홈페이지</a> ·
  <a href="https://chat.openmake.cc">라이브 데모</a> ·
  <a href="https://bench.openmake.cc">Bench</a> ·
  <a href="https://openmake.cc/ko/docs/">셀프호스팅 가이드</a><br/>
  <a href="README.md">English</a> ·
  <strong>한국어</strong> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

> 이 문서는 영어 [README.md](README.md)의 한국어 번역입니다. 내용이 다르면 영어판과 코드가 기준입니다.

## 개요

**OpenMake LLM**은 사용자 자신의 하드웨어에서 직접 운영하는 셀프 호스팅 AI 어시스턴트다. **vLLM**으로 로컬 모델을 서빙하고 그 앞단에 **LiteLLM 프록시**(OpenAI 호환)를 두며, *동일한* 추상화를 통해 사용자가 자신의 키로 등록한 외부 프로바이더(**OpenRouter, NVIDIA NIM, Ollama** 로컬/클라우드 — 모두 OpenAI 호환이며, Anthropic 어댑터도 기본 내장)로 라우팅한다. 따라서 기본적으로 데이터는 사용자 머신에 그대로 머문다.

모든 요청은 경량 **메시지 파이프라인**을 거치며, 이 파이프라인은 프로바이더 게이트, 보안·언어 정책, 프롬프트/도구 조립을 *추가 LLM 라우팅 왕복 없이* 적용한다. 이후 로컬 모델과 외부 모델은 동일한 실행 경로와 상시 도구 루프를 공유한다. 현재의 **`ExecutionPlanBuilder`**는 의도적으로 좁게 설계되어, 선택된 인가된 커스텀 에이전트가 있으면 그것을 로드하는 역할만 한다. 동작은 불투명한 프리셋이 아니라 **모델 · 스타일 · 모드 토글 · 커스텀 에이전트**라는 직교 축으로만 제어된다. 고급 사용자는 **역할별 모델 오케스트레이션**으로 한 단계 더 나아갈 수 있다. 즉 각 기능 역할(에이전트, 심판, 리서치, 병렬 서브 에이전트, 리뷰, 사고 요약)마다 서로 다른 모델(로컬 또는 외부)을 배정한다. 채팅을 넘어, 자율 에이전트·딥 리서치 파이프라인·MCP 도구 시스템을 더하며, 이 모두는 JWT 인증과 역할 기반 접근 제어 뒤에서 동작한다.

> **단일 호스트 설계:** 애플리케이션(API + 웹)은 **PM2**로 실행되고, 상태를 갖는 의존성(PostgreSQL / Redis)과 샌드박스화된 에이전트 / MCP / 산출물 프로세스는 격리를 위해 **Docker**에서 실행된다.

**한눈에 보기**

| | |
|---|---|
| 🧠 **로컬 모델 1개, 요청별 라우팅** | vLLM + LiteLLM으로 서빙되는 `qwen3.8-27b`, 262K 컨텍스트 적합 안전망 포함 |
| 🎛️ **역할별 모델 오케스트레이션** | 기능 역할마다 서로 다른 모델(로컬 또는 BYOK 외부) 배정. 사용자별 + 관리자 전역 매핑, 토큰 예산이 걸린 서버 공유 키 |
| 🤖 **자율 에이전트** | 영속 Docker 샌드박스(셸 · Python · 브라우저 · 파일) 안에서 동작하는 Manus 스타일 멀티턴 에이전트, 사람 개입(human-in-the-loop) 승인 포함 |
| 🔬 **딥 리서치** | 팬아웃 웹 검색 → 출처 수집 → 주장 검증 → 출처 표기 종합 |
| 📊 **리포트 파이프라인** | 리포트 의도 질의는 모델이 생성한 데이터를 고정된 디자인 템플릿을 통해 HTML 산출물로 렌더링 — **PDF/DOCX**로 내보내기 가능 |
| 📓 **NotebookLM 그라운딩** | 사용자의 Google NotebookLM 노트북 하나를 대화 컨텍스트로 고정, 컴포저에서 바로 |
| 🧩 **내장 MCP 도구 22종** + 외부 MCP 서버 | 각 외부 서버는 Docker로 격리(`--cap-drop ALL`, 비루트, 네트워크 정책) |
| 👤 **커스텀 에이전트 & 스킬** | 프로젝트 범위 페르소나(선택적 에이전트별 모델 포함) + 자동 선택 가능한 스킬 라이브러리 + 18개 산업 에이전트(전문가 100명) |
| 💬 **Discord 게이트웨이 봇** | Discord 메시지를 OpenAI 호환 API로 중계하는 선택적 워크스페이스, 역할/멘션 접근 제어 포함 |
| 🖥️ **네이티브 클라이언트** | 로컬 폴더 에이전트 작업용 **OpenMake Companion**(SwiftUI 메뉴바 앱, macOS Apple Silicon), **OpenMake Code** CLI(로컬 브리지), 진행 중인 SwiftUI iOS 클라이언트 — 채팅 자체는 웹 앱에 머문다 |
| 📊 **OpenMake Bench** | [bench.openmake.cc](https://bench.openmake.cc): 블라인드 쌍대 모델 비교와 하드웨어 적합도 점수, 웹 SSO 클라이언트로 로그인. 여기서 고른 모델은 사용자의 모델 역할에 적용된다 |
| 🌐 **4개 언어 UI** | 한국어 · English · 日本語 · 简体中文 (`next-intl`, 쿠키 로케일, 브라우저 자동 감지) |
| 🔒 **보안 우선** | JWT (HttpOnly), Google OAuth 2.0, RBAC, 라우트별 속도 제한, SSRF 가드, 감사 ↔ 알림 |

---

## 스크린샷

> 대화 제목, 노트북 이름, 계정 이메일은 흐림 처리했다. 그 외 모든 것은 실행 중인 앱이다.

**채팅 워크스페이스** — 5개 항목의 워크스페이스 내비게이션, 모델 선택기, 응답 스타일, 슬래시로 호출하는 스킬:

<p align="center">
  <img src="assets/screenshot-chat.png" alt="Chat workspace" width="920" />
</p>

| 모드 메뉴 — 토론 / 사고 / 딥 리서치 / 웹 / 에이전트 / 이미지 / 산출물 / 구조화 | NotebookLM 선택기 — 노트북을 대화 컨텍스트로 고정 |
|---|---|
| ![Composer mode menu](assets/screenshot-composer-modes.png) | ![NotebookLM notebook picker](assets/screenshot-notebook-picker.png) |

**에이전트 작업** — 실시간 진행 상황, 토큰 집계, 반복 스케줄, 재사용 가능한 작업 템플릿을 갖춘 자율 멀티턴 실행:

<p align="center">
  <img src="assets/screenshot-agent-tasks.png" alt="Agent task management" width="920" />
</p>

| 커넥터 — 외부 MCP 서버, 각각 Docker로 격리 | 모델 역할 관리 — 전역 역할→모델 매핑 |
|---|---|
| ![Settings → Connectors](assets/screenshot-settings.png) | ![Model roles admin](assets/screenshot-model-roles.png) |

**스킬 라이브러리** — 도구 바인딩을 갖춘 재사용 가능한 매니페스트, Git에서 임포트하거나 모델이 생성:

<p align="center">
  <img src="assets/screenshot-skill-library.png" alt="Skill Library" width="920" />
</p>

**다국어 UI (한국어 · English · 日本語 · 简体中文)** — 설정에서 인터페이스 언어를 전환하거나, 브라우저(`Accept-Language`)를 따르게 둔다. AI 응답 언어는 메시지 언어를 독립적으로 따른다:

<p align="center">
  <img src="assets/i18n-demo.gif" alt="Interface language switching demo (ko / en / ja / zh)" width="920" />
</p>

---

## 아키텍처

OpenMake는 **정책**(*어떻게* 답할지 결정)과 **실행**(실제로 모델을 호출)을 분리한다 — SQL의 플래너/실행기 분리와 같다. 두 계층은 의도적으로 독립을 유지한다.

```
                          WebSocket / REST
                                  │
                    ┌─────────────▼─────────────┐
  Query ───────────►│      message-pipeline     │  request processing
                    │                           │  · provider gate
                    └─────────────┬─────────────┘  · security & language policy
                                  │                · prompt & tool assembly
                                  │                · authorized custom-agent load
                    ┌─────────────▼─────────────┐
                    │ streamFromExternalProvider│  single path — local & external alike
                    │   (always-on tool loop)   │  · 5 tool turns max
                    └─────────────┬─────────────┘  · special modes intercept earlier
                                  │
                    ┌─────────────▼─────────────┐
                    │       LLMClient.chat      │  execution — per call
                    │  (context-fit safety net) │  · token estimate → truncate → cap
                    └─────────────┬─────────────┘  · overflow → 413 + audit + alert
                                  │
           vLLM serve → LiteLLM proxy (OpenAI-compatible endpoint)
```

- **단일 실행 경로** — 과거의 전략별 계층(생성-검증, 에이전트 루프, 사고, 다이렉트)은 폐기되었다. `message-pipeline`은 로컬 모델과 외부 모델을 상시 MCP 도구 루프를 갖춘 단일 `streamFromExternalProvider` 디스패치로 보낸다. `ExecutionPlanBuilder`는 이제 인가된 커스텀 에이전트만 로드한다. 토론과 딥 리서치는 디스패치 전에 가로채는 별도 모드로 남아 있다.
- **컨텍스트 적합 안전망** — 진입 시 프롬프트 토큰(이미지 포함)을 추정한다. 유효 **262K** 윈도를 초과하면 입력을 잘라내고 → `max_tokens`를 줄이며 → 극단적인 경우 `ContextOverflowError`가 **HTTP 413**을 반환하며 감사 기록과 자동 웹훅 알림을 남긴다.
- **사용자 커스터마이즈(4개 직교 축)** — **모델**(선택기) · **스타일**(간결 / 기본 / 상세) · **모드**(토론 / 사고 / 딥 리서치 / 웹 / 에이전트 작업) · **커스텀 지시 & 에이전트**. 시스템 프롬프트 조립 순서: `memory + custom-instructions + style`.
- **역할별 모델 오케스트레이션** — LLM을 호출하는 모든 하위 시스템은 단일 역할 레지스트리를 통해 모델을 해석하며, 페일오픈 폴백 체인을 갖는다: 사용자별 매핑 → 관리자 설정 전역(DB) → 전역 env → 로컬 기본. 역할별 외부 모델은 사용자의 BYOK 키로 실행되거나, 전역 역할의 경우 서버 공유 운영자 키(일/월 토큰 예산 포함)로 실행된다. 커스텀 에이전트도 자신의 모델을 고정할 수 있다.
- **대화 간 메모리** — 명시적 장기 메모리는 시스템 프롬프트에 주입되며, 프라이버시 토글로 사용자가 세션별로 이를 제외할 수 있다.
- **사고 표시(Claude 웹 스타일)** — 사고 모드가 켜지면 추론 스트림이 실시간 타임라인으로 렌더링된다. 전용 `summary` 역할 모델이 한 줄 헤드라인(중간 스트리밍 → 최종)을 생성하고, 추론과 헤드라인이 모두 영속화되어 대화를 다시 열면 타임라인이 복원된다.

---

## 기능

**▸ 모델 & 라우팅**
- 로컬 모델과 외부 모델은 프로바이더 게이트가 걸린 `message-pipeline`과 도구 루프를 공유한다. 동작은 직교 축(모델 · 스타일 · 모드 · 커스텀 에이전트)으로 제어된다.
- 셀프 호스팅 vLLM + LiteLLM(기본 `qwen3.8-27b`)과 출력 토큰을 보호하고 오버플로 시 우아하게 저하되는 컨텍스트 적합 안전망.
- 외부 키 직접 등록(BYOK) — **OpenRouter, NVIDIA NIM, Ollama**(로컬 + 클라우드), 모두 OpenAI 호환(Anthropic 어댑터는 프로바이더 추상화에 내장) — 저장 시 AES-256-GCM으로 암호화. **게스트는 기본 로컬 모델만 사용**하며, 외부 프로바이더는 로그인이 필요하다.
- **역할별 모델 오케스트레이션** — 설정을 통해 각 기능 역할(`agent`, `judge`, `research`, `spawn`, `review`, `summary`)에 서로 다른 모델(로컬 또는 BYOK 외부)을 배정한다. 관리자는 조직 전역 기본값을 설정하고, 관리자 콘솔에서 키별 토큰 예산이 걸린 서버 공유 외부 키를 등록한다. 해석은 페일오픈이다(어떤 실패에서든 로컬 기본값으로 폴백). 모델 목록은 실제로 도달 가능하고 역할 수행이 가능한 것만 필터링해 보여준다.
- **외부 프로바이더 스로틀링** — 프로바이더별 동시성 제한과 429 시 지수 백오프(`Retry-After` 존중)로, 토론이나 딥 리서치 팬아웃이 몰려도 BYOK 키가 속도 제한에 걸리지 않게 한다. UI의 추론 노력 설정(낮음 / 중간 / 높음)은 OpenAI 호환 외부 프로바이더에 `reasoning_effort`로 전달되고, 로컬 모델은 사고 ON/OFF에 맞는 샘플링 프리셋을 받는다.
- **테일 라우팅(옵트인, 기본 꺼짐)** — 경량 게이트가 각 질의의 오답 가능성을 채점한다. 질의를 *사실성 테일*(오답 가능성이 높고 외부 검증이 가능)로 판단하면, 첫 턴에 `web_search`가 결정적으로 강제된다. 게이트 결정을 동작 변경 없이 기록하는 섀도 모드(`TAIL_ROUTING_SHADOW_ENABLED`)를 함께 제공하므로, `TAIL_ROUTING_STAGE2B_ENABLED`를 켜기 전에 실제 트래픽에서 임계값을 튜닝할 수 있다.

**▸ 에이전트 & 리서치**
- **자율 에이전트 작업** — Manus 스타일 에이전트가 **영속 Docker 샌드박스**(셸, Python, 브라우저, 파일, 계획 도구) 안에서 여러 도구 호출 턴에 걸쳐 목표를 추구하며, 사람 개입 승인을 거친다. 파일 첨부를 기록하고, 비전 채널로 이미지를 주입하며, **Excel(.xlsx)**과 **PDF**(한국어/CJK 폰트 포함)를 포함한 산출물을 생성하고, 거짓으로 "완료" 표시를 하는 대신 미달성을 정직하게 보고한다(`[GOAL_INCOMPLETE]` 마커 + 목표 심판). 작업은 **재사용 가능한 템플릿**으로 저장하거나 **반복 스케줄**에 올릴 수 있다.
- **딥 리서치** — 팬아웃 웹 검색 → 출처 수집 → 주장 검증 → 출처 표기 종합.
- **리포트 파이프라인** — 리포트 의도 질의("X를 조사해 리포트를 작성해")에서 모델은 **데이터(JSON)만** 생성하고, 서버가 이를 고정된 디자인 템플릿을 통해 HTML 산출물로 렌더링한다(*렌더러가 디자인을 소유* — 일관된 편집 레이아웃, KPI 타일, 표, 의존성 없는 SVG 차트, 출처 표기. 모든 모델 문자열은 이스케이프된다). 독립적인 리서치형 리포트 요청은 더 많은 리서치 턴을 위해 자동으로 에이전트 작업에 위임되며, 동일한 계약이 에이전트 작업 산출물에도 적용된다. 실패는 페일오픈이다. 유효한 데이터 블록이 없으면 응답은 일반 채팅으로 스트리밍된다.
- **커스텀 에이전트 & 스킬** — 컴포저에서 바로 선택 가능한 프로젝트 범위 에이전트(claude.ai Projects 대응)로, 각각 선택적으로 자신의 모델에 고정할 수 있으며, 자동 선택 가능한 스킬 라이브러리와 내장 산업 에이전트 18개(전문가 100명)를 더한다.

**▸ 도구 & 확장성**
- **MCP 도구 시스템** — 내장 도구 22종(웹 검색, 팩트 체크, 웹 스크레이프/맵/크롤, 이미지 분석, 에이전트 작업 제어, 스킬/에이전트/MCP git 인제스트 등)에 더해 외부 MCP 서버를 지원하며, 각각 Docker로 격리된다(`--cap-drop ALL`, 비루트, `--memory`+`--memory-swap`, 네트워크 정책, realpath로 가드된 마운트). **설정 → 커넥터**의 MCP 카탈로그에서 서버를 설치한다(Tavily, Sentry, Context7 등이 시드로 제공. `{{env.KEY}}` 시크릿은 셸 변수 참조로 전달되며 argv에 절대 구워 넣지 않는다). 카탈로그 수준의 **도구 허용 목록**은 채팅 자동 노출을 집중시키는데(도구 39개짜리 서버가 모든 프롬프트에 39개 스키마를 쏟아낼 필요는 없다), REST 실행과 명시적 도구 선택기는 전체 접근을 유지한다.
- **NotebookLM 그라운딩** — 사용자의 Google 세션 쿠키(AES-256-GCM 암호화, 스폰 시에만 주입)로 NotebookLM 커넥터를 설치한 뒤, 컴포저에서 노트북을 고정한다. 그라운딩 프리픽스는 LLM 전용 채널을 타므로 저장 메시지와 사이드바 제목은 깔끔하게 유지되며, 고정은 한 대화로 범위가 한정된다.
- **산출물(Artifacts)** — 실시간 샌드박스 iframe 렌더링, 선택적 Docker 코드 실행(Python / JS), 크기 조절 가능한 사이드 패널, 그리고 게시용의 별도 오리진 엄격 CSP 공유 뷰어. OpenAI 호환 API는 산출물을 `message.artifacts` 확장으로 반환하며, `publish_artifacts: true`를 주면 스스로 게시할 수 없는 API 키 클라이언트를 위해 서버가 공유 링크를 발행한다.
- **PDF / DOCX 내보내기** — 모든 HTML 산출물(채팅 또는 에이전트 작업 산출물)은 헤드리스 Chromium 인쇄로 **PDF**로 내보낸다(CJK 폰트 포함). 리포트 산출물은 구조화된 원본 데이터(`artifacts.source_data`)를 유지하여 `python-docx`로 고충실도 **DOCX** 생성을 가능하게 한다. 두 변환 모두 소유자 범위의 속도 제한 엔드포인트 뒤에서 Docker 샌드박스(`--network none`, `--cap-drop ALL`, 메모리/pids 상한) 안에서 일회성으로 실행된다.
- **메모리 & 지시** — 영속적인 대화 간 메모리(세션별 사용 토글 포함)와 상시 커스텀 지시.
- **사고 표시** — 전용 요약 모델이 생성하는 실시간 한 줄 헤드라인을 갖춘 Claude 웹 스타일 추론 타임라인. 영속화되어 다시 열면 복원된다.
- **다국어 UI** — `next-intl`을 통한 한국어, 영어, 일본어, 중국어 간체(쿠키 기반 로케일, 브라우저 자동 감지, 로케일 인식 날짜/숫자 서식).

**▸ 통합**
- **Discord 게이트웨이 봇**(`apps/discord-bot`) — Discord 메시지를 `/api/v1/chat/completions`로 중계하는 선택적 독립 워크스페이스로, 사용자별 세션 격리(`/reset`), 역할/멘션 접근 제어, API 키 인증을 갖는다. 생성된 이미지와 산출물은 실제 Discord 파일 첨부(공유 링크 포함)로 돌아온다. Discord는 API의 상대 경로나 플레이스홀더를 렌더링하지 못하기 때문이다. 자체 PM2 프로세스로 실행된다.
- **OpenMake Bench** — [bench.openmake.cc](https://bench.openmake.cc)는 API의 웹 SSO 클라이언트로 로그인하고 실시간 갱신되는 `/v1/models` 목록을 읽는다. OpenAI 호환 API는 벤치마크 클라이언트를 위한 로 모드(raw mode)도 제공한다.
- **네이티브 클라이언트** — `apps/desktop-native`(OpenMake Companion, SwiftUI 메뉴바: 폴더 연결, 기기 상태, 실행 승인, 작업 완료 알림, 웹 딥 링크), `apps/cli`(OpenMake Code, 서버 샌드박스 대신 사용자 머신에서 에이전트 도구 호출을 실행하는 로컬 브리지), `apps/ios`(SwiftUI 클라이언트, 진행 중). 셋 모두 웹 앱과 Instrument 디자인 토큰을 공유한다.
- **NotebookLM** — `GET /api/mcp/notebooklm/notebooks`가 컴포저 선택기를 뒷받침한다(사용자별 캐시, 업스트림 실패는 `502 NOTEBOOKLM_UPSTREAM`으로 수렴시켜 Google 쿠키 만료 시 UI가 재연결을 유도할 수 있게 한다).

**▸ 보안**
- HttpOnly 쿠키의 JWT, Google OAuth 2.0, RBAC, 사용자별·라우트별 속도 제한, SSRF 가드, Helmet 헤더, 그리고 통합된 감사 ↔ 알림 파이프라인.

---

## 기술 스택

| 계층 | 기술 |
|---|---|
| **백엔드** | Node.js (≥24), Express 5, TypeScript (strict, CommonJS), Zod, Winston |
| **프런트엔드** | Next.js 16, React 19, Zustand 5, Tailwind CSS 4, `next-intl`; Instrument 디자인 시스템(코발트 프라이머리 · 시안 보조, IBM Plex Mono) |
| **데이터베이스** | `pg`를 통한 PostgreSQL — 로(raw), 파라미터화 SQL(ORM 없음) |
| **실시간** | 스트림 분리/재개를 갖춘 WebSocket(`ws`) 스트리밍 채팅 — 백그라운드로 넘어간 탭이나 앱이 응답을 잃지 않고 재연결 |
| **LLM 백엔드** | vLLM + LiteLLM(OpenAI 호환); 외부 프로바이더용 `@anthropic-ai/sdk`, `openai` |
| **에이전트 / 도구** | Model Context Protocol(`@modelcontextprotocol/sdk`), Docker 격리 샌드박스 |
| **통합** | Discord 게이트웨이 봇(`discord.js`) — 선택적 독립 워크스페이스; 웹 SSO를 통한 OpenMake Bench |
| **네이티브 클라이언트** | SwiftUI(macOS Companion, iOS), `packages/local-bridge-core`를 공유하는 Node CLI(`apps/cli`) |
| **인증 / 보안** | `jsonwebtoken`, Google OAuth 2.0, Helmet, AES-256-GCM |
| **인프라** | PM2(API · 웹 · Discord 봇) + Docker(PostgreSQL/Redis, MCP / 에이전트 / 산출물 샌드박스) |
| **테스트 / CI** | Jest/ts-jest, Playwright, ESLint, GitHub Actions(CI Gate) |

---

## 시작하기

지원 플랫폼: **Linux**와 **macOS**(Intel & Apple Silicon).

### 설치(한 줄 명령)

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
```

클론이 필요 없다 — 설치 스크립트가 리포지토리 밖에서 실행되고 있음을 감지하면 소스를
`~/openmake_llm`으로 가져오고(재정의는 `OMK_HOME=...`; `OMK_REF=...`로 브랜치나 태그 선택)
그곳에서 스스로를 다시 실행한다. 파이프로 실행해도 `/dev/tty`를 통해 대화형으로 프롬프트가
뜨며, 터미널이 아닌 환경(CI)에서는 프롬프트가 자동 승인된다. 고전적인 방식이 더 좋다면
예전 그대로 동작한다:

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
./install.sh
```

**Windows**에서는 동일한 한 줄 명령을 **WSL2**(Ubuntu) 안에서 실행한다 — 설치 스크립트가
네이티브 Windows 셸을 감지하면 대신 WSL2 설정 단계를 출력한다.

이게 전부다. 설치 스크립트는 툴체인(Node 24, Docker, PM2 — 없는 것은 가능한 한 `sudo` 없이
설치)을 점검하고, 새로 무작위 생성한 시크릿으로 `.env`를 만들며, 의존성을 설치하고,
PostgreSQL + Redis를 시작하고, 모든 마이그레이션을 적용하고, 두 앱을 빌드하고, PM2로 실행한
뒤 `/health`를 기다린다. 마지막에 웹 URL과 생성된 관리자 비밀번호를 출력한다.

질문은 하나뿐이다 — 어떤 OpenAI 호환 LLM 엔드포인트를 쓸지(Ollama / OpenRouter / 커스텀 /
나중에 결정). 모든 프롬프트를 건너뛰려면:

```bash
# 플래그는 한 줄 명령을 통해서도 그대로 전달된다:
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash -s -- --yes

./install.sh --yes                                    # 플레이스홀더 LLM, .env는 나중에 채움
./install.sh --yes \
  --llm-base-url https://openrouter.ai/api/v1 \
  --llm-api-key  sk-or-... \
  --llm-model    qwen/qwen3-235b-a22b
```

`./install.sh`를 다시 실행해도 안전하다 — 덮어쓰지 않고 복구한다. 유용한 플래그:
`--skip-docker`(Postgres/Redis를 직접 운영), `--skip-build`, `--no-start`,
`--force-env`, 그리고 아래의 포트 재정의. `./install.sh --help`를 참고한다.

이미 기본 포트에서 Postgres나 Redis를 운영 중인가? 5432/6379를 두고 다투는 대신 컨테이너를
옮겨라 — 포트는 `.env`에 기록되고, `openmake_llm.sh`가 그것을 다시 읽는다:

```bash
./install.sh --yes --postgres-port 55432 --redis-port 56379
```

macOS에서 설치 스크립트는 Docker Desktop, OrbStack, 또는 **Colima**와 함께 동작한다
(`brew install colima docker docker-compose` — 헤드리스, GUI 없음). Homebrew의 compose
플러그인이 docker CLI에 등록되어 있지 않으면, 설치 스크립트가 `~/.docker/config.json`에
`cliPluginsExtraDirs`를 대신 추가해 준다.

### 설치된 인스턴스 업데이트

```bash
./openmake_llm.sh update            # git pull (ff-only) → build → migrate → restart
./openmake_llm.sh update --yes      # 마이그레이션 확인을 건너뜀(비대화형)
```

`update`는 커밋되지 않은 변경이나 로컬 커밋이 갈라진 트리는 건드리기를 거부한다 — 사용자의
편집을 절대 덮어쓰지 않는다. 새로 받아온 것이 없으면 재배포를 건너뛴다(그래도 재배포하려면
`--force`). 타르볼 설치(git 없음)는 대신 `install.sh`를 다시 실행해야 하며, 이는 제자리에서
복구한다.

설치를 `main` 대신 릴리스로 고정하려면 한 줄 명령에 `OMK_REF`를 설정한다:

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh \
  | OMK_REF=v1.31.1 bash -s -- --yes
```

### 사전 요구사항(설치 스크립트가 처리)

- **git** — 새 macOS에서는 맨 처음 `git clone`이 Xcode Command Line Tools 설치
  대화상자를 띄운다. 한 번 승인하면 된다(또는 소스를 zip으로 대신 내려받는다).
  `install.sh` 자체는 git이 없어도 견딘다(빌드 메타데이터가 `unknown`으로 폴백)
- **Node.js** `>=24 <25` — `mise`/`fnm`/`nvm`, Homebrew, 또는 이들 중 아무것도 없으면
  로컬 `~/.openmake/node` 타르볼로 프로비저닝
- **Docker** — PostgreSQL/Redis와 MCP/에이전트 샌드박스에 필요하다. Linux에서는 설치
  스크립트가 공식 `get.docker.com` 스크립트 실행을 제안한다. macOS에서는 Docker Desktop
  이나 OrbStack이 필요하다. 참고: Docker Desktop의 **첫 실행**은 GUI 승인(권한 헬퍼)을
  요구할 수 있고 설치 스크립트의 약 60초 데몬 대기를 넘길 수 있다 — 그런 경우 Docker가
  시작을 마칠 때까지 기다렸다가 `./install.sh`를 다시 실행한다(반복해도 안전)
- OpenAI 호환 LLM 엔드포인트: 로컬 **vLLM + LiteLLM** 스택, **Ollama**, 또는 외부
  프로바이더 키

### 수동 설정

직접 배선하고 싶다면, `install.sh`는 다음 단계들의 읽기 쉬운 기록이다:

```bash
npm install
node scripts/setup/gen-env.mjs        # 생성된 시크릿을 갖춘 최소 .env
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis
npx ts-node apps/api/src/data/migrations/cli.ts migrate
npm run build && pm2 start ecosystem.config.js
```

> `--env-file .env`는 선택 사항이 아니다: Compose는 기본 `.env`를 compose 파일의 디렉터리
> (`infra/`) 기준으로 해석하므로, 이것이 없으면 `POSTGRES_PASSWORD`가 비어 시작이 실패한다.

`gen-env.mjs`는 부팅에 필요한 키만 기록한다. `.env.example`이 전체 레퍼런스다 —
필요에 따라 그곳에서 선택 블록(OAuth, 웹 검색, MCP 샌드박스, Discord 봇)을 복사해 온다:

| 변수 | 용도 |
|---|---|
| `PORT` | API 포트(기본 `52416`) |
| `DATABASE_URL` | PostgreSQL 연결 문자열(비밀번호는 `POSTGRES_PASSWORD`와 일치해야 함) |
| `JWT_SECRET` | JWT 서명 시크릿(≥32자) |
| `API_KEY_PEPPER` | API 키 해싱 페퍼 — 프로덕션에서 필수 |
| `TOKEN_ENCRYPTION_KEY` | 외부 프로바이더 자격 증명용 AES-256-GCM 키(정확히 64 hex) |
| `ADMIN_PASSWORD` | 부트스트랩 관리자 계정 비밀번호 — 프로덕션에서 필수 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` | LiteLLM 프록시 엔드포인트, 마스터 키, 기본 모델 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth(선택) |

### 실행

일상 운영은 `openmake_llm.sh`를 통하며, 이 스크립트는 세 계층(PostgreSQL → Redis → 앱)을
Linux와 macOS 양쪽에서 순서대로 처리한다:

```bash
./openmake_llm.sh start     # 전부 올린 뒤 로그를 스트리밍
./openmake_llm.sh status    # 계층별 포트 + docker + PM2 상태
./openmake_llm.sh logs      # 실시간 PM2 로그
./openmake_llm.sh health    # GET /health
./openmake_llm.sh deploy    # build + migrate + restart(코드 변경 적용)
./openmake_llm.sh stop      # 역순 종료
```

또는 각 조각을 직접 다룬다:

```bash
# 개발
npm run dev                 # API + 프런트엔드 함께
npm run dev:api             # 백엔드만(ts-node)
npm run dev:frontend-next   # 프런트엔드만(next dev)

# 프로덕션
npm run build               # 백엔드 + 프런트엔드
npm start                   # node apps/api/dist/server.js
```

재부팅에서 살아남으려면 PM2를 init 시스템에 등록한다 — `pm2 startup`(실행할 명령을 출력:
macOS는 `launchd`, Linux는 `systemd`), 그다음 `pm2 save`.

### 테스트 & 린트

```bash
npm test                    # Jest 단위 테스트(apps/api)
npm run test:e2e            # Playwright(chromium + webkit)
npm run lint                # ESLint
```

> `apps/api` 단위 테스트는 git에서 무시된다(로컬 전용). 따라서 갓 클론한 상태에서는 `npm
> test`가 "0 matches"를 보고한다 — 이는 정상이며, 설치가 깨진 것이 아니다. CI도 같은 방식으로
> 게이트를 건너뛴다.

### 데이터베이스 마이그레이션

`db/migrations/`의 파일은 **부팅 시 자동으로 적용**된다 — `db/init/` 베이스라인 스키마 이후,
대기 중인 마이그레이션이 PostgreSQL 어드바이저리 락(다중 인스턴스 시작을 직렬화) 아래에서
실행되며 실패는 빠르게 실패한다(fail fast). 옵트아웃하려면 `DB_AUTO_MIGRATE=false`를 설정하고
CLI로 수동 실행한다:

```bash
npx ts-node apps/api/src/data/migrations/cli.ts status    # 대기 중 표시
npx ts-node apps/api/src/data/migrations/cli.ts migrate   # 적용
```

롤백 스크립트는 `db/migrations/rollbacks/` 아래에 있다(정방향 마이그레이션 스캔에서 제외).

---

## 프로젝트 구조

```
openmake_llm/
├── apps/
│   ├── api/          # Express 5 + TypeScript API server (strict, CommonJS)
│   │   └── src/
│   │       ├── routes/ controllers/ services/   # REST + business logic
│   │       ├── chat/                            # ExecutionPlanBuilder, classifiers, prompts
│   │       ├── agents/                          # 18 industry agents, router, discussion engine
│   │       ├── llm/ providers/ cluster/         # LLM client, provider abstraction, node routing
│   │       ├── mcp/                             # MCP tool router, external client, Docker sandbox
│   │       ├── sockets/                         # WebSocket chat handler
│   │       ├── auth/ security/ middlewares/     # JWT/OAuth, SSRF guard, rate limiting
│   │       └── data/                            # PostgreSQL (raw SQL), migrations, repositories
│   ├── web/          # Next.js + React frontend (the operating UI)
│   ├── cli/          # OpenMake Code — local bridge CLI (run agent tasks in your own folder)
│   │                 # private workspace: build from source, see apps/cli/README.md
│   ├── desktop-native/ # OpenMake Companion — SwiftUI menu-bar app (macOS Apple Silicon)
│   ├── ios/          # SwiftUI iOS client (in progress)
│   ├── discord-bot/  # Optional Discord gateway bot (relays to /api/v1/chat/completions)
│   └── legacy-web/   # Static asset host (e.g. /generated) — legacy SPA retired
├── db/               # init schema + migrations (+ rollbacks/) — read at runtime
├── packages/         # shared-types, api-contracts, config, api-client, local-bridge-core (shared workspaces)
├── infra/            # Dockerfiles & compose (mcp-runtime, task-runtime, artifact-viewer, egress-proxy)
├── scripts/          # setup/ (gen-env.mjs) + host setup for the LLM backend — vLLM/LiteLLM
│                     # systemd units, serve scripts, litellm.config.yaml, Caddyfile, diagnostics
├── tests/            # Playwright E2E
├── install.sh        # one-shot installer (Linux/macOS): toolchain → .env → DB → build → PM2
├── openmake_llm.sh   # service manager: start/stop/restart/deploy/status/logs/health
└── ecosystem.config.js  # PM2 process definitions (API, Next frontend, optional Discord bot)
```

**실행 중인 서버가 실제로 필요로 하는 것:** 빌드된 `apps/api/dist` + `apps/web/.next`, `db/`(부팅 경로가 `db/init/`를 적용하고, 마이그레이션 CLI가 작업 디렉터리에서 `db/migrations/`를 해석), 그리고 Docker 격리 샌드박스를 위한 `infra/`. `scripts/`와 `tests/`는 어떤 런타임 코드에도 로드되지 *않는다* — 다만 `scripts/vllm/`와 `scripts/caddy/`는 추론 백엔드를 세우거나 재구축할 때 GPU 호스트로 복사하는 배포 산출물이므로 리포지토리와 함께 보관한다.

빌드, 마이그레이션, CI 진입점은 다른 곳에 있다: 빌드는 각 워크스페이스의 `package.json`에, 마이그레이션은 `apps/api/src/data/migrations/cli.ts`에, CI는 `.github/workflows/`에 있다.

---

## 기여

기여를 환영한다. 다음을 지켜주기 바란다:

- [Conventional Commits](https://www.conventionalcommits.org/)를 사용한다 — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- 기능/수정 브랜치에서 작업하고 `main`을 대상으로 PR을 연다.
- 코드 컨벤션을 따른다: TypeScript strict 모드, 입력 검증에 Zod, 로깅에 Winston, **로 파라미터화 SQL만**(ORM 없음), 그리고 외부화된 설정(하드코딩된 모델, 매직 넘버, 인라인 프롬프트 없음).

**PR을 열기 전에:**

- [ ] `npm run lint` 통과
- [ ] `npm test` 통과
- [ ] DB 스키마 변경에는 마이그레이션 파일 포함(시퀀스 충돌 없음)
- [ ] 새 env 변수는 `.env.example`에 문서화
- [ ] UI 변경에는 스크린샷 포함, 보안 변경에는 그 영향 설명

CI는 모든 푸시와 풀 리퀘스트에서 단일 **CI Gate**(Test → Build → Size → Lint)를 실행한다.

---

## 라이선스

**MIT License**로 배포된다 — 자세한 내용은 [LICENSE](LICENSE)를 참고한다.
