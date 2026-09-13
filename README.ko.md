<h1 align="center">OpenMake LLM</h1>

<p align="center">
  <strong>오픈 웨이트 모델과 BYOK 모델을 위한, 오픈소스·로컬 우선·셀프 호스팅 AI 워크스페이스.</strong><br/>
  vLLM/LiteLLM 추론 · 멀티모달 오케스트레이션 · 자율 에이전트 · MCP 도구 · 딥 리서치 · Docker 샌드박스.
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

**OpenMake LLM** 은 자신의 하드웨어에서 운영하는 셀프 호스팅 AI 어시스턴트입니다. 로컬 모델을 **vLLM** 으로 서빙하고 그 앞에 **LiteLLM 게이트웨이**(OpenAI 호환)를 두며, 직접 등록한 키로 쓰는 외부 provider — **OpenRouter, NVIDIA NIM, Ollama Cloud, Open AI Service Hub(hasa), B.AI** — 도 *같은* 게이트웨이로 보냅니다. **ChatGPT 구독 로그인**도 지원합니다. 기본적으로 데이터는 내 서버 밖으로 나가지 않습니다.

모든 채팅 턴은 가벼운 **메시지 파이프라인**(provider 게이트, 보안·언어 정책, 프롬프트·도구 조립)을 거쳐 로컬·외부 모델이 함께 쓰는 단일 실행 경로로 들어갑니다. *이 장면을 그려줘, 읽어줘, 이 영상 받아 적어줘, 짧은 영상 만들어줘* 처럼 텍스트 이상이 필요하면 **Planner** 가 작은 계획을 세우고, 해당 **capability** 작업이 배정된 모델에서 병렬로 실행된 뒤, 사용자가 고른 채팅 모델이 그 결과로 최종 답변을 씁니다. 동작은 불투명한 프리셋이 아니라 서로 독립적인 축 — **모델 · 응답 스타일 · 모드 토글 · 커스텀 에이전트** — 으로만 조절합니다.

채팅 외에도 Docker 샌드박스(또는 로컬 브리지를 통한 내 컴퓨터)에서 도는 자율 에이전트 작업, 딥 리서치, 원클릭 카탈로그가 있는 MCP 도구 시스템, Claude Code 형식의 플러그인·스킬을 설치하는 확장 시스템을 제공하며, 모두 JWT 인증과 역할 기반 접근 제어 뒤에 있습니다.

> **단일 호스트 설계:** 애플리케이션(API + 웹)은 **PM2** 로 실행하고, 상태를 가진 의존성(PostgreSQL / Redis)과 샌드박스로 격리되는 에이전트·MCP·아티팩트 프로세스는 **Docker** 에서 실행합니다.

**한눈에 보기**

| | |
|---|---|
| 🧠 **로컬 모델 + BYOK 게이트웨이** | vLLM + LiteLLM 으로 서빙하는 `qwen3.8-27b`, 262K 컨텍스트 안전망. 외부 provider 도 내 키로 같은 게이트웨이를 탑니다 |
| 🎨 **멀티모달 오케스트레이터** | Planner 가 요청을 이미지 생성·편집, 음성→텍스트, 텍스트→음성, 영상, 비전·OCR 작업으로 나눠 병렬 실행하고, 채팅 모델이 답변을 종합합니다 |
| 🎛️ **모델 역할 & capability** | 역할(에이전트·판정·리서치·서브에이전트·리뷰·요약·플래너)별, capability 별로 모델 지정. 사용자 설정 + 관리자 전역 기본값 |
| 🤖 **자율 에이전트** | 영속 Docker 샌드박스(셸 · Python · 브라우저 · 파일) 또는 **OpenMake Companion** / **OpenMake Code** CLI 로 연결한 로컬 폴더에서 여러 턴을 수행, 사람 승인 게이트 포함 |
| 🔬 **딥 리서치 & 보고서** | 병렬 웹 검색 → 출처 수집 → 인용 종합. 보고서 요청은 **PDF/DOCX** 로 내보낼 수 있는 HTML 아티팩트로 렌더링 |
| 🧩 **내장 도구 23종 + MCP** | 웹 검색·스크래핑·비전·계획·코드/보안 리뷰·스킬 로딩 등. 외부 MCP 서버는 각각 Docker 로 격리, 원격 서버는 OAuth 로그인 지원 |
| 📦 **확장 & 스킬** | Git 이나 마켓플레이스에서 플러그인·스킬·에이전트·MCP 서버를 설치 — 설치 시 Claude Code 관례를 이 환경에 맞게 변환 — 하고 **승인** 한 곳에서 검토 |
| ⚖️ **비교 모드** | 두 모델에 같은 질문을 던지고 답변을 나란히 비교 |
| 🖥️ **네이티브 클라이언트** | OpenMake Companion(SwiftUI 메뉴바 앱, macOS), OpenMake Code CLI, 개발 중인 SwiftUI iOS 클라이언트 — 채팅 자체는 웹 앱에 둡니다 |
| 🌐 **4개 언어 UI** | 한국어 · English · 日本語 · 简体中文 (`next-intl`, 브라우저 자동 감지). 답변은 사용자가 쓴 언어를 따릅니다 |
| 🔒 **보안 우선** | JWT(HttpOnly), Google OAuth 2.0, RBAC, 라우트별 레이트 리밋, SSRF 가드, AES-256-GCM 키 저장, Audit ↔ Alert |

