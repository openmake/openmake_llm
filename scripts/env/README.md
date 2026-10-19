# 환경 운영 — dev / staging / online

> `omk` 사용 설명서. 스크립트는 이 디렉터리의 [`omk.sh`](omk.sh) 이고, Windows 진입점은 [`omk.ps1`](omk.ps1), 순수 함수 테스트는 [`omk.test.sh`](omk.test.sh) 다.

`openmake_llm` 을 세 환경으로 나눠 운영한다(`openmake_bench` 는 add-on — `--bench` 로 고른 환경에만 붙는다). 환경은 서로 **env 파일·docker·PM2 가 분리**되어 있어, 하나가 꼬이면 그것만 지우고 다시 설치할 수 있다. 진입점은 `scripts/env/omk.sh` 하나다.

```
로컬 개발(로컬 장비 · `omk dev up`)
   │ push
feature/<주제> ──PR(CI 필수)──▶ dev ──사람이 `omk env update dev`──▶ ~/.openmake/dev       개발 서버
                          │                    (설치·기능 확인)
                          └──PR(일반 머지 · CI 필수)──▶ main ──사람이 `omk env update staging`──▶ ~/.openmake/staging   스테이징 서버 · staging-chat.<도메인>
                                                         │                     (기능 확인 → `omk env verify staging` 으로 확인한 커밋 기록)
                                                         └──(release-please 릴리스 직후) 사람이 `omk env update online`──▶ ~/.openmake/online   온라인 서버 · chat.<도메인>
                                                                               (릴리스 게이트 → 스모크만)
```

| 이름 | 장소 | 경로 | 무엇 |
|---|---|---|---|
| **로컬 개발** | 로컬 장비 | 작업 클론 | `omk dev up` — 고치면서 바로 보는 핫 리로드. 환경이 아니다 |
| **환경 dev** | 개발 서버 | `~/.openmake/dev` | `omk env install dev` 로 설치한 배포본. 브랜치 `dev` 를 따른다 |
| **환경 staging** | 스테이징 서버 | `~/.openmake/staging` | 설치한 배포본. `main` 을 따른다 |
| **환경 online** | 온라인 서버 | `~/.openmake/online` | 실사용. 최신 릴리스 태그를 따른다 |

장소는 **역할의 이름**이다 — 한 대가 여러 역할을 맡아도 된다(예: 개발 서버와 스테이징 서버가 같은 호스트). 환경은 서로 분리되어 있다.

장수 브랜치는 **`main` 과 `dev` 둘**이다. `dev` 는 `feature/*` 가 모이는 개발용 브랜치이고, `main` 은 staging·릴리스가 따르는 브랜치다.
환경은 브랜치가 아니라 설치본의 이름이다 — **환경 dev 는 브랜치 `dev` 를, 환경 staging 은 `main` 을** 따르고, online 은 릴리스 직후의 main 을 사람이 올린다.
무거운 검증은 GitHub 러너의 CI 와 staging 에서 하고, online 에서는 스모크만 한다.

**online 과 외부 설치는 main 이 아니라 최신 릴리스 태그를 따른다.** main 은 공개 저장소이지만 개발이 모이는 곳이다 — staging 에서 확인하기
전의 main 을 운영이나 외부 설치자가 받으면 안 된다. `omk env install online` 의 기본 ref 는 `release`(가장 높은 `vX.Y.Z` 태그)이고,
`omk env update online` 은 새 릴리스 태그가 있을 때만 그 태그까지 fast-forward 한 뒤(그 사이 `package-lock.json` 이 바뀌었으면 `npm install` 로 의존성을 맞추고) `openmake_llm.sh deploy` 를 부른다. 어느 환경이든
`--ref release` 로 같은 방식을 고를 수 있다(`.env` 의 `OMK_TRACK=release`). `openmake_bench` 는 릴리스 태그가 없어 main 을 쓴다.
bench 의 브랜치는 `--bench-ref` 로 정한다 — 주지 않으면 **llm 의 `--ref` 와 같은 이름**을 찾으므로, llm 에만 있는 `feature/*` 를
올리면서 bench 도 붙일 때는 `--bench --bench-ref main` 으로 준다(같은 이름의 브랜치가 없으면 bench 클론에서 설치가 멈춘다).

