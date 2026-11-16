# 브라우저 적합성 fixture (`browser-*.json`)

로컬 브라우저(Companion P2)의 **기기 쪽 판정** — 사이트 정책(`@openmake/config` `browser-site-policy.ts`)·제어 흐름(`browser-flow.ts`·`browser/browser-flow.ts`)·요청 도우미(`browser/local-browser-defs.ts`)·차단 표식(`policy-block.ts`)·업로드 파일 검사(`upload-files.ts`)·다운로드 저장(`download-place.ts`) — 을 TS 와 Rust(`apps/openmake-code/crates/omk-bridge-core/src/browser/`)가 똑같이 하는지 보는 사례다. 공통 규칙(기준은 TS 의 현재 동작, 기대값은 TS 를 돌려 채운다, 보이지 않는 문자는 `\uXXXX`, 사례 id 중복·빈 묶음 실패)은 `README.md` 와 같다.

| 러너 | 위치 | 실행 |
|---|---|---|
| TS | `packages/local-bridge-core/src/__tests__/conformance-browser.test.ts`(+ `conformance-browser-support.ts`), `browser-run` 은 `conformance-browser-run.test.ts`(+ `conformance-browser-run-support.ts`) | `npx jest -c packages/local-bridge-core/jest.config.js conformance-browser` |
| Rust | `apps/openmake-code/crates/omk-bridge-core/tests/conformance_browser.rs`(+ `tests/conformance_browser/*.rs`) | `cd apps/openmake-code && cargo test --locked -j 2 -p omk-bridge-core --test conformance_browser` |

## 규칙

- **파일 나눔**: `browser-` 로 시작하는 파일은 브라우저 러너 몫이고, 코어 러너(`conformance.test.ts`·`tests/conformance.rs`)는 건너뛴다. 두 브라우저 러너는 `browser-*.json` 목록이 자기가 아는 suite 와 정확히 같은지 본다 — 모르는 파일·빠진 파일은 실패한다.
- **모양 검사**: 두 러너가 같은 표로 최상위 키·묶음 이름·사례 키(`id`·`input`·`expect`, 파일 suite 는 `setup`·`after` 를 더한다)·입력 키(필수·선택)를 본다. 모르는 키·빠진 키·빈 묶음·id 중복은 실패한다. 새 키는 두 러너의 표를 같은 PR 에서 늘린다.
- **입력의 "없음"**: JS `undefined` 는 키를 빼서 적는다(`{"input": {}}` → `classifyBrowserAction(undefined)`). `null` 은 `null` 이다.
- **`divergence`·`rustExpect` 를 쓰지 않는다**(있으면 실패). Rust 가 일부러 다르게 하는 자리는 fixture 에 넣지 않고 Rust 단위 테스트로 고정한다(아래 "fixture 에 넣지 않는 차이").
- 주소는 `example.com`·`example.org`(하위 이름 포함)·`localhost`·`127.0.0.1`·`[::1]` 만, 경로는 `/work/…` 합성 경로나 `{{TMP}}` 만 쓴다.
- 두 러너는 다른 OS 에서 돈다(TS 는 CI 의 Linux, Rust 는 macOS). 파일 suite 에 대소문자 무시(APFS)·권한에 기대는 사례는 넣지 않는다.

## suite

