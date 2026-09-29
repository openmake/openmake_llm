# 인수인계 — macOS 전용 Colima 전환

> 브랜치 `feature/colima-docker-runtime` (기준 `dev` `46e497b`) · 작성 2026-09-29
> 이 문서는 작업을 다른 기기에서 이어가기 위한 것이다. **`dev` 에 합치기 전에 지운다** — 남길 내용은 이미 [README.md](README.md) 에 있다.

## 한 줄 요약

macOS 설치가 Docker Desktop 대신 **전용 Colima VM**(프로필 `openmake`)을 쓰도록 바꿨다. 코드는 끝났고
`omk dev setup` 은 실제 Mac 한 대에서 성공했다. **전체 설치(`omk env install`)와 실제 에이전트 작업, 재부팅, 재설치는 아직 확인하지 않았다.**

## 왜 하는가

Docker Desktop 은 로그인·약관·업데이트 창에서 사람을 기다린다. 서버로 쓰는 Mac 이 재부팅 뒤 창 하나에 멈추면
DB 와 에이전트 샌드박스가 같이 멈춘다. 화면 조작 없이 올라오는 Docker 가 필요하다.

## 결정 — 바꾸기 전에 읽을 것

| 결정 | 이유 | 바꾸면 |
|---|---|---|
| openmake 는 항상 자기 Colima 를 쓴다. Docker Desktop 이 있어도 지우지 않고 설정도 건드리지 않는다 | 어느 Mac 에서나 구성이 같다. 사용자의 다른 컨테이너를 깨지 않는다 | — |
| Colima 는 `--activate=false` 로 띄운다 | 터미널의 `docker` 가 가리키는 곳(기본 컨텍스트)을 옮기지 않는다 | 사용자의 `docker` 명령이 갑자기 Colima 를 본다 |
| 접속은 `DOCKER_HOST` 하나로 정한다. 규칙: macOS 이고 `~/.colima/openmake/docker.sock` 이 있으며 `DOCKER_HOST` 가 비어 있으면 그 소켓 | docker CLI·compose 가 모두 읽는 표준 변수 | — |
| **VM 종류는 `vz`** | 나중에 에이전트가 Docker 를 쓰는 작업을 VM 으로 감쌀 계획이 있다. 중첩 가상화는 `vz` 에서만 된다(Apple M3 이상 · macOS 15 이상) | 그 계획을 할 수 없게 된다 |
| 기존 설치본의 판정은 **호스트 단위** — 기본 Docker 에 `openmake[-<env>]-postgres` 가 하나라도 있으면 그 Mac 에는 Colima 를 설치하지 않는다 | 접속 규칙이 호스트 전체에 걸린다. 환경 하나만 옮기면 나머지 환경의 `omk` 명령이 컨테이너를 못 찾는다 | — |
| VM 크기는 옵션 없이도 호스트에 맞춘다 (메모리 절반·최대 8GB·최소 2GB, CPU 코어 수·최대 4, 디스크 60GB) | 옵션 없이 실행해도 설치가 끝나야 한다 | — |
| 환경 이름을 생략한 `omk env …` 는 **오류가 맞다** | 사용자 결정. 기본 환경으로 넘어가게 만들지 않는다 | — |
| Linux·WSL2 는 바꾸지 않는다 | Colima 는 macOS 전용이다 | — |

범위 밖으로 정한 것: 격리 구조(작업별 컨테이너 · VM 1개), 샌드박스 런타임 선택(gVisor·Kata), 중첩 VM, 사용자별 VM,
Docker in Docker. 지금의 샌드박스(`--cap-drop ALL` · `no-new-privileges` · `--read-only` · 비-root)에 Docker 소켓이나
`--privileged` 를 주면 격리가 사라진다.

## 커밋

| 커밋 | 내용 |
|---|---|
| `4f88d90` feat(install) | 설치기(`scripts/setup/mac/30-toolchain.sh`), 접속 규칙(`omk.sh` · `openmake_llm.sh` · `uninstall.sh` · `db-backup.sh`), `.env` 에 `DOCKER_HOST`, 문서 |
| `3efbb37` fix(mcp) | MCP 샌드박스가 `DOCKER_HOST` 를 docker 프로세스에 넘긴다. 서버 설정의 `DOCKER_*` 키는 버린다 |
| `80fa876` fix(task-sandbox) | 파일 1초 지연 대응 — 컨테이너 안에서 쓰기, 새 이름으로 실행, stdin EPIPE |
| `d7dd81b` feat(omk) | 설치·갱신·리셋의 출력을 `~/.openmake/logs/omk/` 에 자동으로 남긴다 |

## 실측 — 2026-09-29, Apple M1 · RAM 8GB · macOS 27 · Colima 0.10.3 · lima 2.2.0

이 Mac 에는 Docker Desktop 이 없었다.