**브랜치 `dev` 에 합친 것을 확인하는 곳은 환경 dev 다** — 머지한 뒤 `omk env update dev` 로 올려 실제 설치를 확인하고, 통과한 뒤에 `dev` 를 `main` 으로 올린다.
머지 전에 따로 보고 싶은 브랜치는 임시 환경에 올린다(`omk env install pr-123 --ref <브랜치>`). staging 은 **머지된 main** 을 본다(여러 PR 이 합쳐진 결과, update·마이그레이션 경로).

**CI 는 `main` 과 `dev` 의 push/PR 에서 돈다.** `feature/*` 는 PR 로만 `dev` 에 합치고, CI 를 통과해야 머지한다 — 검사가 `dev` → `main` PR 에
몰리면 실패한 커밋을 찾기 어렵다. CI 는 "설치해서 도는지"를 보지 않으므로, 그것은 머지 뒤에 환경 dev 에서 본다.
리뷰 승인은 지금은 필수가 아니다(개발 인원이 늘면 브랜치 보호에서 켠다). `openmake_bench` 는 `dev` 브랜치가 없다 — `main` 에서 따서 `main` 으로 합치고,
환경 dev 에 `--bench` 로 붙이면 bench 는 `main` 을 쓴다.

## 환경 규칙

| | dev | staging | online |
|---|---|---|---|
| 위치 | `~/.openmake/dev/llm` | `~/.openmake/staging/llm` | `~/.openmake/online/llm` |
| 따르는 것 | 브랜치 `dev` 최신 (브랜치 `dev` 가 없는 저장소는 `--ref main`) | `main` 최신 | **최신 릴리스 태그** (`release`) |
| 인스턴스 | `dev` (이름 있음) | `staging` (이름 있음) | **기본(무접미사)** |
| 포트 | install.sh 가 할당 | install.sh 가 할당 | **소스의 기본 포트** (52416 / 3000 / 5432 / 6379 / 9400 / 33000) |
| PM2 | `openmake-{llm,next,litellm}-dev` | `openmake-{llm,next,litellm}-staging` | `openmake-{llm,next,litellm}` |
| docker | `openmake-dev-*` | `openmake-staging-*` | `openmake-*` |
| 배포 | **수동** `omk env update dev` | **수동** `omk env update staging` | **수동** `omk env update online` |

`--bench` 로 설치한 환경은 `~/.openmake/<env>/bench` 와 PM2 `openmake-bench[-<env>]` 가 더 생긴다.

