# 개발·검증·배포 — 8단계 운영 흐름

`omk`의 명령 원본은 [`omk.sh`](omk.sh), Windows/WSL 진입점은 [`omk.ps1`](omk.ps1)입니다. 역할과 단계는 [운영 흐름 페이지](http://rasplay.tplinkdns.com:34321/workflow-map.html)의 8단계를 따릅니다. [현황 보드](http://rasplay.tplinkdns.com:34321/board.html)는 관측 도구이며, 코드 위치와 실행·검증 증거를 구분합니다. 문서나 소스 변경만으로 원격 자동화가 활성화되지는 않습니다.

## 개발에서 운영까지

| 단계 | 담당 | 실행과 다음 조건 |
|---|---|---|
| 1 | local · MacBook / 사람+에이전트 | `origin/dev`에서 작업 브랜치 → 구현 → 로컬 관련 테스트·lint·필요 빌드 → dev 대상 PR. 테스트 근거를 함께 남깁니다. |
| 2 | GitHub | PR 최신 변경의 CI·자동 구조 검사를 충족하면 dev로 일반 병합. 사람 PR 승인 단계는 없습니다. |
| 3 | GitHub runner | **실제로 병합된 dev SHA**의 소스·DB·빌드·lint와 임시 앱의 **기본 스모크+변경 기능/관련 소스 테스트**. 전체 브라우저 테스트를 무조건 실행하지 않습니다. |
| 4 | GitHub | 현재 dev의 push CI 통과 후 dev→main PR 생성·자동 병합. 최신 main 조합의 PR CI도 필요합니다. 실패·SHA 변경 시 중단/재검사합니다. |
| 5 | tom · staging | main 설치 → 스모크 → 구성된 필수 고강도 검증 → 정확한 SHA의 결과 저장 → 사람 실사용을 위해 설치본 고정. |
| 6 | 사람 + tom 명령 | 사람이 tom을 직접 사용해 OK하면 `omk env approve staging --sha FULL_SHA --yes`. 고정 SHA·실행 빌드·통과 근거를 다시 확인하고 verify ref를 기록합니다. |
| 7 | GitHub | verify한 코드에 연결된 release-please PR만 자동 병합 → 버전 태그·릴리스·공급망 증명 발행. verify 이후 기능 변경은 허용하지 않습니다. |
| 8 | ome-on · online | 한 번 선택한 릴리스 태그의 SHA 고정 → verify 계보 검사 → 백업 → 관리형 갱신 → 설치 SHA 일치·운영 스모크 확인. |

bean은 5번 이후 tom, 8번 이후 ome-on에 주기적으로 접속하는 **별도 외부 QA 호스트**입니다. tom 자체 검증과 사람의 OK를 대체하지 않습니다. 반복 검사 실패를 자동 승격 차단·복구로 연결하는 정책은 현재 없습니다.

```text
local: 개발·관련 테스트·PR
    → GitHub: PR CI/구조 검사 → dev 병합
    → GitHub: 병합 dev 소스 검사 + 기본·변경 기능 검사
    → GitHub: dev→main PR CI → main 병합
    → tom: 설치·스모크·필수 검증 → SHA 고정
    → 사람: 실사용 OK → approve(동일 SHA의 verify)
    → GitHub: 검증 계보 확인 → release-please 자동 병합·태그
    → ome-on: 고정 태그 검증·백업·설치·스모크
bean ── 주기적 실사용 검사 ──▶ tom / ome-on
```

별도 **배포 dev 서버는 필수 흐름에서 폐지**됐습니다. Git 브랜치 `dev`와 로컬 `omk dev`는 유지합니다. 레거시 `omk env install dev`는 호환 명령이며 main 승격 게이트로 사용하지 않습니다. `omk/env-dev`를 필수 체크에 추가하지 마세요.

## 로컬 및 GitHub 검사

로컬에서는 변경 범위의 회귀 테스트를 먼저 작성하고 실행합니다. PR에서는 기존 전체 소스/DB CI를 실행하며, 병합된 dev에서도 같은 소스 CI를 다시 실행합니다. dev의 기능 검사는 시작·DB 연결·로그인·기본 채팅·웹 응답과 변경된 기능/소스의 선택 검사로 한정합니다.

CI 모델 fixture는 네트워크·인증·채팅 연결 검증용입니다. 실제 모델 품질이나 실서비스 MCP 동작을 검증했다고 기록하지 않습니다. 실제 서비스 검증은 tom/bean 단계에서 수행합니다. 새 E2E spec은 `scripts/ci/feature-checks.manifest.json`에 `api` 또는 `web` 대상을 선언하고, 필요하면 source-prefix → spec 매핑을 추가합니다. 선택된 정확한 파일만 임시 앱/DB에서 실행하며 전부 skip이면 실패합니다. 웹 대상이 있을 때만 Chromium을 준비합니다. 변경 기능의 관련 테스트를 선택할 수 없으면 통과로 간주하지 않고 테스트/매핑 보완을 요청합니다.

자동 리뷰는 현재 **결정적 구조 검사와 기존 CI 품질 게이트**입니다. 의미적 AI 코드 리뷰를 수행했다고 표현하지 않습니다. 코드 리뷰가 필요한 복잡한 변경은 개발 과정에서 별도로 수행합니다.

## GitHub 자동화 활성화

1. 자동화 소스가 **기본 브랜치 main에 먼저 존재**해야 `workflow_run`·스케줄 이벤트가 동작합니다. 초기 도입 PR은 기존 관리 절차로 검증·병합합니다.
2. dev/main 모두 `CI Gate (Test → Build → Size → Lint)`를 필수·최신 기준(strict)으로 설정합니다. 컨트롤러가 준비 상태를 매번 확인해 즉시 일반 병합하며, 변경 후에도 남는 GitHub `--auto` 예약은 만들지 않습니다. 이전 `omk/env-dev`는 제거합니다. 사람의 PR 리뷰 승인 수는 0입니다. 설정 변경 전 기존 다른 보호 규칙을 보존합니다.
3. Actions secret `OMK_AUTOMATION_TOKEN`을 등록합니다. 호환용 `OMK_PROMOTE_TOKEN`도 지원합니다. 저장소 contents·pull requests 쓰기, actions/checks 읽기 및 보호 규칙 읽기 권한이 필요합니다. GitHub App 토큰은 유효기간과 발급/갱신 방식을 별도로 마련해야 합니다. 개발자의 로컬 인증을 자동 복사하지 않습니다.
4. 기본 `GITHUB_TOKEN`으로 PR을 생성·병합하면 다음 CI가 트리거되지 않을 수 있어 자동화 자격증명을 분리합니다. 미설정은 정상 완료로 숨기지 않고 오류로 알립니다.
5. 권한 있는 오케스트레이터는 신뢰된 기본 브랜치 코드만 실행합니다. PR 소스·PR artifact를 내려받아 권한 토큰으로 실행하지 않습니다.

`auto-merge`는 작업 PR의 최신 CI 뒤에, `promote`는 병합 dev의 push CI 뒤에 실행합니다. `release-verified`는 유효한 verify와 릴리스 PR CI를 주기적으로 확인합니다. 실패/대기는 해당 SHA와 이유를 남깁니다.

활성화 상태는 `node scripts/pipeline/configuration.mjs OWNER/REPO`로 읽기 전용 확인할 수 있습니다. 자격증명 값은 요청하지 않으며, 미설정 항목이 있으면 종료 코드 1과 `blocked`를 반환합니다. `configured`도 실제 배포 완료를 뜻하지 않습니다.

## 환경 규칙

| 항목 | local | tom · staging | ome-on · online |
|---|---|---|---|
| 소스 | 개발 작업 클론 | `~/.openmake/staging/llm` 또는 관리형 기존 경로 | `~/.openmake/online/llm` 또는 관리형 기존 경로 |
| 추적 | 작업 브랜치 | main | release |
| 앱 | 로컬 개발 프로세스 | PM2 | PM2 |
| 인프라 | macOS Colima / Linux Docker | 같은 플랫폼 규칙 | 같은 플랫폼 규칙 |
| 갱신 | 에이전트의 개발 작업 | pipeline 스케줄, 검증 중 hold | 검증 릴리스 pipeline 스케줄 |

포트·사용자·도메인·실제 경로는 해당 `.env`와 `omk env status`를 읽습니다. 호스트 이름이 환경 이름을 대신하지 않습니다. staging은 Tailscale 호스트와 프록시 포트로 접속하고, online의 외부 공개는 운영 Cloudflare/DNS 설정을 따릅니다. Base와 Add-on 분리, 앱 PM2 실행 방식은 유지합니다.

## tom 설치·검증·사람 확인

최초 활성화 전 스모크 계정 `OMK_SMOKE_EMAIL/PASSWORD`와 필수 검증 설정을 준비합니다. 계정 비밀번호·토큰을 검증 JSON이나 Git에 넣지 않습니다. 검증 설정은 기본 `<환경 디렉터리>/.pipeline/checks.json`이며 `OMK_VALIDATION_CONFIG`로 지정할 수 있습니다.

```json
{"checks":[{"name":"changed-feature-regression","argv":["node","scripts/my-staging-check.mjs"]}]}
```

`argv`는 신뢰된 운영자 설정이며 쉘 문자열로 평가하지 않습니다. **예시를 그대로 통과 검사로 사용하지 말고 실제 기능 시나리오를 지정**하세요. 모든 항목은 필수이며 빈 설정·미실행·실패는 검증 통과가 아닙니다. 검증 명령은 tom의 대상 앱에 맞는 테스트 계정을 사용해야 하며, CI 전용 `_test` DB fixture를 실사용 DB에 적용하지 않습니다.

```bash
omk env pipeline staging                  # 설치 → 스모크 → 필수 검증 → hold
omk env pipeline staging --schedule '*/10 * * * *'
omk env status staging
# 사람이 tom을 실제로 사용하고 OK한 뒤, 확인했던 정확한 40자리 SHA로:
omk env approve staging --sha FULL_SHA --yes
# 수동 호환 명령: 동일 근거 검사를 수행한다
omk env verify staging --sha FULL_SHA --yes
```

명령은 현재 HEAD·실행 중 빌드·디스크 빌드·고정 SHA·검증 결과가 일치하는지 검사합니다. 사람이 확인하는 중 자동 갱신을 허용하지 않습니다. 이전 통과 결과를 다른 SHA에 재사용하지 않습니다. 검증이 실패하면 local에 재현과 증거를 전달해 수정합니다. hold를 취소하고 재검증하려면 `omk env hold staging --release`를 명시적으로 실행합니다. 작업 잠금이 남으면 먼저 실행 중 프로세스를 확인하고 복구합니다.

## 릴리스 게이트와 운영

`refs/omk/verified/FULL_SHA`가 검증 근거입니다. verify한 커밋과 태그 커밋은 버전/변경 로그 메타데이터 때문에 달라도 됩니다. **각 중간 커밋**에서 허용된 메타데이터만 바뀌었는지 검사하며, 의존성·코드 변경은 나중에 되돌렸어도 차단합니다. 허용 경로는 검증된 커밋의 release-please 설정에서 읽습니다. JSON은 버전 필드 외 변경을 허용하지 않습니다.

```bash
omk env pipeline online                  # 고정 태그 → 게이트 → 백업·갱신 → 스모크
omk env pipeline online --schedule '*/10 * * * *'
omk env pipeline online --off
omk env verify staging --list
```

새 pipeline은 운영 게이트를 강제합니다. 기존 `env update`·`autoupdate`는 호환/복구용 명령이며 8단계 완료 근거로 대신 사용하지 않습니다. 기본 설치·기존 설치본 이관은 아래 별도 절차이며, 첫 운영 설치도 검증된 릴리스인지 확인한 후 수행합니다. 백업 실패·검증 부재·태그/설치 SHA 불일치·스모크 실패는 완료로 처리하지 않습니다. 운영 자동 갱신의 OS 자동기동 권한·재부팅 검증은 별도 실제 호스트 검증입니다.

## bean 외부 실사용 검사

`node scripts/pipeline/bean.mjs run --config /private/bean.json --output /private/qa`로 대상별 결과를 남깁니다. 설정은 [`../pipeline/bean.example.json`](../pipeline/bean.example.json)을 참고합니다. health·ready·로그인·짧은 채팅을 명시적으로 선택하며, 로그인은 기존 QA 계정 환경변수를 읽습니다. 채팅 검사는 일반 사용자의 채팅 기록을 만들 수 있습니다. 배포·계정 권한 변경·verify는 실행하지 않습니다.

주기는 임의 활성화하지 않습니다. 운영자가 정한 주기로 `node scripts/pipeline/bean.mjs schedule --config /private/bean.json --output /private/qa --every '*/30 * * * *'`를 실행합니다. PM2 영구 등록(`pm2 save`)과 재부팅 복원은 해당 호스트에서 별도로 확인합니다. 결과에는 대상 호스트·관측 SHA/버전·시나리오·시각·통과/실패가 포함되며 짧은 SHA는 짧은 것으로 표시합니다.

## 모니터링 버튼과 증거 연결

6번 “실사용 OK” 버튼은 [`../../docs/architecture/pipeline-monitor-contract.md`](../../docs/architecture/pipeline-monitor-contract.md)의 요청 규격을 사용합니다. 웹서버에서 로그인·승인 권한·CSRF를 확인한 뒤 고정 argv의 `approve` 명령을 요청해야 합니다. 서버 소스가 없는 상태에서 버튼이 이미 연결됐다고 표시하지 않습니다.

현황 보드의 기존 7단계 RC/승인 결과와 새 8단계 결과를 구분합니다. 코드가 운영에 포함된 사실만으로 사용자 OK·검증 완료를 추정하지 않습니다. 전체 소스 조사와 미연결 항목은 [`../../docs/architecture/pipeline-source-audit.md`](../../docs/architecture/pipeline-source-audit.md)를 참고하세요.

## 설치 — 아무것도 없는 PC 에서 한 줄

```bash
# macOS / Linux / WSL2
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh \
  | bash -s -- env install staging --tailscale

curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh \
  | bash -s -- env install online  --public-url https://chat.example.com     # 최신 릴리스 태그를 설치한다
```

```powershell
# Windows — WSL2(Ubuntu) 를 확인하고 그 안에서 같은 스크립트를 실행한다
irm https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.ps1 -OutFile omk.ps1
.\omk.ps1 env install staging --tailscale
```

한 번에 되는 일(순서대로):

1. git 확인 → `openmake_llm` 클론
2. **`install.sh --minimal`** — Node 24·Docker·PM2 준비, `.env` 시크릿 생성, PostgreSQL·Redis, 마이그레이션, 빌드, PM2 기동, health
3. 웹 검색(SearXNG) → 런타임 이미지 → LiteLLM 게이트웨이(업스트림을 주지 않았으면 기본 모델까지)
4. `--bench` 를 줬을 때만: `openmake_bench` 클론·빌드·`.env`·PM2
5. Caddy 프록시(PM2 `omk-proxy`) → `--tailscale`/`--host` 를 줬으면 그 주소 허용
6. `~/.openmake/bin/omk` 래퍼

2 가 실패하면 설치가 멈춘다. 3 의 실패는 경고만 남기고 계속한다. 4 는 실패하면 멈춘다 — 뒤의 5·6 이 실행되지 않는다.

**배포는 기본이 수동이다.** 머지만으로는 아무것도 바뀌지 않고, 사람이 `omk env update <env>` 를 실행해야 그 환경에 올라간다. 원하는 환경만 자동 갱신을 켤 수 있다(`omk env autoupdate <env>` — 원격이 앞서 있을 때만 갱신하는 PM2 cron 앱. 끄려면 `--off`). 갱신 뒤 스모크와 결과 표지까지 잇는 방법은 [자동 승격](#자동-승격--staging-까지-사람-없이-선택).

설치 후 사람이 채울 것 — 해당할 때만 요약 끝에 `[할 일]` 로 나온다:

| 나오는 경우 | 할 일 |
|---|---|
| 게이트웨이는 떴는데 업스트림이 비어 있다 (`--no-default-model` 등) | `<env>/litellm/litellm.env` 의 `QWEN_VLLM_API_BASE` / `BGE_VLLM_API_BASE` / `VLLM_API_KEY` 를 넣고 `omk env start <env>` — 또는 `--llm-base-url … --llm-model …` 로 재설치 |
| `--no-litellm` 으로 설치해 LLM 주소가 자리표시자다 | `llm/.env` 의 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` |
| bench 를 설치했다 | `bench/.env` 의 `OMK_API_KEY` — llm 웹 → 설정 → API 키에서 **`chat` 스코프** 키를 발급해 넣는다 (자동 발급 불가) |
| Discord 봇 토큰을 줬다 | `llm/.env` 의 `DISCORD_BOT_API_KEY` — **`discord` 스코프** 키 |

옵션 없이 설치하면 게이트웨이와 기본 모델이 채워져, 채울 것 없이 채팅까지 된다.

Windows 네이티브는 지원하지 않는다. 설치기 전체가 bash 이고, WSL2 안에서는 Linux 와 100% 같은 코드로 돈다.

## 명령

```bash
omk env install <env> [--ref BR] [--bench [--bench-ref BR]] [--public-url URL] [--no-proxy] [--no-searxng] [--no-runtime-images]
                      [--tailscale] [--host H]… [--no-litellm] [--no-default-model]
                      [--qwen-vllm-base U --bge-vllm-base U --vllm-api-key K]
                      [--llm-base-url U --llm-api-key K --llm-model M] [--autoupdate|--no-autoupdate] [--release-gate]
                      [--ops-profile] [--dgx-host H] [--https-host H] [--artifact-viewer] [--discord-token T]
omk env update  <env> [--if-behind] [--no-backup] [--force-unverified] [--report]   # llm(ff-only → build → migrate → restart) → bench → proxy
omk env smoke   <env> [--report]        # health · 빌드본의 API 포트 · /generated · 로그인 · /ready · 채팅 1회(릴리스 환경은 제외) (--report: 그 커밋에 결과 표지)
omk env verify  <env> [--list]          # 확인을 마친 커밋을 origin 에 기록 (릴리스 게이트)
omk env reset   <env> [--keep-data] [--keep-env] [--purge-images] [--reinstall] [--yes]
omk env status|start|stop|logs <env>
omk env expose  <env> [--tailscale] [--host H]…
omk env backup  <env> [--schedule ['CRON']] [--off] [--list] [--dry-run]
omk env autoupdate <env> [--every 'CRON'] [--off]
omk proxy status | reload | render <env>
omk dev setup [--no-searxng] [--no-runtime-images] [--no-litellm] [--no-default-model] [--llm-base-url U --llm-api-key K --llm-model M]
              [--dgx-host H [--vllm-api-key K]]
omk dev up [all|deps|api|web|bench] [--tailscale] [--host H]…
omk dev down | status | reset [--keep-data]
```

- **bench 는 기본으로 설치하지 않는다** — `--bench` 또는 `--bench-ref BR` 을 줄 때만 붙는다. `--no-bench` 는 예전 호출용으로 계속 받는다(기본과 같다).
  이미 bench 가 있는 환경은 `update`·`start`·`reset --reinstall` 이 그대로 다룬다.
- 종료 코드: `0` 성공 / `1` 사용법·전제조건 / `2` 단계 실패(릴리스 게이트 거부 포함) / `3` health check 실패.
- `staging`/`online` 외의 이름도 된다(`omk env install qa --ref feature/x`) — 이름 있는 인스턴스가 하나 더 생길 뿐이다. `local` 은 로컬 개발이 쓰는 이름이라 환경 이름으로 쓸 수 없다.

**`omk` 명령이 실행하는 스크립트** — 래퍼 `~/.openmake/bin/omk` 는 `online` → `staging` → 그 밖의 환경 순서로 처음 찾은 환경의
`llm/scripts/env/omk.sh` 를 실행한다. online 이 있는 호스트에서는 어느 환경을 다루든 **online 에 설치된 버전의 omk** 가 돈다.
`omk.sh` 자체를 고친 브랜치를 시험할 때는 래퍼 대신 그 소스의 스크립트를 직접 부른다:

```bash
<작업 클론>/scripts/env/omk.sh env install pr-123 --ref feature/<주제>
```

## 웹 검색 — 설치하면 바로 된다

키 없는 기본 제공자(Wikipedia·뉴스·DDG)만으로는 일반 웹 검색이 거의 0건이다. 그래서 omk 는 SearXNG 를
Postgres·Redis 와 같은 급의 **환경 인프라**로 기본 설치한다 (`env install`·`dev setup` 모두. 빼려면 `--no-searxng`).

| 상황 | omk 가 하는 일 | 요약·`status` 에 보이는 줄 |
|---|---|---|
| 보통 | `openmake[-<env>]-searxng` 컨테이너(127.0.0.1 전용, 포트 자동)를 띄우고 `.env` 에 `SEARXNG_URL` 기록 → API 재시작 → **실제 검색 1회로 확인** | `웹 검색  동작 확인 (SearXNG http://127.0.0.1:8888 · 32건)` |
| 외부 연결 없음 | 컨테이너를 만들지 않고, 제공자별 대기(기본 12초)를 2초로 낮춘다(`WEB_SEARCH_FETCH_TIMEOUT_MS` — 이미 값이 있으면 존중) | `꺼짐 (외부 연결 없음 — 연결 후 omk env update)` |
| 나중에 연결됨 | `omk env update` 가 다시 점검해 컨테이너를 띄우고 위 임시값을 걷어낸다 | `동작 확인 …` |
| 컨테이너가 안 뜸 | 로그 5줄을 보여 주고 치운다. **죽은 주소는 `.env` 에 적지 않는다** | `SearXNG 없음 …` |
| `SEARXNG_URL` 을 직접 넣어 둠 | 손대지 않는다 — omk 것은 `http://127.0.0.1:<OMK_SEARXNG_PORT>` 뿐. omk 가 띄운 뒤 주소만 바꿔도 되돌리지 않는다 | `동작 확인 …` / `결과 0건 …` |

설정은 `<env>/searxng/settings.yml`(로컬 개발: 작업 클론의 `.openmake/searxng/`) — 기본 설정 위에 `formats: json`(없으면 Base 호출이 403),
`limiter: false`, `image_proxy: false`, 무작위 `secret_key` 를 덮고, 응답이 불안정한 엔진(brave·startpage·mojeek)을 끈다.
파일이 이미 있으면 다시 쓰지 않는다. `omk env reset` 은 이 컨테이너도 함께 지운다.
검색 쪽 실패는 설치를 멈추지 않는다(경고 후 계속). 컨테이너는 `omk.owner_dir` 라벨이 이 설치본을 가리킬 때만 건드린다 —
같은 이름을 다른 설치본·작업 클론이 쓰고 있으면 손대지 않는다. 뺀 뒤 다시 켜려면 `.env` 의 `OMK_SEARXNG=off` 줄을 지우고 `omk env update`.

Base 에는 웹 검색을 끄는 스위치가 아직 없다(모델은 오프라인에서도 검색을 시도한다) — 제안은 BACKLOG §4.

## 도메인 없이 다른 기기에서 보기 (Tailscale·LAN)

`omk env expose <env> --tailscale` (또는 `--host <이름>`) — 그 호스트의 **프록시 주소**(`http://<호스트>:<OMK_PROXY_PORT>`)를
`CORS_ORIGINS` 에 허용하고 API 를 재시작한다. 호스트 목록은 `.env` 의 `OMK_ENV_HOSTS` 에 기억된다. 프록시의
`localhost` 주소는 설치 때 자동으로 허용된다. 설치할 때 같이 하려면 `omk env install <env> --tailscale`(또는 `--host`) — `reset` 후 재설치해도 유지된다. 웹·REST·채팅 소켓이 전부 프록시 한 주소로 다니므로 그 주소 하나만 허용하면 된다.
평문 HTTP 라 **신뢰하는 망(Tailscale·사내망)에서만** 쓴다. staging 은 `--tailscale` 로 직접 접속하며 Cloudflare Tunnel 을 사용하지 않는다. online 외부 공개는 `--public-url` 과 운영 호스트의 tunnel/DNS 설정을 사용한다.

## LiteLLM 게이트웨이 — 환경마다 하나

앱은 `LLM_BASE_URL` 하나만 본다. 그 뒤에서 로컬 vLLM 과 BYOK 업스트림을 묶는 LiteLLM 을 환경마다 따로 띄운다:
`~/.openmake/<env>/litellm/{venv, litellm.config.yaml, litellm.env, start_litellm.sh}`, PM2 `openmake-litellm[-<env>]`, `127.0.0.1` 전용,
포트는 `OMK_LITELLM_PORT_BASE`(13401)부터 빈 포트. 설치가 끝나면 llm `.env` 의 `LLM_BASE_URL`·`LLM_API_KEY`(= 새로 만든
`LITELLM_MASTER_KEY`)·`OMK_LITELLM_PORT` 가 채워진다.

- **config 는 레포의 `scripts/vllm/litellm.config.yaml` 그대로** 복사한다(`update` 때마다). 호스트마다 다른 값은 `litellm.env`(600) 뿐이다 —
  `QWEN_VLLM_API_BASE` · `BGE_VLLM_API_BASE` · `VLLM_API_KEY`. 설치 때 `--qwen-vllm-base U --bge-vllm-base U --vllm-api-key K` 로 주거나,
  나중에 파일에 넣고 `omk env start <env>`. 비어 있어도 게이트웨이는 뜨고 BYOK 경로는 동작한다(요약에 `[할 일]` 이 나온다).
- **vLLM 이 없는 호스트**(Ollama 만 있는 개발 PC 등)도 자기 게이트웨이를 거친다: `--llm-base-url U --llm-api-key K --llm-model M` 은
  "게이트웨이 뒤의 업스트림"이다. 값은 `litellm.env` 의 `OMK_UPSTREAM_*` 에 기억되고, 환경의 config 사본에 그 모델 한 항목이 추가된다
  (레포 config 는 그대로, 주소·키는 `os.environ` 참조). 앱의 `LLM_BASE_URL` 은 언제나 자기 환경의 게이트웨이다.
- 빼려면 `--no-litellm` (`.env` 의 `OMK_LITELLM=off`).
- `env update` 는 **이미 게이트웨이가 있는 환경만** 갱신한다 — 기존 환경의 `LLM_BASE_URL` 을 가로채지 않는다.
- python 은 `uv` 가 있으면 `uv venv --python 3.12`, 없으면 `python3 -m venv`. 버전 고정은 `OMK_LITELLM_SPEC='litellm[proxy]==X.Y.Z'`.

## 기본 모델 — 아무것도 주지 않아도 채팅이 된다

업스트림(`--llm-base-url`·`--qwen-vllm-base`)을 주지 않고 설치하면 omk 가 **최소 모델**을 게이트웨이 뒤에 둔다:
llama.cpp 의 `llama-server`(OpenAI 호환 · CPU·Metal 에서 돈다 — vLLM 은 GPU 가 필요해 저사양·macOS 에서 못 쓴다) +
`Qwen/Qwen3-1.7B-GGUF:Q8_0`(1.8GB, 도구 호출이 되는 가장 작은 선). 경로는 언제나 **앱 → 환경의 LiteLLM → 업스트림**이다.
작업 클론의 로컬 개발(`omk dev setup`)도 같다 — 게이트웨이는 `local` 것을 따로 두고 모델 서버는 같이 쓴다.

- 호스트당 하나: PM2 `omk-llamacpp`, `127.0.0.1` 전용, `~/.openmake/llamacpp/{bin,models,start.sh,port}`. 환경들이 공유하고 `env reset` 에도 남는다.
  `llama-server` 가 PATH 에 있으면 그것을 쓰고, 없으면 공식 릴리스(`OMK_LLAMACPP_TAG`)를 받는다.
- **환경을 설정하면 그 모델을 따른다** — `--llm-base-url … --llm-model …` 또는 `--qwen-vllm-base …` 로 다시 설치하거나 `litellm.env` 를 채우면
  기본 모델은 쓰이지 않는다. 이미 업스트림이 기억된 환경은 재설치해도 기본 모델로 돌아가지 않는다. 빼려면 `--no-default-model`.
- 작은 모델이다 — **배선 확인과 가벼운 대화용**. 에이전트 작업·검색 품질을 보려면 더 큰 업스트림을 지정한다.
- **호스트에 맞는 모델로 바꾸기**: `OMK_DEFAULT_MODEL_HF`(HuggingFace `repo:quant`) · `OMK_DEFAULT_MODEL_NAME` · `OMK_DEFAULT_MODEL_CTX`(16384) 를 주고
  `omk env install <env>` 를 다시 실행한다 — 예: 16GB Mac 은 `OMK_DEFAULT_MODEL_HF=Qwen/Qwen3-4B-GGUF:Q4_K_M OMK_DEFAULT_MODEL_NAME=qwen3-4b`.
  선택은 `~/.openmake/llamacpp/model.conf` 에 기억되어 다음부터는 옵션 없이도 유지되고, 서버는 새 모델로 다시 뜬다. 같은 서버를 쓰는
  다른 환경은 `omk env install <env>` 를 한 번 다시 돌려 게이트웨이의 모델 이름을 맞춘다.

## 운영 구성 옵션 — 새 서버를 운영과 같게 (install_mac.sh · install_linux.sh 가 켠다)

`install_mac.sh`·`install_linux.sh`(OS 별 원샷 설치)는 사전 준비를 마친 뒤 `omk env install online` 에 아래 옵션을 넘긴다
(질문·omk 호출은 두 OS 공통 `scripts/setup/common/`, OS 별 준비는 `scripts/setup/{mac,linux}/`).
omk 를 직접 쓸 때도 같은 옵션을 줄 수 있다. **주지 않으면 기존 동작 그대로**다.

| 옵션 | 하는 일 | `.env` 표시 |
|---|---|---|
| `--ops-profile` | `scripts/setup/profiles/ops-features.env` 의 운영 기능 플래그 중 **없는 키만** 덧붙인다(에이전트 작업 큐·예약·서브에이전트, 메모리 추출, 보고서, 샌드박스 등 — 코드 기본값은 대부분 꺼짐). 웹 푸시 VAPID 키 생성, `TASK_SANDBOX_ROOT` 를 환경 디렉터리로, 스크래퍼 파이썬(curl_cffi) 가상환경. 런타임 이미지가 없으면 샌드박스 스위치를 끈다 | `OMK_OPS_PROFILE=1` (update 때 새 프로필 키를 덧붙인다) |
| `--dgx-host H` | DGX vLLM `:8002`(채팅)·`:8003`(임베딩)·`:8005`(음악)을 게이트웨이 업스트림으로, 앱의 `LLM_TOKENIZE_URL`·`VLLM_METRICS_URLS`·`SSRF_ALLOWED_HOSTS`·기본 모델(`OMK_DGX_MODEL`, 기본 qwen3.8-27b), 연결 확인(HTTP 코드). 키는 `--vllm-api-key` | — |
| `--https-host H` | 내부망 HTTPS — 프록시가 `:443`(Linux 는 설치 스크립트가 caddy 에 `setcap cap_net_bind_service` 를 준다) 에서 `caddy.d/<env>-https.caddy`(`tls internal`)로 같은 라우팅을 한다. 공개 주소·CORS·secure cookie 설정, 루트 인증서를 `$OMK_ROOT/https/openmake-internal-root.crt` 로 내보낸다(사용자 기기마다 1회 신뢰 등록) | `OMK_HTTPS_HOST` |
| `--artifact-viewer` | 아티팩트 공유 뷰어(nginx 컨테이너 `:8088`, HTTPS 면 `:8443`). nginx.conf 가 백엔드 `:52416` 고정이라 기본 인스턴스 전용 | `OMK_ARTIFACT_VIEWER=1` |
| `--discord-token T` | Discord 봇 빌드·등록. 앱 API 키(discord 스코프)는 설치 후 발급해 `DISCORD_BOT_API_KEY` 에 넣는다 — 운영 봇 토큰 재사용 금지(두 서버가 같은 봇으로 붙는다) | — |

LiteLLM 버전은 `OMK_LITELLM_SPEC` 로 고정한다 — 설치 스크립트는 `litellm[proxy]==1.100.1`(1.102 지연 회귀로 운영이 고정한 버전)을 넘긴다.

## Node 버전 — 기준은 `.node-version` 하나

Node 버전의 기준은 저장소 루트 `.node-version` 하나다. `mise.toml`·런타임 이미지(`infra/mcp-runtime`·`infra/egress-proxy` 의
`FROM node:<버전>-bookworm-slim`)·CI(`actions/setup-node` 의 `node-version-file`)가 모두 이 값을 따르고,
`scripts/ci/node-version.test.mjs`(`npm run test:infra`)가 어긋남을 잡는다. 메이저만 맞추지 않는다 — **정확히 같은 판**이어야 한다.

| 어디서 | 검사 |
|---|---|
| `openmake_llm.sh deploy`·`canary-deploy` | 빌드 전에 셸의 node 와 **PM2 데몬의 node** 가 `.node-version` 과 같은지 본다. 다르면 고치는 방법을 보이고 멈춘다 |
| `install_mac.sh` | brew `node@24` 가 `.node-version` 과 같은지 보고, 통과하면 `brew pin node@24`(`brew upgrade` 가 다른 판으로 올리지 않게) |
| `install_linux.sh` | 이미 있는 node 가 `.node-version` 과 같을 때만 그대로 쓴다. 다르면 mise → fnm → nvm → brew → 공식 tarball 순으로 그 판을 준비한다 |
| `apps/desktop-native/build.sh` | 앱에 넣을 node 가 `.node-version` 과 다르면 빌드 실패 |

PM2 데몬은 처음 띄운 node 를 계속 쓴다 — node 를 바꾼 뒤 `pm2 restart` 만 하면 앱이 옛 node 로 뜬다. 데몬이 다르다고 나오면
셸의 node 를 맞춘 뒤 `pm2 update`(지금 node 로 데몬을 다시 띄우고 저장된 앱을 되살린다)를 실행한다.

버전을 올릴 때:

1. `.node-version`·`mise.toml`·Dockerfile 두 개(`infra/mcp-runtime`·`infra/egress-proxy`)를 **한 PR** 로 바꾼다 (`npm run test:infra` 통과).
2. 각 환경에서 node 를 새 판으로 바꾼다 — 맥은 `brew unpin node@24` → `brew upgrade node@24`(또는 `mise install node@<버전>`) → `brew pin node@24`.
3. `pm2 update` 로 데몬을 새 node 로 다시 띄운다.
4. 런타임 이미지를 다시 빌드한다 (`omk env update`, 또는 macOS 에서 `docker --context colima-openmake build` 를 직접).

## Docker — macOS 는 전용 Colima

macOS 의 OpenMake 는 **자기 Colima VM**(프로필 `openmake`)에서만 컨테이너를 돌린다. Docker Desktop 은
필요하지 않다. 새 설치는 Homebrew Docker CLI 와 Colima 를 준비하며, OpenMake 명령은 Desktop 기본 컨텍스트나
`DOCKER_HOST`·`DOCKER_CONTEXT` 환경변수에 기대지 않고 전용 Colima 소켓을 선택한다. Docker Desktop 은 기존 데이터 이전을 확인한 뒤 제거해도 된다.

| | |
|---|---|
| 최소 사양 | Apple Silicon · RAM 16GB |
| VM 크기 | 옵션 없이 설치하면 호스트에 맞춘다 — 메모리는 호스트의 절반(최대 8GB · 최소 2GB), CPU 는 코어 수(최대 4), 디스크 60GB. 직접 정하려면 처음 만들 때 `OMK_COLIMA_CPU`·`OMK_COLIMA_MEMORY`·`OMK_COLIMA_DISK` |
| 접속 | `DOCKER_HOST=unix://<COLIMA_HOME>/openmake/docker.sock` — 명시한 Colima 홈, 등록된 프로필 경로, `~/.colima` 순서로 고르고 `.env`·PM2·자동 기동에 같은 값을 전달한다. Desktop 컨텍스트는 사용하지 않는다 |
| 자동 시작 | LaunchAgent `com.openmake.colima` (로그인 시). 로그는 `~/.openmake/logs/colima.log` |
| 컨테이너 보기 | `omk env status <env>` 또는 `docker --context colima-openmake ps` (Docker Desktop 화면에는 나오지 않는다) |
| VM 크기 바꾸기 | `colima stop --profile openmake` → `colima start --profile openmake --activate=false --memory 12` |

Linux·WSL2 는 지금처럼 Docker Engine 을 쓴다.

**파일 공유의 1초 지연.** Colima(virtiofs)는 컨테이너가 방금 본 파일을 호스트가 덮어쓰면 약 1초 동안 예전 크기로 읽는다
(연속 20회 중 18회 오독 — 2026-09-29 실측). 그래서 Colima 를 쓰는 호스트에서는 앱이 workspace 파일을 **컨테이너 안에서** 쓰고
(`TASK_SANDBOX_WRITE_VIA_CONTAINER` — 접속처가 Colima 면 자동으로 켜진다), 쓰고 곧바로 실행하는 임시 파일은 호출마다 새 이름으로 만든다.
workspace 를 밖에서 직접 고치는 도구를 붙일 때는 같은 점을 고려한다.

로컬 개발도 같다 — `omk dev setup` 이 런타임 이미지를 빌드하면서 `TASK_SANDBOX_ROOT` 를 `~/.openmake/local/task-workspaces` 로 둔다.
`--no-runtime-images` 로 준비한 뒤 샌드박스를 직접 켤 때는 `.env` 의 `TASK_SANDBOX_ROOT` 를 홈 아래 경로로 둔다 —
Colima 는 홈 디렉터리만 VM 에 공유해, 기본값(`/tmp/…`)은 컨테이너에서 보이지 않는다.

### Docker Desktop 에서 이전

macOS 명령은 기본 Docker 컨텍스트와 무관하게 OpenMake 전용 Colima 프로필을 사용한다.
`COLIMA_HOME` 을 명시하면 그 경로를 사용하며, 미설정 시 등록된 `colima-openmake` 컨텍스트의
소켓 경로를 확인하고, 신규 설치는 `~/.colima` 를 사용한다. 외장 디스크 경로도 설치기·PM2·자동 기동·백업에 함께 전달된다.

설치기는 기존 PostgreSQL 컨테이너·Compose 데이터 볼륨을 **메타데이터로만** 검사한다.
이미 해당 인스턴스의 Colima 컨테이너가 있으면 보존하고, Docker Desktop 에만 OpenMake 데이터가 있거나
기존 설치의 원본을 확인할 수 없으면 새 빈 DB 를 만들지 않고 설치를 중단한다.
설치 중 DB 볼륨을 자동 복사하거나 별도 PostgreSQL/Redis 검증 서버를 띄우지 않는다.

기존 데이터는 먼저 원본·암호화 키·bind mount/볼륨 구성을 백업하고 서비스를 정상 종료한 뒤,
DB 논리 백업·복원 등으로 이전한다. 외부 캐시·메일·아티팩트 경로도 실제 사용 경로와 대조해야 한다.
복원한 DB 의 테이블·서비스 응답과 앱의 로그인·채팅·공유 뷰어를 확인한 뒤 설치를 다시 실행한다.
원본 Docker Desktop 컨테이너·볼륨은 검증이 끝날 때까지 보존한다.

Docker Desktop 을 지워도 CLI 가 남도록 설치기는 Homebrew 의 `docker`, `docker-compose`, `docker-buildx` 를 준비한다.
Linux·WSL 의 Docker Engine 설정은 변경하지 않는다.

### Colima 를 걷어낼 때

```bash
launchctl bootout gui/$(id -u)/com.openmake.colima; rm ~/Library/LaunchAgents/com.openmake.colima.plist
colima delete --profile openmake        # VM 안의 컨테이너·볼륨(DB)·이미지가 모두 사라진다 — 먼저 백업
```

LaunchAgent 를 먼저 지운다 — 남아 있으면 다음 로그인 때 빈 VM 을 다시 만든다.

## 런타임 이미지 — 에이전트 작업·아티팩트 내보내기·외부 MCP 격리

레포에는 Dockerfile(`infra/mcp-runtime` ~1GB, `infra/task-runtime` ~6GB)만 있고 이미지는 호스트에서 빌드해야 한다 —
없으면 에이전트 작업과 아티팩트 내보내기가 동작하지 않고, 외부 MCP 서버는 비격리로 돈다. `env install`·`env update` 가
**환경별 태그**(`openmake-mcp-runtime:<env>` · `openmake-task-runtime:<env>`, online 은 소스 기본값 `:latest`)로 빌드하고
`.env` 의 `MCP_SANDBOX_IMAGE`·`TASK_SANDBOX_IMAGE`·`ARTIFACT_EXEC_IMAGE`·`ARTIFACT_EXPORT_IMAGE` 를 적는다. 같은 호스트의
dev·staging 이 서로의 이미지를 덮어쓰지 않는다. `MCP_SANDBOX_ENABLED`·`TASK_SANDBOX_ENABLED`·`ARTIFACT_EXPORT_ENABLED` 는 값이 없을 때만 `true` 로 둔다.
**online 을 포함한 모든 환경에서 같다**(2026-09-21 결정 — 세 환경이 똑같이 돌아야 staging 의 확인이 online 에 통한다). 끄려면 그 환경의 `.env` 에 `false` 로 적는다 — omk 는 이미 있는 값을 건드리지 않는다.

egress 프록시 이미지(`infra/egress-proxy`, 작다)도 같이 빌드한다 — 태그는 `.env` 의 `TASK_SANDBOX_EGRESS_PROXY_IMAGE`(없으면 `openmake-egress-proxy:latest`)
그대로이고 `.env` 는 고치지 않는다. 프록시 컨테이너(`omk-egress-proxy`)가 옛 이미지로 떠 있으면 지운다 — 다음 브라우저 작업 때 API 가 새 이미지로 다시 띄운다.
프록시를 쓰는지는 `TASK_SANDBOX_EGRESS_PROXY_ENABLED`(기본 꺼짐)가 정한다.

첫 빌드는 수 분이다. 빼려면 `--no-runtime-images` (`.env` 의 `OMK_RUNTIME_IMAGES=off` 로 기억 — 다시 켜려면 그 줄을 지우고
`omk env update`). 빌드 실패는 설치를 멈추지 않는다. `omk env reset` 은 이미지를 **남긴다**(약 7GB 재빌드를 피하려고) — 지우려면 `--purge-images`(환경별 태그만, `:latest` 는 남긴다).

## DB 백업

기준은 레포의 [`scripts/backups/db-backup.sh`](../backups/db-backup.sh)(`pg_dump -Fc` · 보존기간 정리 · 무결성 확인)다. omk 는 "어느 환경의 것을 어디에"만 정한다.

```bash
omk env backup <env>                 # 지금 한 번 → ~/.openmake/backups/<env>/
omk env backup <env> --dry-run       # 무엇을 할지만 출력
omk env backup <env> --list
omk env backup <env> --schedule      # 매일 03:30 (PM2 cron 앱 omk-backup-<env>). 주기: --schedule '0 */6 * * *'
omk env backup <env> --off
```

- 백업은 **환경 디렉터리 밖**에 쌓인다 — `omk env reset <env>` 로 환경을 지워도 남는다. 다른 곳에 두려면 그 환경 `.env` 의 `BACKUP_DIR`. 보존 기간은 `BACKUP_RETENTION_DAYS`(14).
- **릴리스를 따르는 환경(online)은 `omk env update` 가 새 버전을 올리기 직전에 백업을 한 번 뜬다.** 백업이 실패하면 올리지 않는다(`--no-backup` 로 건너뜀).
- 스케줄 잡은 **그 환경에 설치된 omk**(`<env>/llm/scripts/env/omk.sh`)를 실행한다 — `backup` 명령이 없는 옛 버전의 환경에서는 먼저 `omk env update`.
- 복원은 그 환경 디렉터리에서 `./openmake_llm.sh db-restore <파일>`.

## 꼬였을 때 — 지우고 다시

```bash
omk env reset staging --reinstall            # 전부 지우고 같은 브랜치로 재설치
omk env reset staging --keep-env --reinstall # .env(LLM 키·API 키)는 백업했다가 복원
omk env reset staging --keep-data            # DB 볼륨은 남김 (.env 도 함께 보존 — 비밀번호·암호화 키가 데이터와 짝이다)
```

`reset` 은 **환경 이름만으로** 지울 대상을 계산한다 — `.env` 가 깨졌어도 동작한다.

| 지우는 것 | staging 예 |
|---|---|
| PM2 | `openmake-llm-staging` `openmake-next-staging` `openmake-discord-staging` `openmake-bench-staging` `openmake-litellm-staging` `omk-updater-staging` `omk-backup-staging` |
| docker | `openmake-staging-postgres` `openmake-staging-redis` `openmake-staging-searxng` + 볼륨 `openmake-staging_pgdata` `openmake-staging_redisdata` (`--keep-data` 면 볼륨은 남긴다) |
| 프록시 | `~/.openmake/caddy/caddy.d/staging.caddy` · `staging-https.caddy` (+ reload) |
| 디렉터리 | `~/.openmake/staging` (게이트웨이 `litellm/`·SearXNG 설정 포함) |

남기는 것: 런타임 이미지(`--purge-images` 로 지운다), DB 백업(`~/.openmake/backups/<env>`), 호스트 공용인 기본 모델 서버(`omk-llamacpp`)와 프록시(`omk-proxy`).
`--reinstall` 은 지우기 전의 브랜치로 다시 설치한다(릴리스를 따르던 환경은 최신 릴리스 태그로).

**소유권 가드** — 이름이 환경 이름에서 파생되기 때문에, omk 밖의 설치본이 같은 인스턴스 이름을 쓰고 있으면 위험하다. 예를 들어 예전 방식(`./install.sh --instance staging` → `~/.openmake/chat-staging`)으로 설치한 호스트에서 `omk env reset staging` 은 **그 설치본의 DB 볼륨**을 지우게 된다. 그래서 `install`·`reset` 은 컨테이너의 compose 라벨과 PM2 앱의 cwd 로 주인을 확인하고, `~/.openmake/<env>/` 밖의 것이면 거부한다. 기존 설치본을 omk 로 옮기려면 그 디렉터리에서 `./openmake_llm.sh db-dump` → `./uninstall.sh` → `omk env install <env>` → `db-restore` 순서로 한다. 가드를 끄는 것은 `OMK_FORCE_FOREIGN=1` 뿐이다.

손으로 하려면 위 표 그대로 `pm2 delete …` → `docker --context colima-openmake rm -f …` → `docker --context colima-openmake volume rm …` → `rm -rf ~/.openmake/staging`. 전역 도구(Node·Docker CLI·PM2·Caddy)는 다른 환경이 쓰므로 건드리지 않는다.

## 로컬 개발 — `omk dev` (작업 클론 · 핫 리로드)

작업 클론 안에서 쓴다. `openmake_bench` 가 옆 디렉터리(`../openmake_bench`)에 있으면 같이 띄운다 (`OMK_DEV_LLM` / `OMK_DEV_BENCH` 로 지정 가능).

```bash
git clone https://github.com/openmake/openmake_llm.git && git clone https://github.com/openmake/openmake_bench.git
cd openmake_llm && git checkout -b feature/<주제>

scripts/env/omk.sh dev setup          # 최초 1회: 툴체인·.env(OMK_INSTANCE=local)·의존성·DB·마이그레이션·SearXNG·런타임 이미지·게이트웨이·기본 모델
scripts/env/omk.sh dev up             # 전부: DB/Redis/SearXNG/게이트웨이 + api + web (+ bench 클론이 있으면 bench) — Ctrl+C 로 종료
scripts/env/omk.sh dev up api         # 개별: deps | api | web | bench
scripts/env/omk.sh dev up --tailscale     # 다른 기기에서 보기 (또는 --host <이름|IP> 를 여러 번)
scripts/env/omk.sh dev status
scripts/env/omk.sh dev down           # DB/Redis/SearXNG/게이트웨이 정지 (데이터 유지 · 기본 모델 서버는 남긴다)
scripts/env/omk.sh dev reset          # 컨테이너·볼륨 삭제 (소스·.env 유지). --keep-data 면 볼륨은 남긴다
```

`dev setup` 은 앱 빌드와 앱의 PM2 기동을 하지 않는다(`install.sh --minimal --skip-build --no-start`) — 워크스페이스 패키지(`packages/*/dist`)만 빌드한다.
`.env` 나 `node_modules` 가 없으면 `dev up` 이 `dev setup` 을 먼저 돌린다.

**설치 직후 바로 채팅이 된다.** 검색·런타임 이미지·게이트웨이·기본 모델은 `omk env install` 과 같은 함수(`stack_ensure`)로 준비하고 옵션의 뜻도 같다 —
`--no-searxng` · `--no-runtime-images`(약 7GB 빌드를 뺀다) · `--no-litellm` · `--no-default-model` · `--llm-base-url U --llm-model M`(예: 이미 있는 Ollama).
로컬 개발이 환경과 다른 것은 셋뿐이다: 앱을 빌드하지 않고, 앱을 PM2 에 올리지 않고, `.env` 의 `NODE_ENV` 가 `development` 다
(`gen-env.mjs` 의 기본값 `production` 을 바꾼다. `test`·`staging` 처럼 직접 고른 값은 그대로 둔다).

| 같이 쓰는 것 (호스트에 하나) | 따로 두는 것 (`local`) |
|---|---|
| Docker 엔진 — macOS 는 Colima VM `openmake` | PostgreSQL·Redis (`openmake-local-*`) — 브랜치의 마이그레이션이 환경의 DB 를 바꾸지 않게 |
| 기본 모델 서버 — PM2 `omk-llamacpp`, 모델 1.8GB 는 한 번만 받는다 | 게이트웨이 — PM2 `openmake-litellm-local`, `~/.openmake/local/litellm`. 환경이 설치돼 있지 않아도 채팅이 된다 |
| 런타임 이미지의 레이어(Dockerfile 이 같으면 캐시 재사용) | 런타임 이미지의 태그(`:local`) · SearXNG · 작업 공간(`~/.openmake/local/task-workspaces`) |

- `.env` 의 `LLM_BASE_URL` 을 **직접 넣어 둔 작업 클론은 건드리지 않는다.** omk 가 바꾸는 것은 비어 있거나, 자리표시자(`http://localhost:4000` 인데 그 포트에 아무것도 없음)이거나,
  omk 가 넣은 게이트웨이 주소일 때뿐이다. 직접 넣은 주소를 게이트웨이 뒤로 옮기려면 `--llm-base-url … --llm-model …` 을 준다.
- 게이트웨이와 기본 모델 서버는 PM2 로 뜬다 — `dev up` 의 Ctrl+C 뒤에도 남고, 재부팅 등으로 내려가 있으면 `dev up` 이 다시 띄운다.
- 작업 클론이 여럿이면 게이트웨이 하나(`local`)를 같이 쓴다. 게이트웨이의 config 는 마지막으로 `dev setup` 을 돌린 클론의 것이다.
- 옛 인스턴스 이름(`dev`)의 작업 클론에는 게이트웨이·기본 모델·런타임 이미지를 준비하지 않는다(환경 dev 의 것과 자리가 겹친다) — `omk dev reset` 으로 이름을 옮긴 뒤 다시 돌린다.

**다른 기기에서 보기.** 웹은 채팅 소켓을 "접속한 호스트명:API 포트"로 붙이고, 서버는 Origin 이 `CORS_ORIGINS` 와 정확히 일치할 때만 받는다(REST·WS 공통). 그래서 접속에 쓸 호스트를 알려줘야 한다 — `--tailscale` 은 `tailscale status` 에서 MagicDNS 짧은 이름·FQDN·IPv4 를 읽고, `--host` 는 직접 준다. omk 는 그 호스트를 세 곳에 넣는다: API 의 `CORS_ORIGINS`(호스트별 웹·API origin), Next dev 의 `allowedDevOrigins`(모르면 HMR 이 막혀 hydration 이 죽는다), bench vite 의 `allowedHosts`. 목록은 `.env` 의 `OMK_DEV_HOSTS` 에 기억되어 다음 `dev up` 부터는 옵션 없이도 유지된다. 허용하지 않은 호스트·Origin 은 계속 거부된다.

로컬 개발의 앱은 PM2 를 쓰지 않는다 — `npm run dev:api`(`ts-node`)·`next dev`·bench 의 `vite` 가 `concurrently` 아래 포그라운드에서 돈다.
웹과 bench 화면은 고치면 바로 반영되고, **API 는 감시 재시작이 없어** 고친 뒤 `dev up` 을 다시 띄운다. 인스턴스 이름은 **`local`**(컨테이너 `openmake-local-*`)이라
같은 호스트의 **환경 `dev`**(`~/.openmake/dev` — 빌드된 배포본으로 브랜치를 확인하는 곳)·staging·online 과 컨테이너·볼륨 이름이 겹치지 않는다.
포트는 설치할 때 열려 있던 것만 피한다([환경 규칙](#환경-규칙)).
둘은 용도가 다르다: `omk dev up` 은 로컬 장비에서 고치면서 바로 보는 핫 리로드, 환경 dev 는 개발 서버에서 "실제로 설치해도 도는가".
예전에 `dev` 이름으로 준비한 작업 클론은 그대로 동작하지만 환경 dev 와 겹친다 — `omk dev reset` 이 이름을 `local` 로 옮겨 준다(그 뒤 `omk dev setup`).

흐름: 클론 → 개발 → 주제별 `feature/*` 브랜치 → 테스트(`npm test`, `npm run lint`, `bash scripts/env/omk.test.sh`) → 원격 `feature/*` push → 브랜치 `dev` 에 합친다 → 환경 dev 에서 확인([개발에서 배포까지](#개발에서-배포까지--환경별로-할-것--하지-말-것)).

## 프록시와 도메인

Caddy 는 시스템 서비스가 아니라 **PM2 앱 `omk-proxy`** 로 돈다 (호스트당 1개, macOS·Linux·WSL2 동일). 설정은 `~/.openmake/caddy/Caddyfile` 이 `caddy.d/*.caddy` 를 import 하고, 환경마다 `scripts/caddy/instance.caddy.tmpl` 을 그 환경의 `.env` 값으로 렌더링한 블록 하나를 갖는다. `caddy` 가 PATH 에 없으면 공식 릴리스를 `~/.openmake/bin/caddy` 로 받는다.

도메인은 스크립트 어디에도 없다 — `--public-url` 로 받아 llm `.env`(`OMK_APP_URL`·`CORS_ORIGINS`·secure cookie)에 반영한다. staging 은 `--tailscale` 로 허용한 Tailscale 호스트명과 프록시 포트로 직접 접속한다. online 외부 공개의 Cloudflare Tunnel 예시는 [`scripts/cloudflared/config.yml.example`](../cloudflared/config.yml.example) 에 있다.

bench 는 프록시 뒤에 두지 않고 자기 포트(`OMKB_PORT`)로 직접 공개한다. llm 의 로그인 쿠키가 host-only 라서 채팅과 bench 가 서로 다른 호스트명일 때 로그인이 공유되지 않는다 — Tailscale 직결에서는 같은 호스트명에 각 포트를 사용하면 SSO 가 동작한다.

이 방식으로 관리되는 인스턴스는 `.env` 에 `OMK_PROXY_DIR` 이 있고, `openmake_llm.sh deploy` 는 이를 보고 예전의 호스트 Caddyfile 복사(`/opt/homebrew/etc/Caddyfile`)를 건너뛴다.

## 기존 운영본을 online 으로 옮기기 (1회)

기존 운영본은 이미 "기본 인스턴스"다 — 이름·포트·볼륨(`openmake_pgdata`)이 online 과 같다. 옮기는 것은 **경로**뿐이다.

```bash
cd <기존 설치 경로> && ./openmake_llm.sh stop         # PM2 앱·컨테이너 정지 (볼륨은 남는다)
brew services stop caddy 2>/dev/null || true          # 시스템 Caddy 를 쓰고 있었다면 — omk-proxy 와 admin 포트가 겹친다
cp <기존 설치 경로>/.env /tmp/online.env

omk env install online --public-url https://chat.example.com
cp /tmp/online.env ~/.openmake/online/llm/.env && omk env start online   # 기존 시크릿·LLM 설정 승계
omk env status online
```

같은 이름의 docker 볼륨을 다시 붙이므로 DB 는 그대로다. 호스트를 옮기는 경우에는 `./openmake_llm.sh db-dump` → 새 호스트에서 `db-restore`. 롤백은 새 PM2 앱을 멈추고 기존 경로에서 `./openmake_llm.sh start`.

## 환경변수 (omk)

| 변수 | 기본값 | 용도 |
|---|---|---|
| `OMK_ROOT` | `~/.openmake` | 모든 환경의 루트 |
| `OMK_REPO_URL` / `OMKB_REPO_URL` | GitHub 공식 리포 | 포크에서 설치할 때 |
| `OMK_AUTOUPDATE_CRON` | `*/10 * * * *` | 자동 갱신 주기 |
| `OMK_BACKUP_CRON` | `30 3 * * *` | `omk env backup --schedule` 의 기본 주기 |
| `OMK_SMOKE_TIMEOUT` / `OMK_GITHUB_API` | `120` / `https://api.github.com` | 스모크 요청 하나의 제한 시간(초) · 결과 표지를 올릴 API |
| `OMK_SMOKE_READY_WAIT` | `60` | 스모크의 `/ready` 가 200 이 될 때까지 기다리는 최대 시간(초) — 재기동 직후 LLM 노드 첫 확인 |
| `OMK_CADDY_VERSION` | 최신 릴리스 | caddy 버전 고정 (폐쇄망) |
| `OMK_CADDY_ADMIN` | `localhost:2019` | caddy admin 주소 |
| `OMKB_PORT_BASE` / `OMK_PROXY_PORT_BASE` / `OMK_LITELLM_PORT_BASE` | `9400` / `33000` / `13401` | bench·프록시·LiteLLM 빈 포트 탐색 시작점 |
| `OMK_SEARXNG_PORT_BASE` / `OMK_LLAMACPP_PORT_BASE` | `8888` / `18080` | SearXNG·기본 모델 서버 빈 포트 탐색 시작점 |
| `OMK_SEARXNG_IMAGE` | `searxng/searxng:latest` | SearXNG 이미지 |
| `OMK_NET_PROBE_URLS` / `OMK_SEARCH_PROBE_QUERY` | DDG·Bing·Wikipedia / `wikipedia` | 외부 연결 점검 대상(하나라도 열리면 온라인) · 검색 동작 확인용 질의 |
| `OMK_LITELLM_SPEC` | `litellm[proxy]` | LiteLLM pip 설치 대상 — 버전 고정에 쓴다 |
| `OMK_LLAMACPP_TAG` | `b10964` | 기본 모델 서버(llama.cpp) 릴리스 태그 |
| `OMK_DEFAULT_MODEL_HF` / `_NAME` / `_CTX` | `Qwen/Qwen3-1.7B-GGUF:Q8_0` / `qwen3-1.7b` / `16384` | 기본 모델 — 준 값은 `~/.openmake/llamacpp/model.conf` 에 기억된다 |
| `OMK_DGX_MODEL` | `qwen3.8-27b` | `--dgx-host` 일 때 앱의 기본 모델 이름 |
| `OMK_DEV_LLM` / `OMK_DEV_BENCH` | 자동 탐지 | dev 작업 클론 위치 |
| `OMK_LOG` | 켜짐 | 설치·갱신·리셋(`env install`·`env update`·`env reset`·`dev setup`·`dev reset`)의 출력을 `~/.openmake/logs/omk/<시각>-<명령>[-<환경>].log` 에도 남긴다. 끄려면 `off` |
| `OMK_VERIFY_PUSH_URL` | `origin` | `omk env verify` 가 확인 기록을 push 할 원격 |
| `OMK_RESTORE_ENV_FROM` | — | `reset --keep-env` 가 남긴 `.env` 백업 디렉터리 — 설치 전에 되돌린다 |
| `OMK_FORCE_FOREIGN` | — | `1` 이면 소유권 가드를 끈다 |

도메인·호스트 경로·키는 스크립트에 없다. 스크립트에 고정된 값은 이름과 규약뿐이다: 두 리포의 기본 URL, 기본 인스턴스로 매핑되는 환경 이름(`online`),
로컬 개발의 인스턴스 이름(`local`), PM2 앱 이름(`omk-proxy`·`omk-llamacpp`), 확인 기록의 ref 경로(`refs/omk/verified`), DGX vLLM 포트(8002·8003·8005),
내부망 HTTPS 포트(443), artifact-viewer 포트(8088·8443), 그리고 GitHub API 가 막힌 환경에서만 쓰는 caddy 폴백 버전.
