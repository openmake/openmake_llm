# openmake-code (Rust)

로컬 브리지 코어를 Rust 로 옮기는 Cargo workspace 다. 지금 `omk-bridge-core` 에는 판정 순수 함수(차단 목록·exec 환경·플랫폼 분기·샌드박스 프로파일 텍스트·상수)와
파일 kind 처리(경로 스코프·`read` `write` `list` `listAll` `delete` `folders`·`task_end`·시간 제한·요청 만료/중복 판정),
`exec`(차단 → 사용자 확인 → macOS 샌드박스의 3단 방어·일괄 승인·exec PATH 계산·샌드박스 프로파일 파일)와 `worktree`(`add`·`diff`·`remove`),
읽기 전용 도구 `code_nav`(grep·files)·`lsp_diagnostics`(tsc·py_compile)·`test_runner`(탐지)가 있다.
기준은 TS 구현(`packages/local-bridge-core`)의 현재 동작이며, 두 구현이 같은 적합성 fixture 를 통과해야 한다.
능력 목록은 `BRIDGE_KINDS` 12종이고, 호스트가 전용 프로필 브라우저를 얹고 Chrome 이 있으면 끝에 `browser`·`browser_upload` 가 붙는다(아래 "로컬 브라우저").
브라우저(`browser::`)는 기기 쪽 판정·파일 경계(사이트 정책·제어 흐름·요청 도우미·차단 표식·업로드 파일 검사·다운로드 저장, PR-1.6a)와
CDP·Chrome 기동·실행 조정·다운로드 추적·`LocalBrowser`·액션 14종(PR-1.6b)이다.
`exec`·`worktree`·`lsp_diagnostics`·`test_runner` 는 호스트가 `BridgeCore::with_exec_host(ExecHost { … })` 로 확인 창·환경 사본·홈·플랫폼·샌드박스 설정을 얹어야 돈다
(코어는 프로세스 환경을 읽지 않는다). 호스트가 없는 코어는 exec 를 "거부"(126)로, worktree·lsp_diagnostics·test_runner 를 거절로 끝낸다
(code_nav 는 호스트 없이 돈다). 도구 자식(tsc·python3)은 exec 와 같은 샌드박스 안에서 돈다.
읽기 전용 도구의 시간 제한은 호스트가 `with_tool_timeouts(ToolTimeouts { code_nav_ms, diag_ms })` 로 얹는다
(`timed_fs::ms_from_env` 로 `OMK_BRIDGE_CODE_NAV_TIMEOUT_MS`·`OMK_BRIDGE_DIAG_TIMEOUT_MS` 를 채운다, 기본 15초).

## 런타임과 종료

`BridgeCore::handle_exec`·`prepare` 는 시간 + I/O 가 켜진 tokio 런타임(`enable_all()`) 안에서 불러야 한다 — exec·git·PATH 탐지가
자식 프로세스를 띄운다(크레이트는 tokio 의 `rt`·`time`·`sync`·`process`·`io-util` 기능만 쓴다). 자식 프로세스는 비동기로 기다려 blocking 스레드를 쓰지 않는다.
파일 작업은 `spawn_blocking` 으로 돌고 시간 제한(`OMK_BRIDGE_FS_TIMEOUT_MS`, 기본 15초)과 코어마다 동시 작업 4개 상한을 받는다.
블록된 FS 호출은 취소할 수 없어 스레드가 남는다. tokio 런타임은 drop 때 `spawn_blocking` 작업이 끝나기를 기다리므로,
호스트는 런타임을 `shutdown_background()` 또는 `shutdown_timeout()` 으로 끝낸다 — 그냥 drop 하면 영영 블록된 호출이 있을 때 종료가 멈춘다.

