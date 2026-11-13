# openmake-code (Rust)

로컬 브리지 코어를 Rust 로 옮기는 Cargo workspace 다. 지금은 `omk-bridge-core` 에 판정 순수 함수(차단 목록·exec 환경·플랫폼 분기·샌드박스 프로파일 텍스트·상수)만 있다.
기준은 TS 구현(`packages/local-bridge-core`)의 현재 동작이며, 두 구현이 같은 적합성 fixture 를 통과해야 한다.
파일 시스템·프로세스·네트워크를 다루는 부분은 이후 PR 에서 더한다.

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
- TS 러너: `packages/local-bridge-core/src/__tests__/conformance.test.ts`
