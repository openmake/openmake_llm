# 환경 운영 — dev / staging / online

> `omk` 사용 설명서. 스크립트는 이 디렉터리의 [`omk.sh`](omk.sh) 이고, Windows 진입점은 [`omk.ps1`](omk.ps1), 순수 함수 테스트는 [`omk.test.sh`](omk.test.sh) 다.

`openmake_llm` 과 `openmake_bench` 를 세 환경으로 나눠 운영한다. 환경은 서로 **env 파일·docker·PM2 가 분리**되어 있어, 하나가 꼬이면 그것만 지우고 다시 설치할 수 있다. 진입점은 `scripts/env/omk.sh` 하나다.

```
feature/<주제> ──PR(squash · CI 필수)──▶ main ──사람이 `omk env update staging`──▶ ~/.openmake/staging   staging-chat.<도메인>
                                           │                     (기능 확인)
                                           └──(release-please 릴리스 직후) 사람이 `omk env update online`──▶ ~/.openmake/online   chat.<도메인>
                                                                 (스모크만)
```

장수 브랜치는 **`main` 하나**다. `dev`·`staging`·`online` 은 브랜치가 아니라 **환경 이름**이다 — staging 은 main 최신을, online 은 릴리스 직후의 main 을 사람이 올린다. 무거운 검증은 GitHub 러너의 CI 와 staging 에서 하고, online 에서는 스모크만 한다.

두 리포 모두 같은 브랜치 모델을 쓴다. CI 는 `main` 의 push/PR 에서 돈다.

## 환경 규칙

| | dev | staging | online |
|---|---|---|---|
| 위치 | 각자의 작업 클론 | `~/.openmake/staging/{llm,bench}` | `~/.openmake/online/{llm,bench}` |
| 브랜치 | `feature/*` (`--ref`) | `main` 최신 | `main` (릴리스 직후) |
| 인스턴스 | `dev` (이름 있음) | `staging` (이름 있음) | **기본(무접미사)** |
| 포트 | install.sh 가 할당 | install.sh 가 할당 | **소스의 기본 포트** (52416 / 3000 / 5432 / 6379 / 9400 / 33000) |
| PM2 | 없음 (포그라운드) | `openmake-{llm,next,bench}-staging` | `openmake-{llm,next,bench}` |
| docker | `openmake-dev-*` | `openmake-staging-*` | `openmake-*` |
| 배포 | — | **수동** `omk env update staging` | **수동** `omk env update online` |

- **online 이 기본 인스턴스인 이유** — 소스(`install.sh`·`gen-env.mjs`·`resolve-ports.cjs`·문서)의 기본 포트와 이름이 곧 운영 값이다. online 을 기본 인스턴스로 두면 포트 표를 어디에도 다시 적을 필요가 없다.
- **이름 있는 인스턴스의 포트**는 `install.sh` 규칙(한 칸 옆 52417/3010/5433/6380, 점유 시 빈 포트로 이동)을 따른다. **omk 는 포트를 기억하지 않고 각 환경의 `.env` 를 읽는다** — 실제 값은 `omk env status <env>` 로 본다.
- 호스트 구성은 자유다. online 과 staging 이 같은 호스트여도 되고 달라도 된다. dev 는 개발자마다 자기 호스트에서 돈다.

## 설치 — 아무것도 없는 PC 에서 한 줄

```bash
# macOS / Linux / WSL2
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh \
  | bash -s -- env install staging --public-url https://staging-chat.example.com

curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh \
  | bash -s -- env install online  --public-url https://chat.example.com
```

```powershell
# Windows — WSL2(Ubuntu) 를 확인하고 그 안에서 같은 스크립트를 실행한다
irm https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.ps1 -OutFile omk.ps1
.\omk.ps1 env install staging --public-url https://staging-chat.example.com
```

한 번에 되는 일: git 확인 → `openmake_llm` 클론 → **`install.sh`** (Node 24·Docker·PM2 준비, `.env` 시크릿 생성, PostgreSQL·Redis, 마이그레이션, 빌드, PM2 기동, health) → `openmake_bench` 클론·빌드·`.env`·PM2 → Caddy 프록시(PM2 `omk-proxy`) → `~/.openmake/bin/omk` 래퍼.

**배포는 수동이다.** 머지만으로는 아무것도 바뀌지 않고, 사람이 `omk env update <env>` 를 실행해야 그 환경에 올라간다. 원하는 환경만 자동 갱신을 켤 수 있다(`omk env autoupdate <env>` — 원격이 앞서 있을 때만 갱신하는 PM2 cron 앱. 끄려면 `--off`).

