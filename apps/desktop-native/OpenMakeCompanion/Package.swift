// swift-tools-version:5.9
// OpenMake Code — 로컬 에이전트 컴패니언 (SwiftUI, macOS 메뉴바 상주). SwiftPM 이름 OpenMakeCompanion 은 그대로(plan-pr2.5 D-154).
// 서드파티 의존 0 (plan §3 — iOS 축과 동일 원칙). 브리지 호스트는 같은 프로세스 안 Rust 정적 라이브러리(omk-ffi, PR-3.2).
// 먼저 `bash apps/desktop-native/lib/ffi.sh` — Generated/(XCFramework·Swift 바인딩, 커밋하지 않음)를 만든다. 없으면
// "binary target 경로 없음" 으로 실패한다.
import PackageDescription

let package = Package(
    name: "OpenMakeCompanion",
    platforms: [.macOS(.v14)],
    targets: [
        // 자사 Rust(omk-ffi) 정적 라이브러리 — 서드파티 패키지 아님.
        .binaryTarget(name: "OmkFfiCore", path: "Generated/OmkFfiCore.xcframework"),
        // UniFFI 가 만든 Swift 소스. 정적 lib 이 싣지 않는 시스템 링크는 여기 둔다 — ffi.sh 가 native-static-libs 와 대조한다(D-230).
        .target(
            name: "OmkFfi", dependencies: ["OmkFfiCore"], path: "Generated/OmkFfi",
            linkerSettings: [.linkedFramework("Security"), .linkedFramework("CoreFoundation"), .linkedLibrary("iconv")]
        ),
        .executableTarget(name: "OpenMakeCompanion", dependencies: ["OmkFfi"], path: "Sources/OpenMakeCompanion"),
        // 업데이트 판단 순수 함수의 단위·통합 테스트(plan-pr2.4 D-148·plan-pr2.5 §5.1) — 실행 대상을 @testable import 로 바로 시험한다.
        .testTarget(name: "OpenMakeCompanionTests", dependencies: ["OpenMakeCompanion"], path: "Tests/OpenMakeCompanionTests"),
    ]
)
