# 브라우저 적합성 fixture (`browser-*.json`)

로컬 브라우저(Companion P2)의 **기기 쪽 판정** — 사이트 정책(`@openmake/config` `browser-site-policy.ts`)·제어 흐름(`browser-flow.ts`·`browser/browser-flow.ts`)·요청 도우미(`browser/local-browser-defs.ts`)·차단 표식(`policy-block.ts`)·업로드 파일 검사(`upload-files.ts`)·다운로드 저장(`download-place.ts`) — 을 TS 와 Rust(`apps/openmake-code/crates/omk-bridge-core/src/browser/`)가 똑같이 하는지 보는 사례다. 공통 규칙(기준은 TS 의 현재 동작, 기대값은 TS 를 돌려 채운다, 보이지 않는 문자는 `\uXXXX`, 사례 id 중복·빈 묶음 실패)은 `README.md` 와 같다.

| 러너 | 위치 | 실행 |
|---|---|---|
| TS | `packages/local-bridge-core/src/__tests__/conformance-browser.test.ts`(+ `conformance-browser-support.ts`) | `npx jest -c packages/local-bridge-core/jest.config.js conformance-browser` |
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
| `browser-constants` | `values` · `tables` · `messages` · `env` · `chrome` (사례 목록이 아니라 값) | `values`: `BROWSER_*`(환경으로 바뀌는 값은 기본값)·`BROWSER_KIND`·`BROWSER_UPLOAD_CAPABILITY`·`BROWSER_FLOW_MAX_DEPTH`·`BROWSER_REPEAT_MAX`. `tables`: `interactiveRoles`·`pageActions`(정렬)·`actionClass`(분류표 — TS 는 소스의 표 키 순서도 본다)·`policyBlockKinds`(TS 는 `types.ts` 의 합 타입을 읽는다). `messages`: 오류 문구·페이지 조각. `env`: 환경 이름 → 기본값(TS 는 소스에 `process.env.<이름>` 이 있는지도 본다). `chrome`: 후보 경로(`{{HOME}}`)·Windows 루트와 파일 조각·실행 인자(`{{PROFILE}}`, `headlessOnly` 는 화면 없음일 때만) — TS 는 함수를 내보내지 않으므로 `chrome.ts` 소스에 그 글자가 이 순서로 있는지 본다. **Rust 는 1.6a 에서 `chrome` 을 모양만 보고, PR-1.6b 가 함수 결과와 대조한다** |
| `browser-site-policy` | `policies`(이름 → `{allow, deny}`) + `classify` · `hostOf` · `navigable` · `hostMatches` · `allowed` · `needsApproval` · `check` · `parsePolicy` · `uploadFilesOf` · `policyBlock` | `input.policy` 는 `policies` 의 이름. `check.input.approvedUploads` 가 없으면 기본값(`[]`)으로 부른다(이미 `parseApprovedUploads` 를 지난 모양). `policyBlock.input.fn` 은 `of`(`browserPolicyBlockOf`)·`userControl`·`uploadRejected` |
| `browser-flow` | `validate` · `cond` · `run` | `validate.expect`: `{error}`(문구 전체) 또는 `{error: null, flat}`(펼친 단순 액션 값). `cond.expect.expression`: `condExpression` 글자 전체. `run`: 아래 |
| `browser-defs` | `str` · `screenshotName` · `keyEventOf` · `approvedUploads` · `clickPointJs` · `fillPrepareJs` · `downloadTaskOf` · `jsonString` | `keyEventOf.expect`: `{text?, common}`(text 가 `undefined` 면 키 없음) 또는 `{error}`. `clickPointJs`·`fillPrepareJs` 의 `sel` 은 호출부가 넘기는 JSON 문자열 그대로. `downloadTaskOf.input`: `tabs`(`[키, {targetId, sessionId}]`)·`running`(실행 중인 작업 키)·`sessionId?`·`frameId`, `expect` 는 키 또는 `null`. `jsonString`: `JSON.stringify(문자열)` 글자 |
| `browser-upload-files` | `baseSetup` + `cases` | `resolveUploadFiles(input.base, input.files)`. `setup` 은 `baseSetup` 뒤에 더한다. `expect`: `{paths}`(realpath) 또는 `{error}` |
| `browser-download-place` | `cases` | 아래 |

### `browser-flow/run`

