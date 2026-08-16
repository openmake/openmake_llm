// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "OpenMakeKit",
    platforms: [
        .iOS(.v17),
        // macOS 는 CI/로컬에서 `swift test` 실행용 (앱 타깃 아님)
        .macOS(.v13),
    ],
    products: [
        .library(name: "OpenMakeKit", targets: ["OpenMakeKit"]),
    ],
    dependencies: [
        // Apple 공식 런타임 — 생성 코드(Types.swift)의 유일한 의존. 서드파티 0 원칙 준수.
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "OpenMakeKit",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ]
        ),
        .testTarget(
            name: "OpenMakeKitTests",
            dependencies: ["OpenMakeKit"]
        ),
    ]
)