| suite | 묶음 | 사례 |
|---|---|---|
| `browser-constants` | `values` · `tables` · `messages` · `env` · `chrome` (사례 목록이 아니라 값) | `values`: `BROWSER_*`(환경으로 바뀌는 값은 기본값)·`BROWSER_KIND`·`BROWSER_UPLOAD_CAPABILITY`·`BROWSER_FLOW_MAX_DEPTH`·`BROWSER_REPEAT_MAX`. `tables`: `interactiveRoles`·`pageActions`(정렬)·`actionClass`(분류표 — TS 는 소스의 표 키 순서도 본다)·`policyBlockKinds`(TS 는 `types.ts` 의 합 타입을 읽는다). `messages`: 오류 문구·페이지 조각. `env`: 환경 이름 → 기본값(TS 는 소스에 `process.env.<이름>` 이 있는지도 본다). `chrome`: 후보 경로(`{{HOME}}`)·Windows 루트와 파일 조각·실행 인자(`{{PROFILE}}`, `headlessOnly` 는 화면 없음일 때만) — TS 는 함수를 내보내지 않으므로 `chrome.ts` 소스에 그 글자가 이 순서로 있는지 보고, Rust 는 `chrome::candidates`·`launch_args`·`BrowserEnv::from_env` 결과와 대조한다 |
| `browser-site-policy` | `policies`(이름 → `{allow, deny}`) + `classify` · `hostOf` · `navigable` · `hostMatches` · `allowed` · `needsApproval` · `check` · `parsePolicy` · `uploadFilesOf` · `policyBlock` | `input.policy` 는 `policies` 의 이름. `check.input.approvedUploads` 가 없으면 기본값(`[]`)으로 부른다(이미 `parseApprovedUploads` 를 지난 모양). `policyBlock.input.fn` 은 `of`(`browserPolicyBlockOf`)·`userControl`·`uploadRejected`. `hostMatches/runaway-many-stars` 는 옛 정규식 판정이면 끝나지 않는 꼴이다 — 회귀는 실패가 아니라 러너가 멈춤(CI 작업 시간 제한)으로 드러난다 |
| `browser-flow` | `validate` · `cond` · `run` | `validate.expect`: `{error}`(문구 전체) 또는 `{error: null, flat}`(펼친 단순 액션 값). `cond.expect.expression`: `condExpression` 글자 전체. `run`: 아래 |
| `browser-defs` | `str` · `screenshotName` · `keyEventOf` · `approvedUploads` · `clickPointJs` · `fillPrepareJs` · `downloadTaskOf` · `popupTaskOf` · `jsonString` | `keyEventOf.expect`: `{text?, common}`(text 가 `undefined` 면 키 없음) 또는 `{error}`. `clickPointJs`·`fillPrepareJs` 의 `sel` 은 호출부가 넘기는 JSON 문자열 그대로. `downloadTaskOf.input`: `tabs`(`[키, {targetId, sessionId}]`)·`popups`(`[새 창 targetId, 작업 키]`)·`sessionId?`·`frameId` — 순서는 sessionId → 탭 targetId → 새 창, 추측 없음. `popupTaskOf.input`: `tabs`·`popups`·`openerId`(빈 값이면 `null`, 탭이 새 창 표보다 먼저). 두 `expect` 는 키 또는 `null`. `jsonString`: `JSON.stringify(문자열)` 글자 |
| `browser-upload-files` | `baseSetup` + `cases` | `resolveUploadFiles(input.base, input.files)`. `setup` 은 `baseSetup` 뒤에 더한다. `expect`: `{paths}`(realpath) 또는 `{error}` |
| `browser-download-place` | `cases` | 아래 |
| `browser-run` | `defaults`(규칙) + `cases` | 가짜 CDP 대본으로 `LocalBrowser.run` 한 번 — 아래 |

### `browser-flow/run`

- `input.actions` 는 형태 검사를 통과한 배열(러너가 먼저 확인한다), `input.maxSimple` 은 실행 수 상한.
- 가짜 실행: 액션의 `fail` 이 문자열이면 그 문구로, `true` 면 `실패` 로 `{i, type, ok: false, error}`, 아니면 `{i, type, ok: true}`(`type` 이 없으면 키 없음).
- 가짜 조건: `input.conds` 는 조건 JSON 글자 → 평가 순서대로의 값(`true`·`false`·`"throw"`(문구 `조건 평가 실패`)·`{"throw": "<문구>"}`, 다 쓰면 마지막 값 반복). 러너는 키를 **값으로** 대조한다(키 순서에 기대지 않는다 — `cond-key-order` 사례).
- `expect.results`: 결과 배열의 `JSON.stringify` **글자 전체** — 결과 객체의 키 순서(TS 리터럴 순서, 계획 D-76)까지 본다.

### `browser-download-place`

