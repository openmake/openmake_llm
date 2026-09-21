# 백로그 — 환경·개발 테스트

> 구현하지 않고 **적어만 둔 것**이다. 결정과 근거를 잃지 않으려는 기록이며, 착수 전에 다시 검토한다.
> Add-on 구조의 기준은 main 의 구현(`addon-host/` · `src/addons/` · `addons/builtin/`)이다 — 이 문서는 환경·배포와 개발 테스트만 다룬다.

## 1. 개발 단계 기능 검증 — 단순 테스트 다음의 "시뮬레이션" 층 (2026-09-19)

**동기.** dev 에서 "openmake.cc 요약해 줘"가 *웹사이트 정보를 확인할 수 없다*로 끝났다. 검색 기능은 실행됐지만 모든 제공자가 0건이었다(`[WebSearch] 총 0개 (SearXNG:0, Google:0, Wiki:0, News:0, DDG:0, Naver:0)`) — 어느 설치본에도 실제 검색 제공자 키가 없고, 키 없는 3종(DDG 즉답 API·Google News·Wikipedia)은 그런 질의에 원래 결과가 없다. 회귀가 아니라 **설정 공백**인데, 지금 있는 어떤 테스트도 이걸 잡지 못한다.

**이미 있는 것.** Jest 단위(apps/api 테스트 파일 494개) · Playwright E2E 10개(`tests/e2e`) · 평가 러너 7종(`eval:routing|response|citation|budget|tools|matrix|redteam`) · 골든 데이터셋 170건. 평가 러너는 대부분 mock 이고 E2E 는 일부 화면만 본다 — **떠 있는 인스턴스에서 기능이 끝까지 되는지**를 보는 층이 없다.

| 층 | 내용 | 성격 |
|---|---|---|
| L0 | 단위·린트 | 있음 · 매 PR · 결정적 |
| **L1 기능 점검표** | 떠 있는 인스턴스에 기능별 탐침을 던져 "된다 / 안 된다(이유)"를 표로. LLM 응답 · 검색 결과 ≥1건 · 페이지 추출 · MCP 서버 연결 · 샌드박스 이미지 · 임베딩 … `openmake_bench` 의 `doctor` 와 같은 발상. `omk dev check` 후보 | 수 초 · 결정적 |
| **L2 시나리오 시뮬레이션** | API·WS 로 실제 대화를 돌린다 — 질문 몇 개, 에이전트 작업 몇 개, 아티팩트 몇 개. 답변 내용이 아니라 **구조**를 단언한다: 검색 도구를 호출했는가 / 출처가 ≥1개 붙었는가 / 아티팩트가 생성·렌더되는가 / 에이전트 작업이 목표 판정까지 가는가. **목록은 YAML 한 파일로 두고 기능을 개발하면서 같이 늘린다** | 수 분 · 구조 단언 |
| **L3 에이전트 탐색 테스트** | 테스터 OpenMake 인스턴스(예: `:4010`)의 에이전트 작업이 브라우저 도구로 dev(`:3010`) 화면을 직접 눌러 본다. 테스트 목록은 에이전트 작업 템플릿으로 저장 | 수십 분 · 비결정적 |

**L3 가능성 (확인함).** 에이전트 작업에 브라우저 도구가 있다 — `goto·click·fill·waitFor·extractText·screenshot`, CSS 가 깨지면 역할·이름 기반 `smartClick/smartFill` (`services/task-sandbox/tools.ts:247-`). 템플릿 등록 → `POST /api/agent-task-templates/:id/instantiate` → `POST /api/agent-tasks/:taskId/execute` 로 밖에서 돌릴 수 있다.
- **테스터는 안정 버전이어야 한다** — dev 로 dev 를 검사하면 에이전트 런타임이 깨졌을 때 테스트 도구도 같이 깨진다. 테스터=안정 릴리스, 대상=dev.
- 준비물: 샌드박스 이미지 2개 빌드(`openmake-mcp-runtime`, `openmake-task-runtime` — 2026-09-19 이 호스트에 없음), `TASK_SANDBOX_ENABLED=true`, 브라우저 컨테이너 egress allowlist 에 대상 호스트.
- 비결정적이고 토큰을 쓴다 → PR 게이트가 아니라 **야간·수동 탐색**.

**순서.** L1 → L2 → L3. L2 로 기본 기능이 단단해진 뒤에 L3 를 얹어야 "기능이 깨진 것"과 "테스터 에이전트가 헤맨 것"을 구분할 수 있다. 기능 검증은 llm 본체 영역이라 Add-on 트랙과 범위를 맞출 것.

## 2. ~~검색 제공자는 Add-on 으로 붙어야 한다 — SearXNG~~ (2026-09-19 · **취소 — 따로 확인하기로 함**)

> 이 항목은 진행하지 않는다. 아래는 그때 확인한 사실의 기록일 뿐이다. 참고로 main(v1.76.0)은 토론·딥리서치·
> 통합 3종을 add-on 으로 분리했지만 웹 검색은 아직 Base 에 있다(`mcp/web-search` 를 Base 세 파일이 정적 import).


