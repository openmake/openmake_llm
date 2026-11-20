// ProcessSetup(PR-3.2 T-S7·T-S10) — SIGPIPE 무시, 개발 훅 키를 환경에서 옮김, SIGTERM·SIGINT 는 빈 처리기 + main 큐 처리.
import XCTest
import Darwin
@testable import OpenMakeCompanion

/** 신호 처리기 값 — SIG_DFL 0, SIG_IGN 1, 그 밖은 잡은 처리기. */
private func handlerValue(_ sig: Int32) -> Int {
    var a = sigaction()
    sigaction(sig, nil, &a)
    return unsafeBitCast(a.__sigaction_u.__sa_handler, to: Int.self)
}

@MainActor
final class ProcessSetupTests: XCTestCase {
    func testSigpipeIgnoredAndDevKeyLeavesEnvironment() {
        setenv("OMK_COMPANION_API_KEY", "omk_live_setup_synthetic", 1)
        ProcessSetup.apply()
        XCTAssertEqual(ProcessSetup.devApiKey, "omk_live_setup_synthetic")
        XCTAssertNil(getenv("OMK_COMPANION_API_KEY"))
        XCTAssertEqual(handlerValue(SIGPIPE), 1, "SIG_IGN")
        ProcessSetup.apply() // 멱등 — 키가 환경에 없으면 그대로
        XCTAssertEqual(ProcessSetup.devApiKey, "omk_live_setup_synthetic")
    }

    func testTermAndIntUseEmptyHandlersAndReachMain() async {
        ProcessSetup.apply()
        for sig in [SIGTERM, SIGINT] {
            XCTAssertFalse([0, 1].contains(handlerValue(sig)), "\(sig): SIG_DFL·SIG_IGN 이 아닌 빈 처리기")
        }
        let saved = ProcessSetup.onTerminateSignal
        defer { ProcessSetup.onTerminateSignal = saved }
        for sig in [SIGTERM, SIGINT] {
            let hit = XCTestExpectation(description: "signal \(sig)")
            hit.assertForOverFulfill = true
            ProcessSetup.onTerminateSignal = { hit.fulfill() }
            kill(getpid(), sig)
            await fulfillment(of: [hit], timeout: 5)
        }
    }
}