- 러너가 사례마다 `{{TMP}}/root`(연결 폴더)·`{{TMP}}/staging`(대기 폴더)·`{{TMP}}/outside` 를 만들고 `setup` 을 적용한다. `input.staged` 가 있으면 그 글로 `{{TMP}}/staging/guid-1` 을 만들고(없으면 대기 파일 없음), `placeDownload(root, {root, dirs: []}, input.name, 대기 파일)` 을 부른다. 가드는 요청 시점 구조 규칙만 본다 — 연결 때 정한 git 디렉터리 목록이 필요한 사례는 코어 경유 테스트(PR-1.6b)가 본다.
- `expect`: `{savedAs}` · `{rejected}`(가드 거절 — 다른 이름을 찾지 않는다) · `{failed}`(그 밖의 오류, Node 문구 그대로).
- `after`: 호출 뒤 `{{TMP}}` 전체 — 경로 → 글(UTF-8) · `{"symlink": 대상}` · `{"dir": true}`. 대기 파일은 어느 결과든 지워진다(심링크면 링크만, 대기 자리가 폴더면 지우지 못해 남는다).
- `setup`: `{"dir"}` · `{"file", "content"}` · `{"file", "size"}`(성긴 파일) · `{"symlink", "target"}` · `{"hardlink", "target"}`(`target` 의 하드링크) · `{"series": "root/report ({n}).txt", "from", "to", "content"}`. 대기 자리(`staging/guid-1`)를 `setup` 으로 만드는 사례는 `input.staged` 를 뺀다 — 보통 파일·링크 수 1 이 아니면 옮기지 않는다(`failed`).
- **기대값 재현**: 새 사례는 `id`·`input`(파일 suite 는 `setup`)만 적고, `npm run build:packages` 뒤 TS 구현(`packages/config/dist`·`packages/local-bridge-core/dist`)을 jest 밖 Node 에서 러너와 같은 절차(호출·`walk`, `{{TMP}}` 치환)로 불러 `expect`·`after` 를 채운 다음 TS 러너로 확인한다(생성 스크립트는 저장소에 두지 않는다 — 아래 "러너에만 있는 보정" 참고).
- `link` 가 `EXDEV`·`EPERM`·`ENOTSUP` 일 때의 복사 갈래와 검사 뒤 대기 자리를 바꿔 치는 틈(옮긴 대상·연 핸들이 검사한 파일인지)은 fixture 로 만들 수 없어(다른 볼륨·주입) TS `download-place.test.ts` 와 Rust 단위 테스트(`link` 주입)가 본다.

### `browser-run`

- 러너가 사례마다 임시 폴더(`{{TMP}}`)에 `setup` 을 적용하고 `{{TMP}}/profile`(전용 프로필)·`{{TMP}}/root`(연결 폴더)를 만든 뒤, **가짜 CDP** 로
  "떠 있는 Chrome 에 붙기" 길을 탄다. TS 는 `ws` 서버를 루프백에 띄우고 프로필에 `DevToolsActivePort` 를 쓴다(모의 없음, Chrome 없음). Rust 는 `BrowserHost`
  가짜(메모리 duplex, 멈춘 시계)다. 사례 끝에 `dispose`.
- `input`: `spec`(`actions`·`sitePolicy`·`approvedHosts`·`approvedUploads` — 값 그대로) · `opts`(`taskId?` · `saveError?`(스크린샷 저장 함수가 이 문구로 실패) ·
  `upload?`(true 면 `resolveUploadFiles({{TMP}}/root, files)` — 실제 검사) · `place?`(true 면 저장 함수를 준다 → `allowAndName`)) · `cdp`(규칙) ·
  `sentDefaults?` · `userControl?`(실행 전 넘겨받음).
- **규칙**: `{"on": "<method>", "where"?: {<params 의 부분 일치>}, "match"?: "<expression·functionDeclaration 에 든 글자>", "session"?: true|false,
  "reply"?: {…} | "error"?: "<문구>", "times"?: n, "emit"?: [{"method", "params"?, "session"?: true|"<세션>"}]}`. 받은 명령마다 `cdp` → `defaults` 순으로
  조건이 맞고 횟수가 남은 첫 규칙을 쓴다(`times` 없으면 무한). `reply` 가 없으면 `{}`. **`emit` 은 답보다 먼저 보낸다**(`session: true` 는 그 명령의 세션) —
  확인창을 연 누르기의 답보다 `Page.handleJavaScriptDialog` 가 먼저 나가는 순서를 두 구현이 같게 본다. 맞는 규칙이 없으면 오류로 답하고 사례가 실패한다.
