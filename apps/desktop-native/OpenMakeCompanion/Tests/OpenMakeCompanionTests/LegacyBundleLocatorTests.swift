// 휴지통 안내 대상 — 새 앱 번들과 같은 폴더의 옛 앱 하나만(plan-pr2.5 D-176). LaunchServices 조회 없음.
import XCTest
@testable import OpenMakeCompanion

final class LegacyBundleLocatorTests: XCTestCase {
    private var temp: URL!

    override func setUpWithError() throws {
        temp = FileManager.default.temporaryDirectory.appendingPathComponent("omk-locator-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: temp)
    }

    /** `<dir>/<name>.app/Contents/Info.plist` 를 만든다. bundleId 가 nil 이면 Info.plist 없이 폴더만. */
    @discardableResult
    private func app(_ name: String, in dir: URL, bundleId: String?) throws -> URL {
        let u = dir.appendingPathComponent("\(name).app")
        let contents = u.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        if let bundleId {
            let plist = try PropertyListSerialization.data(fromPropertyList: ["CFBundleIdentifier": bundleId], format: .xml, options: 0)
            try plist.write(to: contents.appendingPathComponent("Info.plist"))
        }
        return u
    }

    private func newApp(in dir: URL) throws -> URL {
        try app(AppIdentity.appName, in: dir, bundleId: AppIdentity.bundleId)
    }

    func testSameFolderWithLegacyBundleId() throws {
        let apps = temp.appendingPathComponent("Applications")
        let new = try newApp(in: apps)
        let old = try app(AppIdentity.legacyAppName, in: apps, bundleId: AppIdentity.legacyBundleId)
        XCTAssertEqual(LegacyBundleLocator.url(newBundle: new)?.standardizedFileURL, old.standardizedFileURL)
    }

    func testSameFolderAbsent() throws {
        let new = try newApp(in: temp.appendingPathComponent("Applications"))
        XCTAssertNil(LegacyBundleLocator.url(newBundle: new))
    }

    func testSameFolderDifferentBundleId() throws {
        let apps = temp.appendingPathComponent("Applications")
        let new = try newApp(in: apps)
        try app(AppIdentity.legacyAppName, in: apps, bundleId: "com.example.other")
        XCTAssertNil(LegacyBundleLocator.url(newBundle: new))
    }

    func testSameFolderWithoutInfoPlist() throws {
        let apps = temp.appendingPathComponent("Applications")
        let new = try newApp(in: apps)
        try app(AppIdentity.legacyAppName, in: apps, bundleId: nil)
        XCTAssertNil(LegacyBundleLocator.url(newBundle: new))
    }

    func testOnlyInAnotherFolder() throws {
        let new = try newApp(in: temp.appendingPathComponent("Applications"))
        try app(AppIdentity.legacyAppName, in: temp.appendingPathComponent("Downloads"), bundleId: AppIdentity.legacyBundleId)
        XCTAssertNil(LegacyBundleLocator.url(newBundle: new))
    }

    func testLiveDepsDoNotUseLaunchServices() throws {
        // 회귀 고정: 다른 위치 사본을 잡던 urlForApplication(withBundleIdentifier:) 을 다시 쓰지 않는다.
        let src = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/OpenMakeCompanion/LegacyMigration.swift")
        XCTAssertFalse(try String(contentsOf: src, encoding: .utf8).contains("urlForApplication"))
    }
}
