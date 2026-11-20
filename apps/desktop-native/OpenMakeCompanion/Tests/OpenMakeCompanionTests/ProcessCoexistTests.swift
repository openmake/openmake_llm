// tokio 의 SIGCHLD 처리기와 Foundation Process 공존(PR-3.2 T-S9, D-228(r2)) — 교체 스크립트 경로(Updater)를 보호한다.
import XCTest
import OmkFfi
@testable import OpenMakeCompanion

@MainActor
final class ProcessCoexistTests: XCTestCase {
    private func runExit7() async {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "exit 7"]
        let ended = XCTestExpectation(description: "terminationHandler")
        p.terminationHandler = { _ in ended.fulfill() }
        XCTAssertNoThrow(try p.run())
        p.waitUntilExit()
        XCTAssertEqual(p.terminationStatus, 7)
        await fulfillment(of: [ended], timeout: 5)
    }

    func testProcessWorksWhileAndAfterHost() async throws {
        let home = makeTempDir("coexist")
        defer { try? FileManager.default.removeItem(atPath: home) }
        try await withEnv(["HOME": home]) {
            let box = EventBox()
            let host = try BridgeHost.start(config: HostConfig(server: unreachableServer, browserEnabled: false),
                                            apiKey: syntheticKey, listener: box.relay())
            await fulfillment(of: [box.expect("endpoints") { $0.contains { if case .endpoints = $0 { return true }; return false } }],
                              timeout: 10)
            await runExit7() // 호스트(tokio 런타임)가 살아 있는 동안
            let done = box.expect("exited", hasExited)
            try host.shutdown()
            await fulfillment(of: [done], timeout: 15)
            XCTAssertEqual(box.exited, 0)
            await runExit7() // 호스트가 끝난 뒤
        }
    }
}