- `defaults`: 탭 만들기(`T1`)·붙기(`S1`)·`Page`·`Runtime`·`DOM` 활성화·다운로드 설정·`Target.getTargets`(빈 목록)·`Target.closeTarget`·`Target.setDiscoverTargets`(연결마다 한 번). 주소 읽기(`location.href`)는
  사례가 적는다 — 그래야 `sent` 에 남는다.
- `expect`: `stdout`(결과 `JSON.stringify` **글자 전체** — 키 순서까지, 계획 D-76) · `sent`(받은 명령 `{method, params, session}` 순서 전체, `defaults` 에 걸린 것은
  `sentDefaults` 가 아니면 뺀다) · `saved`(스크린샷 저장 호출 `{name, hex}`). 경로는 `{{TMP}}` 로 바꿔 적는다.
- TS 러너는 실시간이다 — 사례마다 폴링 1~2회로 묶고, 시간 초과(요소 대기 20초·이동·CDP 30초·`loading`·다운로드 5초·`wait` 상한)는 넣지 않는다.
  그 자리는 Rust `tests/browser_timeouts.rs`(멈춘 시계)가 본다.
- 새 사례는 `id`·`setup`·`input` 만 적고 TS 러너와 같은 도우미(`runBrowserCase`)를 jest 안에서 불러 `expect` 를 채운 다음 두 러너로 확인한다(생성 스크립트는 저장소에 두지 않는다).

### 러너에만 있는 보정

- TS 러너(jest)는 테스트를 vm 영역에서 돌려 Node fs 오류가 그 영역의 `Error` 가 아니다 — `placeDownload` 의 `e instanceof Error ? e.message : String(e)` 가 가드 거절 문구 앞에 `Error: ` 를 붙인다. 운영 Node(헬퍼)에서는 붙지 않으므로 fixture 는 붙지 않은 값이고, TS 러너는 `Error: E…: ` 꼴일 때만 접두를 뗀다.

## fixture 에 넣지 않는 차이 (Rust 단위 테스트로 고정 — 계획 D-81)

모두 Rust 가 더 엄격하거나 서버에서 관찰할 수 없는 자리다.

