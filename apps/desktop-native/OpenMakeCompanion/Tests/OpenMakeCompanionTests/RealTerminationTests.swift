// 실제 AppKit 종료(PR-3.2 Opus r4 M-1·Astra r2 H-1) — delegate 가 .terminateLater 로 정리를 기다리는 동안 두 번째 종료 요청이
// 와도 정리 reply 뒤에만 끝나는지 본다. 예약된 종료 콜백·모달 재확인 타이머가 직접 종료(delegate 진입) 뒤에 돌아도 같다(Astra r3 H-1).
// terminate 가 프로세스를 끝내므로 이 시험 번들을 자식 프로세스(xctest)로 다시 띄운다.
import XCTest
import AppKit
@testable import OpenMakeCompanion

private let childEnv = "OMK_REAL_TERMINATION_CHILD"

/** 자식 쪽 delegate — 정리(700ms)를 흉내 내고 reply 한다. 표지는 "OMKCHILD " 로 시작하는 줄. */
@MainActor
private final class ProbeDelegate: NSObject, NSApplicationDelegate {
    let scenario: String
    var asked = 0
    init(scenario: String) { self.scenario = scenario }
    func mark(_ s: String) { print("OMKCHILD \(s)"); fflush(stdout) }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 직접 종료(로그아웃·Apple event quit)는 이벤트 처리 — main 큐 블록이 아닌 run loop 소스에서 들어온다.
        let direct: @MainActor () -> Void = { AppTermination.performOnMainRunLoop { NSApp.terminate(nil) } }
        var first: @MainActor () -> Void = {}, second: (@MainActor () -> Void)?
        switch scenario {
        case "signal":
            ProcessSetup.apply()
            first = { kill(getpid(), SIGTERM) }
            second = { kill(getpid(), SIGINT) }
        case "pending-direct": // request 가 예약한 콜백이 돌기 전에 직접 종료가 delegate 에 들어간다
            first = { AppTermination.performOnMainRunLoop { AppTermination.request(); NSApp.terminate(nil) } }
        case "timer-direct": // 모달 abort 뒤 50ms 재확인 타이머가 남은 채 직접 종료가 delegate 에 들어간다
            var modal = true
            AppTermination.modalRunning = { modal }
            AppTermination.abortModal = { modal = false }
            first = { AppTermination.request() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.11) { MainActor.assumeIsolated { direct() } }
        case "request-menu": // 종료 대기 중 메뉴 "종료"(run loop 소스의 이벤트 처리 → AppTermination.request)
            first = { AppTermination.request() }
            second = { AppTermination.performOnMainRunLoop { AppTermination.request() } }
        default:
            first = { AppTermination.request() }
            second = { AppTermination.request() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { MainActor.assumeIsolated { first() } }
        if let second {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { MainActor.assumeIsolated { self.mark("second"); second() } }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.mark("timeout"); exit(3) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        AppTermination.didEnter() // 제품 delegate 와 같은 첫 줄
        asked += 1
        mark("shouldTerminate \(asked)")
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 700_000_000)
            self.mark("cleanup")
            NSApp.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) { mark("willTerminate") }
}

final class RealTerminationTests: XCTestCase {
    /** 자식 프로세스 본체 — 환경 표지가 없으면(일반 실행) 아무것도 하지 않는다. */
    @MainActor
    func testChildBody() {
        guard let scenario = ProcessInfo.processInfo.environment[childEnv] else { return }
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let d = ProbeDelegate(scenario: scenario)
        app.delegate = d
        app.run() // terminate 가 프로세스를 끝낸다
    }

    func testSecondRequestWaitsForCleanup() throws { try assertChild("request") }
    func testTermThenIntWaitsForCleanup() throws { try assertChild("signal") }
    func testPendingRequestThenDirectTerminateWaitsForCleanup() throws {
        try assertChild("pending-direct", expect: ["shouldTerminate 1", "cleanup", "willTerminate"])
    }
    func testModalRetryTimerThenDirectTerminateWaitsForCleanup() throws {
        try assertChild("timer-direct", expect: ["shouldTerminate 1", "cleanup", "willTerminate"])
    }
    func testMenuQuitDuringRequestWaitsForCleanup() throws { try assertChild("request-menu") }

    private func assertChild(_ scenario: String, expect: [String] = ["shouldTerminate 1", "second", "cleanup", "willTerminate"],
                             file: StaticString = #filePath, line: UInt = #line) throws {
        let bundle = Bundle(for: RealTerminationTests.self).bundlePath
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        p.arguments = ["xctest", "-XCTest", "OpenMakeCompanionTests.RealTerminationTests/testChildBody", bundle]
        p.environment = ProcessInfo.processInfo.environment.merging([childEnv: scenario]) { $1 }
        let out = Pipe()
        p.standardOutput = out
        p.standardError = FileHandle.nullDevice
        try p.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        let marks = String(decoding: data, as: UTF8.self).split(separator: "\n")
            .filter { $0.hasPrefix("OMKCHILD ") }.map { String($0.dropFirst("OMKCHILD ".count)) }
        XCTAssertEqual(marks, expect, "\(scenario): 정리 reply 다음에 끝나야 한다", file: file, line: line)
        XCTAssertEqual(p.terminationStatus, 0, "\(scenario): 정상 종료", file: file, line: line)
    }
}
