// swift-tools-version:5.9
// OpenMake Companion — 로컬 에이전트 컴패니언 (SwiftUI, macOS 메뉴바 상주).
// 서드파티 의존 0 (plan §3 — iOS 축과 동일 원칙). 브리지 코어는 Node 헬퍼로 동봉.
import PackageDescription

let package = Package(
    name: "OpenMakeCompanion",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "OpenMakeCompanion", path: "Sources/OpenMakeCompanion"),
    ]
)