**남는 위험(ReDoS) — 예산 동안 코어 하나·최대 약 43MB × 2칸**: grep 정규식은 모델이 준 값이다. 엔진은 저장소 안 regress 사본
(`vendor/regress`, 출처·패치는 `vendor/regress/OMK-PATCHES.md`)으로, 판정 결함 두 개(루프 재진입·그룹 끝의 역추적 복원 누락 — 매치 누락과
빈 반복을 끝없이 쌓는 메모리 폭주의 원인)를 고치고 실행 한도 두 개를 넣었다: 역추적 스택 상한(`CODE_NAV_REGEX_MAX_BACKTRACK` = 1,048,575 항목,
판정 하나 최대 약 43MB)과 시간 예산 중단(엔진 검사점 256번마다, 1,024 단위보다 긴 줄은 줄 길이에 맞춰 더 자주 예산을 묻는다 — 물음 사이의 일이 줄 길이와 무관하게 묶인다). 예산에 멈추면 그 줄에서 `truncated: true` + 그때까지의 매치,
스택 상한을 넘으면 요청 오류(`정규식 판정이 너무 깊어 중단했습니다 (역추적 한도 초과) — …`)다. 판정 스레드는 예산 시각에서 0.1~0.2초 안(512KiB 한 줄·500자 패턴에서 물음 간격 실측 0.05~0.23초 — 가장 느린 꼴은 `i` 의 `(?=\w*)` 반복)에 code_nav 전용
관문(2칸)을 돌려주므로 묶인 스레드가 남지 않는다 — 관문 시간 제한이 먼저 답한 경우에도 같다. 남는 것: 느린 판정 하나가 예산(기본 15초)
동안 코어 하나·최대 약 43MB 를 쓴다(폴더마다 2칸). 대소문자 무시 접기의 엔진 차이(ſ·ı·K 등)는 공용 fixture README "fixture 에 넣지 않는 차이".

## 로컬 브라우저 (PR-1.6b)

- **얹기**: `BridgeCore::with_browser_profile(프로필 폴더, BrowserEnv::from_env(lookup, platform, home))` — Chrome 을 찾았을 때만 브라우저를 쥔다
  (TS 생성자와 같은 조건). 프로필마다 `LocalBrowser` 하나(프로세스 전역 표)라 여러 연결 폴더의 코어가 같은 브라우저를 쓴다. 코어는 환경을 읽지 않는다 —
  호스트가 `OMK_BRIDGE_CHROME`·`OMK_BRIDGE_BROWSER_HEADLESS`·`OMK_BRIDGE_BROWSER_TIMEOUT_MS`·`OMK_BRIDGE_BROWSER_EXTRACT_READY_MS`·
  `OMK_BRIDGE_BROWSER_DOWNLOAD_WAIT_MS`·`OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES` 와 플랫폼·홈을 넘긴다.
- **호스트가 잇는 것**(PR-1.7, `omk-helper`): 제어권 넘기기·돌려주기 = 모든 루트에 `set_browser_user_control(on)` + 연결의 `notify_browser_control(on)`,
  중지 = `stop_browser()`. 연결은 `bridge_ready` 마다 지금 제어권을 다시 알린다(브라우저 있는 코어만). 헬퍼는 끝날 때 루트를 모두 해제한 **뒤**
  `BridgeCore::dispose_browser()` 를 부른다 — 인스턴스 표가 `static` 이라 프로세스 종료 때 `Drop` 이 돌지 않는다. SIGKILL·패닉으로 죽으면 Chrome 이
  남아 다음 기동이 주소 파일로 거기에 붙는다(TS 와 같다).
- **런타임**: tokio 하나(`net` 기능 추가). CDP 는 `tokio-tungstenite` 위 최소 클라이언트(읽기·쓰기 태스크, 보내기는 소켓 쓰기를 기다리지 않는다)이고
  `127.0.0.1` 로만 붙는다. 확인창·다운로드 이벤트는 연결마다 태스크 하나가 실행 줄기와 따로 처리한다. 공유 상태는 `std::sync::Mutex` 를 짧게만 쥔다.
- **종료**: 띄운 Chrome 에만 `Browser.close`(1초까지) → 종료 5초 대기 → 남아 있으면 SIGKILL(workspace 가 `unsafe` 를 금지해 SIGTERM 을 보낼 안전한 API 가 없다).
  붙기만 한 Chrome 은 끄지 않는다.
