# 적합성 fixture (conformance)

브리지 코어의 판정을 TS 구현(`packages/local-bridge-core/src`)과 Rust 구현(`apps/openmake-code/crates/omk-bridge-core`)이 똑같이 내는지 확인하는 공용 사례다.
연결부(`conn-*.json`)의 형식과 러너는 [`CONN.md`](CONN.md) 에 따로 적는다.

| 러너 | 위치 | 실행 |
|---|---|---|
| TS | `packages/local-bridge-core/src/__tests__/conformance.test.ts` | `npm test --workspace=@openmake/local-bridge-core` |
| Rust | `apps/openmake-code/crates/omk-bridge-core/tests/conformance.rs` | `cd apps/openmake-code && cargo test --locked` |

## 규칙

- **기준은 TS 의 현재 동작이다.** 기대값은 손으로 쓰지 않고, 사례 입력을 적은 뒤 TS 구현을 돌려 나온 값을 넣고 사람이 읽어 확인한다. TS 동작이 이상해 보여도 이식 PR 에서 고치지 않는다.
- 두 러너는 이 폴더의 `*.json` 을 모두 열거한다. 자기가 모르는 suite 가 있으면 실패한다. suite 는 두 러너와 같은 PR 에서만 더한다.
- 판정 사례뿐 아니라 규칙 표(차단 패턴의 `source`·`flags`·사유, 환경변수 허용 목록 등)도 fixture 에 두고 양쪽이 자기 표와 같은지 본다.
- 공통 머리: `{ "suite": "<파일 이름>", "version": 1, ... }`.
- 보이지 않는 문자(제어 문자·유니코드 공백 등)는 `\uXXXX` 로 적는다.
- 경로는 합성 경로(`/work/repo`)만 쓴다. 홈은 자리표시 `{{HOME}}` 이고 러너가 채운다(TS 는 실제 홈의 realpath, Rust 는 인자로 넘기는 임의 홈).
- 사례 id 는 묶음 안에서 겹치지 않는다. 사례가 0개인 묶음은 실패한다(두 러너 모두).
- `scope`·`file-kinds`·`request-guard` 는 두 러너가 모양도 본다 — 최상위 묶음 이름, 사례·요청·단계·`after` 의 키(정해진 키만, 오타는 실패), `requests`·`steps` 가 0개인 사례는 실패. 새 키를 쓰려면 두 러너의 허용 목록을 같은 PR 에서 늘린다.

### 파일 시스템을 만지는 suite (`scope.fs`·`file-kinds`)

- **`{{TMP}}`**: 러너가 사례마다 새로 만든 임시 폴더(이름 접두 `omk-conformance-`)의 **realpath**. 입력·기대값 양쪽에서 치환한다. macOS 임시 폴더는 `/private/…` 아래의 심링크 경로라 realpath 를 거치지 않으면 기대 문구의 경로가 어긋난다. 실제 경로는 fixture 에 넣지 않는다.
- **`setup`**: `{{TMP}}` 기준 상대경로로 만드는 것의 배열, 적힌 순서대로. `{"dir": "root/sub"}` · `{"file": "root/a.txt", "content": "…"}`(또는 `"contentB64"`) · `{"symlink": "root/link", "target": "{{TMP}}/outside"}`(target 은 그대로 링크에 적는다 — 상대 target 가능) · `{"many": {"dir": "root/big", "count": 201, "prefix": "d", "kind": "dir"|"file"}}`(이름은 `prefix` + 번호).
- `file-kinds.cases` 는 사례마다 `root` 를 연결 폴더로 코어 하나를 만들고 `requests` 를 순서대로 보낸다. `expect` 는 결과 객체 전체이고 키 집합까지 같아야 한다. TS 의 예외는 연결부와 같이 `{ok:false, error: 메시지}` 로 바꿔 비교한다.
  - `compare: "sorted-entries"` — `entries` 를 정렬해 비교한다. `compare: "capped"` — `expect` 에 `entriesCount`(와 `truncated`)만 적고, 러너는 개수와 "모든 항목이 `many` 로 만든 이름"인지 본다.
  - `after` — 요청 뒤 디스크 상태. `{"exists": "root/a.txt", "content"|"contentB64": …}` · `{"absent": "outside/planted"}`.
  - `browser` 요청은 넣지 않는다(TS 는 실제로 실행하고 Rust 는 아직 거절한다 — TS 러너가 막는다). `exec`·`worktree` 와 `lsp_diagnostics`·`code_nav`·`test_runner` 는 아래 suite 가 본다.
