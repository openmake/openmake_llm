# regress 저장소 안 사본 — 고친 자리

이 폴더는 [regress](https://github.com/ridiculousfish/regress) 의 **crates.io 0.12.0 배포본**을 옮긴 것이다
(배포본 체크섬 `32eef8b209c3c1c15dbad02c1f30f9539f00dc7253e0cbcdaae442a50a09d7c1` — 사본을 들이기 전 `Cargo.lock` 의 값).
워크스페이스 `Cargo.toml` 의 `[patch.crates-io]` 로 두 크레이트(`omk-bridge-core`·`omk-bridge-conn`)가 이 사본을 쓴다.
라이선스는 상류 그대로 `MIT OR Apache-2.0`(`LICENSE-MIT`·`LICENSE-APACHE`). 아래 패치가 Apache-2.0 §4(b) 의 "고친 파일 표시"다.

## 옮긴 것 / 뺀 것

- 옮김: `src/` `tests/` `Cargo.toml` `Cargo.lock` `LICENSE-APACHE` `LICENSE-MIT` `README.md` `rustfmt.toml` `perf.md` — 들인 커밋에서 글자 그대로.
- 뺌: `.cargo_vcs_info.json` `.cargo-ok` `.github` `.gitignore` `Cargo.toml.orig`(배포 도구 산출물·상류 CI).
- 사본은 워크스페이스 `exclude` 라 워크스페이스의 lint(`unsafe_code = "forbid"` 포함)·fmt·clippy 대상이 아니다. 엔진 안 `unsafe` 는 상류 그대로다.

## 고친 자리 — 모두 `// [omk]` 로 표시

상류 코드와 다른 곳은 `[omk]` 표시가 붙은 조각과 새 파일(이 문서·`tests/omk_patches.rs`·`Cargo.toml` 의 `[[test]] omk_patches` 한 항목)뿐이다.

### ① `Insn::EnterLoop` — 앞 회차의 루프 상태를 복원 스택에 쌓는다 (`src/classicalbacktrack.rs`)

- 원인: 바깥 반복이 안쪽 루프에 **다시** 들어올 때 `iters = 0` 으로 되돌리면서 역추적 복원을 쌓지 않는다. 바깥 다음 회차가 실패해
  앞 회차의 선택 지점으로 돌아가면 안쪽 횟수가 0 으로 남는다.
- 증상: 매치 누락 — `((?:x{1,2})+){2}` 대 `xx` 를 못 맞춘다. 메모리 폭주 — 횟수가 상한에 닿지 못해 빈 반복을 끝없이 쌓는다
  (`((/*){1,2}){1,2}a{2}` 는 슬래시 6개 줄에서도 0.26초에 360MB, `(?:( *){1,2})+(\ba+?)` 대 `  a` 는 감시보다 빨리 메모리를 써 OS 가 죽였다).
- 고침: `iters != 0` 일 때만 옛 `LoopData` 를 `SetLoopData` 로 쌓고 0 으로 되돌린다. 처음 들어오는 루프는 그대로라 추가 비용이 없다.

### ② `Insn::EndCaptureGroup` — 옛 그룹 값을 복원 스택에 쌓는다 (`src/classicalbacktrack.rs`)

- 원인: 그룹 끝을 적을 때 복원을 쌓지 않아, 그룹 **안쪽** 선택 지점으로 돌아가도 끝이 남는다.
- 증상: 자기 그룹 역참조가 틀린다 — `(x{1,2}\1){2}` 대 `xx`, `((.(/??)*)\1){2}` 대 `_//` 를 못 맞춘다.
- 고침: 그룹 끝(뒤 방향이면 시작)을 적기 전에 `SetCaptureGroup { 옛 값 }` 을 쌓는다. 그룹을 나갈 때마다 한 번 쌓으므로
  캡처가 많은 패턴의 엔진 시간이 +12~18% 늘었다(캡처 없는 패턴 +2~7%).

### ③ 판정 실행 한도 (`src/api.rs`·`src/classicalbacktrack.rs`)

```rust
pub struct ExecLimits<'a> { pub max_backtrack: usize, pub stop: &'a dyn Fn() -> bool }
pub enum LimitExceeded { Backtrack, Stopped }
impl Regex { #[cfg(feature = "utf16")] pub fn is_match_ucs2_limited(&self, text: &[u16], limits: ExecLimits<'_>) -> Result<bool, LimitExceeded> }
```

- 이유: ①②를 고쳐도 진짜 지수 패턴(`(a+)+$` 대 `a`×30+`!`)은 끝나지 않고, 깊은 중첩(`((a?){9999}){9999}` 대 빈 줄)은
  역추적 스택이 0.09초에 459MB 까지 자란다. 서버(모델)가 준 패턴을 판정하는 `code_nav` grep 이 시간·메모리 한도를 가져야 한다.
- 검사점 두 자리: `run_loop` 맨 앞(루프 진입·재진입)과 `try_backtrack` 맨 앞. 명령 포인터가 뒤로 가는 길은 루프 재진입과 역추적뿐이다
  (`Alt`·둘러보기는 앞으로만 간다, 한 글자 루프는 줄 길이에 선형).
- 스택 상한: `둘러보기가 치워 둔 바깥 스택 길이 합 + 현재 스택 길이 > max_backtrack` 이면 `Backtrack`.
- 중단 콜백: 검사점 `clamp(POLL_WORK / 줄 길이, 1, POLL_EVERY)` 번마다 `stop()` 을 묻고 `true` 면 `Stopped`(`POLL_EVERY = 256`,
  `POLL_WORK = 256 × 1024` 단위). 검사점 사이에는 검사점을 거치지 않고 줄을 훑는 명령(둘러보기 안 한 글자 루프 `(?=.*)`·역참조)이
  패턴 길이만큼 들어갈 수 있어 검사점 사이의 일은 `패턴 안 훑기 수 × 줄 길이`다. 묻는 간격을 줄 길이로 줄여 물음 사이의 일을
  `훑기 수 × max(POLL_WORK, 줄 길이)` 로 묶는다 — `(?=.*)`×80+`\b\B` 대 512KiB 한 줄이 예산 50ms 에서 고치기 전 외삽 약 5초 늦게,
  고친 뒤 실측 약 15~45ms 늦게 멈춘다(예산 50ms 로 잰 값 — 물음 간격 자체는 0.05~0.15초, `i` 의 `(?=\w*)`×70 은 0.15~0.23초). 대가는 256Ki 단위 이상 줄에서 검사점마다 `stop()` 을 부르는 것(시각 확인 한 번 — 가벼운 패턴의
  512KiB 한 줄 판정 약 3ms → 12ms). 1,024 단위 이하 줄은 고치기 전과 같다.
- 넘은 뒤: 그 스택을 버리고 실패로 끝낸다. 둘러보기 안에서 넘었으면 부정 둘러보기도 성공으로 치지 않는다. 다음 시작 위치를 시도하지 않는다.
  `is_match_ucs2_limited` 는 `Err` 를 돌려준다 — 한도를 넘은 판정이 `Ok(true)`·`Ok(false)` 로 새지 않는다.
- 한도를 주지 않는 기존 API(`find`·`find_from_ucs2` 등)는 동작이 같다(검사점은 `None` 확인 한 번).

## 테스트

```sh
cargo test --locked --manifest-path vendor/regress/Cargo.toml --features utf16
```

상류 테스트 546건 + `tests/omk_patches.rs`(①②의 재현 패턴, ③의 스택·중단·둘러보기·기존 API 와 같음). CI(`openmake-code.yml`)가 같은 명령을 돌린다.
로컬에서는 `CARGO_TARGET_DIR` 를 워크스페이스 `target/` 아래로 주면 사본 폴더에 `target/` 이 생기지 않는다.

## 상류 새 판에 다시 맞추는 절차

1. 새 판 배포본을 받아(임시 크레이트에 `regress = "=<판>"` 를 걸고 `cargo fetch` → `~/.cargo/registry/src/*/regress-<판>/`) 위 "옮긴 것" 목록만 이 폴더에 덮어쓴다 — 이 커밋은 글자 그대로 둔다.
2. 상류가 ①②를 고쳤는지 확인한다(`tests/omk_patches.rs` 의 ①② 사례를 새 판 그대로 돌린다 — **원본은 메모리 폭주 사례가 있으므로 RSS·시간 상한을 둔 판정기로 한 건씩**).
   고쳐졌으면 그 조각을 빼고 ③만 남긴다.
3. 남은 `[omk]` 조각을 다시 적용한다(이 폴더의 `git log -p` 가 조각별 커밋이다). `Cargo.toml` 에 `[[test]] omk_patches` 를 다시 넣는다.
4. 워크스페이스 `Cargo.lock` 의 regress 판을 새 판으로 맞춘다(`source`·`checksum` 줄은 path 라 없다). 두 크레이트의 `regress = "…"` 판도 맞춘다 —
   판이 어긋나면 patch 가 안 먹어 한도 API 가 없어 **컴파일이 깨진다**(조용히 원본으로 돌아가지 않는다).
5. 사본 테스트(위 명령) + 워크스페이스 `cargo test --locked` + 공용 fixture 두 러너(`conformance-tools`)를 돌린다.
6. 아래 차등 실험을 다시 돌려 기준을 확인한다.

## 차등 실험 — Node 와 판정이 같은지 (다시 맞출 때 한 번)

저장소에 스크립트를 두지 않는다. 다시 만들 때의 규칙과 기준:

- **패턴 생성**: 시드 고정 의사 난수로 문법 트리를 만든다 — `대안 = 순서열 (| 순서열)?`(15%), `순서열 = 항 1~3개`, 항은 깊이 3까지
  그룹(`(`·`(?:`·`(?=`·`(?!`)·`^`·`$`·`\1`·원자, 원자 뒤 45% 확률로 수량자(`* + ? {1,2} {2} {0,1} {2,} *? +? ?? {1,2}?`).
  원자: `a b x / A 가 Ａ 😀 . \w \s \d [ab] [^a] [a-z] \b \/ 공백`. 길이 30자 이하, 중복 제거.
  넓힌 문법은 원자에 `\S \W \D \B \t \x41 a [A-Z] [가-힣] [^] [\s\S] [\w/] [^\d ] é É _ 1 - [a\-b] \. \( ab xx` 와
  뒤보기(`(?<=`·`(?<!`)·이름 그룹(`(?<n1>…)`)·`\k<n1>` 을 더하고 길이 60자 이하.
- **줄**: 고정 12줄(`''`·`xx`·`aa`·`ab`·`////b`·`a`×10·`x`×10·`/`×10+`b`·`a a a a`·`가가가`·`ＡＡa`·`😀😀`)에 무작위 줄을 더해 50줄
  (기본 문법 길이 ≤10, 넓힌 문법 ≤16, 글자는 위 원자에 나오는 글자들).
- **판정**: 패턴마다 50줄 × 플래그(`''`·`'i'`) 를 Node `new RegExp(p, f).test(줄)`(vm 시간 제한 1초)와 이 엔진 `is_match_ucs2_limited`
  (스택 상한 1,048,575, 판정당 1초)로 낸다. 컴파일 오류는 양쪽 모두 `E` 로 비교한다.
- **안전**: Rust 판정기는 RSS·시간 감시 안에서 돌리고, 죽으면 다음 패턴부터 이어 돌린다. **원본(패치 전) 엔진으로는 묶음을 돌리지 않는다.**
  감시는 판정기 **밖의** 프로세스로 둔다(프로세스 그룹 RSS 를 0.2초마다 보고 상한에서 그룹째 죽인다) — 판정기 안의 감시 스레드는
  묶음이 쥔 출력 잠금에 막혀 죽이지 못한다. 돌리기 전에 메모리를 빠르게 잡는 더미 프로세스로 감시가 실제로 죽이는지 먼저 본다.
- **기준**: 기본 문법 2만 패턴 + 넓힌 문법 2만 패턴(시드를 기록)에서 **판정 차이 0·미완료 0**(Node 가 시간 초과한 패턴은 비교에서 뺀다).
  0.12.0 + ①②③ 은 기본 문법 10만·넓힌 문법 10만 패턴에서 차이 0 이었다.
- 알려진 차이(이 실험의 문법 밖이거나 접기 표 차이): `i` 플래그 비유니코드 접기의 ſ(U+017F)·ı(U+0131)·그리스 이오타 첨자 쌍·새 유니코드 4쌍,
  클래스의 K(U+212A) — 공용 fixture README "fixture 에 넣지 않는 차이" 참고.
