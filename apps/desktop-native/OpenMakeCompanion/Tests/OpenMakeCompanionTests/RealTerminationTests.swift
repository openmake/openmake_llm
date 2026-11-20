// 실제 AppKit 종료(PR-3.2 Opus r4 M-1·Astra r2 H-1) — delegate 가 .terminateLater 로 정리를 기다리는 동안 두 번째 종료 요청이
// 와도 정리 reply 뒤에만 끝나는지 본다. terminate 가 프로세스를 끝내므로 이 시험 번들을 자식 프로세스(xctest)로 다시 띄운다.
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
        let first: @MainActor () -> Void, second: @MainActor () -> Void
        if scenario == "signal" {
            ProcessSetup.apply()
            first = { kill(getpid(), SIGTERM) }
            second = { kill(getpid(), SIGINT) }
        } else {
            first = { AppTermination.request() }
            second = { AppTermination.request() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { MainActor.assumeIsolated { first() } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { MainActor.assumeIsolated { self.mark("second"); second() } }
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.mark("timeout"); exit(3) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
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

    private func assertChild(_ scenario: String, file: StaticString = #filePath, line: UInt = #line) throws {
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
        XCTAssertEqual(marks, ["shouldTerminate 1", "second", "cleanup", "willTerminate"],
                       "\(scenario): 두 번째 요청 뒤에도 정리 reply 다음에 끝나야 한다", file: file, line: line)
    }
}