**작업 클론의 로컬 개발(`omk dev …`)은 환경이 아니다** — `~/.openmake` 아래에 두지 않고, 인스턴스 이름 `local`(docker `openmake-local-*`)로
앱이 PM2 없이 포그라운드에서 돈다. 환경 `dev` 와 이름이 비슷하지만 별개다 — 다만 앱이 기대는 것(검색·런타임 이미지·게이트웨이·기본 모델)은
환경 설치와 **같은 함수**로 준비한다([로컬 개발](#로컬-개발--omk-dev-작업-클론--핫-리로드)).

- **online 이 기본 인스턴스인 이유** — 소스(`install.sh`·`gen-env.mjs`·`resolve-ports.cjs`·문서)의 기본 포트와 이름이 곧 운영 값이다. online 을 기본 인스턴스로 두면 포트 표를 어디에도 다시 적을 필요가 없다.
- **이름 있는 인스턴스의 포트**는 `install.sh` 규칙을 따른다 — 기본은 한 칸 옆(52417/3010/5433/6380)이고, 그 포트가 쓰이고 있으면 옮긴다
  (API 는 다음 빈 포트, 웹 13000~, PostgreSQL 15432~, Redis 16379~). **omk 는 포트를 기억하지 않고 각 환경의 `.env` 를 읽는다** — 실제 값은 `omk env status <env>` 로 본다.
- 충돌 판정은 **설치하는 순간 열려 있는 포트**만 본다. 같은 호스트의 다른 환경이나 로컬 개발이 멈춰 있을 때 설치하면 같은 포트를 받을 수 있다 —
  나란히 쓸 환경은 띄워 둔 채 설치한다. 로컬 개발이 겹쳤으면 `omk dev setup` 을 다시 돌리면 옮겨진다. 환경끼리 겹친 것은 자동으로 옮기지 않는다
  (PM2 에 등록된 앱의 포트는 자기 것으로 본다) — 한쪽을 `omk env reset` 한 뒤, 다른 쪽을 띄워 둔 채 다시 설치한다.
- 호스트 구성은 자유다. 개발 서버·스테이징 서버·온라인 서버가 같은 호스트여도 되고 달라도 된다. 로컬 개발은 개발자마다 자기 로컬 장비에 둔다.

## 개발에서 배포까지 — 환경별로 할 것 / 하지 말 것

| # | 어디서 | 무엇을 | 명령 |
|---|---|---|---|
| ① | **로컬 개발** (로컬 장비) | 브랜치 `dev` 에서 브랜치를 따 핫 리로드로 수정 → 로컬 테스트 → push | `git switch -c feature/<주제> origin/dev` · `omk dev up` … `git push -u origin feature/<주제>` |
| ② | GitHub | `feature/*` → `dev` PR → CI → **일반 머지** (직접 push 하지 않는다) | `gh pr create --base dev` |
| ③ | **환경 dev** (개발 서버) | 합쳐진 `dev` 가 실제로 설치되고 도는지 확인 | `omk env update dev` (처음 한 번: `omk env install dev --tailscale`) |
| ④ | GitHub | `dev` → `main` PR → CI → 리뷰 → **일반 머지** | `gh pr create --base main --head dev` |
| ⑤ | **환경 staging** (스테이징 서버) | 머지된 main 을 기존 데이터 위에서 update 로 확인 | `omk env update staging` |
| ⑥ | **환경 staging** (스테이징 서버) | 확인을 마친 커밋을 기록 | `omk env verify staging` |
| ⑦ | GitHub | release-please 의 릴리스 PR 머지 → `vX.Y.Z` 태그 (⑥ 뒤에 main 에 머지된 것이 없을 때) | 릴리스 PR 머지 |
| ⑧ | **환경 online** (온라인 서버) | 새 릴리스 태그로 올리고 스모크 확인 — 게이트가 ⑥ 의 기록을 본다 | `omk env update online` |

기본은 전부 **수동**이다 — 머지·릴리스만으로는 어떤 환경도 바뀌지 않는다. 앞 단계를 통과하기 전에는 다음 단계로 가지 않는다
(환경 dev 통과 전 `main` 으로 올리지 않는다, staging 통과 전 릴리스 금지). ②~⑤ 를 사람 없이 잇는 방법은 아래 [자동 승격](#자동-승격--staging-까지-사람-없이-선택).

`dev` 를 `main` 으로 올릴 때는 squash 하지 않는다 — squash 는 `dev` 와 `main` 의 연결을 끊어, 다음에 올릴 때마다 이미 올린 변경이 충돌한다.
커밋 제목은 `feat(…):` · `fix(…):` 형식을 지킨다 — 일반 머지라 `dev` 의 커밋 제목이 그대로 `main` 에 들어가고, release-please 가 그것을 CHANGELOG 에 쓴다.

### 자동 승격 — staging 까지 사람 없이 (선택)

환경이 스스로 갱신하고, 갱신한 커밋에 결과를 붙이고, 그 결과가 다음 단계를 연다. 사람의 관문은 staging 확인과 `verify` 부터다(⑥~⑧ 은 그대로).

```
feature PR → dev (CI 통과 시 자동 머지)
  → 환경 dev 가 주기마다 dev 를 받아 update → 스모크 → 그 커밋에 표지 omk/env-dev
  → dev → main PR 자동 생성 · CI 와 omk/env-dev 가 모두 통과하면 자동 머지 (일반 머지)
  → 환경 staging 이 주기마다 main 을 받아 update → 스모크 → 표지 omk/env-staging
  → 사람: staging 확인 → verify → 릴리스 PR → online
```

| 조각 | 하는 일 | 켜는 곳 |
|---|---|---|
| `omk env smoke <env>` | health · 빌드본의 API 포트 · 웹의 `/generated` 경로 · 로그인 · `/ready`(LLM 노드·DB·기본 모델, 쓰기 없음) · 채팅 1회. 릴리스를 따르는 환경(`OMK_TRACK=release` — 기본 online)은 채팅을 빼고 쓰기 없는 검사만 한다. 하나라도 실패하면 종료 코드 3 | 그 환경 `.env` 의 `OMK_SMOKE_EMAIL` · `OMK_SMOKE_PASSWORD` (스모크가 로그인할 계정) |
| 결과 표지 | 갱신 → 스모크 뒤 그 커밋에 GitHub 커밋 상태 `omk/env-<env>` 를 붙인다. 갱신이 실패해도 실패로 붙인다 | 그 환경 `.env` 의 `OMK_STATUS_TOKEN` (커밋 상태 쓰기 권한만) → `omk env autoupdate <env>` 를 다시 실행 |
| `promote` 워크플로 | dev 에 push 될 때 dev → main PR 을 만들고(있으면 그대로) 자동 머지를 건다 | 저장소 시크릿 `OMK_PROMOTE_TOKEN` · 저장소 설정 "Allow auto-merge" |
| main 보호 규칙 | 필수 체크에 `omk/env-dev` 를 더한다 — 환경 dev 가 확인하지 않은 커밋은 main 에 들어가지 못한다 | 저장소 설정 |

- 표지는 **확인한 커밋**에 붙는다. PR 의 최신 커밋을 환경이 아직 받지 않았으면 표지가 없어 자동 머지가 기다린다.
- 실패하면 표지가 실패로 남고 다음 단계가 열리지 않는다. 환경은 이전 버전 그대로 돈다. 실패로 남은 커밋은 다음 주기에 스모크를 다시 본다 —
  바로 다시 보려면 `omk env smoke <env> --report`.
- 갱신(빌드·마이그레이션)이 실패한 커밋은 다음 주기에 새 커밋이 없어도 갱신부터 다시 한다 — 갱신 없이 스모크만 보면 예전 빌드본이 통과해 버린다.
- **켜는 순서**: 환경 dev 가 표지를 붙이기 시작 → main 필수 체크에 `omk/env-dev` 추가 → `OMK_PROMOTE_TOKEN` 등록. `promote` 는 필수 체크에
  `omk/env-dev` 가 없으면 PR 만 만들고 자동 머지를 걸지 않는다.
- 통과를 기록한 커밋은 다시 보지 않는다 — 스모크의 채팅 1회는 그 계정에 대화 기록을 한 건 남긴다(릴리스를 따르는 환경은 채팅을 보내지 않는다).
- `OMK_STATUS_TOKEN` 이 없는 환경의 autoupdate 는 지금까지처럼 갱신만 한다. `OMK_PROMOTE_TOKEN` 이 없으면 `promote` 는 아무것도 하지 않는다.
- `OMK_PROMOTE_TOKEN` 은 기본 `GITHUB_TOKEN` 이 아니어야 한다 — 기본 토큰으로 만든 PR·머지는 CI 와 release-please 를 깨우지 않는다.
- 릴리스를 따르는 환경(online)은 대상이 아니다 — 릴리스 게이트가 `verify` 기록을 본다.

### dev — "합쳐진 dev 가 실제 환경에서 도는가"

| 할 것 | 하지 말 것 |
|---|---|
| 브랜치 `dev` 에 머지될 때마다 `omk env update dev` — **설치가 끝까지 되는지**부터 본다 | 환경 dev 를 건너뛰고 `dev` 를 `main` 으로 올리지 않는다 — CI 는 "설치해서 도는지"를 보지 않는다 |
| 바꾼 기능 + 기본 동작(채팅·웹 검색·에이전트 작업·아티팩트 내보내기)을 확인한다 | dev 의 결과로 **답변 품질·에이전트 성공률**을 판단하지 않는다 — 기본 모델은 작다. dev 가 증명하는 것은 배선과 구조다 |
| 꼬이면 망설이지 말고 `omk env reset dev --reinstall` — 데이터는 버리는 것이다 | 남기고 싶은 데이터를 dev 에 두지 않는다 |
| 문제가 나오면 로컬 개발에서 고쳐 → push → 브랜치 `dev` 에 머지 → `omk env update dev` | 환경 디렉터리(`~/.openmake/dev/llm`)의 소스를 직접 고치지 않는다 |
| 머지 전에 따로 볼 브랜치는 **임시 환경**에 올린다: `omk env install pr-123 --ref <브랜치>` → 끝나면 `omk env reset pr-123` | 환경 dev 에 `--ref` 만 바꿔 다시 install 하지 않는다 — 이미 있는 클론은 그대로 재사용되어 **이전 브랜치가 설치된다**(로그의 "소스 재사용: … (브랜치)" 한 줄로만 드러난다) |
| 무거운 실험(새 모델, 설정 변경, 일부러 깨뜨리기)은 여기서 한다 | 임시 환경을 방치하지 않는다 — 환경마다 DB·게이트웨이·이미지가 따로 생긴다 |

### staging — "합쳐진 main 이 online 에 올라가도 되는가"

| 할 것 | 하지 말 것 |
|---|---|
| **항상 main** (`--ref` 없이 설치). 머지될 때마다 `omk env update staging` | `--ref feature/*` 로 PR 을 시험하지 않는다 — 그것은 임시 환경의 일이다 (예외: 환경 매니저 자체를 바꾸는 브랜치의 공존 시험) |
| **update 경로**로 올린다 — online 도 update 로 올라가므로 같은 길을 먼저 밟는다 | 습관적으로 reset → 재설치하지 않는다 — 마이그레이션이 기존 데이터에서 도는지 볼 수 없게 된다 |
| 데이터를 **유지**한다(계정·대화·작업이 쌓여 있어야 마이그레이션 검증이 된다). reset 은 정말 꼬였을 때만 | 실사용 데이터·비밀값을 가져다 넣지 않는다 — 환경은 소스에서 설치한 것만으로 선다 |
| 여러 PR 이 합쳐진 결과의 **기능 확인은 여기까지** 끝낸다 | 통과하기 전에 릴리스 PR 을 머지하지 않는다 |
| 확인이 끝나면 `omk env verify staging` — 그 커밋에서 나온 릴리스만 online 에 올라간다 | 확인하지 않고 verify 하지 않는다. verify 뒤에 main 에 머지가 더 들어왔으면 update → 확인 → verify 를 다시 한다 |
| 문제가 나오면 수정(①부터) 또는 revert | staging 에서 직접 핫픽스하지 않는다 |

### online — "실사용"

| 할 것 | 하지 말 것 |
|---|---|
| 릴리스 직후 `omk env update online` — **최신 릴리스 태그**로만 올라간다(새 태그가 없으면 아무 일도 하지 않는다) | main HEAD·`feature/*` 를 올리지 않는다 (`--ref` 로 브랜치를 주지 않는다) |
| **스모크만**: 접속 200 · 로그인 · `/ready`(LLM 노드·DB·기본 모델) · `omk env status online` — **채팅은 보내지 않는다**. 코드 동작은 같은 커밋으로 staging 에서 확인했고(릴리스 게이트), online 에서 새로 생길 수 있는 고장은 연결·설정이라 쓰기 없는 `/ready` 로 본다(대화 기록·모델 호출을 남기지 않는다) | 부하 시험·대량 평가·동시 다발 요청 같은 **무거운 검증을 하지 않는다** — 운영 모델 서버를 공유한다. 그런 것은 CI 와 staging 에서 끝낸다 |
| 매일 백업을 걸어 둔다(`omk env backup online --schedule`). `update` 는 올리기 직전에 한 번 더 뜬다 | `omk env reset online` 을 하지 않는다 — 볼륨(DB)까지 지운다. 옮길 때는 `db-dump` → `db-restore` |
| 게이트를 켜 둔다(`.env` 의 `OMK_RELEASE_GATE=1`) — staging 에서 확인하지 않은 릴리스는 올라가지 않는다 | `--force-unverified` 를 습관적으로 쓰지 않는다 — 급한 수정에만, 쓴 기록은 `logs/release-gate.log` 에 남는다 |
| 문제가 나면 수정 → 새 릴리스 → update. 급하면 이전 태그로 되돌리고 `./openmake_llm.sh deploy` | online 에서 실험·설정 시험·모델 교체 시험을 하지 않는다 |
| 호스트별 값(도메인·모델 서버 주소·키)은 그 환경의 `.env`·`litellm.env` 에만 둔다 | 저장소에 호스트 경로·주소·키를 적지 않는다 |

| | dev | staging | online |
|---|---|---|---|
| 올리는 방식 | update (꼬이면 reset + install) | **update 만** | **update 만** |
| 데이터 | 버림 | 유지 | 절대 보존 |
| 검증 깊이 | 기능 전부(배선·구조) | 기능 + update·마이그레이션 | 스모크만 |
| 모델 | 호스트 기본 모델 또는 지정 | 같음 | 운영 모델 서버 (`--qwen-vllm-base …`) |

## 릴리스 게이트 — staging 에서 확인한 커밋만 online 에

릴리스 태그는 **릴리스 PR 을 머지한 순간의 main** 에 찍힌다. staging 을 마지막으로 올린 뒤에 머지된 PR 은 확인 없이 릴리스에 들어간다 —
게이트는 그 경우를 막는다. 브랜치를 늘리지 않고, 확인한 커밋과 릴리스 사이의 연결만 강제한다.

```bash
# 스테이징 서버 — 기능·마이그레이션 확인을 마친 뒤
omk env verify staging            # 검사(깨끗한 작업 트리 · origin/main 에 있는 커밋 · health) → origin 에 기록
omk env verify staging --list     # 기록 보기 (어느 환경에서든)

# 온라인 서버 — 한 번 켠다 (.env 에 OMK_RELEASE_GATE=1 을 적거나, 설치할 때 --release-gate)
omk env update online             # 확인된 릴리스만 올라간다
```

- **기록**은 origin 의 `refs/omk/verified/<커밋>` 이다. 브랜치·태그가 아니라 GitHub 화면에는 보이지 않고, 환경들이 다른 호스트에 있어도 읽힌다.
- **통과 조건** — 기록된 커밋이 릴리스 태그의 조상이고, 그 사이에 바뀐 것이 릴리스 메타데이터뿐이다: `release-please-config.json` 의 `extra-files`·
  `changelog-path`, 루트 `package.json`·`package-lock.json`·`.release-please-manifest.json`. JSON 은 바뀐 줄이 버전뿐이어야 한다(릴리스 커밋에 섞인 의존성 변경은 거부).
  허용 목록은 **확인한 커밋**의 설정에서 읽는다.
- **거부되면** 아무것도 바꾸지 않고 종료 코드 2 로 끝난다 — 환경은 지금 버전 그대로 돈다. 확인하지 않은 커밋과 경로를 출력한다. `autoupdate` 도 같은 게이트를 지난다.
- **급한 수정**은 `omk env update online --force-unverified` — 물어본 뒤 진행하고 `~/.openmake/online/logs/release-gate.log` 에 남긴다.
- 게이트는 **켠 환경에서만** 동작한다. 외부 설치본은 기록을 쓸 권한도 staging 도 없으므로 기본은 꺼져 있다. `openmake_bench` 는 릴리스 태그가 없어 대상이 아니다.

**스테이징 서버의 쓰기 권한** — `verify` 는 origin 에 push 한다. 설치된 클론의 origin 은 https(읽기 전용)이므로 push 할 주소를 따로 준다.

```bash
OMK_VERIFY_PUSH_URL=git@github.com:openmake/openmake_llm.git omk env verify staging
```

| 방법 | 설명 |
|---|---|
| SSH agent forwarding (권장) | `ssh -A staging-host` 로 들어가 실행한다 — 확인한 사람의 키를 그때만 쓰고, 호스트에 자격 증명이 남지 않는다 |
| 쓰기 권한 deploy key | 호스트에 저장해야 할 때. 그 키로 `main`·`v*` 태그를 고칠 수 없게 브랜치 보호·태그 ruleset 을 먼저 확인한다 |

## 설치 — 아무것도 없는 PC 에서 한 줄

```bash
# macOS / Linux / WSL2
curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh \
  | bash -s -- env install staging --public-url https://staging-chat.example.com

curl -fsSL https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.sh \
  | bash -s -- env install online  --public-url https://chat.example.com     # 최신 릴리스 태그를 설치한다
```

```powershell
# Windows — WSL2(Ubuntu) 를 확인하고 그 안에서 같은 스크립트를 실행한다
irm https://raw.githubusercontent.com/openmake/openmake_llm/main/scripts/env/omk.ps1 -OutFile omk.ps1
.\omk.ps1 env install staging --public-url https://staging-chat.example.com
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
평문 HTTP 라 **신뢰하는 망(Tailscale·사내망)에서만** 쓴다 — 밖으로 공개할 때는 `--public-url` + 터널.

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
4. 런타임 이미지를 다시 빌드한다 (`omk env update`, 또는 `docker build` 를 직접).

## Docker — macOS 는 전용 Colima

macOS 의 openmake 는 **자기 Colima VM**(프로필 `openmake`)에서만 컨테이너를 돌린다. Docker Desktop 은
로그인·약관·업데이트 창에서 사람을 기다리므로 서버에 맞지 않는다. Mac 에 Docker Desktop 이 있어도
지우거나 설정을 바꾸지 않는다 — 터미널의 `docker` 는 계속 그쪽을 가리키고, openmake 만 Colima 를 쓴다.

| | |
|---|---|
| 최소 사양 | Apple Silicon · RAM 16GB (Docker Desktop 을 함께 쓰면 32GB 권장) |
| VM 크기 | 옵션 없이 설치하면 호스트에 맞춘다 — 메모리는 호스트의 절반(최대 8GB · 최소 2GB), CPU 는 코어 수(최대 4), 디스크 60GB. 직접 정하려면 처음 만들 때 `OMK_COLIMA_CPU`·`OMK_COLIMA_MEMORY`·`OMK_COLIMA_DISK` |
| 접속 | `DOCKER_HOST=unix://$HOME/.colima/openmake/docker.sock` — omk·`openmake_llm.sh`·`uninstall.sh`·`db-backup.sh` 는 소켓이 있으면 스스로 설정하고, 앱은 `.env` 의 값을 쓴다 |
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

### Docker Desktop 에서 옮기기

이미 Docker Desktop(또는 다른 Docker)으로 운영 중인 호스트는 설치기를 다시 돌려도 옮기지 않는다 — DB 가 그쪽에 있다.
**한 호스트는 한 Docker 만 쓴다** — 기본 Docker 에 `openmake[-<env>]-postgres` 컨테이너가 하나라도 남아 있으면 Colima 를 설치하지 않는다.

옮기는 동안 **기본 Docker 는 켜 둔다**(꺼져 있으면 설치기가 컨테이너 유무를 볼 수 없어 멈춘다).
`reset` 은 환경 디렉터리를 통째로 지운다 — DB 는 백업에서, `.env` 는 `--keep-env` 가 보존한 것에서 되살리고,
그 밖에 남길 파일(업로드·생성 파일 등 `~/.openmake/<env>/llm` 아래의 것)은 먼저 다른 곳에 복사해 둔다.

환경이 하나인 호스트:

```bash
omk env backup <env>                                   # 1. DB 백업 → ~/.openmake/backups/<env>/ (reset 에도 남는다)
omk env reset <env> --keep-env --reinstall --yes       # 2. 정리 후 같은 .env 로 다시 설치 — 이제 Colima 로 간다
cd ~/.openmake/<env>/llm && ./openmake_llm.sh db-restore ~/.openmake/backups/<env>/<백업 파일>   # 3. 복원
```

환경이 여럿인 호스트는 **전부 정리한 뒤에** 다시 설치한다:

```bash
omk env backup <env>                                   # 환경마다
omk env reset <env> --keep-env --yes                   # 환경마다 — 끝에 보존한 .env 의 위치를 알려준다
OMK_RESTORE_ENV_FROM="<그 위치>" omk env install <env>   # 환경마다 — .env 를 되살려야 암호화 키·비밀번호가 백업과 맞는다
cd ~/.openmake/<env>/llm && ./openmake_llm.sh db-restore ~/.openmake/backups/<env>/<백업 파일>
```

`.env` 를 되살리지 않고 설치하면 암호화 키가 새로 만들어져, 복원한 DB 의 자격증명을 풀 수 없고 발급한 API 키가 통하지 않는다.

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

손으로 하려면 위 표 그대로 `pm2 delete …` → `docker rm -f …` → `docker volume rm …` → `rm -rf ~/.openmake/staging`. 전역 도구(Node·Docker·PM2·Caddy)는 다른 환경이 쓰므로 건드리지 않는다.

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
