// 업데이트 판단 순수 함수(D-144·D-145·§3.2.1 단계 0)의 단위 테스트 — 서버 계약은 plan §2.2(PR-2.3) 의 가짜 응답.
import XCTest
@testable import OpenMakeCompanion

final class UpdateChoiceTests: XCTestCase {
    private let sha = String(repeating: "a", count: 64)

    private func block(_ version: String, _ file: String, sha256: Any? = nil) -> [String: Any] {
        ["version": version, "file": file, "sha256": sha256 ?? sha, "url": "/api/desktop/download/\(file)"]
    }

    private func native(_ v: String) -> [String: Any] { block(v, "OpenMake-Companion-\(v)-arm64.dmg") }
    private func macos(_ v: String) -> [String: Any] { block(v, "OpenMake-Code-\(v)-arm64.dmg") }

    private func decide(_ payload: [String: Any]?, current: String = "0.4.4", interactive: Bool = false,
                        failed: String? = nil, running: Bool = false) -> UpdateChoice {
        UpdateChoice.decide(payload: payload, current: current, interactive: interactive,
                            failedSuccessorVersion: failed, successorRunning: running)
    }

    private func expectBlock(_ v: String, _ file: String) -> UpdateBlock {
        UpdateBlock(version: v, file: file, sha256: sha)
    }

    // MARK: 블록 조합 × 버전 관계

    func testNoPayloadOrNoBlocksIsNone() {
        XCTAssertEqual(decide(nil), .none)
        XCTAssertEqual(decide([:]), .none)
        XCTAssertEqual(decide(["windows": block("0.1.10", "OpenMake-Companion-Setup-0.1.10.exe")]), .none)
    }

    func testNativeOnlyKeepsTheOldPath() {
        XCTAssertEqual(decide(["native": native("0.4.5")]), .sameIdentity(expectBlock("0.4.5", "OpenMake-Companion-0.4.5-arm64.dmg")))
        XCTAssertEqual(decide(["native": native("0.4.4")]), .latest)
        XCTAssertEqual(decide(["native": native("0.4.3")]), .latest)
    }

    func testNativeWithoutValidShaIsNone() {
        // 0.4.3 과 같은 규칙: sha256 이 64자가 아니면 블록이 없는 것과 같다.
        XCTAssertEqual(decide(["native": block("0.4.5", "OpenMake-Companion-0.4.5-arm64.dmg", sha256: "abc")]), .none)
        XCTAssertEqual(decide(["native": block("0.4.5", "OpenMake-Companion-0.4.5-arm64.dmg", sha256: NSNull())]), .none)
    }

    func testMacosOnlyNewerGoesToSuccessor() {
        XCTAssertEqual(decide(["macos": macos("0.5.0")]), .successor(expectBlock("0.5.0", "OpenMake-Code-0.5.0-arm64.dmg")))
    }

    func testBothNewerGoesStraightToSuccessor() {
        XCTAssertEqual(decide(["native": native("0.4.5"), "macos": macos("0.5.0")]),
                       .successor(expectBlock("0.5.0", "OpenMake-Code-0.5.0-arm64.dmg")))
    }

    func testMacosNewerNativeSameGoesToSuccessor() {
        XCTAssertEqual(decide(["native": native("0.4.4"), "macos": macos("0.5.0")]),
                       .successor(expectBlock("0.5.0", "OpenMake-Code-0.5.0-arm64.dmg")))
    }

    func testMacosNotNewerFallsBackToNative() {
        XCTAssertEqual(decide(["native": native("0.4.5"), "macos": macos("0.4.4")], current: "0.4.4"),
                       .sameIdentity(expectBlock("0.4.5", "OpenMake-Companion-0.4.5-arm64.dmg")))
        XCTAssertEqual(decide(["macos": macos("0.4.4")], current: "0.4.4"), .latest)
    }

    // MARK: macos 블록이 온전하지 않으면 후속으로 가지 않는다

