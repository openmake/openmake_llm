# 연결 적합성 fixture (`conn-*.json`)

브리지 연결부 — TS `connection.ts`·`endpoints.ts`·헬퍼의 deviceId 계산 — 를 TS 와 Rust(`apps/openmake-code/crates/omk-bridge-conn`)가 똑같이 하는지 보는 사례다. 공통 규칙(기준은 TS 의 현재 동작, 보이지 않는 문자는 `\uXXXX`, `{{TMP}}`·`setup`, 사례 id 중복·빈 묶음 실패)은 `README.md` 와 같다.

| 러너 | 위치 | 실행 |
|---|---|---|
| TS | `packages/local-bridge-core/src/__tests__/conformance-conn.test.ts` | `npx jest -c packages/local-bridge-core/jest.config.js conformance-conn` |
| Rust | `apps/openmake-code/crates/omk-bridge-conn/tests/conformance.rs` | `cd apps/openmake-code && cargo test --locked -p omk-bridge-conn --test conformance` |

## 규칙

- **파일 나눔**: `conn-` 로 시작하는 파일은 연결 러너 몫이고, 코어 러너(`conformance.test.ts`·`omk-bridge-core/tests/conformance.rs`)는 건너뛴다. 네 러너 모두 자기 몫의 목록을 아는 suite 와 정확히 대조한다 — 어느 쪽에도 없는 파일은 실패한다.
- **모양 검사**: 두 러너가 같은 표로 최상위 묶음 이름·사례 키·`steps` 형식을 본다. 모르는 키·빠진 키·빈 목록은 실패한다. 새 키는 두 러너의 표를 같은 PR 에서 늘린다.
- **`divergence`·`rustExpect` 를 쓰지 않는다**(있으면 실패). Rust 가 일부러 다르게 하는 자리는 fixture 에 넣지 않고 Rust 단위 테스트로 고정한다(아래 "fixture 에 넣지 않는 차이").
- 주소는 `example.com`(하위 이름 포함)·`localhost`·`127.0.0.1`·`[::1]` 만, 키는 `omk_test`, 경로는 `/work/…` 합성 경로나 `{{TMP}}` 만 쓴다.

## suite

| suite | 묶음 | 사례 |
|---|---|---|
| `conn-constants` | `values` | 연결 상수. 정규식은 `{source, flags}`. TS 는 `constants.ts`·`endpoints.ts` 에서 찾는다 |
| `conn-reconnect-delay` | `cases` | `input: {attempt, baseMs, maxMs, random}` → `{ms}`. `attempt` 는 0 이상의 정수 |
| `conn-notice` | `cases` · `trim` | `cases`: `input` 은 서버 프레임 필드, `expect` 는 알림 또는 `null`. `trim`: JS `String.prototype.trim` |
| `conn-endpoints` | `normalize` · `plainRemoteHttp` · `resolve` · `discover` | 주소 입력은 문자열만. `resolve.expect` 는 결과 또는 `{error}`. `discover.input.response` 는 `{status, body}`(body 는 응답 본문 글자 — `fetch` 의 `res.json()` 처럼 UTF-8 로 풀며 앞의 BOM 하나를 떼고 JSON 으로 읽는다, 2xx 만 읽는다) 또는 `{fail: true}`(조회가 던짐), `expect` 는 `{url, result}`(url = 요청한 주소) 또는 `{error}` |
| `conn-device-id` | `rootDeviceId` · `realpathSync` · `baseId` | `realpathSync` 는 Node `fs.realpathSync`(JS 구현) — 오류는 Node 문구 그대로. `baseId` 의 지원 폴더는 `{{TMP}}/support`, 파일은 그 안의 `device-id`. `expect` 는 `{id}`(파일을 읽은 값) 또는 `{generated: true, written}`(UUID v4 를 만들었고, `written` = 파일에 그 값이 쓰였는가) |
| `conn-frames` | `cases` | 아래 |

TS 러너는 헬퍼(`apps/desktop-native/helper/src/helper.mjs`)를 가져올 수 없어(ESM, 가져오는 순간 인자·환경을 읽고 폴더를 만든다) 헬퍼의 식을 같은 글자로 실행하고, 그 식들이 헬퍼 소스에 그대로 있는지 확인한다.

