// swift-tools-version:5.9
// 생성 전용 도구 패키지 — 앱/Kit 빌드와 격리 (Xcode 빌드는 node·생성기에 비의존).
// scripts/generate-openmakekit.sh 가 `swift run --package-path Tools swift-openapi-generator` 로 사용.
import PackageDescription

let package = Package(
    name: "Tools",
    platforms: [.macOS(.v13)],
    dependencies: [
        // exact 고정 — 생성기 버전이 바뀌면 출력이 달라져 CI codegen drift 게이트가 오탐한다.
        // 업그레이드는 버전 변경 + 재생성 + Generated 커밋을 한 커밋으로.
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.13.0"),
    ],
    targets: []
)