- 두 러너는 다른 OS 에서 돈다(TS 는 CI 의 Linux, Rust 는 macOS). 대소문자 무시(APFS)·FIFO·권한(chmod)에 기대는 사례는 넣지 않는다. 블록되는 FS 호출은 Rust `tests/fs_timeout.rs`·TS `fs-timeout.test.ts` 가 따로 본다.

## suite

| 파일 | 대상 |
|---|---|
| `constants.json` | 환경변수 허용 목록·캐시/비밀 경로·요청 종류 등 상수 값 |
| `denylist.json` | `rules`(규칙 표) · `normalize`(차단 전 정리) · `cases`(판정) |
| `exec-env.json` | exec 자식 환경 조립. 결과는 순서 없는 맵으로 비교한다 |
| `platform.json` | 셸 호출·PATH 구분자·폴더 이름·일괄 승인 가능 여부 |
| `sandbox-profile.json` | macOS sandbox-exec 프로파일 텍스트(바이트 단위 일치). 입력 `{root, gitDir, commonDir?, tool?, protect?}` — `commonDir` 를 적지 않으면 `gitDir` 와 같고(일반 레포), `tool: true` 는 확인 없이 뜨는 자식용 도구 프로파일(exec 프로파일 + `(deny network*)`, git 금지 줄은 그 뒤 맨 끝), `protect` 는 금지 줄을 걸 git 디렉터리 **목록**(하나에 한 줄, 적지 않으면 `[gitDir 쪽]` — 믿지 않는 연결 폴더의 `.git` 디렉터리와 폴더 안을 가리키는 `.git` gitfile·심링크의 대상은 쓰기 허용 없이 금지 줄만). 프로파일은 파일로 쓰지 않고 `sandbox-exec -p` 로 넘긴다 |
| `scope.json` | `nodePath`(Node `path.posix` 의 `resolve`·`dirname`·`relative`) · `lexical`(어휘 스코프 검사 — TS 러너는 FS 를 항등으로 바꾼 `safeFromAsync`) · `fs`(심링크·dangling·최근접 조상) |
| `file-kinds.json` | `cases`(파일 kind·`folder` 필드·디스패처) · `timeout`(시간 초과 문구) · `fsTimeoutEnv`(`OMK_BRIDGE_FS_TIMEOUT_MS` 해석) |
| `request-guard.json` | 요청 만료·중복 판정. 사례마다 새 guard 에 `steps` 를 순서대로 넣는다. `{"fill": {prefix, from, count}}` 은 그 수만큼 통과해야 한다 |
| `exec-gate.json` | `cases`(차단 → 확인 → 실행, 거부 불변식, 일괄 승인·회수, 실행 결과, `command`·`folder` 필드) · `sandboxEnabled` · `autoApproveEnv` · `failClosed`(준비 안 함·홈 realpath 실패 — 프로파일 텍스트를 만들지 못함) |
| `exec-path.json` | `resolve`(로그인 셸·프로세스 PATH·고정 4곳·mise 병합, 자식 환경·cwd — 가짜 실행 파일) · `win32` |
| `worktree.json` | `cases`(`add`·`diff`·`remove`·모르는 op, `.openmake`·`worktrees`·`<taskId>`·worktree 안 하위 폴더가 폴더 밖 심링크일 때의 거부 — 안쪽 심링크는 허용. `.git/info`·`info/exclude` 가 심링크면(git 디렉터리 안쪽을 가리켜도) 제외 등록만 건너뛴다. worktree 연산 직전 git 디렉터리 대조 — 다르면 git 을 띄우지 않고 거절. 실패한 add 의 정리. git 금지 경로(git 디렉터리 자신·`config`·`commondir`·`config.worktree`·`hooks`, linked 배치의 `<common>/worktrees`, worktree 의 `.git` — 대소문자를 접어서 비교, 믿지 않는 연결 폴더의 `.git` 디렉터리와 그 `.git` 이 폴더 안을 가리키는 gitfile·심링크의 대상도)를 지키는 파일 kind `write`·`delete` 단계. 파일 kind 는 git 이 저장소로 인식하는 구조를 만들거나 고치지 못한다(설계 D-11 — 깊이 무관, 요청 시점 판정): ① 연결 폴더 기준 경로에 `.git` 구성 요소(대소문자 접기)가 있으면 거절 — `.git` 자신(파일·심링크 자리 포함, 만들기·지우기)과 그 아래 전부(`HEAD`·`objects`·`refs`·`info` 포함), 루트든 하위 폴더든 worktree 의 `.git` 이든 같다. ② 대상의 조상 폴더(연결 폴더까지) 중 `HEAD` 항목이 지금 있는(lstat — 끊긴 심링크 포함) 폴더와 연결 때 정한 지킬 git 디렉터리(HEAD 유무 무관)마다 그 바로 아래 `config`·`commondir`·`config.worktree`·`hooks/**` 와 ASCII 가 아닌 글자가 든 첫 이름을 거절 — APFS 는 유니코드 대소문자 접기로 아직 없는 `con\uFB01g`·`config.wor\u212Atree` 를 `config`·`config.worktree` 로 읽는다(둘째 이름부터는 보지 않는다, 이미 있는 `config/` 디렉터리 아래는 열려 있다, exec 프로파일은 이미 이 표기를 막는다 — 실측). ③ 파일 kind 는 `HEAD`(대소문자 접기) 항목의 유무를 바꾸지 못한다 — 어느 폴더에서든 아직 없는 `HEAD` 를 새로 만드는 쓰기와 `HEAD` 자신을 지우는 것을 거절(이미 있는 `HEAD` 의 내용 쓰기는 된다, `HEAD` 를 품은 폴더째 지우기는 구조가 함께 사라지므로 된다) — ②와 합쳐 "`config` 먼저, `HEAD` 나중" 순서와, linked worktree 가 `HEAD` 없는 common dir 의 `config` 를 읽는 배치에서 "`HEAD` 지우기 → `config` 쓰기" 순서도 닫는다. 연결 때 루트에 `HEAD` 항목이 있으면(lstat) `gitdir: .` 배치처럼 루트를 지킬 목록에 넣어 프로파일 금지 줄도 건다. gitfile 은 코어가 직접 읽는다(일반 파일 — `.git` 이 심링크면 따라간 대상 — ·`GITFILE_MAX_BYTES` 이하·`gitdir: ` 한 줄·끝 `\r`·`\n` 은 모두 뗀다, 상대 경로는 `.git` 자리의 폴더 기준 — git 과 같다). `info/exclude` 가 일반 파일이 아니거나(FIFO 등) `MAX_BUFFER` 를 넘으면 읽지 않고 제외 등록만 건너뛴다. `omk-base` 는 일반 파일·`GITFILE_MAX_BYTES` 이하만 읽는다(심링크·큰 파일이면 diff 기준이 `HEAD`). 실패한 add 는 그 worktree 만 치운다(다른 끊긴 worktree 등록은 남는다). `folder` 로 고른 중첩 레포는 git dir·common dir 가 둘 다 연결 폴더 안일 때만 그 레포로 연산한다 — 알려진 범위: 중첩 레포의 `config`·`hooks`·`commondir` 에는 프로파일 금지 줄이 없다(연결 때 믿은 git 만 지킨다, 경계는 도구 프로파일 — 파일 kind 는 D-11 로 막는다). linked 배치에서 **다른** worktree 메타(`<common>/worktrees/<다른 이름>/commondir` 등)는 막지 않는다 — `git worktree add` 가 같은 자리에 새 메타를 만들어야 해 프로파일만으로 깔끔히 가를 수 없다(`modules/**` 와 같은 급). D-11 구조 가드는 파일 kind 만이다 — 프로파일(exec)에 늘 넣으면 승인된 `git init`·`git config`·서브모듈이 막히므로, 연결 뒤 승인된 exec 로 만든 `.git`·루트 `HEAD` 는 다음 연결부터 프로파일 금지 줄이 걸린다(파일 kind 가드는 요청 시점에 바로 본다). 브라우저 **다운로드**는 Chrome 이 연결 폴더 루트에 직접 써서 파일 kind 가드를 지나지 않는다(`HEAD`·`config` 를 둘 다 내려받는 순서는 열려 있다 — 별건, 설계 D-11). 사용자가 `.git/config` 에 `include.path` 로 작업 트리 파일(`../.gitconfig` 등)을 끌어온 레포는 그 파일이 git 설정이 된다 — git 이 저장소로 인식하는 구조가 아니라 사용자 설정이라 D-11 범위 밖이다(`package.json` 스크립트와 같은 급). git 은 gitfile 을 1MiB 까지 읽지만 코어는 `GITFILE_MAX_BYTES` 를 넘는 gitfile(끝 줄바꿈으로 부풀린 것 포함)을 읽지 않는다 — 그때 탐지도 실패하면 폴더 안 대상의 보호가 빠진다(`.git` 자신은 D-11 ① 이 막아 파일 kind 로는 만들 수 없다). 연결 경로에 개행이 있으면 git 탐지(rev-parse 출력을 줄로 나눈다)가 실패해 worktree 를 쓸 수 없다(보호는 `.git` 디렉터리 쪽으로 유지 — 막는 쪽). `omk-base` 임시 이름(`omk-base.omk-<pid>`) 자리에 폴더를 미리 두면 기준점이 써지지 않아 diff 기준이 `HEAD` 로 떨어진다(지우지 않는 쪽 — `omk-base` 자체도 에이전트가 쓸 수 있는 자리라 같은 급)) · `taskId`(형식) · `gitDir`(연결 때의 git 디렉터리 신뢰 판정 — 믿는 네 배치는 `{git: {gitDir, commonDir}}`, 그 밖은 `{git: null}`) · `taskIdPattern`(TS `TASK_ID_RE` 의 source·flags) |
| `glob.json` | `cases`(글롭 → 판정: `basenameOnly` 와 `tests`(이름마다 맞는지)) — TS `globToRegExp`, Rust `Glob` |
| `code-nav.json` | `cases`(코어 경유 `code_nav` grep·files) · `walk`(`walkFiles` 직접, 예산 지남/먼 시각) · `secretFiles`(민감 이름 판정) · `excludedFiles`·`excludedDirs`(표 — 순서까지) |
| `diagnostics-parse.json` | `cases`(코어 경유 `lsp_diagnostics` — PATH 와 무관한 사례) · `direct`(`collectDiagnostics` 직접, PATH = `{{BIN}}`, 가짜 tsc·python3) |
| `test-runner.json` | `cases`(코어 경유 `test_runner`) · `direct`(`detectTestRunner` 직접, PATH = `{{BIN}}`, 가짜 python3·go). 표식 파일(`package.json`·`pyproject.toml`·`setup.cfg`)은 일반 파일·`MAX_BUFFER` 이하만 읽는다 — 심링크·FIFO·큰 파일은 표식 없음. FIFO 는 setup 에 만드는 단계가 없고 멈춤을 시간으로 재야 해 fixture 대신 TS `git-review-r3.test.ts`·Rust `tests/git_review_r3.rs` 가 고정한다 |