**요구.** 기능은 Base 에 박지 않고 Add-on 으로 붙인다는 설계에 따라, SearXNG 도 `.env` 한 줄이 아니라 **다른 Add-on 과 같은 방식으로** 붙어야 한다.

**현재 (확인함).**
- SearXNG 는 이미 Base 에 하드코딩돼 있다 — `mcp/web-search/providers.ts:510-534`, `process.env.SEARXNG_URL` 을 직접 읽어 켜진다.
- 검색 제공자 목록은 레지스트리가 아니라 고정 import 나열이다 (`mcp/web-search/search-orchestrator.ts:13-19,123-131`).
- 지금 동작하는 Add-on 다운 경로는 **MCP 서버**뿐이다 — 카탈로그의 검색 커넥터 Brave(`059`)·Tavily(`112`)가 그렇게 붙는다.
- main 의 `openmake-addon.json` `components.mcp` 는 스키마에만 있고 읽는 코드가 없다(내장 팩은 스킬 시드만 처리 — `addon-host/index.ts`).

| 방법 | Add-on 다움 | 한계 |
|---|---|---|
| A. 컨테이너 + `SEARXNG_URL` | ✗ | 코드 변경 0 이지만 Base 설정이다 |
| B. MCP 서버 Add-on | ✓ (지금 되는 유일한 경로) | 별도 검색 도구가 하나 더 생길 뿐 — **내장 웹 검색과 Deep Research 는 MCP 도구가 아니라 Base 의 검색 모듈을 직접 부르므로 여전히 0건** |
| **C. 검색 제공자 확장점(제공자 레지스트리)** | ✓✓ | 설계·구현 필요 — Add-on 트랙 |

**결론: C.** 억지로 붙이지 않는다. 이 확장점은 설계 리뷰의 C4(Base 가 `web-search` 를 정적으로 import — `routes/chat.routes.ts:46`, `sockets/ws-chat-handler.ts:32`, `services/orchestrator/executors/web.ts:7`)를 푸는 자연스러운 첫 단계이고, SearXNG 가 그 요구사항을 정하는 첫 사례다: 제공자 등록 · 설정(URL·키) 주입 · 컨테이너 서비스 동반 여부 · 비활성 시 graceful · `process.env` 직접 read 제거.

## 3. omk 검증 현황 (2026-09-21 갱신)

**실제로 돌려 본 것** — macOS(arm64, 16GB) 한 대, GitHub 에서 받아 설치:
- `env install dev --ref feature/*` → `reset` → 재설치 → 같은 환경에 다시 `install`(멱등) → `env update`(커밋 4개 · 마이그레이션 포함)
- dev·staging **공존**: 포트(api·web·proxy·bench·LiteLLM·SearXNG·DB)·PM2·컨테이너·볼륨·이미지 태그 무충돌, 한쪽 `reset` 이 다른 쪽을 건드리지 않음
- `env install` 안에서의 SearXNG·런타임 이미지·LiteLLM·기본 모델(llama.cpp 다운로드 포함) 흐름, 옵션 없는 설치에서 앱 → 게이트웨이 → 모델 채팅
- 업스트림 지정(`--llm-base-url … --llm-model …` → 게이트웨이 뒤), 기본 모델 교체(1.7B → 4B)와 선택 기억
- `--ref release`: 최신 태그 설치 → 이전 태그로 되돌린 뒤 `update` 가 새 태그로 ff + deploy → 최신이면 no-op
- `--tailscale` / `env expose`: Tailscale 주소로 웹·로그인·웹소켓·채팅
- 기능: 채팅 · 웹 검색 · 에이전트 작업(샌드박스 컨테이너) · 아티팩트 PDF 내보내기 — **API 호출로만**. 브라우저 화면은 사람이 확인해야 한다

**아직 안 돌려 본 것**
- Linux 실설치(순수 함수 테스트만 Ubuntu 24.04 · Debian 12 · Fedora 41 컨테이너에서 통과) · Windows(WSL2, `omk.ps1`)
- 빈 PC — 검증 호스트에 Node·Docker·PM2·Caddy·uv 가 이미 있어 툴체인 설치·Caddy 다운로드·`python3 -m venv` 폴백 경로를 타지 않았다
- **`online`(기본 인스턴스) 설치와 "기존 운영본을 online 으로 옮기기"** — 한 번도 실행하지 않았다. `--public-url`, `--keep-data`, `--keep-env`, `autoupdate` 도 미실행
- vLLM 업스트림(`--qwen-vllm-base` …)으로 실제 추론 — 검증 호스트에 vLLM 이 없다. 게이트웨이가 요청을 업스트림까지 넘기는 것만 확인
- **CI 에 omk 실설치 job 이 없다** — Gate 0.5 는 문법·shellcheck·순수 테스트만 본다. 깨끗한 Ubuntu 러너에서
  `omk env install → status → update → reset` 을 돌리면 Linux·빈 PC·자동 반복이 한 번에 해결된다(이미지·기본 모델은 `--no-runtime-images --no-default-model`)

