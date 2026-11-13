# 적합성 fixture (conformance)

브리지 코어의 판정을 TS 구현(`packages/local-bridge-core/src`)과 Rust 구현(`apps/openmake-code/crates/omk-bridge-core`)이 똑같이 내는지 확인하는 공용 사례다.

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

### 파일 시스템을 만지는 suite (`scope.fs`·`file-kinds`)

- **`{{TMP}}`**: 러너가 사례마다 새로 만든 임시 폴더(이름 접두 `omk-conformance-`)의 **realpath**. 입력·기대값 양쪽에서 치환한다. macOS 임시 폴더는 `/private/…` 아래의 심링크 경로라 realpath 를 거치지 않으면 기대 문구의 경로가 어긋난다. 실제 경로는 fixture 에 넣지 않는다.
- **`setup`**: `{{TMP}}` 기준 상대경로로 만드는 것의 배열, 적힌 순서대로. `{"dir": "root/sub"}` · `{"file": "root/a.txt", "content": "…"}`(또는 `"contentB64"`) · `{"symlink": "root/link", "target": "{{TMP}}/outside"}`(target 은 그대로 링크에 적는다 — 상대 target 가능) · `{"many": {"dir": "root/big", "count": 201, "prefix": "d", "kind": "dir"|"file"}}`(이름은 `prefix` + 번호).
- `file-kinds.cases` 는 사례마다 `root` 를 연결 폴더로 코어 하나를 만들고 `requests` 를 순서대로 보낸다. `expect` 는 결과 객체 전체이고 키 집합까지 같아야 한다. TS 의 예외는 연결부와 같이 `{ok:false, error: 메시지}` 로 바꿔 비교한다.
  - `compare: "sorted-entries"` — `entries` 를 정렬해 비교한다. `compare: "capped"` — `expect` 에 `entriesCount`(와 `truncated`)만 적고, 러너는 개수와 "모든 항목이 `many` 로 만든 이름"인지 본다.
  - `after` — 요청 뒤 디스크 상태. `{"exists": "root/a.txt", "content"|"contentB64": …}` · `{"absent": "outside/planted"}`.
  - `exec`·`worktree`·`lsp_diagnostics`·`code_nav`·`test_runner`·`browser` 요청은 넣지 않는다(TS 는 실제로 실행하고 Rust 는 아직 거절한다 — TS 러너가 막는다).
- 두 러너는 다른 OS 에서 돈다(TS 는 CI 의 Linux, Rust 는 macOS). 대소문자 무시(APFS)·FIFO·권한(chmod)에 기대는 사례는 넣지 않는다. 블록되는 FS 호출은 Rust `tests/fs_timeout.rs`·TS `fs-timeout.test.ts` 가 따로 본다.

## suite

| 파일 | 대상 |
|---|---|
| `constants.json` | 환경변수 허용 목록·캐시/비밀 경로·요청 종류 등 상수 값 |
| `denylist.json` | `rules`(규칙 표) · `normalize`(차단 전 정리) · `cases`(판정) |
| `exec-env.json` | exec 자식 환경 조립. 결과는 순서 없는 맵으로 비교한다 |
| `platform.json` | 셸 호출·PATH 구분자·폴더 이름·일괄 승인 가능 여부 |
| `sandbox-profile.json` | macOS sandbox-exec 프로파일 텍스트(바이트 단위 일치) |
| `scope.json` | `nodePath`(Node `path.posix` 의 `resolve`·`dirname`·`relative`) · `lexical`(어휘 스코프 검사 — TS 러너는 FS 를 항등으로 바꾼 `safeFromAsync`) · `fs`(심링크·dangling·최근접 조상) |
| `file-kinds.json` | `cases`(파일 kind·`folder` 필드·디스패처) · `timeout`(시간 초과 문구) · `fsTimeoutEnv`(`OMK_BRIDGE_FS_TIMEOUT_MS` 해석) |
| `request-guard.json` | 요청 만료·중복 판정. 사례마다 새 guard 에 `steps` 를 순서대로 넣는다. `{"fill": {prefix, from, count}}` 은 그 수만큼 통과해야 한다 |

## 알려진 차이

알려진 차이는 정해진 자리에만 쓸 수 있다 — `denylist/cases` ↔ `regress-nonunicode-i-fold`, `file-kinds/cases/requests` ↔ `non-string-field`. 다른 자리에 `divergence`·`rustExpect` 가 있으면 두 러너 모두 실패한다.

