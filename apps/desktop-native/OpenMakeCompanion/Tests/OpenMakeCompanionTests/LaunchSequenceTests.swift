// 기동 조율 순서(plan-pr2.5 D-173·§4.1). 이 테스트는 순서만 입증한다 — FIFO 가 다리 판정 구간 안에 실제로
// 읽히는지는 라이브 ⓑ 몫이다.
import XCTest
@testable import OpenMakeCompanion

@MainActor
final class LaunchSequenceTests: XCTestCase {
    private func run(_ outcome: MigrationOutcome) async -> [String] {
        var calls: [String] = []
        await LaunchSequence.run(LaunchSteps(
            consumeKey: { calls.append("consumeKey") },
            migrate: { calls.append("migrate"); return outcome },
            connect: { calls.append("connect") },
            requestNotifications: { calls.append("requestNotifications") },
            offerTrash: { _ in calls.append("offerTrash") },
            scheduleUpdateCheck: { calls.append("scheduleUpdateCheck") }))
        return calls
    }

    func testProceedWithTrash() async {
        let calls = await run(.proceed(trash: URL(fileURLWithPath: "/tmp/OpenMake Companion.app")))
        XCTAssertEqual(calls, ["consumeKey", "migrate", "connect", "requestNotifications", "offerTrash", "scheduleUpdateCheck"])
    }

    func testProceedWithoutTrash() async {
        let calls = await run(.proceed(trash: nil))
        XCTAssertEqual(calls, ["consumeKey", "migrate", "connect", "requestNotifications", "scheduleUpdateCheck"])
    }

    func testBlocked() async {
        // .blocked 순서: consumeKey → migrate → scheduleUpdateCheck — connect·requestNotifications·offerTrash 각 0회.
        let calls = await run(.blocked)
        XCTAssertEqual(calls, ["consumeKey", "migrate", "scheduleUpdateCheck"])
    }

    func testNothingBeforeConsumeKey() async {
        for outcome in [MigrationOutcome.blocked, .proceed(trash: nil)] {
            let calls = await run(outcome)
            XCTAssertEqual(calls.first, "consumeKey")
        }
    }
}