설치 후 사람이 채울 것 두 가지 — 끝에 안내가 나온다:
1. `llm/.env` 의 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_DEFAULT_MODEL` (또는 설치 시 `--llm-base-url …` 로 전달)
2. `bench/.env` 의 `OMK_API_KEY` — llm 웹 → 설정 → API 키에서 **`chat` 스코프** 키를 발급해 넣는다 (자동 발급 불가)

Windows 네이티브는 지원하지 않는다. 설치기 전체가 bash 이고, WSL2 안에서는 Linux 와 100% 같은 코드로 돈다.

## 명령

```bash
omk env install <env> [--ref BR] [--bench-ref BR] [--public-url URL] [--no-bench] [--no-proxy]
                      [--llm-base-url U --llm-api-key K --llm-model M] [--autoupdate|--no-autoupdate]
omk env update  <env> [--if-behind]     # llm(ff-only → build → migrate → restart) → bench → proxy
omk env status|start|stop|logs <env>
omk env autoupdate <env> [--every 'CRON'] [--off]
omk env reset   <env> [--keep-data] [--keep-env] [--reinstall] [--yes]
omk proxy status | reload | render <env>
```

`staging`/`online` 외의 이름도 된다(`omk env install qa --ref feature/x`) — 이름 있는 인스턴스가 하나 더 생길 뿐이다.

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

설정은 `<env>/searxng/settings.yml`(dev: `.openmake/searxng/`) — 기본 설정 위에 `formats: json`(없으면 Base 호출이 403),
`limiter: false`, 무작위 `secret_key` 만 덮는다. `omk env reset` 은 이 컨테이너도 함께 지운다.
검색 쪽 실패는 설치를 멈추지 않는다(경고 후 계속). 컨테이너는 `omk.owner_dir` 라벨이 이 설치본을 가리킬 때만 건드린다 —
같은 이름을 다른 설치본·작업 클론이 쓰고 있으면 손대지 않는다. 뺀 뒤 다시 켜려면 `.env` 의 `OMK_SEARXNG=off` 줄을 지우고 `omk env update`.

Base 에는 웹 검색을 끄는 스위치가 아직 없다(모델은 오프라인에서도 검색을 시도한다) — 제안은 BACKLOG §4.

## 도메인 없이 다른 기기에서 보기 (Tailscale·LAN)

`omk env expose <env> --tailscale` (또는 `--host <이름>`) — 그 호스트의 **프록시 주소**(`http://<호스트>:<OMK_PROXY_PORT>`)를
`CORS_ORIGINS` 에 허용하고 API 를 재시작한다. 호스트 목록은 `.env` 의 `OMK_ENV_HOSTS` 에 기억된다. 프록시의
`localhost` 주소는 설치 때 자동으로 허용된다. 웹·REST·채팅 소켓이 전부 프록시 한 주소로 다니므로 그 주소 하나만 허용하면 된다.
평문 HTTP 라 **신뢰하는 망(Tailscale·사내망)에서만** 쓴다 — 밖으로 공개할 때는 `--public-url` + 터널.

## LiteLLM 게이트웨이 — 환경마다 하나

앱은 `LLM_BASE_URL` 하나만 본다. 그 뒤에서 로컬 vLLM 과 BYOK 업스트림을 묶는 LiteLLM 을 환경마다 따로 띄운다:
`~/.openmake/<env>/litellm/{venv, litellm.config.yaml, litellm.env, start_litellm.sh}`, PM2 `openmake-litellm[-<env>]`, `127.0.0.1` 전용,
포트는 `OMK_LITELLM_PORT_BASE`(13401)부터 빈 포트. 설치가 끝나면 llm `.env` 의 `LLM_BASE_URL`·`LLM_API_KEY`(= 새로 만든
`LITELLM_MASTER_KEY`)·`OMK_LITELLM_PORT` 가 채워진다.

- **config 는 레포의 `scripts/vllm/litellm.config.yaml` 그대로** 복사한다(`update` 때마다). 호스트마다 다른 값은 `litellm.env`(600) 뿐이다 —
  `QWEN_VLLM_API_BASE` · `BGE_VLLM_API_BASE` · `VLLM_API_KEY`. 설치 때 `--qwen-vllm-base U --bge-vllm-base U --vllm-api-key K` 로 주거나,
  나중에 파일에 넣고 `omk env start <env>`. 비어 있어도 게이트웨이는 뜨고 BYOK 경로는 동작한다(요약에 `[할 일]` 이 나온다).
