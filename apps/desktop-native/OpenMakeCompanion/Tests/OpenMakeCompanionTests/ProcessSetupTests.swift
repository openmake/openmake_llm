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

/** main 큐 작업 하나를 띄우고 중첩 run loop 로 그것이 실행되는지 본다(상한 1초) — applicationShouldTerminate 의 .terminateLater
    가 reply(Task @MainActor)를 기다리는 모양. main 디스패치 큐 블록 안이면 거짓(교착 모양), run loop 소스 안이면 참. */
@MainActor
private func nestedLoopDrainsMainQueue() -> Bool {
    var drained = false
    DispatchQueue.main.async { drained = true }
    let deadline = Date().addingTimeInterval(1)
    while !drained && Date() < deadline {
        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    return drained
}

/** R-10(PR-3.2 r3) — 종료 요청은 main 큐 블록 밖(run loop 소스)에서 terminate 를 부른다. */
@MainActor
final class AppTerminationTests: XCTestCase {
    func testRequestInsideMainQueueBlockRunsAfterBlockAndCanDrainMainQueue() async {
        let saved = AppTermination.terminate
        defer { AppTermination.terminate = saved }
        let done = XCTestExpectation(description: "terminate")
        var blockEnded = false
        var ranAfterBlock = false
        var drained = false
        AppTermination.terminate = {
            ranAfterBlock = blockEnded
            drained = nestedLoopDrainsMainQueue()
            done.fulfill()
        }
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                AppTermination.request()
                blockEnded = true
            }
        }
        await fulfillment(of: [done], timeout: 5)
        XCTAssertTrue(ranAfterBlock, "terminate 는 요청한 main 큐 블록이 끝난 뒤에 불려야 한다")
        XCTAssertTrue(drained, "terminate 안의 중첩 run loop 가 main 큐 작업(reply Task)을 실행할 수 있어야 한다")
    }

    func testSignalDefaultGoesThroughRequest() async {
        ProcessSetup.apply()
        let saved = AppTermination.terminate
        defer { AppTermination.terminate = saved }
        let done = XCTestExpectation(description: "terminate via SIGTERM")
        var drained = false
        AppTermination.terminate = {
            drained = nestedLoopDrainsMainQueue()
            done.fulfill()
        }
        kill(getpid(), SIGTERM)
        await fulfillment(of: [done], timeout: 5)
        XCTAssertTrue(drained, "신호 처리기(main 큐 블록)에서 바로 부르면 reply 를 기다리는 중첩 루프가 교착한다")
    }
}
