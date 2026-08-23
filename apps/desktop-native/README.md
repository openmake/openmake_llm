# OpenMake Companion (SwiftUI 네이티브 데스크톱)

메뉴바 상주 **로컬 에이전트 컴패니언** — 폴더 연결·디바이스 상태·exec 승인·작업 종료 알림·웹 딥링크만 담당한다.
채팅 등 깊은 UI 는 웹(chat.openmake.cc)이 전담한다 (plan §1 비목표: 채팅 UI 재구현 금지).
Plan: `docs/proposals/2026-08-22-desktop-native-companion-plan.md` (로컬 보관).

## 구조

```
helper/src/helper.mjs    # Node 헬퍼 — @openmake/local-bridge-core 의 stdio JSON-lines 어댑터
helper/harness.cjs       # 헬퍼 회귀 하네스 (build.sh 가 게이트로 실행)
OpenMakeCompanion/       # SwiftPM 앱 (MenuBarExtra + 설정 + HelperManager + Updater)
build.sh                 # helper 번들(esbuild) → 하네스 → swift build → .app 조립 → ad-hoc 서명 → dmg
```

- 브리지 보안 코어(경로 스코프·exec 3단 방어·git 고정 조립·worktree)는 **`packages/local-bridge-core` 재사용** — Swift 재구현 금지(plan §6 게이트).
- 앱↔헬퍼 stdio 계약은 `helper.mjs` 상단 주석 참고. confirm 응답은 항상 앱(사용자 다이얼로그)만 발원.
- 인증: API key(`omk_live_*`, bridge 스코프) → Keychain 저장, 헬퍼엔 env(`OMK_COMPANION_API_KEY`)로 전달 (ps 노출 방지).
- **다중 루트(0.2.0)**: 메뉴 "작업 폴더 추가…" 로 여러 루트를 각각 연결 — 루트당 독립 브리지 연결(파생 deviceId = base id + 경로 해시)이라 **서버·프로토콜 무변경**, 웹엔 루트마다 별개 디바이스로 표시(기존 디바이스 선택기 사용). 유저당 총 디바이스 수는 서버 `LOCAL_BRIDGE_MAX_DEVICES`(기본 3)가 강제 — 초과는 해당 루트 상태에 서버 오류로 표면화. 스코프·샌드박스·일괄승인 회수는 루트별 독립(코어 인스턴스 분리).
- 업데이트: `GET /api/desktop/latest` 의 `native` 채널(추가 전용 필드) — sha256 검증 후 분리 스크립트가 교체·재실행 (구 Electron updater.js 에서 이식).

## 빌드 / 게시

```bash
npm run build:packages                      # local-bridge-core dist 선행
bash apps/desktop-native/build.sh 0.1.1     # dist/OpenMake-Companion-<v>-arm64.dmg
bash scripts/publish-desktop.sh apps/desktop-native/dist/OpenMake-Companion-0.1.1-arm64.dmg
# → latest.json 의 native 블록만 갱신 (기존 Electron 설치본용 필드는 보존)
```

## 개발/E2E 전용 env 훅 (정식 경로는 Keychain·NSOpenPanel·다이얼로그만)

| env | 효과 |
|---|---|
| `OMK_COMPANION_API_KEY` | Keychain 대신 이 키 사용 (헬퍼 스폰 env) |
| `OMK_COMPANION_FOLDER` | 기동 시 패널 없이 이 폴더 자동 연결 |
| `OMK_COMPANION_NODE` / `OMK_COMPANION_HELPER.CJS` | 번들 Resources 대신 이 경로 사용 (swift run 개발 실행) |
| `OMK_COMPANION_AUTO_UPDATE=1` | 업데이트 다이얼로그 없이 즉시 진행 (업데이터 E2E) |
| `OMK_BRIDGE_SANDBOX=0` / `OMK_BRIDGE_AUTO_APPROVE=1` | 코어 공통 훅 (CLI 와 동일) |
