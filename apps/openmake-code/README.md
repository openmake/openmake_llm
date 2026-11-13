# openmake-code (Rust)

로컬 브리지 코어를 Rust 로 옮기는 Cargo workspace 다. 지금 `omk-bridge-core` 에는 판정 순수 함수(차단 목록·exec 환경·플랫폼 분기·샌드박스 프로파일 텍스트·상수)와
파일 kind 처리(경로 스코프·`read` `write` `list` `listAll` `delete` `folders`·`task_end`·시간 제한·요청 만료/중복 판정),
`exec`(차단 → 사용자 확인 → macOS 샌드박스의 3단 방어·일괄 승인·exec PATH 계산·샌드박스 프로파일 파일)와 `worktree`(`add`·`diff`·`remove`),
읽기 전용 도구 `code_nav`(grep·files)·`lsp_diagnostics`(tsc·py_compile)·`test_runner`(탐지)가 있다.
기준은 TS 구현(`packages/local-bridge-core`)의 현재 동작이며, 두 구현이 같은 적합성 fixture 를 통과해야 한다.
능력 목록은 `BRIDGE_KINDS` 12종 전부다. 브라우저는 이후 PR 에서 더한다 — 그때까지 코어는 `browser` 를 "지원하지 않는 kind" 로 거절한다.
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

**남는 위험(ReDoS)**: grep 정규식은 모델이 준 값이고 `regress` 에는 단계·시간 제한이 없어, 한 줄 안에서 끝나지 않는 판정은 멈출 수 없다.
`code_nav` 는 코어마다 전용 관문(2칸)에서 돌아 그 요청은 시간 제한에 답하고 파일 kind·다른 폴더는 계속 돌지만, 묶인 스레드는 프로세스가
끝날 때까지 코어 하나를 100% 쓴다(폴더마다 최대 2개). 차등 실험에서는 빈 매치를 반복하는 중첩 수량자가 짧은 줄에서도 메모리를 크게 쓰는
경우가 있었다 — 진짜 해법(단계 예산이 있는 엔진 또는 죽일 수 있는 작업자 프로세스)은 별건이다.

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
- 시간·크기에 기대는 프로세스 동작은 `tests/exec_proc.rs`, 샌드박스가 실제로 막는 것은 `tests/exec_sandbox.rs`(macOS, 실제 `sandbox-exec`)가 본다.
- 읽기 전용 도구: 러너 `tests/conformance/code_nav.rs`·`diagnostics.rs`·`test_runner.rs`(TS 는 `conformance-tools.test.ts`), fixture 밖은
  `tests/tools_core.rs`, ReDoS 가두기는 `tests/tools_redos.rs`(CPU 2개를 묶어 따로 둔다), 도구 자식 샌드박스는 `tests/tools_sandbox.rs`(macOS).
