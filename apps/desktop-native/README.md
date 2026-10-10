# OpenMake Companion (SwiftUI 네이티브 데스크톱)

메뉴바 상주 **로컬 에이전트 컴패니언** — 폴더 연결·디바이스 상태·exec 승인·작업 알림(종료·승인 대기)·웹 딥링크만 담당한다.
채팅 등 깊은 UI 는 웹(chat.openmake.cc)이 전담한다 (plan §1 비목표: 채팅 UI 재구현 금지).
Plan: `docs/proposals/2026-08-22-desktop-native-companion-plan.md` (로컬 보관).

## 구조

```
helper/src/helper.mjs    # Node 헬퍼 — @openmake/local-bridge-core 의 stdio JSON-lines 어댑터
helper/harness.cjs       # 헬퍼 회귀 하네스 (build.sh 가 게이트로 실행)
OpenMakeCompanion/       # SwiftPM 앱 (MenuBarExtra + 설정 + HelperManager + Updater)
Localization/            # <lang>.lproj/Localizable.strings — ko(개발 언어)·en·ja·zh-Hans
check-l10n.sh            # 다국어 표 게이트 (build.sh·CI 공용)
build.sh                 # helper 번들(esbuild) → 하네스 → l10n 게이트 → swift build → .app 조립 → ad-hoc 서명 → dmg
```

