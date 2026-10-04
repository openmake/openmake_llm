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

## 아직 하지 않은 것

- **실제 Windows 에서 실행해 보지 않았다.** 기동 검증(`npm run smoke`)은 macOS 의 Electron 으로 돌렸다.
- 설치 파일(패키징)·자동 업데이트·정식 아이콘 — 설치 파일은 `electron-builder` 로 만들 예정이고, 서버의 `/api/desktop/latest` 에 Windows 블록이 필요하다.
- 설치 안내 문서(서명 없는 앱의 SmartScreen 경고 해제 절차).