---

## 데모

> 실제로 돌아가는 앱에서 녹화했고, 탭은 자동으로 넘어갑니다. 최근 대화 제목과 계정 이름은 가렸습니다.

<table>
  <tr>
    <td align="center">
      <img src="assets/demo-tour.gif" alt="데모 투어: 채팅, 멀티모달, 에이전트 작업, 설정, 언어" width="860" />
    </td>
  </tr>
  <tr>
    <td>
      <b>Chat</b> — 질문하면 답변이 스트리밍으로 이어지고, 모델·응답 스타일·추론 강도를 입력창에서 바로 바꿉니다<br/>
      <b>Multimodal</b> — “…한 이미지를 만들어줘” 가 이미지 생성 작업이 되어, 그 capability 에 배정된 모델에서 실행되고 대화 안에 표시됩니다<br/>
      <b>Agent tasks</b> — 승인 정책을 고른 Agent 모드가 목표를 샌드박스에서 실행하며 진행 상황을 보여주고 결과를 돌려줍니다<br/>
      <b>Settings</b> — 모델 역할, capability 별 모델 배정, MCP 카탈로그, 스킬 라이브러리<br/>
      <b>Languages</b> — 인터페이스는 브라우저 언어나 설정에서 고른 언어를 따릅니다
    </td>
  </tr>
</table>

---

## 아키텍처

OpenMake 는 **무엇을 실행할지 정하는 일**과 **모델을 호출하는 일**을 분리합니다. 특수 모드는 먼저 가로채고, 나머지는 모두 한 경로로 흐릅니다.

```
                             WebSocket / REST
                                     │
                       ┌─────────────▼─────────────┐
   Query ─────────────►│     message-pipeline      │  provider gate · security & language policy
                       └─────────────┬─────────────┘  prompt & tool assembly · custom agent
                                     │
                       ┌─────────────▼─────────────┐
                       │          Planner          │  one small JSON plan per turn
                       └──────┬──────────────┬─────┘
                        simple│              │multi
                              │   ┌──────────▼──────────┐
                              │   │  capability tasks   │  image · speech · video · vision
                              │   │  (run in parallel)  │  on the models you assigned
                              │   └──────────┬──────────┘
                       ┌──────▼──────────────▼─────┐
                       │ streamFromExternalProvider│  one path for local & external models
                       │   (always-on tool loop)   │  chat model writes the final answer
                       └─────────────┬─────────────┘
                                     │
                       ┌─────────────▼─────────────┐
                       │       LLMClient.chat      │  context-fit safety net
                       └─────────────┬─────────────┘  truncate → cap → 413 + audit
                                     │
                  LiteLLM gateway → vLLM (local) · BYOK external providers
```

