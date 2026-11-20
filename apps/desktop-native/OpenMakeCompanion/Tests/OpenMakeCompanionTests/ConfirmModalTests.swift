// 승인 창과 종료(PR-3.2 Astra r1 H-1 후속) — 승인 창(모달)은 main 큐 블록 밖에서 돌고, 종료 요청은 떠 있는 창을 거부로 끝낸다.
import XCTest
import AppKit
import OmkFfi
@testable import OpenMakeCompanion

@MainActor
final class ConfirmModalTests: XCTestCase {
    private let folder = "/synthetic-omk-confirm"

    /** 승인 창은 main 큐 블록(relay 전달) 밖에서 돈다 — 안에서 돌면 창이 떠 있는 동안 main 큐(신호·Exited·종료 reply)가 멈춘다. */
    func testConfirmModalRunsOutsideMainQueueBlock() async {
        let f = FakeHosts()
        defer { f.restoreDefaults() }
        f.helper.connect(folder: folder)
        let shown = XCTestExpectation(description: "confirm shown")
        var drained = false
        f.helper.showConfirm = { _ in
            drained = nestedModalDrainsMainQueue()
            shown.fulfill()
            return .alertFirstButtonReturn
        }
        f.started[0].1.onEvent(event: .confirm(id: 7, command: "true", taskId: nil, base: folder, folder: folder, sandbox: true))
        await fulfillment(of: [shown], timeout: 5)
        XCTAssertTrue(drained, "승인 창이 떠 있는 동안 main 큐가 돌아야 한다")
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(f.started[0].0.answers.map(\.0), [7])
        XCTAssertEqual(f.started[0].0.answers.first?.1, .yes)
        f.exit(0)
    }

    /** 승인 창이 떠 있는 동안 SIGTERM — 창을 거부로 끝내고(사용자 승인 없이 실행하지 않는다) 종료로 간다. */
    func testTerminateSignalDuringConfirmAbortsAsDenied() async {
        let f = FakeHosts()
        defer { f.restoreDefaults() }
        ProcessSetup.apply()
        let savedTerminate = AppTermination.terminate, savedRunning = AppTermination.modalRunning
        let savedAbort = AppTermination.abortModal, savedRequested = AppTermination.requested
        defer {
            AppTermination.terminate = savedTerminate
            AppTermination.modalRunning = savedRunning
            AppTermination.abortModal = savedAbort
            AppTermination.requested = savedRequested
        }
        AppTermination.requested = false
        f.helper.connect(folder: folder)
        var modal = false, aborted = false
        AppTermination.modalRunning = { modal }
        AppTermination.abortModal = { aborted = true }
        let terminated = XCTestExpectation(description: "terminate")
        AppTermination.terminate = { terminated.fulfill() }
        f.helper.showConfirm = { _ in
            modal = true
            defer { modal = false }
            kill(getpid(), SIGTERM)
            let deadline = Date().addingTimeInterval(3)
            while !aborted && Date() < deadline {
                _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
            }
            return aborted ? .abort : .alertFirstButtonReturn // 끝나지 않았으면 승인(빨강을 드러낸다)
        }
        f.started[0].1.onEvent(event: .confirm(id: 9, command: "true", taskId: nil, base: folder, folder: folder, sandbox: true))
        await fulfillment(of: [terminated], timeout: 5)
        XCTAssertTrue(aborted, "종료 요청이 창을 끝낸다")
        XCTAssertEqual(f.started[0].0.answers.first?.1, .no, "끝난 창은 거부로 답한다")
        f.exit(0)
    }

    /** 종료가 요청된 뒤의 승인 요청은 창을 띄우지 않고 거부로 답한다. */
    func testConfirmAfterTerminateRequestIsDeniedWithoutWindow() async {
        let f = FakeHosts()
        let savedRequested = AppTermination.requested
        defer { f.restoreDefaults(); AppTermination.requested = savedRequested }
        f.helper.connect(folder: folder)
        AppTermination.requested = true
        var shown = false
        f.helper.showConfirm = { _ in shown = true; return .alertFirstButtonReturn }
        f.started[0].1.onEvent(event: .confirm(id: 3, command: "true", taskId: nil, base: folder, folder: folder, sandbox: true))
        for _ in 0..<20 where f.started[0].0.answers.isEmpty { try? await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertFalse(shown)
        XCTAssertEqual(f.started[0].0.answers.first?.1, .no)
        f.exit(0)
    }

    /** 모달은 하나씩 — 앞 창이 닫힌 뒤에 다음 창을 띄운다(run loop 소스 안에서 겹쳐 뜨지 않게). */
    func testModalsRunOneAtATime() async {
        var open = 0, maxOpen = 0
        let show: @MainActor () -> NSApplication.ModalResponse = {
            open += 1; maxOpen = max(maxOpen, open)
            let deadline = Date().addingTimeInterval(0.2)
            while Date() < deadline { _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
            open -= 1
            return .OK
        }
        async let a = AppTermination.runModal(show)
        async let b = AppTermination.runModal(show)
        let (ra, rb) = await (a, b)
        XCTAssertEqual([ra, rb], [.OK, .OK])
        XCTAssertEqual(maxOpen, 1)
    }
}

/** 모달 흉내 — 중첩 run loop 로 main 큐 작업이 실행되는지 본다(상한 1초). */
@MainActor
private func nestedModalDrainsMainQueue() -> Bool {
    var drained = false
    DispatchQueue.main.async { drained = true }
    let deadline = Date().addingTimeInterval(1)
    while !drained && Date() < deadline {
        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    return drained
}

/** 같은 종류 후보(Astra r1 H-1 후속 3) — 호스트가 살아 있을 수 있는 자리의 모달은 모두 AppTermination.runModal 을 거친다.
    남는 직접 runModal 은 둘뿐: 승인 창 기본 표시(runModal 안에서 불린다)와 이전 안내(LegacyMigration.alert — 호스트 기동 전).
    한계(Opus r4 N-2): 줄 단위 문자열 대조라 runModal(for:)·runModalSession·beginSheetModal·별칭 변수·줄바꿈한 호출·같은 줄
    주석은 잡지 못하고, 허용 항목의 위치도 고정하지 않는다. 회귀 신호일 뿐 런타임 안전성 증명이 아니다 — 실제 동작은
    ConfirmModalTests·RealTerminationTests 와 라이브 R-10 이 본다. */
final class ModalSitesTests: XCTestCase {
    func testDirectRunModalOnlyInAllowedPlaces() throws {
        let sources = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("Sources/OpenMakeCompanion")
        var direct: [String] = []
        for f in try FileManager.default.contentsOfDirectory(at: sources, includingPropertiesForKeys: nil)
        where f.pathExtension == "swift" {
            for line in try String(contentsOf: f, encoding: .utf8).split(separator: "\n")
            where line.contains("runModal()") && !line.contains("AppTermination.runModal") {
                direct.append("\(f.lastPathComponent): \(line.trimmingCharacters(in: .whitespaces))")
            }
        }
        XCTAssertEqual(direct.sorted(), [
            "HelperManager.swift: return $0.runModal()",
            "LegacyMigration.swift: return makeAlert(title, body, buttons: buttons).runModal() == .alertFirstButtonReturn",
        ])
    }
}
