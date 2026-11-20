# omk-api — OpenMake REST 클라이언트 (PR-3.1)

CLI `apps/cli/src/api.ts` 의 18개 호출 전체와 폴더 조회 1개를 Rust 로 옮긴 크레이트다. REST 호출·응답 해석만 맡고,
UI·폴링·자동 실행·자동 재시도·Keychain·상태 판정은 소비자(3.2 FFI, 3.3~3.5 앱, 4.1 CLI) 몫이다.
macOS 제품 범위의 내부 크레이트이며 portable SDK 가 아니다(omk-bridge-conn 을 통해 Unix·bridge-core 의존이 따라온다 — Windows 는 PR-5.1).

## 범위

| 메서드 | HTTP (`T=/api/agent-tasks`, `S=/api/shared-tasks`) |
|---|---|
| create_task | POST T (+ `Idempotency-Key`) |
| get_task / list_tasks / list_steps / list_subagents | GET T/{id} · T?executor=local&deviceId=&status= · T/{id}/steps · T/{id}/subagents |
| execute_task / resume_task | POST T/{id}/execute · T/{id}/resume (`{}`) |
| set_auto_approve | POST T/{id}/approvals/auto-approve `{enabled}` — 호출자가 명시할 때만, 자동 호출 없음 |
| list_pending / answer_approval / answer_question | GET T/approvals/pending · POST T/approvals/{id}/{approve\|reject}(body 없음) · POST …/answer `{text}` |
| get_share / preview_share / publish_share / unshare | GET·POST·DELETE T/{id}/share, POST T/{id}/share/preview |
| get_shared_task / open_shared_artifact | GET S/{shareId}(?token=) · S/{shareId}/artifacts/{index}/open(?token=) — URL 은 반환만 |
| bridge_status / list_folders | GET /api/local-bridge/status · /api/local-bridge/folders?deviceId=&path= |

나머지 관리·파일·취소·steer·fork 기능은 넣지 않는다. 공유는 preview → 사람 확인 → publish 순서를 소비자가 지킨다.

## 비동기 소비

- `ApiClient::new(server_url, ApiKey, RequestLimits)` — 런타임을 소유하지 않는다. 호출자의 Tokio 런타임에서 await 한다
  (3.2 는 메인 스레드에서 block_on 하지 않는다). `ApiClient: Send + Sync`, 모든 공개 future 는 `Send` — `Arc<ApiClient>` 로 공유한다.
- `RequestLimits { timeout, body_max_bytes }` 는 필수이며 0 은 거부한다. 큰 공유 문서·페이지 없는 작업 목록을 감당할 값은 소비 PR 이 정한다.
- 요청마다 HTTP/1 연결 하나. 풀·HTTP/2·프록시·자동 재시도 없음. 리디렉션은 따르지 않고 오류다(키가 다른 origin 으로 가지 않게).
  TLS 는 OS 신뢰 저장소(ring) — 검증을 끄는 옵션은 없다. 취소·시간 초과 때 연결은 정리된다.

## 키

`ApiKey` 는 생성 인자로만 받는다. Debug 는 `[REDACTED]`, Display·Serialize·getter 없음, 헤더 값은 sensitive 표시.
Keychain·파일·환경변수에서 읽는 일과 로그는 크레이트 밖이다. 메모리 소거(zeroize)는 보장하지 않는다.

## 제출 수명 (Idempotency-Key)

`CreateSubmission::new(goal, device_id, folder_rel)` 이 UUID v4 키와 body 를 한 번 만들어 묶는다. 결과를 모르는 네트워크 실패나
409(같은 키 처리 중) 뒤 다시 보낼 때는 **같은 객체**로 `create_task` 를 부른다 — 서버가 작업을 한 번만 만든다. 새 사용자 제출에만 새 객체.
`create_task` 는 실행하지 않는다. `deduplicated: true` 이고 `task.status` 가 pending 이 아니면 이미 실행이 시작된 것이므로
**다시 execute 하지 않는다**. 실행 가능 판정은 서버가 한다. 프로세스 종료 후 복구·재시도 정책은 범위 밖이다.

## 오류

`ApiError` 는 InvalidInput·Authentication(401)·Forbidden(403)·Conflict(409)·RateLimited(429)·Http(그 밖 3xx/4xx)·Server(5xx)·
ApiFailure(2xx + success:false)·Network·Timeout·Decode·ResponseTooLarge. 서버 오류는 `ServerError` 에 status·code·message 를 보존한다.
Display/Debug 에는 범주·status·고정 문구만 나온다(code 도 출력하지 않는다). 서버 사유는 `server_message()` 로만 읽는다 —
같은 `BAD_REQUEST` 라도 사유가 다르다. message 는 제어 문자를 지우고 4096 bytes 로 자르지만 비밀값이 없다는 보장은 아니므로,
소비 UI/CLI 는 명시 접근 값만 화면에 표시하고 자동 로깅하지 않는다.

응답은 표준 envelope 만 받는다: 2xx `success:true` 는 `data` 필수, success 없는 직접 payload 는 Decode. 미지 필드는 무시하고
상태·step type·visibility·isolation.state·riskClass 같은 미지 문자열은 보존한다. 서버 판정(status·resumable·queued·isolation)을 재계산하지 않는다.

## 계약 대조의 한계

`packages/api-contracts/openapi.v1.json` 은 43개 path 중 이 크레이트가 쓰는 것으로 작업 생성 POST 하나만 담고 있다.

- 문서화된 생성 operation: 사용 필드의 type/enum/required 와 Idempotency-Key 위치·pattern 을 대조하고, 실제 생성 키를 pattern(regress)으로 검사한다.
- 미문서 18개 operation 과 생성 응답의 추가 task 필드: `tests/contracts/exceptions-*.json` 의 정확한 예외(사유·서버 근거·소비 PR·U-10)로만 통과한다.
- DTO 직렬화 키 집합 = 문서 대조 ∪ 예외(교집합 없음), 실제 요청 query/body 키 = manifest. 모든 필드가 OpenAPI 와 일치한다는 뜻이 아니다.
- 계약 보강은 단계 ①~④ 서버 무수정 원칙에 따라 단계 ④ 이후 별도 서버 PR(U-10)로 한다.

**계약을 바꾸는 서버 PR 에서 이 테스트가 실패하면 그 PR 에서 오래된 예외를 문서 대조 대상으로 승격하고 DTO/fixture/manifest 를 함께 대조한다.**

dev·main 필수 검사는 `CI Gate (Test → Build → Size → Lint)` 하나이며 `openmake-code` 는 비필수이므로, 계약 PR 이 openmake-code 실패 상태로 머지될 수 있다.

## 검사

```sh
cd apps/openmake-code
cargo fmt --check
cargo clippy --all-targets --locked -j 2 -- -D warnings
cargo test --locked -j 2 -p omk-api
```

- `src/contract_tests/` — OpenAPI 대조·DTO 키 집합·실제 키 pattern, 일부러 틀린 메모리 사본의 실패(테스트 빌드 전용).
- `tests/decode.rs` · `tests/http.rs` · `tests/security.rs` — 로컬 목 HTTP 서버(127.0.0.1:0)로 해석·wire·전송 실패·보안 경계. 실제 서버 라이브가 아니다.
- `tests/live_readonly.rs` — 기본 ignored 운영 read-only 보조 스모크. 저장소 밖 설정 파일 경로만 `OMK_API_SMOKE_CONFIG` 로 받는다
  (키를 환경변수·argv 에 넣지 않는다). EGO 라이브를 대신하지 않는다.
- fixture 출처: `tests/fixtures/SOURCES.md`.
