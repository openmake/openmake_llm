# OpenMake Code — 로컬 브리지 CLI

내 컴퓨터의 폴더를 OpenMake 에이전트 작업의 작업 공간으로 연결하는 CLI.

서버 샌드박스(Docker) 대신 **사용자 머신에서 직접** 도구를 실행한다. 턴 오케스트레이션은
서버(`AgentTaskService` 하네스)가 하고, 이 CLI 는 **도구 실행 + 터미널 렌더**만 담당한다
(자체 에이전트 루프 없음). 데스크톱 컴패니언(`apps/desktop-native`)과 같은 브리지 프로토콜을 쓰며,
`src/bridge.ts` 는 데스크톱 `bridge.js` 의 호스트 비의존 코어를 이식한 것이다.

---

## 빌드

npm 에 배포하지 않는 private workspace 라 **레포에서 직접 빌드**한다.

```bash
# 레포 루트에서
npm run build --workspace=apps/cli     # → apps/cli/dist/
```

### ⚠️ 재빌드가 필요한 경우

`dist/` 는 git 에 포함되지 않는다(`.gitignore`). 자동 업데이트 경로도 없다.
**`git pull` 로 코드를 받은 뒤에는 반드시 다시 빌드해야** 새 기능이 적용된다.

```bash
git pull
npm run build --workspace=apps/cli
```

빌드를 빠뜨리면 옛 `dist/` 가 계속 실행되어, 서버는 새 기능을 지원하는데 CLI 만
모르는 상태가 된다. 예를 들어 **폴더 선택**(아래) 미지원 CLI 로 연결하면 웹 폴더
피커가 "이 디바이스는 폴더 탐색을 지원하지 않습니다" 로 표시된다 — 오류가 아니라
구버전 디바이스에 대한 안전한 폴백이다.

---

## 설치 (실행 경로 만들기)

`bin` 이름은 `openmake-code` 다. 셋 중 편한 방법을 쓴다.

```bash
# ① 전역 심링크 (권장)
npm link --workspace=apps/cli
openmake-code help

# ② 직접 실행
node apps/cli/dist/index.js help

# ③ 셸 alias
alias openmake-code='node /path/to/openmake_llm/apps/cli/dist/index.js'
```

---

## 사용법

```bash
openmake-code login              # 서버 URL·API key 저장 (~/.openmake/config.json, 0600)
openmake-code connect [dir]      # 폴더 상주 연결 — 웹에서 작업을 시작할 수 있게 된다
openmake-code status             # 연결 상태·디바이스 조회
openmake-code "목표" [--dir .] [--yes]   # 로컬 에이전트 작업 1회 실행
```

- `connect` 는 **전경 데몬**이다. 종료는 `Ctrl+C`.
- 디바이스당 폴더는 **하나**다. 여러 폴더가 필요하면 터미널을 여러 개 띄워 각각 `connect` 한다.
- `--yes` 는 파일 쓰기류의 **서버측 승인**만 자동화한다. 셸 명령은 별개로 아래 실행 확인이 계속 걸린다.
- 비대화형(비-TTY) 실행에서는 셸 확인에 답할 수 없으므로 명령이 **자동 거부**된다(fail-safe).

### API key 발급 — `bridge` 스코프 필수

웹 **설정 → API 키**에서 **브리지(CLI)** 스코프로 발급한다(`omk_live_...`).

> ⚠️ 브리지 WebSocket 은 `bridge` 스코프 **API key 로만** 인증된다. 세션 JWT 로는 연결이
> 거부된다(`허용되지 않은 Origin입니다`) — 네이티브 클라이언트의 Origin 검증 면제가 API key
> 연결에만 적용되기 때문이다(CSWSH 방어). 이 키는 로컬 실행 전용이라 추론 API·토큰 소비는 못 한다.

### 폴더 선택 (웹에서 하위 폴더 고르기)

`connect` 로 연결한 루트 **안의** 하위 폴더를 웹 컴포저에서 골라 그 폴더에서 실행할 수 있다.
CLI 를 다시 시작할 필요가 없다. 연결 루트 자체는 보안 경계라 바뀌지 않으며, 폴더 목록은
**디바이스가 직접 열거해 보고한 것**만 웹에 표시된다.

이 기능을 쓰려면 CLI 가 최신 빌드여야 한다(위 재빌드 안내 참고).

---

## 보안

`connect` 로 연결한 폴더 밖은 건드리지 못한다. 방어는 여러 겹이다.

- **경로 스코프** — 모든 파일 접근은 연결 폴더(또는 선택한 하위 폴더) 기준으로 검사하고,
  realpath 로 심링크 탈출까지 막는다.
- **셸 실행 3단** — ① 위험 패턴(`sudo`, pipe-to-shell, 자격증명 파일 접근 등)은 확인 없이 즉시 차단
  ② 나머지는 **실행 전 터미널 확인**(y=실행 / a=이 작업 동안 모두 / n=거부) — 서버 설정으로 우회 불가
  ③ macOS 에서는 `sandbox-exec` 로 감싸 폴더 밖 쓰기와 비밀 파일(`.ssh`·`.aws` 등) 읽기를 커널이 차단.
- **일괄 승인 범위** — `a` 는 **그 작업에만** 적용되고 작업 종료 시 회수된다.
- **worktree 격리** — 연결 폴더가 git 레포면 별도 worktree + 브랜치(`omk-task/*`)에서 작업해
  현재 작업트리·브랜치를 오염시키지 않는다. 변경분이 남으면 **지우지 않고 보존**한다.
- **폴더는 절대 삭제하지 않는다** — 작업 종료 시 서버는 종료 통지만 보낸다.

### 개발/E2E 전용 환경변수

운영에서는 쓰지 않는다.

| 변수 | 효과 |
|---|---|
| `OMK_BRIDGE_SANDBOX=0` | `sandbox-exec` 격리 해제 (미설정 시 프로파일 준비 실패하면 실행을 거부) |
| `OMK_BRIDGE_AUTO_APPROVE=1` | 셸 실행 확인을 자동 승인 |

---

## 서버 전제 조건

서버에서 로컬 실행 기능이 켜져 있어야 한다(`LOCAL_EXECUTOR_ENABLED=true`).
꺼져 있으면 `openmake-code status` 가 `로컬 실행 기능: 비활성` 으로 표시하고,
웹 컴포저의 로컬 실행 토글도 비활성 상태가 된다.

## 설정 파일

| 경로 | 내용 |
|---|---|
| `~/.openmake/config.json` | 서버 URL + API key (0600, **평문 저장**이라 파일 권한으로 보호) |
| `~/.openmake/device-id` | 호스트 고정 디바이스 id — 재실행해도 같은 디바이스로 식별된다 |