- 브리지 보안 코어(경로 스코프·exec 3단 방어·git 고정 조립·worktree)는 **`packages/local-bridge-core` 재사용** — Swift 재구현 금지(plan §6 게이트).
- 앱↔헬퍼 stdio 계약은 `helper.mjs` 상단 주석 참고. confirm 응답은 항상 앱(사용자 다이얼로그)만 발원.
- **서버 주소(설정)**: 주소 하나를 자유 입력한다 — 브라우저에서 OpenMake 를 여는 주소(또는 API 주소). 헬퍼가 그 주소의 `GET /api/desktop/config` 로 서버의 API·웹 포트를 물어 연결 주소와 웹 주소를 정한다(`packages/local-bridge-core` 의 `endpoints`). 넣은 포트가 웹 포트면 연결은 API 포트로, API 포트면 웹은 웹 포트로, 둘 다 아니면(앞단 프록시) 넣은 주소 그대로. 조회 경로가 없는 구버전 서버는 넣은 주소를 그대로 쓴다. 종전의 선택지 2개(chat.openmake.cc / localhost:52416)는 없앴고, "로컬"로 저장돼 있던 설정은 `http://localhost:52416` 으로 옮긴다.
- 인증: API key(`omk_live_*`, bridge 스코프) → Keychain 저장, 헬퍼엔 기동 직후 stdin 의 `auth` 명령으로 전달(인자·환경으로 넘기지 않는다 — 아래 0.3.4). 키 발급은 웹의 **API 액세스 페이지(`/api-access`)** — 설정 화면의 "API 액세스 페이지 열기" 버튼이 연다.
- **다중 루트(0.2.0)**: 메뉴 "작업 폴더 추가…" 로 여러 루트를 각각 연결 — 루트당 독립 브리지 연결(파생 deviceId = base id + 경로 해시)이라 **서버·프로토콜 무변경**, 웹엔 루트마다 별개 디바이스로 표시(기존 디바이스 선택기 사용). 유저당 총 디바이스 수는 서버 `LOCAL_BRIDGE_MAX_DEVICES`(기본 3)가 강제 — 초과는 해당 루트 상태에 서버 오류로 표면화. 스코프·샌드박스·일괄승인 회수는 루트별 독립(코어 인스턴스 분리).
- **승인 대기 알림(0.2.6)**: 로컬 실행 작업이 도구 승인·`ask_human` 응답을 기다리며 멈추면 서버가 그 디바이스로 `bridge_notice`(단방향, 필드 화이트리스트)를 보내고 앱이 네이티브 알림을 띄운다(클릭 → `/agent-tasks?task=<id>`). 종전 설계는 "승인 대기 알림은 웹 푸시 담당 — 중복 구현 금지" 였으나, 웹 푸시는 설정에서 켜야 하는 opt-in 이라 운영 구독 0건 = 실제 도달 0 이어서 바꿨다. 코어는 알림을 검증(종류·taskId 형식·도구명 제어문자·길이)해 넘길 뿐 아무것도 실행하지 않고, 구 디바이스는 모르는 type 을 무시한다(추가 전용).
- **다국어(0.2.6)**: 웹과 같은 언어(ko·en·ja·zh-Hans·de). 문자열은 `L("키")` → `Localization/<lang>.lproj`, 앱 번들 `Contents/Resources` 로 복사하고 `CFBundleDevelopmentRegion=ko`(웹 `DEFAULT_LOCALE`). 헬퍼·코어의 상태 문구는 한국어 원문 + 상태 코드(`code`·`arg`)로 오고 앱이 코드로 번역한다. 새 문구를 넣으면 모든 표에 추가 — `check-l10n.sh` 가 키 불일치·누락 키를 막는다.
- **로컬 브라우저(0.3.0)**: 설정의 "에이전트의 브라우저 사용 허용"을 켜면 헬퍼를 `OMK_COMPANION_BROWSER=1` 로 띄우고, 코어가 전용 프로필(`~/Library/Application Support/OpenMakeCompanion/browser-profile`) Chrome 을 CDP 로 제어한다(평소 Chrome 프로필은 쓰지 않는다). 서버에는 능력 목록의 `browser` 로 알리며, 서버 쪽 게이트(`LOCAL_BRIDGE_BROWSER_ENABLED`)가 켜져 있어야 도구가 노출된다. 사이트 정책 판정·제어권·중지 로직은 전부 코어(`packages/local-bridge-core/src/browser`)에 있고, 앱은 메뉴("브라우저 넘겨받기/돌려주기", "브라우저 작업 중지")와 설정 토글만 담당한다(stdio 명령 `browserControl`·`browserStop`).
- **넘겨받기 알림(0.3.1)**: "브라우저 넘겨받기"·"돌려주기"를 누르면 헬퍼가 서버에 `bridge_event { kind: 'browser_control', user }` 를 보낸다(단방향, 다시 연결될 때도 현재 상태를 한 번 더 보낸다). 서버가 `LOCAL_BRIDGE_TAKEOVER_PARK` 를 켰으면 넘겨받은 동안 작업을 주차해 실행 자리를 비우고, 돌려주면 같은 브라우저 호출부터 재개한다. 이 알림을 모르는 구버전 서버는 조용히 버린다.
- **끊긴 연결 감지(0.3.6)**: 코어가 30초마다 서버에 ping 을 보내고, 75초 동안 아무 프레임도 오지 않으면 연결을 끊어 재연결한다. 접속 시도에도 30초 제한을 둔다. 네트워크가 잠깐 끊겨 반쯤 죽은 연결은 close 가 오지 않아, 앱은 떠 있는데 서버에는 미연결로 남았다(2026-10-10 실측 34분, 앱을 다시 열어야 풀렸다). 앱 코드 변경은 없고 동봉 코어만 바뀐다.
- **고정 명령 환경 제한(0.3.5)**: 코어가 exec 뿐 아니라 고정 명령(셸 경로 탐색·테스트 러너 탐지·진단·worktree git)의 자식 환경도 allowlist 로 제한한다(#1200). 앱 코드 변경은 없고 동봉 코어만 바뀐다.
- **헬퍼 키 전달 경로(0.3.4)**: API key 를 헬퍼의 환경변수가 아니라 stdin 첫 줄(`{cmd:'auth',apiKey}`)로 준다. 프로세스 시작 환경은 같은 사용자의 다른 프로세스가 읽을 수 있어(`sysctl KERN_PROCARGS2`), 샌드박스 안에서 승인된 명령이 헬퍼의 키를 읽어 낼 수 있었다 — 헬퍼가 읽은 뒤 `process.env` 에서 지워도 시작 환경은 남는다.
- **업로드·정책 차단 표식(0.3.3)**: 코어가 로컬 브라우저 파일 업로드 액션 `uploadFile`(연결된 허용 폴더 안의 파일만, 매번 사용자 승인)을 지원하고 능력 `browser_upload` 를 알린다. 정책·사용자 제어로 막은 호출에는 결과에 `policyBlock` 표식을 실어 서버가 감사 기록을 남긴다(#1177 · #1178).
- **인증 사유 표시(0.3.2)**: 서버가 키 폐기·만료·비활성, 계정 비활성·삭제, bridge 스코프 없음으로 연결을 닫으면(1008 + 사유) 그 폴더의 상태에 사유를 보여 준다("API key 가 폐기되었습니다 — 새 키를 발급해 설정에 넣으세요" 등, 5개 언어). 코어는 이 사유로 닫힌 뒤 10분 간격으로만 다시 시도하고(`AUTH_RETRY_MS`), 설정에서 API key 를 바꾸면 헬퍼를 다시 띄워 새 키로 바로 붙는다. hello 의 `authClose` 로 새 코어임을 알려야 서버가 게스트 연결을 사유와 함께 닫으므로, 구버전 서버에서는 종전처럼 "서버 오류" 로 보인다.
- 업데이트: `GET /api/desktop/latest` 의 `native` 블록 — sha256 검증 후 분리 스크립트가 교체·재실행 (구 Electron updater.js 에서 이식). **macOS 는 네이티브 컴패니언만 배포한다(2026-09-11)** — 매니페스트는 native 블록 하나이고 최상위(기본) 값도 그것을 따르며, 구 Electron dmg 는 게시·다운로드에서 제거됐다. 서버 브리지 등록도 API key(bridge 스코프) 연결만 받는다(쿠키 로그인 연결 = 구 Electron 앱 경로 차단).

## 빌드 / 게시

```bash
npm run build:packages                      # local-bridge-core dist 선행
bash apps/desktop-native/build.sh           # dist/OpenMake-Companion-<v>-arm64.dmg — 버전은 VERSION 파일(인자로 덮어쓸 수 있다)
bash scripts/publish-desktop.sh apps/desktop-native/dist/OpenMake-Companion-<v>-arm64.dmg
# → latest.json 을 { native } 로 다시 쓴다 (컴패니언 dmg 가 아니면 거부)
```

- **버전**: `VERSION` 파일이 기준이다. 앱은 서버에 게시된 버전이 자기보다 높으면 업데이트를 권하므로, 기능을 더한 빌드는 게시본보다 높은 버전이어야 한다(낮으면 업데이트가 구버전으로 되돌린다).
- 업데이트는 앱이 놓인 폴더에 새 버전을 복사해 교체한다. 디스크 이미지(dmg)에서 바로 실행한 앱처럼 그 폴더에 쓸 수 없으면 받지 않고 "응용 프로그램 폴더로 옮긴 뒤 다시 시도"를 안내한다.

## 개발/E2E 전용 env 훅 (정식 경로는 Keychain·NSOpenPanel·다이얼로그만)

| env | 효과 |
|---|---|
| `OMK_COMPANION_API_KEY` | Keychain 대신 이 키 사용 (앱이 읽어 헬퍼에 stdin 으로 전달 — 헬퍼 환경에는 싣지 않는다) |
| `OMK_COMPANION_FOLDER` | 기동 시 패널 없이 이 폴더 자동 연결 |
| `OMK_COMPANION_NODE` / `OMK_COMPANION_HELPER.CJS` | 번들 Resources 대신 이 경로 사용 (swift run 개발 실행) |
| `OMK_COMPANION_AUTO_UPDATE=1` | 업데이트 다이얼로그 없이 즉시 진행 (업데이터 E2E) |
| `OMK_BRIDGE_SANDBOX=0` / `OMK_BRIDGE_AUTO_APPROVE=1` | 코어 공통 훅 (CLI 와 동일) |