| 확인 | 결과 |
|---|---|
| `omk dev setup` (옵션 없음) | 성공. 화면 승인 없이 약 5분. `[ERR]`·`[WARN]` 없음 |
| VM | CPU 4 · 메모리 4GB(자동) · 데이터 디스크 60GB. `colima list` 의 시스템 디스크 20GB 는 별개다 |
| uid 1000 컨테이너가 홈 아래 workspace 에 쓰기 (샌드박스와 같은 제한) | 통과 |
| 홈 밖(`/tmp/…`)을 마운트 | 컨테이너에 **빈 디렉터리**가 보인다 → `TASK_SANDBOX_ROOT` 를 홈 아래로 잡는 이유 |
| 기본 docker 컨텍스트 | `default` 그대로. `colima-openmake` 컨텍스트는 만들어진다 |
| compose 가 Colima 에서 동작 | 통과 |
| 컨테이너 → Mac 의 서비스 (`host.docker.internal`) | 통과 |
| 이미 뜬 VM 에 `colima start` 재실행 | 무해 (`already running, ignoring`) |

### 파일 공유의 1초 지연 — 가장 중요한 발견

Colima(virtiofs)는 **컨테이너가 방금 본 파일을 호스트가 덮어쓰면 약 1초 동안 예전 크기로 읽는다.**
`node-written-longer-content` 를 쓴 직후 컨테이너는 `no` 두 글자만 읽었다.

| 방식 (쓰고 곧바로 읽기 × 20) | 잘못 읽음 |
|---|---|
| 호스트가 쓰기 · 고정 이름 | **18회** |
| 호스트가 쓰기 · 호출마다 새 이름 | 0회 |
| 컨테이너 안에서 쓰기 → 컨테이너가 읽기 | 0회 |
| 컨테이너 안에서 쓰기 → 호스트가 읽기 | 0회 |

컨테이너 안에서 쓰기는 한 번에 평균 41ms. 새 파일·삭제·컨테이너가 쓴 것을 호스트가 읽는 방향에는 지연이 없다.
Docker Desktop 에도 같은 현상이 있는지는 **확인하지 못했다.**

대응 두 가지가 모두 들어가 있다.
- `TaskSandbox.writeFile` 이 컨테이너 안에서 쓴다 (`writeViaContainer` — docker 접속처가 Colima 일 때만 자동).
- `python_execute` · `browser` · `skill_run` 은 실행 파일을 호출마다 새 이름으로 만든다 (`runFresh`).

## 남은 검증

| # | 확인 | 방법 | 필요한 것 |
|---|---|---|---|
| 1 | 전체 설치 | `scripts/env/omk.sh env install dev --ref feature/colima-docker-runtime` | 런타임 이미지 약 7GB 빌드. RAM 16GB 이상 권장 |
| 2 | **실제 에이전트 작업에서 컨테이너 안 쓰기가 도는가** | 1 뒤에 웹에서 에이전트 작업 실행. 같은 파일을 연달아 고치고 실행하는 작업으로 | 1 |
| 3 | 런타임 이미지에 `sh` · `cat` · `mkdir` · `dirname` 이 있는가 | `docker --context colima-openmake run --rm openmake-task-runtime:dev sh -c 'command -v cat mkdir dirname'` | 1 |
| 4 | MCP 샌드박스 컨테이너가 Colima 에 뜨는가 | stdio MCP 서버 연결 뒤 `docker --context colima-openmake ps --filter label=openmake.serverId` | 1 |
| 5 | 재부팅 뒤 VM 과 컨테이너가 올라오는가 | 재부팅 → 로그인 → 2분 뒤 `colima status --profile openmake`, `omk env status dev`, `tail ~/.openmake/logs/colima.log` | — |
| 6 | 지우고 다시 설치 | 아래 "전부 지우기" 뒤 `omk dev setup` | — |
| 7 | **Docker Desktop 이 함께 있는 Mac** | 설치 전후로 `docker context ls` 의 `*` 와 기존 컨테이너가 그대로인지 | 그런 Mac |
| 8 | Intel Mac | `brew install colima`, `--vm-type vz` 가 되는지 | Intel Mac. 없으면 "확인하지 않음"으로 둔다 |
| 9 | `omk dev up` 으로 앱과 bench 가 뜨는가 | bench 는 아래 "기존 문제"의 `better-sqlite3` 확인 | — |

2 가 가장 중요하다. 단위 테스트는 가짜 `docker` 로 돌렸고, Colima 실측은 앱 코드가 아니라 같은 명령을 셸에서 직접 실행한 것이다.

실패하면 `~/.openmake/logs/omk/` 의 최신 로그를 본다. 설치가 도는 동안에는 스크립트를 고치지 않는다 —
bash 는 실행하면서 파일을 읽으므로, 도중에 바뀌면 엉뚱한 곳에서 실패한다.