### exec·worktree suite (`exec-gate`·`exec-path`·`worktree`)

- 사례마다 `{{TMP}}/home` 을 가짜 홈으로 만든다 — `{{HOME}}` 은 그 경로, `{{BIN}}` 은 `{{TMP}}/bin`. 러너가 주는 환경: 러너 프로세스의 `PATH`, `HOME`, `SHELL=/bin/sh`, `LANG=C` + 가짜 비밀 `OMK_COMPANION_API_KEY`·`GITHUB_TOKEN`·`OMK_BRIDGE_AUTO_APPROVE=0`(자식에 넘어가지 않는 것만 본다). TS 러너는 `process.env` 를 사례 동안 바꿨다가 되돌리고, jest 의 환경 사본 때문에 `os.homedir()` 를 `HOME` 을 따르게 모의한다. Rust 러너는 `ExecHost` 로 넘긴다.
- setup 종류 추가: `{"symlink", "target"}`(위 `scope.fs` 와 같다) · `{"git": [...], "cwd": "repo"}`(격리된 git — 사용자·시스템 설정 없음, 작성자·날짜 고정, `init.defaultBranch=main`) · `{"file": …, "repeat": {"line", "count"}}`(그 줄을 count 번).
- `steps` 의 요청 단계: `exec-gate` 는 `{msg, confirm?, asked, askedWith?, expect, compare?, after?, autoApproved}` — `confirm` 은 물음이 오면 줄 답, `asked` 는 물음이 왔는지(오지 않아야 하는데 오거나 그 반대면 실패), `autoApproved` 는 단계 뒤 일괄 승인 수. `{"clearAutoApprove": true, "autoApproved": n}` 은 연결 해제 흉내, `{"parallel": [요청…], "answerOrder": [...], "autoApproved": n}` 은 요청을 함께 보내 물음이 다 모인 뒤 그 차례로 답한다(물음은 명령 글자로 짝짓는다 — 명령이 겹치면 실패). 사례의 `changes` 는 변화 알림마다의 일괄 승인 수. `worktree` 는 `{msg, expect, compare?, after?}`(`msg.kind` 는 `worktree`·`write`·`delete` 만 — 러너가 사례마다 코어를 `prepare` 한다) 와 요청이 아닌 단계 `{"git", "cwd", "stdout"?}`·`{"file", "content"|"repeat"}`·`{"remove"}`·`{"symlink", "target"}`.
- `compare`: `no-stderr`(stderr 를 빼고) · `stdout-length`(`stdoutLength` — UTF-16 길이) · `stdout-lines`(`stdoutHas`·`stdoutLacks` — 그 글자로 시작하는 줄이 있다/없다) · `stdout-contains`(`stdoutContains`·`stdoutLacks`) · `error-prefix`(`errorPrefix`). `after` 에 `{"fileHas", "line", "count"}`(그 줄이 정확히 count 번)를 더 쓸 수 있다.
- 샌드박스: Rust 러너는 macOS 에서 켜고(실제 `sandbox-exec`), TS 러너는 그 OS 의 값대로 돈다. 사례 폴더는 프로파일이 쓰기를 열어 둔 임시 폴더라 `cases` 는 켜도 꺼도 결과가 같은 명령만 담는다 — 샌드박스가 막는 것은 Rust `tests/exec_sandbox.rs`·`tests/git_sandbox.rs`, TS `git-sandbox.test.ts` 가 본다(작업 폴더를 열어 둔 경로 밖에 둔다).

