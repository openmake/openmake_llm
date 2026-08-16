# @openmake/api-contracts

iOS 등 멀티클라이언트가 소비하는 **API 계약 산출물** 패키지. (배경: `docs/proposals/2026-08-16-ios-axis1-openapi-contract-plan.md`)

| 산출물 | 내용 | Source of Truth |
|---|---|---|
| `openapi.v1.json` | REST 계약 (OpenAPI 3.0.3) | `apps/api/src/swagger/spec-core.ts` (+ `swagger/paths-*.ts`, `schemas-core.ts`) |
| `events/ws-chat.v1.schema.json` | WS 채팅 프로토콜 (JSON Schema draft-07) | `packages/shared-types` 의 `WsChatRequest`·`WsServerEvent` |

## 규칙

- **산출물 수기 편집 금지.** TS SoT 를 수정한 뒤 재생성한다:
  ```bash
  npm run contracts:export
  ```
- 재생성 결과는 **결정적**이어야 한다 — CI 가 `contracts:export` 후 `git diff --exit-code` 로 drift 를 검사한다 (축 1 Step 5).
- `info.version` 은 앱 릴리스 버전이 아닌 **계약 버전**이다. breaking change(필드 삭제·타입 변경·필수화 등)는 기존 v1 파일을 고치지 않고 `v2` 파일 추가로만 반영한다. enum 값 추가도 breaking-risk 로 취급 — 클라이언트는 미지 enum/이벤트를 무시-허용으로 디코딩해야 한다.
- `servers` 는 의도적으로 미포함 — 클라이언트(생성 SDK)가 serverURL 을 주입한다.

## 소비처

- Swift: `swift-openapi-generator`(REST) + `quicktype`(WS Codable) — 축 3 `OpenMakeKit` 에서 생성·커밋.