- **저장**: 스크린샷·다운로드·업로드 파일 검사는 write 와 같은 가드(`safe_from` + `assert_git_path_allowed`)로 코어의 FS 관문 안에서 돈다 — 막힌 볼륨에서는
  `… 시간 초과` 로 끝난다(TS 는 시간 제한 없음).
- **시험**: 가짜 CDP(멈춘 시계 + duplex) — `tests/browser_cdp.rs`·`browser_scheduler.rs`·`browser_downloads*.rs`·`browser_local.rs`·`browser_core.rs`·
  `browser_timeouts.rs`, fixture `browser-run.json`. 실제 Chrome 은 `tests/browser_chrome.rs` — **로컬 전용**(Chrome 없음 또는 `CI=true` 면
  `SKIP(local-browser)`), 다른 무거운 실행과 겹치지 않게
  `cargo test -j 2 --locked -p omk-bridge-core --test browser_chrome -- --test-threads=1 --nocapture`.

## omk-helper (PR-1.7)

`crates/omk-helper` — Node 헬퍼(`apps/desktop-native/helper/src/helper.mjs`)와 **같은 stdio JSON-lines 계약**의 실행 파일이다. 계약의 원본은
`helper.mjs` 머리 주석(이벤트 10종·명령 8종)이고, 이벤트 줄은 `JSON.stringify` 의 키 순서까지 같다. 판정 로직은 없다 — 코어·연결을 호스트 값으로 잇는다.
Node 와 다른 점·그대로 옮긴 점은 `crates/omk-helper/README.md`. 배포되는 앱은 아직 Node 헬퍼를 쓴다(전환은 PR-2.1).

- **띄우기**: `omk-helper --server <주소>`(없으면 `http://localhost:52416`) — 첫 줄 `status idle`, 주소 찾기 뒤 `endpoints` 한 번. 키는 stdin 의
  `{"cmd":"auth","apiKey":…}` 로만 받는다. `omk-helper --server <주소> --resolve` 는 `{"bridgeUrl","webUrl","discovered"}` 한 줄만 내고 끝낸다(stdin 을 읽지 않는다).
- **런타임**: `runtime::host_runtime()` 하나. 주 actor 하나가 루트 표·확인 대기·종료 표식을 혼자 쥐고(자물쇠 없음), stdin 읽기·stdout 쓰기는 OS 스레드 하나씩이다
  (stdout 에 쓰는 곳은 그 스레드뿐). 끝낼 때 `shutdown_background()`.
- **환경 변수**(기동 때 한 번 읽는다 — 이름·기본값은 TS 와 같다):

  | 변수 | 뜻 |
  |---|---|
  | `HOME` | 지원 폴더 `<HOME>/Library/Application Support/OpenMakeCompanion`(device-id·샌드박스·브라우저 프로필 — Node 헬퍼와 같은 자리) |
  | `OMK_COMPANION_BROWSER` | 정확히 `1` 이면 전용 프로필 브라우저(`<지원 폴더>/browser-profile`) |
  | `OMK_COMPANION_API_KEY` | **쓰지 않는다** — 있으면 stderr 한 줄 + exit 2(지울 수 없어 자식에 넘어간다. 조회 전용 실행은 보지 않는다) |
  | `OMK_BRIDGE_SANDBOX` | `0` 이면 exec 샌드박스 끔(macOS) |
  | `OMK_BRIDGE_AUTO_APPROVE` | `1` 이면 확인 없이 실행(개발·테스트 훅) |
  | `OMK_BRIDGE_FS_TIMEOUT_MS`·`OMK_BRIDGE_CODE_NAV_TIMEOUT_MS`·`OMK_BRIDGE_DIAG_TIMEOUT_MS` | 시간 제한(기본 15초) |
  | `OMK_BRIDGE_CHROME`·`OMK_BRIDGE_BROWSER_*`·`OMK_BRIDGE_UPLOAD_MAX_FILE_BYTES` | 브라우저 환경(위 "로컬 브라우저") |

