// 기동 조율 순서(plan-pr2.5 D-173·§4.1). 이 테스트는 순서만 입증한다 — FIFO 가 다리 판정 구간 안에 실제로
// 읽히는지는 라이브 ⓑ 몫이다. FIFO 소비는 applicationDidFinishLaunching 안에서 동기로 맨 먼저 돌고(D-119·§4.1 1),
// LaunchSequence 는 그 결과만 받는다 — Task 지연이 consume 앞에 끼지 않는다(리뷰 r1 M-1(b)).
import XCTest
@testable import OpenMakeCompanion

@MainActor
final class LaunchSequenceTests: XCTestCase {
    private func run(_ outcome: MigrationOutcome) async -> [String] {
        var calls: [String] = []
        await LaunchSequence.run(keyHandoff: .notReceived, LaunchSteps(
            migrate: { calls.append("migrate"); return outcome },
            connect: { calls.append("connect") },
            requestNotifications: { calls.append("requestNotifications") },
            offerTrash: { _ in calls.append("offerTrash") },
            scheduleUpdateCheck: { calls.append("scheduleUpdateCheck") }))
        return calls
    }

    func testProceedWithTrash() async {
        let calls = await run(.proceed(trash: URL(fileURLWithPath: "/tmp/OpenMake Companion.app")))
        XCTAssertEqual(calls, ["migrate", "connect", "requestNotifications", "offerTrash", "scheduleUpdateCheck"])
    }

    func testProceedWithoutTrash() async {
        let calls = await run(.proceed(trash: nil))
        XCTAssertEqual(calls, ["migrate", "connect", "requestNotifications", "scheduleUpdateCheck"])
    }

    func testBlocked() async {
        // .blocked 순서: migrate → scheduleUpdateCheck — connect·requestNotifications·offerTrash 각 0회.
        let calls = await run(.blocked)
        XCTAssertEqual(calls, ["migrate", "scheduleUpdateCheck"])
    }

    /** applicationDidFinishLaunching 의 첫 문장이 FIFO 소비이고, 그 결과를 LaunchSequence 에 넘긴다(소스 글자 대조). */
    func testConsumeKeyIsFirstAndSynchronousInDidFinishLaunching() throws {
        let src = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Sources/OpenMakeCompanion/CompanionApp.swift")
        let text = try String(contentsOf: src, encoding: .utf8)
        let head = try XCTUnwrap(text.range(of: "func applicationDidFinishLaunching(_ notification: Notification) {"))
        let body = text[head.upperBound...]
        let firstStatement = body.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty && !$0.hasPrefix("//") }
        XCTAssertEqual(firstStatement?.components(separatedBy: " //").first, "let keyHandoff = KeyHandoff.consume()")
        let consume = try XCTUnwrap(body.range(of: "KeyHandoff.consume()"))
        let task = try XCTUnwrap(body.range(of: "Task {"))
        XCTAssertLessThan(consume.lowerBound, task.lowerBound)
        XCTAssertTrue(body.contains("LaunchSequence.run(keyHandoff: keyHandoff,"))
    }
}