**알려진 빈틈**
- 한 줄 설치는 `omk.sh` 자체를 main 에서 받는다 — 설치되는 앱 소스는 릴리스 태그지만 부트스트랩 스크립트는 main HEAD 다. 막으려면 URL 을 태그로 고정(릴리스마다 README 갱신)
- online 롤백이 omk 명령으로 없다 — 지금은 손으로 이전 태그 체크아웃 → `./openmake_llm.sh deploy`
- 구형 docker 빌더(buildx 없음)는 이미지를 지우면 빌드 캐시도 사라진다 — 그래서 `reset` 이 런타임 이미지를 남긴다(`--purge-images`). 환경을 많이 만들면 환경당 약 7GB 가 쌓인다
- 기본 모델 서버는 호스트당 하나다 — 모델을 바꾸면 그 서버를 쓰는 다른 환경은 `omk env install <env>` 를 다시 돌려야 게이트웨이의 모델 이름이 맞는다
- `omk dev up`(작업 클론·포그라운드)과 환경 `dev` 가 같은 인스턴스 이름을 쓴다 — 한 호스트에서 동시에 쓸 수 없다(나중 것을 소유권 가드가 거부). 이름을 나눌지 미결정
- 런타임 이미지가 준비되면 `MCP_SANDBOX_ENABLED`·`TASK_SANDBOX_ENABLED`·`ARTIFACT_EXPORT_ENABLED` 를 값이 없을 때 `true` 로 둔다 — 소스 주석은 "운영 활성화는 사용자 직접". online 에서도 자동으로 켤지 미결정
- `scripts/backups/db-backup.sh` 와 운영이 쓰는 레포 밖 백업 스크립트의 통일 방향 미결정

## 4. 업스트림에 알릴 것

- `package-lock.json` 이 낡아 있다(워크스페이스 버전 1.70.0 vs package.json 1.74.0 — release-please 가 lock 을 갱신하지 않는다). 설치만 해도 lock 이 바뀌어 `update` 가 막혔다. `openmake_llm.sh update` 에 우회를 넣었지만 근본 수정은 릴리스 파이프라인 쪽이다
- 모델이 URL 을 받고도 페이지 추출이 아니라 웹 검색을 골랐다 (위 1번의 사례)
- `[LocalModels] probe … http://localhost:11434/v1/v1/models → 404` — Ollama base URL 에 `/v1` 이 있으면 경로가 중복된다
- **웹 검색 스위치가 없다** (2026-09-19) — 외부 연결이 없는 설치본에서도 모델에 검색 도구가 노출돼, 질문마다
  제공자별 `WEB_SEARCH_FETCH_TIMEOUT_MS`(기본 12초)를 기다린 뒤 0건이 된다. 제안: `WEB_SEARCH_ENABLED=false` 면
  검색·팩트체크 도구를 모델에 노출하지 않고 `performWebSearch` 는 즉시 `[]` — `DISCUSSION_FACTCHECK_ENABLED` 와 같은
  kill-switch 패턴. 그때까지 omk 는 오프라인 설치본의 대기를 2초로 낮추는 것으로 버틴다(README "웹 검색").
- **`.env.example` 은 "docker compose 로 기동"이라 하지만 `infra/docker-compose.yml` 에 searxng 서비스가 없다** —
  omk 가 `docker run` 으로 메운다. 업스트림이 compose 서비스(프로필)로 넣으면 omk 쪽은 그걸 쓰도록 바꾼다.

- **기본 MCP 서버가 새 설치본에서 항상 연결 실패한다** (2026-09-21) — `db/init/003-seed.sql` 이 `noapi-google-search`
  (command `noapi-google-search-mcp`)를 enabled 로 심지만, 그 실행 파일은 호스트에도 `openmake-mcp-runtime` 이미지에도 없다.
  기동 때마다 `[ExternalMCP] Failed to connect` 가 남는다(이유 문자열도 비어 있다). 웹 검색은 SearXNG 로 되므로 기능 공백은 없다.
  선택지: 이미지에 bake(`uv tool install --with 'mcp<2' …` + chromium) / 시드를 disabled 로 / 설치기가 호스트에 설치하고 `sandbox_network=host`.

## 5. 완전 오프라인 설치 (기록만, 2026-09-19)

`install.sh` 는 git clone·npm·docker pull 을 하므로 인터넷이 전혀 없는 PC 에는 설치 자체가 안 된다. 지금 다루는
"오프라인"은 *설치 후 외부망 차단* 또는 *내부 미러로 설치* 다. 폐쇄망 번들(소스 tarball + npm 캐시 + `docker save`
이미지: postgres·redis·searxng·샌드박스)은 별도 작업.

