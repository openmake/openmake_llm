#!/usr/bin/env bash
# TestFlight 업로드 (축 3 Step 8) — 로컬 수동 실행 전용 (서명 비밀은 CI 에 두지 않는다)
#
# 선행 조건 (1회):
#   1. Apple Developer Program 가입 계정으로 Xcode > Settings > Accounts 로그인
#   2. App Store Connect 에서 앱 등록 (번들 ID: cc.openmake.chat)
#   3. Team ID 확인 (developer.apple.com > Membership)
#
# 실행:
#   DEVELOPMENT_TEAM=<TEAMID> ./apps/ios/scripts/archive-testflight.sh
#
# -allowProvisioningUpdates 가 인증서/프로비저닝을 자동 생성·갱신한다 (Automatic signing).
set -euo pipefail

if [ -z "${DEVELOPMENT_TEAM:-}" ]; then
    echo "오류: DEVELOPMENT_TEAM 환경변수가 필요합니다 (Apple Developer Team ID)" >&2
    exit 1
fi

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE_PATH="$IOS_DIR/build/OpenMakeApp.xcarchive"

echo "[testflight] 1/2 아카이브 (Release, 기기용)"
xcodebuild -project "$IOS_DIR/OpenMakeApp.xcodeproj" \
    -scheme OpenMakeApp \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE_PATH" \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    -allowProvisioningUpdates \
    archive

echo "[testflight] 2/2 App Store Connect 업로드 (ExportOptions.plist destination=upload)"
xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist "$IOS_DIR/ExportOptions.plist" \
    -exportPath "$IOS_DIR/build/export" \
    -allowProvisioningUpdates

echo "[testflight] 완료 — App Store Connect > TestFlight 에서 처리 상태를 확인하세요"
