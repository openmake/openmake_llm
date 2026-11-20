// 재기동 대기(리뷰 r1 Low-1) — 대기를 시작할 때의 세대만 기다린다. 대기 중 새 세대가 떠도 옛 세대가 끝나면 바로 진행.
import XCTest
@testable import OpenMakeCompanion

@MainActor
final class HostWaitTests: XCTestCase {
    func testRestartWaitsOnlyForRetiringGenerations() async {
        var live: Set<Int> = [1]
        var polls = 0
        let t = Date()
        await HelperManager.waitUntilExited([1], live: {
            polls += 1
            if polls == 2 { live = [1, 2] } // 대기 중 새 세대가 뜬다
            if polls == 4 { live = [2] }    // 옛 세대 exited
            return live
        }, limit: 5)
        XCTAssertLessThan(Date().timeIntervalSince(t), 2, "새 세대를 기다리지 않는다")
    }

    func testNilWaitsForAll() async {
        var polls = 0
        let t = Date()
        await HelperManager.waitUntilExited(nil, live: {
            polls += 1
            return polls < 4 ? [1, 2] : [2]
        }, limit: 1)
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(t), 1, "전부 기다린다(상한까지)")
    }
}
