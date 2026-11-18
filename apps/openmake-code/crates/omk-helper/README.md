# omk-helper

OpenMake Companion 헬퍼 실행 파일 — Node 헬퍼(`apps/desktop-native/helper/src/helper.mjs`)와 같은 stdio JSON-lines 계약. 띄우는 법·환경 변수·종료 순서·
시험은 `apps/openmake-code/README.md` 의 "omk-helper" 절. 같은 하네스(`apps/desktop-native/helper/harness.cjs`)를 두 헬퍼가 같은 단언으로 통과한다.

| 파일 | 내용 |
|---|---|
| `src/main.rs` | 인자 → `run` → 종료 코드, 패닉 훅 |
| `src/lib.rs` | `run`(기동·`--resolve`·stdout 비우기), stderr 고정 문구 |
| `src/args.rs` · `src/commands.rs` · `src/events.rs` | 인자·명령 해석·이벤트 줄(순수 함수) |
| `src/instance.rs` | 지원 폴더 잠금(`instance.lock`, `flock`) — 한 지원 폴더를 헬퍼 하나만 쓴다 |
| `src/host.rs` | 호스트 값(지원 폴더·호스트 이름·환경 사본·샌드박스·시간 제한·브라우저) → 코어 조립 |
| `src/stdio.rs` | stdin 읽기 스레드·stdout 쓰기 스레드 |
| `src/app/` | 주 actor — 루트 표·확인 대기·connect/disconnect·종료 |

## 그대로 옮긴 Node 동작 (이상해 보여도 바꾸지 않았다)

1. 주소 찾기가 끝나기 전에 `connect` → `disconnect` 가 이어 오면 `disconnect` 가 먼저 처리돼(아직 루트 없음) 결국 연결된다. `connect` 만 주소 찾기를 기다린다.
2. `connected` 이벤트는 "connect 를 처리했다"는 뜻이다(실제 연결은 `status connected`). 순서는 `connected` → `연결 중…` → `연결됨`.
3. 루트를 해제하면 `disconnected` 뒤에 그 연결의 `status closed`(폴더 있음)가 늦게 온다. 재연결 대기 중(예: 인증 사유로 닫힘)이던 루트는 `closed` 가 없다.
   `connect` 직후에 해제하면 그 폴더의 `status connecting` 도 `disconnected` 뒤에 올 수 있다(계약에 없는 순서 — D-93).
4. `api_key_required`·`folder_open_failed` 는 폴더 필드가 없다.
5. 같은 루트 재연결은 `disconnected` 없이 연결만 바뀐다. 없는 루트의 `disconnect` 는 아무 이벤트도 내지 않는다. 루트가 없을 때 종료하면 해제 이벤트·`idle` 이 없다.
6. `browserControl` 은 브라우저가 꺼져 있어도 서버에 제어권 프레임을 보내고 메아리를 낸다.
7. 확인에는 시간 제한이 없다.
8. `disconnect` 의 `folder` 가 문자열이 아니면(수·`null`) 전체 해제다. `connect` 의 `folder: ""` 는 헬퍼의 현재 폴더로 풀린다(Node `realpathSync('')`).
9. `--server` 다음 인자는 무엇이든 주소다(`--server --resolve` 면 주소가 `--resolve` 이고 조회 전용도 켜진다).
10. realpath 오류 문구는 Node `fs.realpathSync` 와 같은 글자다(`ENOENT: no such file or directory, lstat '…'` 등).

## Node 헬퍼와 다른 점 (모두 더 엄격하거나 부모·서버에서 관찰할 수 없다)

1. 키 env 폴백(`OMK_COMPANION_API_KEY`) 없음 — 있으면 exit 2(일반 실행만).
2. JSON `null` 한 줄을 버린다(Node 는 `null.cmd` 로 죽는다, exit 1). serde_json 만 거부하는 줄(중첩 128 초과, 짝 없는 서로게이트 이스케이프)도 버린다.
3. 줄은 `\n`(앞의 `\r` 하나 포함)에서만 자른다 — Node readline 은 홀로 선 `\r`·U+2028·U+2029 에서도 잘라 그 글자가 든 명령을 깨뜨린다.
4. `--resolve` 실행은 stdin 명령을 읽지 않고, 신호 처리기를 달지 않는다(SIGTERM 이면 기본 동작대로 죽는다).
5. `--server` 에 값이 없으면 기본 주소(Node 는 깨진 결과).
6. `autoApprove.count` 는 낸 시점의 합이고, 해제 때 `autoApprove` 는 `disconnected` 뒤에 온다(Node 는 앞뒤로). 값은 같다.
7. base id 는 기동 때 한 번 읽는다(Node 는 연결마다).
8. 종료가 Chrome 정리를 기다린다(최악 약 8.6초). 종료 코드·이벤트는 같다. 띄우는 중인 Chrome·실행 중이던 exec 자식도 끈다(`stdio_browser_shutdown`)
   — Node 헬퍼는 `dispose` 를 부르지 않아 띄우는 중인 Chrome 을 남기고(리뷰 실측 3/3), exec 자식(`sleep`)을 고아로 남긴다. Node 쪽은 이 PR 에서 고치지 않는다.
9. 패닉은 exit 101 + 위치 한 줄(Node 는 스택 전문 + exit 1).
10. 잘못된 서버 주소로 접속하면 죽지 않고 `status server_error`.
11. 종료가 시작된 뒤(첫 계기 뒤 100ms 안)에 온 확인 요청은 부모에 묻지 않고 곧바로 거부한다(Node 는 묻고 그대로 끝나 서버가 시간 초과를 본다).
12. 코어 생성이 realpath 직후 실패하면(그 사이 폴더 삭제) `folder_open_failed` 로 알린다(Node 는 잡히지 않은 거부로 죽는 자리). 같은 루트 재연결이었으면
    옛 연결은 그대로 둔다(코어를 먼저 만들고 성공한 뒤에 바꾼다).
13. `endpoints` 는 호스트 이름 조회(`/bin/hostname`, 2초 제한)와 함께 끝난다 — 보통 수 ms 늦다.
14. 주소 찾기가 끝난 **뒤**의 명령은 받은 순서대로 처리한다 — Node 는 `connect` 마다 `await endpointsReady` 라 같은 읽기 조각의 뒷줄보다 늦게 돈다
    (한 번에 쓴 `auth`·`connect`·`disconnect` → Node 는 연결 유지, 여기는 해제 / `connect`·`auth` → Node 는 연결, 여기는 `api_key_required`). 둘 다 덜 붙는 쪽
    이고, 앱은 `auth` 를 먼저 보내고 명령마다 따로 쓴다(`stdio_roots` `after_discovery_commands_run_in_order`).
15. 지원 폴더 잠금(device-id 충돌 설계 §3.3) — 일반 실행은 `device-id` 를 읽기 전에 `<지원 폴더>/instance.lock` 을 잡고 끝날 때까지 쥔다. 다른 헬퍼가
    쥐고 있으면 처음 한 번 `status connecting`(폴더 없음)을 내고 `OMK_HELPER_LOCK_WAIT_MS`(기본 15000) 동안 다시 시도한다. 끝내 못 잡으면
    `status instance_conflict`(`arg` = 주인의 실행 경로), 잠금 파일을 열지 못하거나 잠금이 안 되면 곧바로 `status instance_lock_failed` 를 내고
    exit 3 — 어느 쪽도 `idle`·`endpoints`·연결·`device-id`·브라우저 프로필에 닿지 않는다. `--resolve` 는 잠금과 무관하다. Node 헬퍼에는 잠금이 없다
    (`stdio_instance_lock`).