### `conn-frames`

사례 하나 = 임시 폴더 하나 + 실제 코어 하나 + 가짜 서버 하나 + 연결 하나.

- 사례 키: `id` · `opts` · `steps` · `expect`, 선택 `setup`(`{{TMP}}` 기준) · `root`(연결 폴더의 `{{TMP}}` 기준 이름, 기본 `root` — 러너가 만든다) · `after`(`[{absent}]`·`[{exists, content}]`).
- `opts`: `deviceId` · `label`, 선택 `hostId` · `reconnectMs` · `authRetryMs` · `shouldReconnect`(`false` 면 항상 거짓) · `headersError`(접속 헤더 함수가 이 문구로 실패). 러너는 `random` 을 항상 1 로 준다(재연결 대기 = 기준 간격). 헤더는 `Authorization: Bearer omk_test`.
- 가짜 서버는 `bridge_hello` 를 받으면 `bridge_ready` 로 답한다. 러너는 연결 뒤 상태 `connected` 까지 기다리고(`headersError` 면 기다리지 않는다) `steps` 를 차례로 한다.
- `steps`: `{"server": {…}}`(텍스트 프레임) · `{"serverText": "…"}`(JSON 이 아닐 수 있는 텍스트) · `{"serverBinary": "…"}`(바이너리 프레임) · `{"serverClose": {"code", "reason"}}`(빈 객체면 코드 없이 닫는다) · `{"serverDrop": true}`(닫기 절차 없이 끊는다) · `{"client": "browserControl", "user": bool}` · `{"client": "disconnect"}`.
  - `bridge_exec` 를 보내면 그 결과 프레임이 올 때까지, `browserControl` 은 그 프레임이 올 때까지, 닫힘·끊김·`disconnect` 는 끝 상태(`reconnecting`·`idle`·`closed`·인증 사유)가 나올 때까지 기다린다(연결이 없으면 기다리지 않는다).
  - 끝나고 연결이 살아 있으면 **끝 표지**(만료된 `bridge_exec` — 코어를 거치지 않고 바로 거절된다)를 보내 그 응답까지 기다린다. 끝 표지 응답은 `frames` 에서 뺀다.
- `expect`: `frames`(서버가 받은 프레임 전체, 순서대로, 객체 전체 일치) · `statuses`(`[글, 코드, arg]`, 없으면 `null`) · `notices` · `delays`(재연결 대기 ms).
- 자리표시: `"{{CAPABILITIES}}"` = 그 구현의 `core.capabilities()`(옮기는 도중이라 TS 와 Rust 의 목록이 다르다) · `"{{DURATION}}"` = 0 이상의 정수인지만 본다 · `{"{{NOW}}": 차이}`(서버 프레임 안) = 지금 시각(ms) + 차이.
- `exec` 등 Rust 코어가 아직 거절하는 kind 는 넣지 않는다.

## fixture 에 넣지 않는 차이 (Rust 단위 테스트로 고정)

Rust 가 일부러 다르게 하는 자리다 — 모두 더 엄격하거나 서버에서 관찰할 수 없다. 설계 `plan-pr1.5.md` D-49.

| 자리 | TS | Rust | Rust 테스트 |
|---|---|---|---|
| 연결 주소가 ws URL 이 될 수 없을 때 | `new WebSocket` 이 던져 처리되지 않은 거부 | 상태 `서버 주소가 올바르지 않습니다: <주소>`(`server_error`) 뒤 멈춤 | `connection_scenarios.rs` |
| `error` 프레임의 `message` 가 문자열·`null`·없음이 아닐 때 | JS 문자열 변환 | 빈 문구 | `frames.rs` |
| 짝 없는 대리 문자가 든 프레임 | 받는다 | JSON 해석 실패 → 무시 | `frames.rs` |
| `toolName` 100 단위 절단이 대리 쌍 한가운데 | 반쪽이 남는다 | 그 글자를 뺀다 | `notice.rs` |
| `random` 이 NaN | 대기 1ms | 1.0 으로 본다 | `reconnect.rs` |
| 주소 조회 리디렉션·64KiB 넘는 본문 | 따른다·받는다 | 조회 실패 | `real_socket.rs` |
