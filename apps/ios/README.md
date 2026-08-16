# OpenMake iOS (축 3)

SwiftUI 네이티브 클라이언트. 계획: `docs/proposals/2026-08-16-ios-axis3-swiftui-mvp-plan.md`.

## 구조

| 경로 | 내용 |
|---|---|
| `OpenMakeApp.xcodeproj` | 앱 프로젝트 (Xcode 16+ synchronized-folder 포맷 — 파일 추가 시 pbxproj 수정 불필요) |
| `OpenMakeApp/` | 앱 소스 (App / Features / Core — feature 단위) |
| `Packages/OpenMakeKit/` | SPM 코어 — 생성 계약 코드 + 네트워킹/인증/디코딩 규약 |
| `Tools/` | 생성 전용 패키지 (swift-openapi-generator) — 앱 빌드와 격리 |
| `scripts/generate-openmakekit.sh` | 계약 → Swift 재생성 |

## 계약 코드 (커밋 방식)

`Packages/OpenMakeKit/Sources/OpenMakeKit/Generated/` 는 **커밋되는 생성 코드**다 — 수기 편집 금지.
SoT 는 `packages/api-contracts` (축 1). 계약이 바뀌면:

```bash
./apps/ios/scripts/generate-openmakekit.sh   # swift-openapi-generator + quicktype(npx)
```

## 필수 규약 (축 1 PoC 발견 — 위반 시 런타임 크래시/이벤트 유실)

- **REST 디코딩은 `OpenMakeJSON.decoder()` 만** — `format: date-time` 은 밀리초 ISO8601 커스텀 전략 필요 (기본 JSONDecoder 는 실패).
- **WS 수신은 `WsEventDecoder.decode()` 만** — 미지 이벤트 type 무시(forward-compat). 생성 enum 직접 디코딩 금지.

## 빌드/테스트

```bash
# Kit 단위 테스트 (macOS)
cd apps/ios/Packages/OpenMakeKit && swift test

# 앱 빌드 (시뮬레이터, 서명 불필요)
cd apps/ios && xcodebuild -project OpenMakeApp.xcodeproj -scheme OpenMakeApp \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

번들 ID `cc.openmake.chat` · 최소 iOS 17 · 서드파티 의존 0 (Apple 공식 swift-openapi-runtime 만).
app scheme 은 서버 `MOBILE_AUTH.APP_SCHEME`(기본 `openmake`) 와 일치해야 한다 (축 2).

## TestFlight (Step 8 — 로컬 수동, 서명 비밀은 CI 금지)

1회 선행: ① Apple Developer Program 계정으로 Xcode > Settings > Accounts 로그인
② App Store Connect 에 앱 등록 (번들 ID `cc.openmake.chat`) ③ Team ID 확인.

```bash
DEVELOPMENT_TEAM=<TEAMID> ./apps/ios/scripts/archive-testflight.sh
```

아카이브(Release, Automatic signing + `-allowProvisioningUpdates`) 후
`ExportOptions.plist(destination=upload)` 로 App Store Connect 에 직접 업로드된다.
