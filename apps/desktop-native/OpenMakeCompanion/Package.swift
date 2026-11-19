// swift-tools-version:5.9
// OpenMake Companion — 로컬 에이전트 컴패니언 (SwiftUI, macOS 메뉴바 상주).
// 서드파티 의존 0 (plan §3 — iOS 축과 동일 원칙). 브리지 코어는 Rust 헬퍼(`omk-helper`)로 동봉.
import PackageDescription

let package = Package(
    name: "OpenMakeCompanion",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "OpenMakeCompanion", path: "Sources/OpenMakeCompanion"),
        // 업데이트 판단 순수 함수의 단위 테스트(plan-pr2.4 D-148) — 실행 대상을 @testable import 로 바로 시험한다.
        .testTarget(name: "OpenMakeCompanionTests", dependencies: ["OpenMakeCompanion"], path: "Tests/OpenMakeCompanionTests"),
    ]
)