- **단일 실행 경로** — 로컬·외부 모델이 `streamFromExternalProvider` 와 그 MCP 도구 루프를 함께 씁니다. 토론과 딥 리서치는 디스패치 전에 가로채는 별도 모드입니다.
- **Planner → capability → 종합** — `simple` 계획이면 추가 모델 호출이 없습니다. `multi` 계획은 실행 전에 배정·키 상태·게이트웨이 지원·쿼터를 확인하고, 의존 관계 단계별로 병렬 실행하며, 성공한 미디어만 답변에 붙입니다. 끝나지 않은 영상 작업은 보존했다가 다음 메시지에서 다시 제출하지 않고 이어받습니다.
- **모델 결정** — 모델을 호출하는 모든 하위 시스템은 역할·capability 레지스트리로 모델을 정합니다: 사용자 설정 → 관리자 전역 기본값 → 내장 기본값 순이며, 실패하면 로컬 모델로 돌아갑니다.
- **컨텍스트 안전망** — 진입 시 프롬프트 토큰(이미지 포함)을 추정하고, 유효 **262K** 창을 넘으면 입력을 줄이고 `max_tokens` 를 낮추며, 최후에는 감사 기록·알림과 함께 **HTTP 413** 을 돌려줍니다.
- **사용자 맞춤** — **모델** · **응답 스타일**(간결 / 기본 / 상세) · **모드**(토론 / Thinking / 답변 검증 / 딥 리서치 / 에이전트) · **커스텀 지시문 & 에이전트**, 그리고 선택적으로 켜는 대화 간 메모리.
- **끊겨도 이어지는 스트리밍** — 탭이 백그라운드로 가거나 앱 소켓이 끊겨도 생성은 계속되고, 다시 연결되면 같은 답변에 이어서 붙습니다.

---

## 기능

**▸ 모델 & 라우팅**
- 셀프 호스팅 vLLM + LiteLLM(기본 `qwen3.8-27b`)과, 출력 토큰을 보호하며 단계적으로 줄이는 컨텍스트 안전망.
- OpenRouter, NVIDIA NIM, Ollama Cloud, Open AI Service Hub(hasa), B.AI 에 **내 키 사용(BYOK)** — 모두 LiteLLM 게이트웨이를 거치고 키는 AES-256-GCM 으로 암호화 저장 — 에 더해 ChatGPT 구독 로그인. 게스트는 로컬 모델만 씁니다.
- **모델 역할** — `agent`, `judge`, `research`, `spawn`, `review`, `summary`, `planner` 마다 다른 모델을 지정. 관리자는 조직 전역 기본값을 두고 일/월 토큰 예산이 있는 서버 공용 키를 등록할 수 있습니다.
- **capability 별 모델** — 텍스트, 코드, 비전·OCR, 이미지 생성·편집, 음성→텍스트, 텍스트→음성, 영상 모델을 설정에서 묶음 단위로 고르고 항목별로 따로 지정할 수도 있습니다.
- **분명한 실패 사유** — 레이트 리밋, 크레딧 부족, 접근 제한 모델, 지원하지 않는 도구 정의를 뭉뚱그린 업스트림 오류가 아니라 그대로 알려주고, provider 별 동시 호출 상한은 `429` 에 물러섭니다.
- **비교 모드** — 같은 프롬프트를 두 모델로 나란히 실행.

**▸ 멀티모달**
- **Planner 기반 오케스트레이션** — 이미지 생성·편집(직전 이미지 참조), 오디오·영상 첨부의 음성→텍스트, 텍스트→음성, 영상 생성, 비전 설명·OCR 을 병렬 실행 가능한 capability 작업으로 처리합니다.
- 채팅 모델이 이미지를 볼 수 없으면 비전 모델이 먼저 이미지를 설명하고, 채팅 모델은 그 기록을 근거로 답합니다.
- 생성된 미디어는 `/generated` 에서 서빙되고 보존 기간이 지나면 자동 정리되며, 사용량과 계획 소요 시간은 비용 검토용으로 기록됩니다.

