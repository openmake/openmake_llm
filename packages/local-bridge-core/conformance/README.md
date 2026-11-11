# 적합성 fixture (conformance)

브리지 코어의 판정을 TS 구현(`packages/local-bridge-core/src`)과 Rust 구현(`apps/openmake-code/crates/omk-bridge-core`)이 똑같이 내는지 확인하는 공용 사례다.

| 러너 | 위치 | 실행 |
|---|---|---|
| TS | `packages/local-bridge-core/src/__tests__/conformance.test.ts` | `npm test --workspace=@openmake/local-bridge-core` |
| Rust | `apps/openmake-code/crates/omk-bridge-core/tests/conformance.rs` | `cd apps/openmake-code && cargo test --locked` |

## 규칙

- **기준은 TS 의 현재 동작이다.** 기대값은 손으로 쓰지 않고, 사례 입력을 적은 뒤 TS 구현을 돌려 나온 값을 넣고 사람이 읽어 확인한다. TS 동작이 이상해 보여도 이식 PR 에서 고치지 않는다.
- 두 러너는 이 폴더의 `*.json` 을 모두 열거한다. 자기가 모르는 suite 가 있으면 실패한다. suite 는 두 러너와 같은 PR 에서만 더한다.
- 판정 사례뿐 아니라 규칙 표(차단 패턴의 `source`·`flags`·사유, 환경변수 허용 목록 등)도 fixture 에 두고 양쪽이 자기 표와 같은지 본다.
- 공통 머리: `{ "suite": "<파일 이름>", "version": 1, ... }`.
- 보이지 않는 문자(제어 문자·유니코드 공백 등)는 `\uXXXX` 로 적는다.
- 경로는 합성 경로(`/work/repo`)만 쓴다. 홈은 자리표시 `{{HOME}}` 이고 러너가 채운다(TS 는 실제 홈의 realpath, Rust 는 인자로 넘기는 임의 홈).

## suite

| 파일 | 대상 |
|---|---|
| `constants.json` | 환경변수 허용 목록·캐시/비밀 경로·요청 종류 등 상수 값 |
| `denylist.json` | `rules`(규칙 표) · `normalize`(차단 전 정리) · `cases`(판정) |
| `exec-env.json` | exec 자식 환경 조립. 결과는 순서 없는 맵으로 비교한다 |
| `platform.json` | 셸 호출·PATH 구분자·폴더 이름·일괄 승인 가능 여부 |
| `sandbox-profile.json` | macOS sandbox-exec 프로파일 텍스트(바이트 단위 일치) |

## 알려진 차이

Rust 는 차단 패턴을 ECMAScript 정규식 크레이트 `regress` 로 컴파일한다. `regress`(0.12.0 기준)는 `u` 없는 `i` 플래그에서 비ASCII 문자를 ASCII 로 접는다 — U+017F(ſ)→`s`, U+212A(켈빈 기호)→`k`. JavaScript 는 이 접기를 하지 않는다. 그래서 `i` 플래그 규칙(Windows 규칙)에서 이 두 문자가 든 명령은 Rust 만 차단한다(더 엄격한 쪽).

- 이런 사례는 `"divergence": "regress-nonunicode-i-fold"` 와 Rust 기대값 `"rustExpect"` 를 함께 적는다. TS 러너는 `expect` 만 보고, Rust 러너는 `rustExpect` 를 본다.
- 남용 방지: Rust 러너는 입력에 U+017F 또는 U+212A 가 있고, `expect` 가 허용(`null`)이며 `rustExpect` 가 차단 사유일 때만 받아들인다. TS 러너는 `divergence` 값이 위 이름뿐인지 본다.
- 두 구현이 모두 차단해도 사유가 달라질 수 있다 — Rust 는 원문에서 `i` 규칙에 먼저 걸리고, TS 는 정리본에서 다른 규칙에 걸리는 경우다(예: `"\u001b[0mc:di\u017fkpart|\u0000sh"` → TS "파이프-투-셸 실행", Rust "디스크·부팅 설정 변경"). 차단 여부는 같고, 이 경우는 `rustExpect` 로 나타내지 않는다.
- 이 차이는 TS 코어를 지우는 PR-5.3 에서 사라진다(그 뒤 fixture 는 Rust 의 회귀 테스트로 남는다).