1. `nth`·`ms` 가 배열·객체 — TS `Number([5])` = 5, Rust 는 NaN 으로 본다(`tests/browser_js_value.rs`).
2. `press` 의 조합 키·키 이름이 객체 프로토타입 이름(`constructor+a`·`toString`) — TS 는 표 조회가 참이 돼 조합 키 없이 통과하거나 `key: undefined` 를 보낸다, Rust 는 `지원하지 않는 조합 키: …`·`지원하지 않는 키: …`.
3. 결과에 되돌려 싣는 임의 값(문자열이 아닌 `type` 등) — 안쪽 객체의 키는 정렬되고 수는 `serde_json` 표기다.
4. 문구의 값을 UTF-16 200 단위로 자를 때(`clip`) 끝이 대리 쌍 한가운데면 TS 는 짝 없는 반쪽을 남기고 Rust 는 그 글자를 뺀다(`README.md` 의 git 오류 꼬리와 같은 차이 — 짝 없는 대리 문자는 fixture JSON 에 담을 수 없다).
5. 잘못된 punycode 호스트(`xn--`) — TS `URL` 은 받고, Rust `url` 은 주소 오류 → 호스트 모름(쓰기는 승인 대상, 이동은 막힘).
6. 범위 밖 수(`1e999`)가 든 요청 — TS `JSON.parse` 는 `Infinity`, Rust 는 해석 실패.
7. (없앰 — 대기 자리 검사로 fixture 에 들어갔다)
8. `serde_json` 이 못 읽는 정책 JSON — 짝 없는 대리 문자 이스케이프(`{"allow":["\ud800"]}`)·128단 넘게 겹친 값·범위 밖 수(`1e999`). TS `JSON.parse` 는 읽어 `allow` 를 쓰고, Rust 는 빈 정책(전부 승인 대상 — 더 엄격, `tests/browser_js_value.rs`).
9. 대소문자 변환(`toLowerCase`·`toUpperCase`) — Unicode 판이 달라(Node 24.22.2 ICU 18.0, Rust 1.99.1 std 17.0) 41 코드 포인트가 다르다: BMP 8개(U+0277·U+027C·U+AB4B·U+AB4C 의 대문자 U+A7DD·U+A7E2·U+AB6C·U+AB6D 짝)와 U+1DF40~U+1DF7F 의 32개·U+1DF95(→ `SS`). 호스트는 IDNA 뒤 ASCII 라 정책 판정에는 영향이 없고, `parsePolicy` 결과 글자·한 글자 `press` 의 `windowsVirtualKeyCode` 만 달라질 수 있다. 툴체인 판에 따라 바뀌므로 단위 테스트로 고정하지 않는다.
10. 결과 글을 UTF-16 단위로 자를 때(`extractText`·`extractHtml` 8000, `fill` 되돌림 200, 확인창 문구 300, 요소 이름 120) 끝이 대리 쌍 한가운데면 4 와 같은 차이다.
11. CDP 응답의 짝 없는 대리 문자(페이지 글) — TS 는 받고, Rust 는 그 반쪽을 U+FFFD 로 바꿔 읽는다(안 바꾸면 응답 전체를 못 읽어 30초 시간 초과가 된다, `tests/browser_cdp.rs`).
12. 스크린샷·다운로드 저장·업로드 파일 검사가 코어의 FS 관문(시간 제한) 안에서 돈다 — 막힌 볼륨에서 `screenshot 시간 초과` 등으로 끝난다(TS 는 시간 제한 없음).
13. Chrome 종료 — TS 는 SIGTERM, Rust 는 `Browser.close` → 5초 → SIGKILL(띄운 Chrome 만).
14. 시간·크기 환경 값이 수가 아니면 — TS `Number('abc')` = NaN, Rust 는 기본값(`ms_from_env`).
15. `Preferences` 다시 쓰기 — TS 는 JS 수 표기(2^53 넘는 정수 반올림)·키 삽입 순서, Rust 는 정수 그대로·키 정렬(Chrome 은 둘 다 읽는다). `serde_json` 이 못 읽는 꼴(128단 넘게 겹친 값·범위 밖 수 `1e999`)은 깨진 파일로 본다 — TS `JSON.parse` 는 읽어 다른 키를 보존하고, Rust 는 두 키만 든 새 파일로 바꾼다(실제 Chrome `Preferences` 는 얕고 그런 수를 쓰지 않는다).
16. CDP 응답 모양이 Chrome 과 다를 때(가짜 서버·고장난 Chrome 에서만) — `nodes`·`targetInfos` 가 문자열(JS 는 글자로 돌거나 `… is not a function`), `DOM.getBoxModel` 의 `content` 원소가 문자열(JS `+` 는 이어 붙인다), `Page.captureScreenshot` 의 `data` 가 문자열이 아님. Rust 는 값이 없거나 `null` 일 때의 V8 `TypeError` 문구만 같게 내고(`browser-run` 의 `snapshot-no-nodes`·`snapshot-null-node`·`smartClick-no-model`·`smartFill-no-object` 가 고정), 그 밖의 꼴은 실패 문구·`null` 좌표가 다르다(더 엄격 — 실패로 끝난다).
17. 액션 결과의 `dialogs` — TS 는 탭의 배열을 그대로 달아(`r.dialogs = tab.dialogs`) 액션이 끝난 뒤(다음 액션의 초기화 전·마지막 액션이면 `finalUrl` 읽기 중) 뜬 확인창도 그 결과에 덧붙고, Rust 는 결과를 만들 때 꺼내(`mem::take`) 뒤에 뜬 것은 기록에서 빠진다(확인창 처리는 같다 — 시간에 달린 좁은 경우).

## 알려진 동작 (코드로 막지 않음)

- 전용 프로필 Chrome 은 기동 뒤 Chrome 자체의 구성 요소와 모델(피싱 탐지·언어 감지 등)을 Google 에서 받는다. 끄는 것으로 확인한 인자(Chrome 157 기준, `--disable-features=OptimizationHints`)는 피싱 탐지 모델까지 꺼서 넣지 않는다(2026-11-16 결정). 구성 요소 갱신(인증서 폐기 목록 등)을 끄는 `--disable-component-update` 도 같은 이유로 넣지 않는다 — 이 프로필에서 Chrome 이 외부로 아무것도 받지 않는다는 보장은 없다.