**▸ 에이전트 & 리서치**
- **자율 에이전트 작업** — **영속 Docker 샌드박스**(셸, Python, 브라우저, 파일, 계획, 코드 탐색)에서 목표를 여러 턴에 걸쳐 수행하며, 승인 정책은 **Manual / Auto / Skip**. 파일·이미지를 첨부하고 **Excel**, **PDF** 같은 산출물을 받으며, 달성하지 못하면 거짓 "완료" 대신 목표 판정 결과를 그대로 보여줍니다. 작업을 **템플릿**으로 저장하거나 **예약** 실행하고, 실행 결과를 **공유**할 수 있습니다.
- **로컬 실행** — **OpenMake Companion**(macOS 메뉴바 앱)이나 **OpenMake Code** CLI 로 내 컴퓨터의 폴더를 연결하면, 도구 호출이 그 폴더 안에서 경로 제한·명령 확인 게이트·git worktree 격리와 함께 실행됩니다.
- **병렬 서브에이전트** — 서로 독립적인 하위 작업을 여러 서브에이전트에 나눠 맡기고 결과를 합칩니다.
- **딥 리서치** — 주제 분해, 병렬 웹 검색(SearXNG, 네이버, 다음 등), 청크 요약, 인용이 달린 보고서.
- **보고서 파이프라인** — 보고서 요청은 구조화 데이터를 만들고, 서버가 고정 템플릿으로 HTML 아티팩트를 렌더링해 **PDF**, **DOCX** 로 내보낼 수 있습니다.
- **커스텀 에이전트** — 입력창에서 고르는 프로젝트형 페르소나. 에이전트마다 모델을 고정할 수 있고, 18개 산업 에이전트(전문가 100명)가 기본 제공됩니다.

**▸ 도구 & 확장**
- **내장 도구 23종** — 웹 검색, 사실 확인, 페이지 추출, 스크랩·맵·크롤, 이미지 분석·OCR, 에이전트 작업 조회, 계획, 코드·보안 리뷰, 스킬 생성·로딩, 스킬·에이전트·MCP 서버·확장 Git 가져오기, MCP 메타 도구, 관리자 전용 운영 지표 도구. 프롬프트를 작게 유지하려고 필요한 턴에만 노출합니다.
- **외부 MCP 서버** — 샌드박스를 켜면(생성되는 설정의 기본값) stdio 서버가 Docker 에서 `--cap-drop ALL`, non-root, 메모리·네트워크 제한, 선택적 읽기 전용 루트 파일시스템으로 실행됩니다. **MCP 카탈로그**(Tavily, Context7, Notion, NotebookLM, 카카오맵, OpenDART, 공공데이터 API 등)에서 설치하고, 원격 서버는 **OAuth** 로 로그인합니다.
- **확장** — Git, zip, 마켓플레이스에서 플러그인·스킬·커스텀 에이전트·MCP 서버를 설치합니다. Claude Code 관례(도구 이름, `$ARGUMENTS`, `commands/`, `agents/`, 번들 스크립트)는 설치 시 변환되고, 검토가 필요한 항목은 모두 **승인** 화면에 모입니다.
- **스킬** — 도구 바인딩이 있는 재사용 매니페스트. `/skill-name` 으로 부르거나 관련 질문에서 모델이 고릅니다.
- **아티팩트** — 샌드박스 라이브 미리보기, 선택적 Docker 코드 실행, 게시용 별도 origin 뷰어.
- **NotebookLM 그라운딩** — 입력창에서 내 노트북 하나를 대화 컨텍스트로 고정합니다.
- **메모리·지시문·알림** — 선택적으로 켜는 대화 간 메모리, 항상 적용되는 커스텀 지시문, 에이전트 작업이 승인을 기다리거나 끝나면 오는 웹 푸시 알림.