### 읽기 전용 도구 suite (`glob`·`code-nav`·`diagnostics-parse`·`test-runner`)

- 환경·가짜 홈·가짜 비밀은 exec·worktree suite 와 같다. 코어 경유 사례(`cases`)는 사례마다 코어 하나(Rust 는 러너 환경의 `ExecHost`, macOS 에서 샌드박스 켬)에 `requests` 를 차례로 보낸다 — 확인 창이 불리면 실패한다. `direct` 는 모듈 함수를 PATH 를 `{{BIN}}` 하나로 주고 부른다(Rust 는 샌드박스 끔 — 샌드박스는 `cases` 와 `tests/tools_sandbox.rs` 가 본다). `python3`·`go` 가 있느냐는 장비마다 달라 PATH 에 기대는 판정은 `direct` 에만 둔다.
- setup 종류 추가: `{"symlink", "target"}` · `{"many": {dir, count, prefix, kind, content?}}`(파일마다 그 내용) · `{"fakeTool": "root/node_modules/.bin/tsc", "stdout", "stderr", "exit", "record"}` — 실행 권한 0755 의 `#!/bin/sh` 스크립트. 불릴 때마다 `{{TMP}}/calls/<n>`(도구를 가리지 않는 일련번호)에 기록 이름·인자 수·인자(한 줄에 하나)·cwd(`pwd -P`)·환경(`/usr/bin/env`)을 남기고 stdout·stderr 를 찍은 뒤 `exit` 로 끝난다. 셸 내장 명령과 절대경로만 쓴다.
- `toolCalls`: 요청(또는 `direct` 사례) 동안 가짜 도구가 불린 기록을 순서대로 — `{tool, args, cwd, envHas, envLacks}`. 빈 배열 = 한 번도 안 불렸다. 샌드박스를 켠 Rust 에서도 도구가 받는 인자는 같다(앞머리는 `sandbox-exec` 가 먹는다).
- `compare`: `counts`(`codeNav` 의 `matches`·`files` 대신 `matchesCount`·`filesCount` 중 정확히 하나 — 상한·예산에 걸린 부분집합은 폴더 열거 순서에 달렸다) · `error-prefix`(`errorPrefix`, 비어 있지 않게).
- python3 인자는 두 구현 같은 강화형이다(TS 는 도구 샌드박스 수정 #1745) — `-I -m py_compile <파일>`, 탐지는 `-I -c "import importlib.util,site,sys; sys.path.append(site.getusersitepackages()); sys.exit(0 if importlib.util.find_spec('pytest') else 1)"`.

## 알려진 차이

알려진 차이는 정해진 자리에만 쓸 수 있다 — `denylist/cases` ↔ `regress-nonunicode-i-fold`, `file-kinds/cases/requests`·`exec-gate/cases/steps`·`worktree/cases/steps`·`code-nav/cases/requests`·`diagnostics-parse/cases/requests` ↔ `non-string-field`. 다른 자리에 `divergence`·`rustExpect` 가 있으면 두 러너 모두 실패한다.

### `regress-nonunicode-i-fold`

Rust 는 차단 패턴을 ECMAScript 정규식 크레이트 `regress` 로 컴파일한다. `regress`(0.12.0 기준)는 `u` 없는 `i` 플래그에서 비ASCII 문자를 ASCII 로 접는다 — U+017F(ſ)→`s`, U+212A(켈빈 기호)→`k`. JavaScript 는 이 접기를 하지 않는다. 그래서 `i` 플래그 규칙(Windows 규칙)에서 이 두 문자가 든 명령은 Rust 만 차단한다(더 엄격한 쪽).

- 이런 사례는 `"divergence": "regress-nonunicode-i-fold"` 와 Rust 기대값 `"rustExpect"` 를 함께 적는다. TS 러너는 `expect` 만 보고, Rust 러너는 `rustExpect` 를 본다.
- 남용 방지: Rust 러너는 입력에 U+017F 또는 U+212A 가 있고, `expect` 가 허용(`null`)이며 `rustExpect` 가 차단 사유일 때만 받아들인다. TS 러너는 `divergence` 값이 위 이름뿐인지 본다.
- 두 구현이 모두 차단해도 사유가 달라질 수 있다 — Rust 는 원문에서 `i` 규칙에 먼저 걸리고, TS 는 정리본에서 다른 규칙에 걸리는 경우다(예: `"\u001b[0mc:di\u017fkpart|\u0000sh"` → TS "파이프-투-셸 실행", Rust "디스크·부팅 설정 변경"). 차단 여부는 같고, 이 경우는 `rustExpect` 로 나타내지 않는다.
- 이 차이는 TS 코어를 지우는 PR-5.3 에서 사라진다(그 뒤 fixture 는 Rust 의 회귀 테스트로 남는다).

### `non-string-field`

서버는 `kind`·`path`·`folder`·`contentB64`·`command`·`op`·`taskId` 를 항상 문자열로 보낸다. TS 는 JSON 을 느슨하게 읽어 문자열이 아닌 값이 오면 Node 의 TypeError 문구가 나가거나(`path: 5`), 뜻밖에 통과한다(`contentB64: [1,2]` 는 바이트 2개를 쓴다).

- JS 에서 거짓인 값(`null`·`false`·`0`·`""`·없음)은 두 구현 모두 "없음"으로 본다(일반 사례).
- `command`·`op` 의 거짓 값은 TS 표기 그대로 옮긴다 — `command` 가 없으면 확인 창에는 빈 명령, 실행은 `String(m.command)`(`undefined`·`null`·`false`·`0`), 모르는 op 문구는 `${m.op}`.
- JS 에서 참인 비문자열(0 이 아닌 수·`true`·배열·객체)이 일곱 필드에 오면 Rust 는 처리하지 않고 `{ok:false, error:"요청 필드 형식이 올바르지 않습니다: <필드>"}` 를 낸다(더 엄격한 쪽). 이런 사례는 `"divergence": "non-string-field"` 와 `rustExpect` 를 함께 적는다.
- TS 는 `command: ["ls"]` 를 `ls` 로 묻고 실행하며, `taskId: 5` 를 일괄 승인 집합의 키로 쓰고, worktree 의 `taskId: 12345678` 을 형식 검사에 통과시킨다. Rust 는 묻지도 실행하지도 않는다(exec-gate 러너는 알려진 차이 단계에서 물음이 없음을 본다).
- 남용 방지: Rust 러너는 입력의 일곱 필드 중 하나가 참인 비문자열이고 `rustExpect.ok` 가 `false` 이며 `after` 가 없을 때만 받아들인다.
- 읽기 전용 도구(PR-1.4)의 네 필드를 같은 순서 뒤에 더한다: `pattern`·`glob`(참인 비문자열), `maxResults`(참인 비수 — 문자열 `"1"`·`true`·배열도), `paths`(배열의 앞 60개 원소 중 참인 비문자열). TS 는 `String(pattern)`·`String(glob)`·`Number(maxResults)` 로 뜻밖에 통과하고, `paths` 원소는 Node TypeError 문구가 나간다. 거짓 값은 TS 글자 그대로다 — `pattern` 은 `??` 라 `0`·`false` 가 그 글자의 검색, `paths` 가 배열이 아니면 빈 목록, 거짓 원소는 `.`. 코드 탐색·진단 사례는 `toolCalls` 를 두지 않는다.

### fixture 에 넣지 않는 차이

- `OMK_BRIDGE_FS_TIMEOUT_MS` 가 정수가 아닐 때(`abc`·`1e3`·`1500.5`·음수·공백뿐): TS 는 NaN·실수·음수 타이머가 되어 1ms 로 돌거나 문구에 `NaNs` 가 찍힌다. Rust 는 기본값 15000 으로 돈다(개발·테스트 훅의 잘못된 입력). Rust 단위 테스트가 고정한다.
- 동시 FS 작업 상한: TS 는 프로세스 공용 libuv 스레드 풀(4)이 사실상의 상한이고, Rust 는 코어(연결 폴더)마다 4개다 — 한 폴더의 볼륨이 막혀도 다른 폴더 요청이 굶지 않는다.
- exec 의 `taskId: ""`: TS 는 호스트의 확인 콜백에 `taskId` 를 `""` 로, Rust 는 없음(`None`)으로 넘긴다. 승인·실행 판정은 같고(둘 다 일괄 승인 대상이 아니다) 확인 창 인자에서만 다르다.
- 시간 초과 뒤: TS 는 줄에 있던 호출이 나중에 실행될 수 있다(이미 "실패"라고 답한 `write`·`delete` 포함). Rust 는 아직 시작하지 않은 작업을 실행하지 않는다.
- exec 의 시간 초과·출력 상한: TS 는 직접 자식에 SIGTERM, Rust 는 SIGKILL(D-31). 시간 초과 때 직접 자식이 아직 살아 있으면 서버가 받는 결과는 같다(`exitCode 1` + 그때까지의 출력). 직접 자식은 이미 끝났는데 뒤에 남긴 프로세스가 파이프를 쥐어 시간 초과가 되면 두 구현 모두 그 자식의 종료 코드와 그때까지의 출력을 낸다(`sleep 300 & echo fg` → `exitCode 0`·`fg\n`, `…; exit 3` → 3 — Node `execFile` 그대로, worktree 의 git 도 같다. `execFileSync` 인 PATH·git 탐지는 두 구현 모두 실패). 시간에 기대 fixture 대신 Rust `tests/exec_proc.rs`·`tests/exec_core.rs` 가 본다. 출력 상한은 언제나 1 이다. 다른 것은 TERM 을 받아 스스로 정리하던 자식이 정리 없이 끝나는 것, 그리고 TERM 을 무시하는 명령(`trap '' TERM; sleep 300`) — TS 는 시간 초과 뒤에도 끝날 때까지 기다리고 그 종료 코드(0 이면 성공)를 내지만 Rust 는 시간 제한에 1 로 끝난다. 손자 프로세스는 두 구현 모두 남는다.
- exec 출력 상한의 단위: 둘 다 바이트로 세지만 TS 는 마지막 조각을 "남은 바이트 수만큼의 글자"로 잘라 여러 바이트 글자가 섞이면 길이가 파이프 조각 크기에 따라 달라진다. Rust 는 1,048,576 바이트 이하의 가장 긴 UTF-8 글자 경계까지 남긴다(D-32). ASCII 는 같아 fixture 는 ASCII 만 담는다.
- 환경·홈·플랫폼: TS 는 실행할 때마다 `process.env`·`os.homedir()` 를 읽고, Rust 는 호스트가 코어를 만들 때 준 사본을 쓴다(D-33). 헬퍼는 실행 중에 자기 환경을 바꾸지 않아 관찰되지 않는다.
- `prepare`·PATH 탐지·git 탐지(신뢰 판정 포함): TS 는 동기(`execFileSync`·`fs.*Sync`)라 최대 5초씩 프로세스 전체가 멈춘다. Rust 는 판정의 FS 를 관문 안에서 보고(막히면 git 없음), `core.worktree` 조회 git 을 언제나 한 번 더 띄운다(TS 는 서브모듈 배치를 볼 때만 — 결과는 같다). Rust 는 비동기라 그 연결만 기다리고, 로그인 셸·mise 의 stderr 는 버린다(TS 는 헬퍼의 stderr 로 흘려보낸다)(D-35). 연결의 `prepare` 는 접속 단계의 맨 앞(핸드셰이크 시간 제한 밖, 소켓을 만들기 전)에서 돌아 그동안에도 해제·채널 닫힘을 바로 처리하고, 헤더 실패·잘못된 주소처럼 소켓을 만들지 않는 연결에서는 돌지 않는다(TS 는 `connect()` 첫 줄에서 언제나 부른다 — 소켓이 없어 서버가 볼 수 없는 차이).
- worktree 의 파일 작업이 막힌 볼륨에서 멈출 때: TS 는 동기 호출이라 응답하지 못하고, Rust 는 `worktree 시간 초과 (15s) — …` 로 끝난다(D-36).
- git 출력의 오류 꼬리(`worktree 생성 실패: `·`diff 실패: `)를 UTF-16 단위로 자를 때 대리 쌍 한가운데면 TS 는 짝 없는 반쪽을 남기고 Rust 는 그 글자를 뺀다.
- 샌드박스 프로파일은 파일로 쓰지 않는다 — 코어마다 텍스트를 들고 `sandbox-exec -p` 로 넘긴다(두 구현 같다, 리뷰 F1). 호스트가 주는 프로파일 폴더 옵션은 남아 있지만 쓰지 않는다.
- 폴더 `delete` 가 하위 항목에서 막힐 때(예: 하위 폴더가 0555): TS(`fsp.rm` recursive)는 막힌 항목의 syscall·경로를 적고(`EACCES: permission denied, unlink '<폴더>/q/f'`), Rust(`remove_dir_all`)는 지우려던 폴더를 적는다(`EACCES: permission denied, rmdir '<폴더>'`). 오류 코드와 실패 여부는 같다. chmod 사례라 fixture 에 넣지 않는다.
- 읽기 전용 도구(PR-1.4) — fixture 로 관찰할 수 없거나 두 엔진이 다른 것. Rust 단위·통합 테스트가 고정한다.
  - grep 정규식 엔진(`regress` 대 V8): 구문 오류의 꼬리 문구가 다르다(접두 `정규식이 올바르지 않습니다: ` 만 같다 — fixture 는 `error-prefix`). `u` 없는 `\u{61}` 를 regress 는 `a` 로 읽는다(JS 는 `u` 61번). `i` 에서 ſ(U+017F)를 `s` 로, 클래스(`[a-z]`·`\w`) 안의 K(U+212A)를 `k` 로 접는다(리터럴 `k` 는 두 엔진 모두 접지 않는다). 단언에 수량자(`\b*`·`(?=…)*`)를 붙이면 V8 은 구문 오류, regress 는 통과한다. 클래스 안에서 `-` 와 맞닿은 보충 문자는 Rust 만 거절한다(JS 는 `[a-😀]` 만 통과).
  - regress 의 판정 결함(차등 실험 — 실제 쓰이는 꼴 300 패턴에서는 0건): 중첩 수량자 역추적에서 JS 가 맞는 것을 놓친다(최소 재현 `((?:x{1,2})+){2}` 대 `xx` — JS 참, regress 거짓). 빈 매치를 반복하는 중첩 수량자(`\s*?((가?){2})+$`·`((/*){1,2}){1,2}a{2}`)는 짧은 줄에서도 끝나지 않거나 메모리를 크게 쓴다(V8 은 즉시 끝난다). code_nav 전용 관문(2칸)은 그 판정의 **CPU 만** 묶어 두고 **메모리는 막지 못한다** — 아래 ReDoS 항목.
  - 끝나지 않는 정규식(ReDoS): TS 는 이벤트 루프가 멎어 그 헬퍼의 모든 연결이 끊긴다. Rust 의 code_nav 전용 관문은 **CPU 만** 막는다 — 시간만 오래 걸리는 판정은 스레드 하나가 묶이고(폴더마다 최대 2개, 코어 하나씩 100%) 그 요청은 `code_nav 시간 초과` 로 답하며 같은 폴더의 다른 kind·다른 폴더는 계속 돈다. **메모리는 막지 못한다**: 패턴 `((/*){1,2}){1,2}a{2}`(20자) 대 줄 `/`×20 + `b`(21자 — 소스의 구분선 주석으로 흔하다)에서 regress 의 RSS 가 0.8초 안에 1.2GB 를 넘는다(슬래시 16개는 6초에 1.0GB). 관문 시간 제한(15초)에 닿기 전에 **헬퍼 프로세스 전체가 죽거나 스왑으로 멎을 수 있다** — 그러면 TS 와 같이 그 헬퍼의 모든 폴더 연결이 끊긴다. PR-1.7(헬퍼) 전에 닫는 별건이다(메모리 상한이 있는 grep 작업자 프로세스 또는 엔진 교체). 시간 예산은 파일 사이에 더해 줄마다도 본다.
  - 막힌 볼륨: TS 는 `lsp_diagnostics`·`test_runner` 의 파일 확인과 `code_nav` 의 스코프 확인이 시간 제한 밖이라 응답하지 못한다. Rust 는 `<라벨> 시간 초과 (15s) — …` 로 끝난다.
  - 도구 자식(tsc·python3)은 두 구현 모두 exec 와 같은 프로파일의 샌드박스 안에서 돈다(TS #1745). 프로파일이 없거나 감싼 자식에서 sandbox-exec 자체가 실패하면(종료 코드 65·71 + stderr `sandbox-exec:`) exec 와 같은 문구 + `exitCode 126` 으로 거절한다 — 자식을 띄워야 할 때만. python3 는 띄우기 전에 PATH 에서 찾고(없으면 빈 진단·`none` — 단 프로파일이 없으면 찾기 전에 거절, TS 와 같다), Rust 는 PATH 의 **절대경로 항목만** 본다(TS 는 상대 항목도 본다).
  - 폴더 열거는 이름 바이트순(TS 는 OS 순서) — 상한(4000)·예산에 걸렸을 때 남는 집합만 다를 수 있다. 줄을 300 단위에서 대리 쌍 한가운데로 자르면 TS 는 반쪽을 남기고 Rust 는 그 글자를 뺀다.
  - `go` 의 실행 권한: TS 는 `access(X_OK)`, Rust 는 "모드에 실행 비트가 하나라도"(심링크는 따라가고 폴더도 통과). `package.json` 의 짝 없는 대리 쌍 이스케이프·128단 넘는 중첩·범위를 넘는 수(`1e999` — `JSON.parse` 는 `Infinity`)는 Rust 만 해석 실패(→ TS `npm`, Rust `none`). tsc 줄·열이 u64 를 넘으면 Rust 는 그 줄을 버리고, py_compile 의 첫 `line N` 이 넘치면 1 이다(TS 는 정밀도를 잃은 실수).