- `--llm-base-url` 을 직접 주면(다른 엔드포인트를 쓰겠다는 뜻) 또는 `--no-litellm` 이면 설치하지 않는다(`.env` 의 `OMK_LITELLM=off`).
- `env update` 는 **이미 게이트웨이가 있는 환경만** 갱신한다 — 기존 환경의 `LLM_BASE_URL` 을 가로채지 않는다.
- python 은 `uv` 가 있으면 `uv venv --python 3.12`, 없으면 `python3 -m venv`. 버전 고정은 `OMK_LITELLM_SPEC='litellm[proxy]==X.Y.Z'`.

## 런타임 이미지 — 에이전트 작업·아티팩트 내보내기·외부 MCP 격리

레포에는 Dockerfile(`infra/mcp-runtime` ~1GB, `infra/task-runtime` ~6GB)만 있고 이미지는 호스트에서 빌드해야 한다 —
없으면 에이전트 작업과 아티팩트 내보내기가 동작하지 않고, 외부 MCP 서버는 비격리로 돈다. `env install`·`env update` 가
**환경별 태그**(`openmake-mcp-runtime:<env>` · `openmake-task-runtime:<env>`, online 은 소스 기본값 `:latest`)로 빌드하고
`.env` 의 `MCP_SANDBOX_IMAGE`·`TASK_SANDBOX_IMAGE`·`ARTIFACT_EXEC_IMAGE`·`ARTIFACT_EXPORT_IMAGE` 를 적는다. 같은 호스트의
dev·staging 이 서로의 이미지를 덮어쓰지 않는다. `MCP_SANDBOX_ENABLED`·`TASK_SANDBOX_ENABLED`·`ARTIFACT_EXPORT_ENABLED` 는 값이 없을 때만 `true` 로 둔다.

첫 빌드는 수 분이다. 빼려면 `--no-runtime-images` (`.env` 의 `OMK_RUNTIME_IMAGES=off` 로 기억 — 다시 켜려면 그 줄을 지우고
`omk env update`). 빌드 실패는 설치를 멈추지 않는다. `omk env reset` 은 환경별 태그를 지우고(`:latest` 는 남긴다) 빌드 캐시는 남는다.

## 꼬였을 때 — 지우고 다시

```bash
omk env reset staging --reinstall            # 전부 지우고 같은 브랜치로 재설치
omk env reset staging --keep-env --reinstall # .env(LLM 키·API 키)는 백업했다가 복원
omk env reset staging --keep-data            # DB 볼륨은 남김 (.env 도 함께 보존 — 비밀번호·암호화 키가 데이터와 짝이다)
```

`reset` 은 **환경 이름만으로** 지울 대상을 계산한다 — `.env` 가 깨졌어도 동작한다.

| 지우는 것 | staging 예 |
|---|---|
| PM2 | `openmake-llm-staging` `openmake-next-staging` `openmake-discord-staging` `openmake-bench-staging` `omk-updater-staging` |
| docker | `openmake-staging-postgres` `openmake-staging-redis` + 볼륨 `openmake-staging_pgdata` `openmake-staging_redisdata` |
| 프록시 | `~/.openmake/caddy/caddy.d/staging.caddy` (+ reload) |
| 디렉터리 | `~/.openmake/staging` |

**소유권 가드** — 이름이 환경 이름에서 파생되기 때문에, omk 밖의 설치본이 같은 인스턴스 이름을 쓰고 있으면 위험하다. 예를 들어 예전 방식(`./install.sh --instance staging` → `~/.openmake/chat-staging`)으로 설치한 호스트에서 `omk env reset staging` 은 **그 설치본의 DB 볼륨**을 지우게 된다. 그래서 `install`·`reset` 은 컨테이너의 compose 라벨과 PM2 앱의 cwd 로 주인을 확인하고, `~/.openmake/<env>/` 밖의 것이면 거부한다. 기존 설치본을 omk 로 옮기려면 그 디렉터리에서 `./openmake_llm.sh db-dump` → `./uninstall.sh` → `omk env install <env>` → `db-restore` 순서로 한다. 가드를 끄는 것은 `OMK_FORCE_FOREIGN=1` 뿐이다.

손으로 하려면 위 표 그대로 `pm2 delete …` → `docker rm -f …` → `docker volume rm …` → `rm -rf ~/.openmake/staging`. 전역 도구(Node·Docker·PM2·Caddy)는 다른 환경이 쓰므로 건드리지 않는다.

## dev

작업 클론 안에서 쓴다. `openmake_bench` 가 옆 디렉터리(`../openmake_bench`)에 있으면 같이 띄운다 (`OMK_DEV_LLM` / `OMK_DEV_BENCH` 로 지정 가능).