**▸ 연동**
- API 키와 스코프를 쓰는 **OpenAI 호환 API**(`/api/v1/chat/completions`).
- 사용자별 세션과 파일 첨부를 지원하며 API 로 메시지를 전달하는 **Discord 게이트웨이 봇**(`apps/discord-bot`).
- **OpenMake Bench** — [bench.openmake.cc](https://bench.openmake.cc) 는 웹 SSO 로 로그인하며, 거기서 고른 모델을 내 모델 역할에 적용할 수 있습니다.

**▸ 보안**
- HttpOnly 쿠키 JWT, Google OAuth 2.0, RBAC, 사용자·라우트별 레이트 리밋, SSRF 가드, Helmet 헤더, 에이전트 도구의 자격증명 파일 보호, 통합 Audit ↔ Alert 파이프라인.

---

## 기술 스택

| 계층 | 기술 |
|---|---|
| **백엔드** | Node.js (≥24), Express 5, TypeScript (strict, CommonJS), Zod 4, Winston |
| **프론트엔드** | Next.js 16, React 19, Zustand 5, Tailwind CSS 4, `next-intl`; Instrument 디자인 시스템 |
| **데이터베이스** | `pg` 기반 PostgreSQL — 파라미터화된 raw SQL (ORM 없음) |
| **실시간** | 끊김 후 이어받기(detach/resume)를 지원하는 WebSocket(`ws`) 스트리밍 |
| **LLM 백엔드** | vLLM + LiteLLM 게이트웨이 (OpenAI 호환); 외부 provider 는 `openai` SDK |
| **에이전트 / 도구** | Model Context Protocol (`@modelcontextprotocol/client` v2), Docker 격리 샌드박스 |
| **네이티브 클라이언트** | SwiftUI (macOS Companion, iOS), `packages/local-bridge-core` 를 공유하는 Node CLI (`apps/cli`) |
| **연동** | Discord 게이트웨이 봇 (`discord.js`); 웹 SSO 로 연결되는 OpenMake Bench |
| **인증 / 보안** | `jsonwebtoken`, Google OAuth 2.0, Helmet, AES-256-GCM |
| **인프라** | PM2 (API · 웹 · Discord 봇) + Docker (PostgreSQL/Redis, MCP / 에이전트 / 아티팩트 샌드박스) |
| **테스트 / CI** | Jest/ts-jest, Playwright, ESLint, GitHub Actions (CI Gate) |

---

## 시작하기

지원 플랫폼: **Linux** 와 **macOS** (Intel & Apple Silicon).

### 설치(한 줄 명령)

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash
```

클론할 필요가 없습니다. 설치 스크립트가 저장소 밖에서 실행된 것을 감지하면 소스를
`~/.openmake/chat` 에 받아(`OMK_HOME=...` 으로 위치 변경, `OMK_REF=...` 로 브랜치·태그 선택)
그 안에서 다시 실행합니다. 같은 호스트에 두 번째 사본을 띄우려면 `--instance NAME`
(`... | bash -s -- --instance NAME`)을 붙이세요. `~/.openmake/chat-NAME` 에 전용 포트(52417/3010),
데이터베이스, Redis, PM2 이름(`openmake-llm-NAME`)으로 설치됩니다. `--public-url https://chat.example.com`
은 공개 주소를 `.env` 에 쓰고, HTTPS 면 secure 쿠키로 전환합니다. 파이프로 실행해도 `/dev/tty` 로
대화형 질문을 하며, 터미널이 없는 환경(CI)에서는 자동 승인합니다. 기존 방식도 그대로 됩니다:

```bash
git clone https://github.com/openmake/openmake_llm.git
cd openmake_llm
./install.sh
```

**Windows** 에서는 **WSL2**(Ubuntu) 안에서 같은 한 줄 명령을 실행하세요. 네이티브 Windows 셸을 감지하면
WSL2 설정 절차를 대신 안내합니다.

이게 전부입니다. 설치 스크립트는 도구 체인(Node 24, Docker, PM2 — 없으면 가능한 한 `sudo` 없이 설치)을
확인하고, 무작위 시크릿으로 `.env` 를 만들고, 의존성을 설치하고, PostgreSQL + Redis 를 시작하고,
마이그레이션을 적용하고, 두 앱을 빌드해 PM2 로 띄운 뒤 `/health` 를 기다립니다. 마지막에 웹 주소와
생성된 관리자 비밀번호를 출력합니다.

질문은 하나뿐입니다 — 어떤 OpenAI 호환 LLM 엔드포인트를 쓸지(Ollama / OpenRouter / 직접 입력 /
나중에). 모든 질문을 건너뛰려면:

```bash
# 플래그는 한 줄 명령을 통해서도 그대로 전달된다:
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh | bash -s -- --yes

./install.sh --yes                                    # 임시 LLM 설정, .env 는 나중에 채움
./install.sh --yes \
  --llm-base-url https://openrouter.ai/api/v1 \
  --llm-api-key  sk-or-... \
  --llm-model    qwen/qwen3-235b-a22b
```

`./install.sh` 를 다시 실행해도 안전합니다 — 덮어쓰지 않고 고칩니다. 유용한 플래그:
`--skip-docker`(Postgres/Redis 직접 운영), `--skip-build`, `--no-start`, `--force-env`, 그리고
아래 포트 지정. `./install.sh --help` 를 참고하세요.

기본 포트에 이미 Postgres 나 Redis 가 있다면 5432/6379 를 두고 다투지 말고 컨테이너 포트를 옮기세요.
포트는 `.env` 에 기록되고 `openmake_llm.sh` 가 다시 읽습니다:

```bash
./install.sh --yes --postgres-port 55432 --redis-port 56379
```

macOS 에서는 Docker Desktop, OrbStack, **Colima**(`brew install colima docker docker-compose` —
GUI 없는 헤드리스)를 모두 지원합니다. Homebrew 의 compose 플러그인이 docker CLI 에 등록돼 있지 않으면
설치 스크립트가 `~/.docker/config.json` 에 `cliPluginsExtraDirs` 를 추가합니다.

관리자 계정이 아직 없으면 웹 앱이 일회성 **셋업 페이지**를 열어, 관리자를 만들고 필요하면 LLM 게이트웨이도
설정할 수 있습니다.

### 설치된 인스턴스 업데이트

```bash
./openmake_llm.sh update            # git pull (ff-only) → 빌드 → 마이그레이션 → 재시작
./openmake_llm.sh update --yes      # 마이그레이션 확인 생략 (비대화형)
```

`update` 는 커밋하지 않은 변경이나 갈라진 로컬 커밋이 있으면 손대지 않습니다 — 편집한 내용을 덮어쓰지
않습니다. 새로 받은 것이 없으면 재배포를 건너뜁니다(강제로 재배포하려면 `--force`). git 없이 tarball 로
설치했다면 대신 `install.sh` 를 다시 실행하세요(제자리에서 고칩니다).

`main` 대신 특정 릴리스로 고정하려면 한 줄 명령에 `OMK_REF` 를 지정합니다:

```bash
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/install.sh \
  | OMK_REF=v1.62.3 bash -s -- --yes
```

### 사전 요구사항(설치 스크립트가 처리)

- **git** — 새 macOS 에서는 첫 `git clone` 이 Xcode Command Line Tools 설치 창을 띄웁니다. 한 번 승인하거나
  소스를 zip 으로 받으세요. `install.sh` 자체는 git 이 없어도 동작합니다(빌드 메타데이터가 `unknown`)
- **Node.js** `>=24 <25` — `mise`/`fnm`/`nvm`, Homebrew, 또는 셋 다 없으면 로컬 `~/.openmake/node` tarball 로 준비
- **Docker** — PostgreSQL/Redis 와 MCP·에이전트 샌드박스에 필요합니다. Linux 에서는 공식 `get.docker.com`
  스크립트 실행을 제안하고, macOS 에서는 Docker Desktop, OrbStack, Colima 중 하나가 필요합니다. 참고: Docker
  Desktop 의 **첫 실행**은 GUI 승인(권한 헬퍼)을 요구해 설치 스크립트의 약 60초 대기를 넘길 수 있습니다 — 그러면
  Docker 가 다 뜬 뒤 `./install.sh` 를 다시 실행하세요(반복해도 안전)
- OpenAI 호환 LLM 엔드포인트: 로컬 **vLLM + LiteLLM** 스택, **Ollama**, 또는 외부 provider 키

### 수동 설정

직접 구성하고 싶다면 `install.sh` 가 다음 단계를 그대로 읽을 수 있게 담고 있습니다:

```bash
npm install
node scripts/setup/gen-env.mjs        # 시크릿이 생성된 최소 .env
docker compose --env-file .env -f infra/docker-compose.yml up -d postgres redis
npm run build && pm2 start ecosystem.config.js   # 마이그레이션은 부팅 시 자동 적용
```

> `--env-file .env` 는 생략할 수 없습니다. Compose 는 기본 `.env` 를 compose 파일이 있는 디렉토리(`infra/`)
> 기준으로 찾기 때문에, 없으면 `POSTGRES_PASSWORD` 가 비어 시작이 실패합니다.

`gen-env.mjs` 는 부팅에 필요한 키만 씁니다(서버도 첫 시작 때 없는 `JWT_SECRET` / `API_KEY_PEPPER` /
`TOKEN_ENCRYPTION_KEY` 를 생성합니다). `.env.example` 이 전체 참고 문서이니 필요한 선택 블록(OAuth, 웹 검색,
MCP 샌드박스, Discord 봇)을 복사해 쓰세요:

| 변수 | 용도 |
|---|---|
| `PORT` | API 포트 (기본 `52416`) |
| `DATABASE_URL` | PostgreSQL 연결 문자열 (비밀번호는 `POSTGRES_PASSWORD` 와 일치) |
| `JWT_SECRET` | JWT 서명 시크릿 (32자 이상) |
| `API_KEY_PEPPER` | API 키 해싱 pepper |
| `TOKEN_ENCRYPTION_KEY` | 외부 provider 자격증명용 AES-256-GCM 키 (정확히 64 hex) |
| `ADMIN_PASSWORD` | 선택: 부트스트랩 관리자 비밀번호 — 비워 두면 셋업 페이지에서 관리자를 만듭니다 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` | LiteLLM 게이트웨이 엔드포인트, 마스터 키, 기본 모델 |
| `LLM_GATEWAY_PROVIDERS` | 게이트웨이로 보낼 외부 provider id (쉼표 구분) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth (선택) |

많은 운영 설정은 **관리자 → 시스템 설정**에서 실행 중에 바꿀 수 있습니다(데이터베이스 값이 `.env` 보다 우선).

### 실행

일상 운영은 PostgreSQL → Redis → 앱 세 계층을 순서대로 다루는 `openmake_llm.sh` 로 합니다(Linux·macOS 공통):

```bash
./openmake_llm.sh start     # 전체 기동 후 로그 출력
./openmake_llm.sh status    # 계층별 포트 + docker + PM2 상태
./openmake_llm.sh logs      # 실시간 PM2 로그
./openmake_llm.sh health    # GET /health
./openmake_llm.sh deploy    # 빌드 + 마이그레이션 + 재시작 (코드 변경 반영)
./openmake_llm.sh stop      # 역순 종료
```

또는 각 부분을 직접 실행합니다:

```bash
# 개발
npm run dev                 # API + 프론트엔드 동시 실행
npm run dev:api             # 백엔드만 (ts-node)
npm run dev:frontend-next   # 프론트엔드만 (next dev)

# 프로덕션
npm run build               # 공유 패키지 + 백엔드 + 프론트엔드
npm start                   # node apps/api/dist/server.js
```

재부팅 후에도 살아 있게 하려면 PM2 를 init 시스템에 등록하세요 — `pm2 startup`(실행할 명령을 출력합니다:
macOS 는 `launchd`, Linux 는 `systemd`) 후 `pm2 save`.

### 테스트 & 린트

```bash
npm test                    # 공유 패키지 빌드 후 Jest 단위 테스트 (apps/api)
npm run test:e2e            # Playwright (chromium + webkit)
npm run lint                # ESLint
```

### 데이터베이스 마이그레이션

`db/migrations/` 의 파일은 **부팅 시 자동으로 적용**됩니다 — `db/init/` 기준 스키마 다음에, 대기 중인 마이그레이션이 PostgreSQL advisory lock(여러 인스턴스 동시 기동을 직렬화) 아래에서 실행되고 실패하면 즉시 멈춥니다. 끄려면 `DB_AUTO_MIGRATE=false` 로 두고 CLI 로 직접 실행하세요:

```bash
npx ts-node apps/api/src/data/migrations/cli.ts status    # 대기 중인 항목 표시
npx ts-node apps/api/src/data/migrations/cli.ts migrate   # 적용
```

롤백 스크립트는 `db/migrations/rollbacks/` 에 있습니다(정방향 마이그레이션 스캔에서 제외).

---

## 프로젝트 구조

```
openmake_llm/
├── apps/
│   ├── api/          # Express 5 + TypeScript API 서버 (strict, CommonJS)
│   │   └── src/
│   │       ├── routes/ controllers/ services/   # REST + 비즈니스 로직
│   │       ├── services/orchestrator/           # Planner, capability 실행기, 사전 점검
│   │       ├── chat/                            # 파이프라인 헬퍼, 분류기, 프롬프트
│   │       ├── agents/                          # 산업 에이전트, 토론 엔진, 스킬, git 가져오기
│   │       ├── llm/ providers/ cluster/         # LLM 클라이언트, provider 추상화, 노드 라우팅
│   │       ├── mcp/                             # MCP 도구 라우터, 외부 클라이언트, Docker 샌드박스
│   │       ├── sockets/                         # WebSocket 채팅·로컬 브리지 핸들러
│   │       ├── auth/ security/ middlewares/     # JWT/OAuth, SSRF 가드, 레이트 리밋
│   │       └── data/                            # PostgreSQL (raw SQL), 마이그레이션, 리포지토리
│   ├── web/          # Next.js + React 프론트엔드 (운영 UI)
│   ├── cli/          # OpenMake Code — 로컬 브리지 CLI (소스에서 빌드, apps/cli/README.md 참고)
│   ├── desktop-native/ # OpenMake Companion — SwiftUI 메뉴바 앱 (macOS)
│   ├── ios/          # SwiftUI iOS 클라이언트 (개발 중)
│   ├── discord-bot/  # 선택: Discord 게이트웨이 봇 (/api/v1/chat/completions 로 전달)
│   └── legacy-web/   # /generated 미디어용 정적 자산 호스트
├── db/               # 초기 스키마 + 마이그레이션 (+ rollbacks/) — 런타임에 읽음
├── packages/         # shared-types, api-contracts, config, api-client, local-bridge-core
├── infra/            # Dockerfile & compose (mcp-runtime, task-runtime, artifact-viewer, egress-proxy)
├── scripts/          # setup/ (gen-env.mjs), LLM 백엔드 호스트 설정 (vLLM/LiteLLM), Caddy, 진단
├── tests/            # Playwright E2E
├── assets/           # README 데모 GIF
├── install.sh        # 원샷 설치 스크립트 (Linux/macOS): 도구 체인 → .env → DB → 빌드 → PM2
├── openmake_llm.sh   # 서비스 관리: start/stop/restart/deploy/update/status/logs/health
└── ecosystem.config.js  # PM2 프로세스 정의 (API, Next 프론트엔드, 선택: Discord 봇)
```

**실행 중인 서버가 실제로 필요로 하는 것:** 빌드된 `apps/api/dist` + `apps/web/.next`, `db/`(부팅 경로가 `db/init/` 과 대기 중인 `db/migrations/` 를 적용), 그리고 Docker 격리 샌드박스용 `infra/`. `scripts/` 와 `tests/` 는 런타임 코드가 읽지 *않지만*, `scripts/vllm/` 과 `scripts/caddy/` 는 추론 백엔드와 리버스 프록시 배포 산출물이니 저장소와 함께 두세요.

---

## 기여

기여를 환영합니다. 다음을 지켜 주세요:

- [Conventional Commits](https://www.conventionalcommits.org/) 사용 — `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- 기능/수정 브랜치에서 작업하고 `main` 대상으로 PR 을 여세요.
- 코드 규칙: TypeScript strict 모드, 입력 검증은 Zod, 로깅은 Winston, **파라미터화된 raw SQL 만**(ORM 금지), 설정 외부화(모델명·매직 넘버·인라인 프롬프트 하드코딩 금지).

**PR 을 열기 전에:**

- [ ] `npm run lint` 통과
- [ ] `npm test` 통과
- [ ] DB 스키마 변경 시 마이그레이션 파일 포함 (순번 충돌 없음)
- [ ] 새 환경변수는 `.env.example` 에 문서화
- [ ] UI 변경은 스크린샷이나 짧은 GIF 첨부, 보안 변경은 영향 범위 설명

CI 는 모든 push 와 pull request 에서 단일 **CI Gate**(Test → Build → Size → Lint)를 실행합니다.

---

## 문의

| | |
|---|---|
| 일반 문의 & 셀프 호스팅 도움 | support@openmake.cc |
| 메인테이너 | riskpw@openmake.cc · rockyhan@openmake.cc |

---

## 라이선스

**MIT 라이선스**로 배포됩니다 — 자세한 내용은 [LICENSE](LICENSE) 를 참고하세요.
