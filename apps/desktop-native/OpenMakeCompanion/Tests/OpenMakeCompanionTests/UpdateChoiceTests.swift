// 업데이트 판단 순수 함수(plan-pr2.5 D-155)의 단위 테스트 — 새 앱은 `macos` 블록만 읽는다(`native` 는 다리 몫).
import XCTest
@testable import OpenMakeCompanion

final class UpdateChoiceTests: XCTestCase {
    private let sha = String(repeating: "a", count: 64)

    private func block(_ version: String, _ file: String, sha256: Any? = nil) -> [String: Any] {
        ["version": version, "file": file, "sha256": sha256 ?? sha, "url": "/api/desktop/download/\(file)"]
    }

    private func native(_ v: String) -> [String: Any] { block(v, "OpenMake-Companion-\(v)-arm64.dmg") }
    private func macos(_ v: String) -> [String: Any] { block(v, "OpenMake-Code-\(v)-arm64.dmg") }

    private func decide(_ payload: [String: Any]?, current: String = "0.5.0") -> UpdateChoice {
        UpdateChoice.decide(payload: payload, current: current)
    }

    private func expectBlock(_ v: String) -> UpdateBlock {
        UpdateBlock(version: v, file: "OpenMake-Code-\(v)-arm64.dmg", sha256: sha)
    }

    func testNoPayloadOrNoMacosBlockIsNone() {
        XCTAssertEqual(decide(nil), .none)
        XCTAssertEqual(decide([:]), .none)
        XCTAssertEqual(decide(["windows": block("0.1.10", "OpenMake-Companion-Setup-0.1.10.exe")]), .none)
    }

    func testMacosHigherSameLower() {
        XCTAssertEqual(decide(["macos": macos("0.5.1")]), .update(expectBlock("0.5.1")))
        XCTAssertEqual(decide(["macos": macos("0.5.0")]), .latest)
        XCTAssertEqual(decide(["macos": macos("0.4.9")]), .latest)
    }

    func testNativeIsIgnoredEvenIfHigher() {
        XCTAssertEqual(decide(["native": native("9.9.9")]), .none)
        XCTAssertEqual(decide(["native": native("9.9.9"), "macos": macos("0.5.0")]), .latest)
        XCTAssertEqual(decide(["native": native("9.9.9"), "macos": macos("0.5.1")]), .update(expectBlock("0.5.1")))
    }

    func testMacosFileOutsidePrefixIsIgnored() {
        for file in ["OpenMake-Companion-0.5.1-arm64.dmg", "OpenMake-Code-0.5.1-arm64.exe", "../OpenMake-Code-0.5.1.dmg",
                     "OpenMake-Code-0.5.1/x.dmg", "OpenMake-Code-.dmg", "openmake-code-0.5.1.dmg"] {
            XCTAssertEqual(decide(["macos": block("0.5.1", file)]), .none, file)
        }
    }

    func testMacosShaMustBe64Hex() {
        for bad: Any in [String(repeating: "a", count: 63), String(repeating: "a", count: 65), String(repeating: "g", count: 64), NSNull()] {
            XCTAssertEqual(decide(["macos": block("0.5.1", "OpenMake-Code-0.5.1-arm64.dmg", sha256: bad)]), .none, "\(bad)")
        }
        XCTAssertEqual(decide(["macos": block("0.5.1", "OpenMake-Code-0.5.1-arm64.dmg", sha256: String(repeating: "A", count: 64))]),
                       .update(UpdateBlock(version: "0.5.1", file: "OpenMake-Code-0.5.1-arm64.dmg", sha256: String(repeating: "A", count: 64))))
    }

    func testMacosVersionMustBeNumeric() {
        for v in ["", "0.5.1-beta", "v0.5.1", "0.5.1 "] {
            XCTAssertEqual(decide(["macos": block(v, "OpenMake-Code-0.5.1-arm64.dmg")]), .none, v)
        }
    }

    // MARK: 버전 비교 (종전 Updater.isNewer 와 같은 규칙)

    func testIsNewer() {
        XCTAssertTrue(UpdateChoice.isNewer("0.4.10", than: "0.4.9"))
        XCTAssertTrue(UpdateChoice.isNewer("0.5", than: "0.4.9"))
        XCTAssertFalse(UpdateChoice.isNewer("0.4.4", than: "0.4.4.0"))
        XCTAssertFalse(UpdateChoice.isNewer("0.4.3", than: "0.4.4"))
    }
}