- **종료**: stdin 끝(부모가 죽었다)·`quit`·SIGTERM·SIGINT 가 같은 길 — ① 확인 대기 전부 거부 ② 100ms(거부 결과가 서버로 나갈 시간) ③ 전체 해제
  (`disconnected`·`autoApprove`·마지막 `status idle`) ④ 띄운 Chrome 정리(`dispose_browser`, 최악 약 6.6초) ⑤ stdout 비우기(500ms 까지) → exit 0.
  두 번째 계기는 무시한다(앱은 `quit` 1초 뒤 SIGTERM 을 보낸다).
- **로그를 달지 않는다**: 로거를 설치하지 않아 `tungstenite`·`rustls` 의 `log` 기록(핸드셰이크의 Authorization, CDP 프레임의 입력값)이 찍힐 길이 없다.
  stderr 는 고정 문구 셋뿐이다(기동 실패, 키 env 거절, 패닉 위치 — 패닉은 exit 101). `RUST_LOG=trace` 에서도 stderr 가 비어 있음을 테스트가 본다.
- **시험**: `cargo test --locked -j 2 -p omk-helper` — 실제 프로세스·실 TCP 가짜 서버(`tests/stdio_*.rs`), ReDoS 뒤 같은 연결 유지와 RSS 800MB 감시
  (`stdio_redos.rs`), 실제 Chrome 종료 정리(`helper_chrome.rs` — **로컬 전용**, `CI=true`·Chrome 없음·GUI 로그인 세션 없음이면 `SKIP(local-browser)`,
  `-- --test-threads=1 --nocapture`). 같은 하네스를 두 헬퍼로:

  ```bash
  node apps/desktop-native/helper/harness.cjs                                                    # Node 헬퍼(사전: build:packages + esbuild 번들)
  (cd apps/openmake-code && cargo build -j 2 --locked -p omk-helper)
  node apps/desktop-native/helper/harness.cjs --helper apps/openmake-code/target/debug/omk-helper  # omk-helper
  ```

## 검사

```bash
cd apps/openmake-code
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
cargo deny check advisories licenses   # cargo-deny 필요(CI 는 버전 고정 설치)
```

툴체인은 `rust-toolchain.toml` 로 고정한다. CI 는 `.github/workflows/openmake-code.yml`(macOS) 이다.

## 적합성 fixture

- 위치: `packages/local-bridge-core/conformance/*.json` (형식·알려진 차이는 그 폴더의 `README.md`)
- Rust 러너: `crates/omk-bridge-core/tests/conformance.rs`
- TS 러너: `packages/local-bridge-core/src/__tests__/conformance.test.ts`(exec·worktree 계열은 `conformance-exec.test.ts`)
- 브라우저: fixture `browser-*.json`(형식·넣지 않는 차이는 `BROWSER.md`), 러너 `tests/conformance_browser.rs`(TS 는 `conformance-browser.test.ts`·`conformance-browser-run.test.ts`), 공용 흐름 사례 `tests/browser_flow_cases.rs`, JS 값 변환·Rust 전용 사례 `tests/browser_js_value.rs`.
- 시간·크기에 기대는 프로세스 동작은 `tests/exec_proc.rs`, 샌드박스가 실제로 막는 것은 `tests/exec_sandbox.rs`(macOS, 실제 `sandbox-exec`)가 본다.
- 읽기 전용 도구: 러너 `tests/conformance/code_nav.rs`·`diagnostics.rs`·`test_runner.rs`(TS 는 `conformance-tools.test.ts`), fixture 밖은
  `tests/tools_core.rs`, 끝나지 않는 판정의 CPU 묶기는 `tests/tools_redos.rs`(CPU 2개를 묶어 따로 둔다 — 메모리 폭주는 시험하지 않는다), 도구 자식 샌드박스는 `tests/tools_sandbox.rs`(macOS).
