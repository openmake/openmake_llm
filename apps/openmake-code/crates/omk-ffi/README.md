# omk-ffi

OpenMake Code(macOS 앱)가 같은 프로세스 안에서 브리지 호스트를 돌리는 UniFFI 표면(PR-3.2). 호스트 로직은 `omk-bridge-host` 그대로이고,
여기는 값 옮기기·스레드·패닉 경계만 둔다. Swift 바인딩·XCFramework 는 `bash apps/desktop-native/lib/ffi.sh` 가 만든다(`omk-ffi-bindgen` → `Generated/`, 커밋 안 함).

| 표면 | 뜻 |
|---|---|
| `BridgeHost.start(config, apiKey, listener)` | 시작. 빈 키 `ApiKeyRequired`, 환경에 `OMK_COMPANION_API_KEY` 가 있으면 `KeyInEnvironment`(키는 인자로만) |
| `connect` · `disconnect` · `answerConfirm` · `clearAutoApprove` · `setBrowserUserControl` · `stopBrowser` · `shutdown` | 헬퍼 stdio 명령과 같은 뜻. 끝난 뒤면 `HostError.Stopped` |
| `HostListener.onEvent(HostEvent)` | 디스패처 스레드 하나에서 순서대로. `exited(code)` 가 언제나 마지막(0 정상·1 기동 실패·3 잠금·101 내부 오류) |
| `resolveEndpoints(server)` | 주소 찾기(블로킹 — 백그라운드에서 부른다) |

| 파일 | 내용 |
|---|---|
| `src/ffi.rs` | 내보내는 타입·`BridgeHost` |
| `src/run.rs` | 시작 검사, 호스트 스레드·이벤트 디스패처, 패닉 훅(프로세스를 끝내지 않고 살아 있는 호스트를 끊어 `exited(101)`) |
| `src/convert.rs` | `Event` → `HostEvent`, 확인 답 |
| `src/cloexec.rs` | 자식 띄우기 훅 — 앱의 열린 fd 가 exec 자식·Chrome 에 새지 않게 `pre_exec` 에서 FD_CLOEXEC(T0-a 실측: 훅 없으면 상속) |

**unsafe 예외:** 워크스페이스는 `unsafe_code = "forbid"` 다. 이 크레이트만 `deny` 로 두고 `lib.rs` 의 `#![allow(unsafe_code)]` 로 UniFFI 매크로가
만드는 코드와 `cloexec.rs`(`pre_exec`·`fcntl`)만 허용한다. `run.rs`·`convert.rs` 는 `#![forbid(unsafe_code)]`. `tests/ffi_guard.rs` 가 이 규칙과
MPL-2.0 고지(`apps/desktop-native/THIRD_PARTY_NOTICES.md` ↔ `Cargo.lock`)를 대조한다.
