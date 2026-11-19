// 정체성 글자·정적 규칙(plan-pr2.5 D-153·D-172·§5.1 S-1~S-4) — 소스 파일을 글자로 읽어 대조한다.
import XCTest
@testable import OpenMakeCompanion

final class IdentityTests: XCTestCase {
    /** Tests/OpenMakeCompanionTests/IdentityTests.swift → apps/desktop-native */
    private let appRoot = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    private var sources: URL { appRoot.appendingPathComponent("OpenMakeCompanion/Sources/OpenMakeCompanion") }

    private func read(_ url: URL) throws -> String { try String(contentsOf: url, encoding: .utf8) }

    private func sourceFiles() throws -> [URL] {
        try FileManager.default.contentsOfDirectory(at: sources, includingPropertiesForKeys: nil).filter { $0.pathExtension == "swift" }
    }

    private func shellValue(_ name: String, in text: String) -> String? {
        for line in text.split(separator: "\n") where line.hasPrefix("\(name)=\"") {
            return String(line.dropFirst(name.count + 2).prefix { $0 != "\"" })
        }
        return nil
    }

    func testS1BuildScriptMatchesAppIdentity() throws {
        let build = try read(appRoot.appendingPathComponent("build.sh"))
        XCTAssertEqual(shellValue("APP_NAME", in: build), AppIdentity.appName)
        XCTAssertEqual(shellValue("BUNDLE_ID", in: build), AppIdentity.bundleId)
        XCTAssertEqual(AppIdentity.appName, "OpenMake Code")
        XCTAssertEqual(AppIdentity.bundleId, "cc.openmake.code")
        XCTAssertEqual(AppIdentity.keychainService, "cc.openmake.code")
        XCTAssertEqual(AppIdentity.legacyBundleId, "cc.openmake.companion")
        XCTAssertEqual(AppIdentity.legacyKeychainService, "cc.openmake.companion")
        // 지원 폴더·표식 경로는 다리와 같은 값(D-2·§3.2.2).
        XCTAssertTrue(AppIdentity.supportDirectory.hasSuffix("/Library/Application Support/OpenMakeCompanion"))
        XCTAssertEqual(AppIdentity.successorPendingPath, AppIdentity.supportDirectory + "/successor-pending")
    }

    func testS2MarkerJudgementReadsNoTime() throws {
        let text = try read(sources.appendingPathComponent("LegacyMigration.swift"))
        for banned in ["attributesOfItem", "modificationDate", "stat(", "Date()"] {
            XCTAssertFalse(text.contains(banned), banned)
        }
    }

    func testS3NoSelfRelaunch() throws {
        for f in try sourceFiles() {
            let text = try read(f)
            XCTAssertFalse(text.contains("openApplication(at:"), f.lastPathComponent)
            XCTAssertFalse(text.contains("\"-n\""), f.lastPathComponent)
        }
    }

    func testS4NoLegacyLettersOutsideAppIdentity() throws {
        XCTAssertFalse(try read(sources.appendingPathComponent("Updater.swift")).contains("OpenMake Companion.app"))
        for f in try sourceFiles() where f.lastPathComponent != "AppIdentity.swift" {
            XCTAssertFalse(try read(f).contains("cc.openmake.companion"), f.lastPathComponent)
        }
    }
}
