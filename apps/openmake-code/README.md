# openmake-code (Rust)

로컬 브리지 코어를 Rust 로 옮기는 Cargo workspace 다. 지금 `omk-bridge-core` 에는 판정 순수 함수(차단 목록·exec 환경·플랫폼 분기·샌드박스 프로파일 텍스트·상수)와
파일 kind 처리(경로 스코프·`read` `write` `list` `listAll` `delete` `folders`·`task_end`·시간 제한·요청 만료/중복 판정),
`exec`(차단 → 사용자 확인 → macOS 샌드박스의 3단 방어·일괄 승인·exec PATH 계산·샌드박스 프로파일 파일)와 `worktree`(`add`·`diff`·`remove`)가 있다.
기준은 TS 구현(`packages/local-bridge-core`)의 현재 동작이며, 두 구현이 같은 적합성 fixture 를 통과해야 한다.
진단·코드 탐색·테스트 러너 탐지·브라우저는 이후 PR 에서 더한다 — 그때까지 코어는 그 kind 를 "지원하지 않는 kind" 로 거절하고 능력 목록에서 뺀다.
`exec`·`worktree` 는 호스트가 `BridgeCore::with_exec_host(ExecHost { … })` 로 확인 창·환경 사본·홈·플랫폼·샌드박스 설정을 얹어야 돈다
(코어는 프로세스 환경을 읽지 않는다). 호스트가 없는 코어는 exec 를 "거부"(126)로, worktree 를 거절로 끝낸다.

## 런타임과 종료

`BridgeCore::handle_exec`·`prepare` 는 시간 + I/O 가 켜진 tokio 런타임(`enable_all()`) 안에서 불러야 한다 — exec·git·PATH 탐지가
자식 프로세스를 띄운다(크레이트는 tokio 의 `rt`·`time`·`sync`·`process`·`io-util` 기능만 쓴다). 자식 프로세스는 비동기로 기다려 blocking 스레드를 쓰지 않는다.
파일 작업은 `spawn_blocking` 으로 돌고 시간 제한(`OMK_BRIDGE_FS_TIMEOUT_MS`, 기본 15초)과 코어마다 동시 작업 4개 상한을 받는다.
블록된 FS 호출은 취소할 수 없어 스레드가 남는다. tokio 런타임은 drop 때 `spawn_blocking` 작업이 끝나기를 기다리므로,
호스트는 런타임을 `shutdown_background()` 또는 `shutdown_timeout()` 으로 끝낸다 — 그냥 drop 하면 영영 블록된 호출이 있을 때 종료가 멈춘다.

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
