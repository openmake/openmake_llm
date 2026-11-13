# omk-bridge-conn

로컬 브리지 연결부 — TS `packages/local-bridge-core` 의 `connection.ts`(WS 상태기계)·`endpoints.ts`(서버 주소 찾기)와 헬퍼 `helper.mjs` 의 deviceId 계산을 옮긴다.
서버에서 보면 Node 헬퍼와 같은 프레임·같은 재연결 간격·같은 deviceId 가 나와야 한다. 기준은 TS 의 현재 동작이고, 적합성 fixture `packages/local-bridge-core/conformance/conn-*.json`(형식은 그 폴더의 `CONN.md`)을 두 구현이 함께 통과한다.

| 모듈 | 내용 |
|---|---|
| `constants` | 연결 상수(재연결·핸드셰이크·hello 지연·생존 확인·인증 사유와 문구·알림·조회) |
| `reconnect` · `notice` · `frames` · `js_string` | 순수 함수 — 재연결 대기, `bridge_notice` 검증, 프레임 만들기·분류, JS `trim`·UTF-16 절단 |
| `endpoints` · `http_get` | 주소 정규화·평문 원격 판정·주소 정하기, `/api/desktop/config` 조회(GET 한 번) |
| `transport` | ws 주소·접속 대상, `Connector` 트레이트, 실제 접속부 `NetConnector`(TCP, `wss` 면 TLS) |
| `connection` · `status` | `BridgeConnection` — 연결·재연결·인증 재시도·해제, 상태 알림 |
| `device_id` | Node 동기 `fs.realpathSync` 이식, base id(`device-id` 파일), 루트별 deviceId |
| `runtime` | 호스트용 tokio 런타임 |

## 런타임과 종료

- 호스트는 `runtime::host_runtime()` 으로 런타임을 만든다 — 다중 스레드(작업 스레드 2), blocking 스레드 상한 64. 막힌 볼륨에서 블록된 파일 작업이 늘어도 스레드가 이 수를 넘지 않고, 넘는 요청은 시간 초과로 끝난다.
- `BridgeConnection::new` 는 런타임 안에서 부른다(연결 태스크를 띄운다). 핸들을 버리면 태스크가 끝나고 소켓은 상태 알림 없이 끊긴다.
- 종료는 `Runtime::shutdown_timeout` 으로 한다. 그냥 drop 하면 영영 블록된 파일 호출이 있을 때 종료가 멈춘다(코어 README 와 같다).
- 시간은 `tokio::time` 만 쓴다. 벽시계는 요청 만료 판정과 `durationMs` 에만 쓰고 `ConnectionOptions::clock` 으로 바꿀 수 있다.

## 코어 수명

- 연결은 받은 `Arc<BridgeCore>` 를 끝까지 쓴다. 재연결은 코어를 새로 만들지 않으므로 코어의 동시 파일 작업 허가(4개)도 늘지 않는다.
- 호스트(PR-1.7)는 같은 루트를 다시 연결할 때도 루트별 코어를 재사용한다(해제 때는 일괄 승인 회수만).
- 코어와 닿는 자리: `folder_root()` · `capabilities()` · `handle_exec()` · `RequestGuard`. PR-1.3 합류 자리(연결 시 `prepare`, 해제 시 일괄 승인 회수)는 `connection.rs` 의 `core_hooks` 다.

## TLS

- `rustls`(암호 제공자 `ring`, 설정에 직접 넣는다 — 전역 기본 제공자를 설치하지 않는다) + `rustls-platform-verifier`. 인증서 신뢰는 OS 가 판단한다(macOS: Security.framework — Keychain 의 사설 CA·신뢰 설정을 따른다, 폐기 확인 포함).
- 검증을 끄는 설정은 없다. 자체 서명 서버 접속은 거부된다(`tests/real_socket.rs`).
- TS 와 다른 점: Node 헬퍼는 Node 에 든 CA 목록을 쓴다. 공개 CA 는 양쪽에 다 있고, Keychain 에 넣은 사설 CA 는 Rust 에서만 통한다.

## 테스트

```bash
cd apps/openmake-code
cargo test --locked -p omk-bridge-conn
```

- `tests/conformance.rs` — `conn-*` fixture 6개(TS 러너 `conformance-conn.test.ts` 와 같은 사례).
- `tests/connection_scenarios.rs` — TS `connection.test.ts`·`reconnect-delay.test.ts` 의 연결 시나리오. 메모리 안 duplex 가짜 서버 + 멈춘 시계로 결정적으로 돈다. Rust 에서 더한 시나리오는 `tests/connection_scenarios_rust.rs`, 공용 환경은 `tests/support/scenario.rs`.
- `tests/real_socket.rs` — 실 TCP·TLS·HTTP 몇 건. `tests/core_lifetime.rs` — 막힌 폴더(FIFO)로 코어 수명·blocking 상한.
- TS 와 일부러 다르게 한 자리는 fixture 에 넣지 않고 단위 테스트로 고정한다(`CONN.md` "fixture 에 넣지 않는 차이").