- `input.actions` 는 형태 검사를 통과한 배열(러너가 먼저 확인한다), `input.maxSimple` 은 실행 수 상한.
- 가짜 실행: 액션의 `fail` 이 문자열이면 그 문구로, `true` 면 `실패` 로 `{i, type, ok: false, error}`, 아니면 `{i, type, ok: true}`(`type` 이 없으면 키 없음).
- 가짜 조건: `input.conds` 는 조건 JSON 글자 → 평가 순서대로의 값(`true`·`false`·`"throw"`(문구 `조건 평가 실패`)·`{"throw": "<문구>"}`, 다 쓰면 마지막 값 반복). 러너는 키를 **값으로** 대조한다(키 순서에 기대지 않는다 — `cond-key-order` 사례).
- `expect.results`: 결과 배열의 `JSON.stringify` **글자 전체** — 결과 객체의 키 순서(TS 리터럴 순서, 계획 D-76)까지 본다.

### `browser-download-place`

- 러너가 사례마다 `{{TMP}}/root`(연결 폴더)·`{{TMP}}/staging`(대기 폴더)·`{{TMP}}/outside` 를 만들고 `setup` 을 적용한다. `input.staged` 가 있으면 그 글로 `{{TMP}}/staging/guid-1` 을 만들고(없으면 대기 파일 없음), `placeDownload(root, {root, dirs: []}, input.name, 대기 파일)` 을 부른다. 가드는 요청 시점 구조 규칙만 본다 — 연결 때 정한 git 디렉터리 목록이 필요한 사례는 코어 경유 테스트(PR-1.6b)가 본다.
- `expect`: `{savedAs}` · `{rejected}`(가드 거절 — 다른 이름을 찾지 않는다) · `{failed}`(그 밖의 오류, Node 문구 그대로).
- `after`: 호출 뒤 `{{TMP}}` 전체 — 경로 → 글(UTF-8) · `{"symlink": 대상}` · `{"dir": true}`. 대기 파일은 어느 결과든 지워진다.
- `setup`: `{"dir"}` · `{"file", "content"}` · `{"file", "size"}`(성긴 파일) · `{"symlink", "target"}` · `{"series": "root/report ({n}).txt", "from", "to", "content"}`.
- **기대값 재현**: 새 사례는 `id`·`input`(파일 suite 는 `setup`)만 적고, `npm run build:packages` 뒤 TS 구현(`packages/config/dist`·`packages/local-bridge-core/dist`)을 jest 밖 Node 에서 러너와 같은 절차(호출·`walk`, `{{TMP}}` 치환)로 불러 `expect`·`after` 를 채운 다음 TS 러너로 확인한다(생성 스크립트는 저장소에 두지 않는다 — 아래 "러너에만 있는 보정" 참고).
- `link` 가 `EXDEV`·`EPERM`·`ENOTSUP` 일 때의 복사 갈래는 fixture 로 만들 수 없어(다른 볼륨·주입) TS `download-place.test.ts` 와 Rust 단위 테스트(오류 코드 주입)가 본다.

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
7. 대기 파일(`staging/<guid>`)이 심링크·폴더 — TS `fs.link` 는 OS 의 `link(2)` 를 따라 결과가 OS 마다 다르다(macOS 는 원본 심링크를 따라가 대상 파일의 하드링크 = 보통 파일, Linux 는 심링크 자체를 링크). 두 러너의 OS 가 달라 fixture 에 넣지 않는다. Rust 는 원본을 `canonicalize` 해 늘 대상 파일을 링크한다 — macOS TS 와 같고, Linux 에서도 연결 폴더 안에 심링크를 만들지 않는다(더 엄격). 끊긴·순환 링크는 `link` 의 `ENOENT`·`ELOOP` 문구, 폴더 원본은 macOS `copyfile` 의 `ENOTSUP`(대상이 있으면 `EEXIST` 가 먼저라 다음 이름으로 넘어간다). macOS TS 실측값으로 `src/browser/download_place.rs` 단위 테스트가 고정한다.
8. `serde_json` 이 못 읽는 정책 JSON — 짝 없는 대리 문자 이스케이프(`{"allow":["\ud800"]}`)·128단 넘게 겹친 값·범위 밖 수(`1e999`). TS `JSON.parse` 는 읽어 `allow` 를 쓰고, Rust 는 빈 정책(전부 승인 대상 — 더 엄격, `tests/browser_js_value.rs`).
9. 대소문자 변환(`toLowerCase`·`toUpperCase`) — Unicode 판이 달라(Node 24.22.2 ICU 18.0, Rust 1.99.1 std 17.0) 41 코드 포인트가 다르다: BMP 8개(U+0277·U+027C·U+AB4B·U+AB4C 의 대문자 U+A7DD·U+A7E2·U+AB6C·U+AB6D 짝)와 U+1DF40~U+1DF7F 의 32개·U+1DF95(→ `SS`). 호스트는 IDNA 뒤 ASCII 라 정책 판정에는 영향이 없고, `parsePolicy` 결과 글자·한 글자 `press` 의 `windowsVirtualKeyCode` 만 달라질 수 있다. 툴체인 판에 따라 바뀌므로 단위 테스트로 고정하지 않는다.
