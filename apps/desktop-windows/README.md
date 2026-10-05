# OpenMake Companion (Windows, Electron)

트레이에 상주하는 로컬 에이전트 컴패니언 — 폴더 연결·연결 상태·명령 실행 확인 창·승인 대기 알림·브라우저 넘겨받기/중지·설정만 담당한다.
채팅 등 깊은 화면은 웹이 맡는다(macOS 앱 `apps/desktop-native` 와 같은 역할 분담).

- 브리지 보안 로직은 `packages/local-bridge-core` 를 그대로 쓴다(메인 프로세스에 번들). 여기서 다시 구현하지 않는다.
- 인증은 bridge 스코프 API key 뿐. key 는 OS 자격증명 보호(`safeStorage`, Windows DPAPI)로 암호화해 저장하고, 암호화를 쓸 수 없으면 저장하지 않는다.
- 폴더마다 연결을 따로 만들고 같은 PC 식별자(`hostId`)를 보낸다 — 서버가 PC 1대로 센다.
- Windows 에서는 명령을 OS 샌드박스로 가두지 못하므로 "이 작업 동안 모두 허용"을 내놓지 않고 명령마다 확인한다.
- 루트 npm workspace 가 아니다(CI 가 Electron 을 내려받지 않게). 이 폴더에서 따로 `npm install` 한다.

```bash
npm run build:packages            # 저장소 루트 — 코어 dist
cd apps/desktop-windows && npm install
npm test                          # 저장·문구 단위 테스트
npm run smoke                     # 실제 Electron 을 띄워 가짜 서버에 붙는지 확인
npm start                         # 개발 실행
```

## 설치 파일과 게시

```bash
npm run dist:win                                  # release/OpenMake-Companion-Setup-<버전>.exe (NSIS)
bash ../../scripts/publish-desktop-windows.sh     # 서버 배포 폴더에 복사 + latest.json 의 windows 블록 갱신
```

- 서버 주소는 설정에 하나만 넣는다. 앱이 그 주소의 `GET /api/desktop/config` 로 서버의 API·웹 포트를 물어 연결 주소와 웹 주소를 정한다(macOS 앱과 같은 규칙 — `packages/local-bridge-core` 의 `endpoints`).
- 브라우저 넘겨받기·돌려주기를 서버에 알린다(0.1.3, `bridge_event` 의 `browser_control`). 서버가 `LOCAL_BRIDGE_TAKEOVER_PARK` 를 켰으면 넘겨받은 동안 작업을 주차해 실행 자리를 비운다(macOS 앱과 같은 동작).
- 앱은 `GET /api/desktop/latest` 의 `windows` 블록으로 새 버전을 확인하고, 받은 설치 파일의 sha256 을 대조한 뒤에만 실행한다(`src/update.mjs`).
- CI(`.github/workflows/desktop-windows.yml`)가 Windows 실행기에서 테스트·기동 검증을 돌리고 설치 파일을 만들어 실행 결과에 `OpenMake-Companion-Setup` 으로 남긴다(30일 보관). 서버 게시는 그 파일을 받아 위 스크립트로 한다.
- **설치 파일(NSIS)은 Windows 나 x64 장비에서 만든다.** Apple Silicon Mac 에서는 앱 폴더(`release/win-unpacked`)까지만 만들어지고, 번들된 `makensis` 가 x64 실행 파일이라 마지막 단계가 실패한다(Rosetta 없음, 2026-10-04 확인).
- 사용자용 설치 안내는 `INSTALL.md`.

## 아직 하지 않은 것

- **실제 Windows 에서 실행해 보지 않았다.** 기동 검증(`npm run smoke`)은 macOS 의 Electron 으로 돌렸다.
- 설치 파일을 실제로 만들어 설치·업데이트해 보지 않았다. 정식 아이콘도 없다(트레이는 임시 점 아이콘).
