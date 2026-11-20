// HostEventRelay(PR-3.2 T-S5) — 한 백그라운드 스레드에서 낸 순서가 main 에서 그대로, 옛 세대는 exited 만.
import XCTest
import OmkFfi
@testable import OpenMakeCompanion

@MainActor
final class HostEventRelayTests: XCTestCase {
    func testOrderPreservedOnMain() async {
        var got: [UInt64] = []
        let done = XCTestExpectation(description: "1000")
        let relay = HostEventRelay(generation: 2, current: { 2 }, onEvent: { e in
            if case let .autoApprove(n) = e { got.append(n); if got.count == 1000 { done.fulfill() } }
        }, onExited: { _, _ in })
        let t = Thread { for i in 0..<1000 { relay.onEvent(event: .autoApprove(count: UInt64(i))) } }
        t.start()
        await fulfillment(of: [done], timeout: 10)
        XCTAssertEqual(got, (0..<1000).map(UInt64.init))
    }

    func testOldGenerationOnlyPassesExited() async {
        var events: [HostEvent] = []
        var exits: [(Int, Int32)] = []
        let done = XCTestExpectation(description: "exited")
        let old = HostEventRelay(generation: 1, current: { 2 }, onEvent: { events.append($0) },
                                 onExited: { g, c in exits.append((g, c)); done.fulfill() })
        DispatchQueue.global().async {
            old.onEvent(event: .connected(folder: "/r"))
            old.onEvent(event: .status(folder: nil, text: "t", code: "idle", arg: nil))
            old.onEvent(event: .exited(code: 0))
        }
        await fulfillment(of: [done], timeout: 5)
        XCTAssertTrue(events.isEmpty, "\(events)")
        XCTAssertEqual(exits.map(\.0), [1])
        XCTAssertEqual(exits.map(\.1), [0])
    }
}