```bash
git clone https://github.com/openmake/openmake_llm.git && git clone https://github.com/openmake/openmake_bench.git
cd openmake_llm && git checkout -b feature/<주제>

scripts/env/omk.sh dev setup          # 최초 1회: 툴체인·.env(OMK_INSTANCE=dev)·의존성·DB·마이그레이션
scripts/env/omk.sh dev up             # 전부: DB/Redis + api + web + bench (Ctrl+C 로 종료)
scripts/env/omk.sh dev up api         # 개별: deps | api | web | bench
scripts/env/omk.sh dev up --tailscale     # 다른 기기에서 보기 (또는 --host <이름|IP> 를 여러 번)
scripts/env/omk.sh dev status
scripts/env/omk.sh dev down           # DB/Redis 정지 (데이터 유지)
scripts/env/omk.sh dev reset          # 컨테이너·볼륨 삭제 (소스·.env 유지)
```

**다른 기기에서 보기.** 웹은 채팅 소켓을 "접속한 호스트명:API 포트"로 붙이고, 서버는 Origin 이 `CORS_ORIGINS` 와 정확히 일치할 때만 받는다(REST·WS 공통). 그래서 접속에 쓸 호스트를 알려줘야 한다 — `--tailscale` 은 `tailscale status` 에서 MagicDNS 짧은 이름·FQDN·IPv4 를 읽고, `--host` 는 직접 준다. omk 는 그 호스트를 세 곳에 넣는다: API 의 `CORS_ORIGINS`(호스트별 웹·API origin), Next dev 의 `allowedDevOrigins`(모르면 HMR 이 막혀 hydration 이 죽는다), bench vite 의 `allowedHosts`. 목록은 `.env` 의 `OMK_DEV_HOSTS` 에 기억되어 다음 `dev up` 부터는 옵션 없이도 유지된다. 허용하지 않은 호스트·Origin 은 계속 거부된다.

dev 는 PM2 를 쓰지 않는다 — `tsx`/`next dev`/`vite` 가 포그라운드에서 돈다. 인스턴스 이름이 `dev` 라서 같은 호스트의 staging·online 과 컨테이너·볼륨·포트가 겹치지 않는다.

흐름: 클론 → 개발 → 주제별 `feature/*` 브랜치 → 테스트(`npm test`, `npm run lint`, `bash scripts/env/omk.test.sh`) → 원격 `feature/*` push → `main` 으로 PR.

## 프록시와 도메인

Caddy 는 시스템 서비스가 아니라 **PM2 앱 `omk-proxy`** 로 돈다 (호스트당 1개, macOS·Linux·WSL2 동일). 설정은 `~/.openmake/caddy/Caddyfile` 이 `caddy.d/*.caddy` 를 import 하고, 환경마다 `scripts/caddy/instance.caddy.tmpl` 을 그 환경의 `.env` 값으로 렌더링한 블록 하나를 갖는다. `caddy` 가 PATH 에 없으면 공식 릴리스를 `~/.openmake/bin/caddy` 로 받는다.

도메인은 스크립트 어디에도 없다 — `--public-url` 로 받아 llm `.env`(`OMK_APP_URL`·`CORS_ORIGINS`·secure cookie)에 반영한다. 외부 공개는 터널/DNS 를 **그 환경의 프록시 포트**(`OMK_PROXY_PORT`)로 향하게 한다: [`scripts/cloudflared/config.yml.example`](../cloudflared/config.yml.example).

bench 는 프록시 뒤에 두지 않고 자기 포트(`OMKB_PORT`)로 직접 공개한다. llm 의 로그인 쿠키가 host-only 라서 `staging-chat.…` 의 로그인이 `bench-staging.…` 으로 넘어가지 않는다 — 공개 도메인에서는 bench 에 API 키 또는 초대 코드로 로그인하고, SSO 는 같은 호스트명(예: Tailscale 호스트명 + 포트)으로 접속할 때만 동작한다.

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
| `OMK_CADDY_VERSION` | 최신 릴리스 | caddy 버전 고정 (폐쇄망) |
| `OMK_CADDY_ADMIN` | `localhost:2019` | caddy admin 주소 |
| `OMKB_PORT_BASE` / `OMK_PROXY_PORT_BASE` / `OMK_LITELLM_PORT_BASE` | `9400` / `33000` / `13401` | bench·프록시·LiteLLM 빈 포트 탐색 시작점 |
| `OMK_DEV_LLM` / `OMK_DEV_BENCH` | 자동 탐지 | dev 작업 클론 위치 |

스크립트에 남은 하드코딩은 다섯 가지뿐이다: 두 리포의 기본 URL, 루트 디렉터리 이름, 기본 인스턴스로 매핑되는 환경 이름(`online`), PM2 프록시 앱 이름, 그리고 GitHub API 가 막힌 환경에서만 쓰는 caddy 폴백 버전.