### `regress-nonunicode-i-fold`

Rust 는 차단 패턴을 ECMAScript 정규식 크레이트 `regress` 로 컴파일한다. `regress`(0.12.0 기준)는 `u` 없는 `i` 플래그에서 비ASCII 문자를 ASCII 로 접는다 — U+017F(ſ)→`s`, U+212A(켈빈 기호)→`k`. JavaScript 는 이 접기를 하지 않는다. 그래서 `i` 플래그 규칙(Windows 규칙)에서 이 두 문자가 든 명령은 Rust 만 차단한다(더 엄격한 쪽).

- 이런 사례는 `"divergence": "regress-nonunicode-i-fold"` 와 Rust 기대값 `"rustExpect"` 를 함께 적는다. TS 러너는 `expect` 만 보고, Rust 러너는 `rustExpect` 를 본다.
- 남용 방지: Rust 러너는 입력에 U+017F 또는 U+212A 가 있고, `expect` 가 허용(`null`)이며 `rustExpect` 가 차단 사유일 때만 받아들인다. TS 러너는 `divergence` 값이 위 이름뿐인지 본다.
- 두 구현이 모두 차단해도 사유가 달라질 수 있다 — Rust 는 원문에서 `i` 규칙에 먼저 걸리고, TS 는 정리본에서 다른 규칙에 걸리는 경우다(예: `"\u001b[0mc:di\u017fkpart|\u0000sh"` → TS "파이프-투-셸 실행", Rust "디스크·부팅 설정 변경"). 차단 여부는 같고, 이 경우는 `rustExpect` 로 나타내지 않는다.
- 이 차이는 TS 코어를 지우는 PR-5.3 에서 사라진다(그 뒤 fixture 는 Rust 의 회귀 테스트로 남는다).

### `non-string-field`

서버는 `kind`·`path`·`folder`·`contentB64` 를 항상 문자열로 보낸다. TS 는 JSON 을 느슨하게 읽어 문자열이 아닌 값이 오면 Node 의 TypeError 문구가 나가거나(`path: 5`), 뜻밖에 통과한다(`contentB64: [1,2]` 는 바이트 2개를 쓴다).

- JS 에서 거짓인 값(`null`·`false`·`0`·`""`·없음)은 두 구현 모두 "없음"으로 본다(일반 사례).
- JS 에서 참인 비문자열(0 이 아닌 수·`true`·배열·객체)이 네 필드에 오면 Rust 는 처리하지 않고 `{ok:false, error:"요청 필드 형식이 올바르지 않습니다: <필드>"}` 를 낸다(더 엄격한 쪽). 이런 사례는 `"divergence": "non-string-field"` 와 `rustExpect` 를 함께 적는다.
- 남용 방지: Rust 러너는 입력의 네 필드 중 하나가 참인 비문자열이고 `rustExpect.ok` 가 `false` 이며 `after` 가 없을 때만 받아들인다.

### fixture 에 넣지 않는 차이

- `OMK_BRIDGE_FS_TIMEOUT_MS` 가 정수가 아닐 때(`abc`·`1e3`·`1500.5`·음수·공백뿐): TS 는 NaN·실수·음수 타이머가 되어 1ms 로 돌거나 문구에 `NaNs` 가 찍힌다. Rust 는 기본값 15000 으로 돈다(개발·테스트 훅의 잘못된 입력). Rust 단위 테스트가 고정한다.
- 동시 FS 작업 상한: TS 는 프로세스 공용 libuv 스레드 풀(4)이 사실상의 상한이고, Rust 는 코어(연결 폴더)마다 4개다 — 한 폴더의 볼륨이 막혀도 다른 폴더 요청이 굶지 않는다.
- 시간 초과 뒤: TS 는 줄에 있던 호출이 나중에 실행될 수 있다(이미 "실패"라고 답한 `write`·`delete` 포함). Rust 는 아직 시작하지 않은 작업을 실행하지 않는다.
- 폴더 `delete` 가 하위 항목에서 막힐 때(예: 하위 폴더가 0555): TS(`fsp.rm` recursive)는 막힌 항목의 syscall·경로를 적고(`EACCES: permission denied, unlink '<폴더>/q/f'`), Rust(`remove_dir_all`)는 지우려던 폴더를 적는다(`EACCES: permission denied, rmdir '<폴더>'`). 오류 코드와 실패 여부는 같다. chmod 사례라 fixture 에 넣지 않는다.