    func testMacosFileOutsidePrefixIsIgnored() {
        for file in ["OpenMake-Companion-0.5.0-arm64.dmg", "OpenMake-Code-0.5.0-arm64.exe", "../OpenMake-Code-0.5.0.dmg",
                     "OpenMake-Code-0.5.0/x.dmg", "OpenMake-Code-.dmg", "openmake-code-0.5.0.dmg"] {
            XCTAssertEqual(decide(["native": native("0.4.5"), "macos": block("0.5.0", file)]),
                           .sameIdentity(expectBlock("0.4.5", "OpenMake-Companion-0.4.5-arm64.dmg")), file)
            XCTAssertEqual(decide(["macos": block("0.5.0", file)]), .none, file)
        }
    }

    func testMacosShaMustBe64Hex() {
        for bad: Any in [String(repeating: "a", count: 63), String(repeating: "a", count: 65), String(repeating: "g", count: 64), NSNull()] {
            XCTAssertEqual(decide(["macos": block("0.5.0", "OpenMake-Code-0.5.0-arm64.dmg", sha256: bad)]), .none, "\(bad)")
        }
        XCTAssertEqual(decide(["macos": block("0.5.0", "OpenMake-Code-0.5.0-arm64.dmg", sha256: String(repeating: "A", count: 64))]),
                       .successor(UpdateBlock(version: "0.5.0", file: "OpenMake-Code-0.5.0-arm64.dmg", sha256: String(repeating: "A", count: 64))))
    }

    func testMacosVersionMustBeNumeric() {
        for v in ["", "0.5.0-beta", "v0.5.0", "0.5.0 "] {
            XCTAssertEqual(decide(["macos": block(v, "OpenMake-Code-0.5.0-arm64.dmg")]), .none, v)
        }
    }

    // MARK: 실패 버전 건너뛰기 (D-145)

    func testAutomaticCheckSkipsTheFailedSuccessorVersion() {
        XCTAssertEqual(decide(["macos": macos("0.5.0")], failed: "0.5.0"), .latest)
        XCTAssertEqual(decide(["native": native("0.4.5"), "macos": macos("0.5.0")], failed: "0.5.0"),
                       .sameIdentity(expectBlock("0.4.5", "OpenMake-Companion-0.4.5-arm64.dmg")))
    }

    func testManualCheckRetriesTheFailedVersion() {
        XCTAssertEqual(decide(["macos": macos("0.5.0")], interactive: true, failed: "0.5.0"),
                       .successor(expectBlock("0.5.0", "OpenMake-Code-0.5.0-arm64.dmg")))
    }

    func testHigherVersionIsOfferedAgainAfterAFailure() {
        XCTAssertEqual(decide(["macos": macos("0.5.1")], failed: "0.5.0"),
                       .successor(expectBlock("0.5.1", "OpenMake-Code-0.5.1-arm64.dmg")))
    }

    // MARK: 새 앱이 이미 실행 중 (§3.2.1 단계 0)

    func testSuccessorAlreadyRunningDoesNotDownload() {
        let b = expectBlock("0.5.0", "OpenMake-Code-0.5.0-arm64.dmg")
        XCTAssertEqual(decide(["macos": macos("0.5.0")], interactive: true, running: true), .successorRunning(b))
        XCTAssertEqual(decide(["macos": macos("0.5.0")], interactive: false, running: true), .successorRunning(b))
        // 실행 중은 실패가 아니다 — 실패 버전이 적혀 있지 않았으면 다음 자동 확인도 다시 권한다.
        XCTAssertEqual(decide(["macos": macos("0.5.0")], interactive: false, running: false),
                       .successor(b))
    }

    func testRunningMattersOnlyWhenTheSuccessorWouldBeChosen() {
        XCTAssertEqual(decide(["native": native("0.4.5")], running: true),
                       .sameIdentity(expectBlock("0.4.5", "OpenMake-Companion-0.4.5-arm64.dmg")))
        XCTAssertEqual(decide(["macos": macos("0.5.0")], failed: "0.5.0", running: true), .latest)
    }

    // MARK: 버전 비교 (종전 Updater.isNewer 와 같은 규칙)

    func testIsNewer() {
        XCTAssertTrue(UpdateChoice.isNewer("0.4.10", than: "0.4.9"))
        XCTAssertTrue(UpdateChoice.isNewer("0.5", than: "0.4.9"))
        XCTAssertFalse(UpdateChoice.isNewer("0.4.4", than: "0.4.4.0"))
        XCTAssertFalse(UpdateChoice.isNewer("0.4.3", than: "0.4.4"))
    }
}