### 전부 지우기

```bash
launchctl bootout gui/$(id -u)/com.openmake.colima; rm -f ~/Library/LaunchAgents/com.openmake.colima.plist
colima delete --profile openmake --force      # VM 안의 컨테이너·볼륨(DB)·이미지가 모두 사라진다
rm -rf ~/.colima/openmake
mv .env .env.wiped.$(date +%H%M%S)            # 작업 클론에서 — 새 설치처럼 시험하려면
brew uninstall colima docker docker-compose docker-buildx && brew autoremove   # brew 설치까지 다시 볼 때만
```

LaunchAgent 를 먼저 지운다 — 남아 있으면 다음 로그인 때 빈 VM 을 다시 만든다.

## 미룬 것 (리뷰에서 나온 낮은 우선순위)

| 항목 | 영향 |
|---|---|
| 설치기를 돌릴 때마다 LaunchAgent 를 bootout → bootstrap 한다 | 동작에는 문제없다 |
| 기본 Docker 가 꺼져 있고 `.env` 가 있으면 설치가 멈춘다. 우회 옵션이 없다 | Docker 를 켜고 재실행해야 한다 |
| `ensure_docker` 는 사용자가 둔 `DOCKER_HOST` 를 덮고 `omk` 는 존중한다. `DOCKER_CONTEXT` 가 export 돼 있으면 접속 규칙이 무시된다 | 그런 설정이 있는 Mac 에서만 |
| VM 이 꺼져 있을 때 운영 스크립트가 `colima start` 를 안내하지 않는다 | docker 의 연결 오류만 보인다 |
| `ensure_docker` 분기 · `install_colima` · `colima_start` · `enable_docker_autostart` 는 단위 테스트가 없다 | 실제 설치로 확인한다 |
| SSH 로 설치하면 `launchctl bootstrap gui/…` 이 실패한다 | plist 는 남아 다음 GUI 로그인 때 로드된다 |
| `OMK_ROOT` 나 작업 클론이 홈 밖이면 마운트가 빈다 | Colima 는 홈만 공유한다 |
| `.env.example` 의 주석 `macOS(Docker Desktop) 포함` | 표현만 옛것 |
| 입력 첨부 복사(`importFile`)는 호스트에서 한다 | 같은 이름으로 다시 첨부하면 1초 지연 |
| 개발 서버(`omk dev up`)는 `TASK_SANDBOX_ROOT` 를 설정하지 않는다 | 개발 서버에서 샌드박스를 켜면 workspace 가 VM 에 안 보인다. README 에 적어 두었다 |

## 이번 변경과 무관한 기존 문제

| 항목 | 내용 |
|---|---|
| `omk dev status` 의 docker 줄이 비어 있다 | 컨테이너를 `openmake-dev-*` 로 찾는데 개발 서버는 `openmake-local-*` 다 (`cmd_dev_status`) |
| bench 의존성 설치 때 `better-sqlite3` · `esbuild` 의 설치 스크립트가 실행되지 않는다는 npm 경고 | bench 가 실행 시 실패할 수 있다. 확인하지 않았다 |
| `uninstall.sh` 의 shellcheck 경고 (`C_ERR` 미사용) | CI lint 대상이 아니다 |

## 테스트

```bash
bash scripts/env/omk.test.sh                  # 188
bash scripts/setup/mac-toolchain.test.sh      # 35 — scripts/setup/mac/ 안에 두지 않는다(설치기가 그 디렉터리의 *.sh 를 전부 source 한다)
npm run build:packages
npm test --workspace=apps/api -- src/services/task-sandbox src/addons/mcp-runtime
```

shellcheck 가 없으면 `npx --yes shellcheck@latest -S warning <파일…>`. 프로젝트는 Node 24 를 요구한다 —
Homebrew 의 기본 node 가 다른 버전이면 `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.

## 브랜치 운영

`dev` 는 계속 쓰는 개발용 브랜치다(2026-09-29 결정). [README.md](README.md) 는 아직 "장수 브랜치는 `main` 하나"라고 적고 있다.

| 정해진 것 | 정해지지 않은 것 |
|---|---|
| 작업 기준은 `origin/dev` | CI(`ci.yml`)는 `main` 의 push/PR 에서만 돈다 — `dev` 로 가는 PR 은 검사되지 않는다 |
| `dev` → `main` 은 squash 가 아니라 **일반 머지**로 올린다(squash 는 `dev` 와 `main` 의 연결을 끊어 올릴 때마다 충돌한다) | README 의 브랜치 설명 |
| 커밋 제목은 `feat(…):` · `fix(…):` 형식을 지킨다 — release-please 가 그대로 CHANGELOG 에 쓴다 | |

이 브랜치를 `dev` 에 합치면 `feat` 커밋이 있어 다음 릴리스는 minor 가 올라간다.
