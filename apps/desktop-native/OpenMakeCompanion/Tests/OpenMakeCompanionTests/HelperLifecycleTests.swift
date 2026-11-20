// 호스트 lifecycle(PR-3.2 Astra r1 M-1·확인 창) — 가짜 호스트로 HelperManager 의 재기동·종료 대기·승인 창 경로를 본다.
import XCTest
import AppKit
import OmkFfi
@testable import OpenMakeCompanion

/** 받은 명령을 적는 가짜 호스트 — exited 는 시험이 relay 로 낸다. */
final class FakeHost: BridgeHostProtocol, @unchecked Sendable {
    var shutdowns = 0
    var answers: [(UInt64, ConfirmChoice)] = []
    func answerConfirm(id: UInt64, choice: ConfirmChoice) throws { answers.append((id, choice)) }
    func clearAutoApprove() throws {}
    func connect(folder: String) throws {}
    func disconnect(folder: String?) throws {}
    func setBrowserUserControl(user: Bool) throws {}
    func shutdown() throws { shutdowns += 1 }
    func stopBrowser() throws {}
}

/** 가짜 호스트를 띄우는 HelperManager — 시작마다 (호스트, relay) 를 남긴다. */
@MainActor
final class FakeHosts {
    let helper = HelperManager()
    var started: [(FakeHost, HostListener)] = []
    // 시험 전 전역 상태 — restoreDefaults 가 되돌린다(Astra r2 L-1).
    private let savedFolders = UserDefaults.standard.stringArray(forKey: "lastFolders")
    private let savedFolder = UserDefaults.standard.string(forKey: "lastFolder")
    private let savedEnvKey = getenv("OMK_COMPANION_API_KEY").map { String(cString: $0) }
    private let savedDevKey = ProcessSetup.devApiKey

    init() {
        setenv("OMK_COMPANION_API_KEY", "omk_live_lifecycle_synthetic", 1)
        ProcessSetup.apply() // 개발 훅 키 — Keychain 을 보지 않게
        helper.startHost = { [unowned self] _, _, listener in
            let h = FakeHost()
            started.append((h, listener))
            return h
        }
    }

    /** n 번째(0부터) 호스트가 끝났다고 낸다 — 실제 relay 경로(main 큐)로. */
    func exit(_ n: Int) { started[n].1.onEvent(event: .exited(code: 0)) }

    /** 바꾼 전역 상태(defaults·환경 키·개발 훅 키)를 시험 전 값으로 되돌린다. */
    func restoreDefaults() {
        UserDefaults.standard.set(savedFolders, forKey: "lastFolders")
        UserDefaults.standard.set(savedFolder, forKey: "lastFolder")
        if let k = savedEnvKey { setenv("OMK_COMPANION_API_KEY", k, 1) } else { unsetenv("OMK_COMPANION_API_KEY") }
        ProcessSetup.restoreDevApiKeyForTests(savedDevKey)
    }
}

@MainActor
final class HelperLifecycleTests: XCTestCase {
    private let folder = "/synthetic-omk-lifecycle"

    /** Astra r1 M-1 재현 — 설정 재기동 대기 중 종료·업데이트 정리(stopHostAndWait)가 시작되면 옛 호스트 Exited 뒤에도 새 호스트가
        뜨지 않고, 대기는 상한 전에 끝난다. */
    func testStopHostAndWaitCancelsPendingRestart() async {
        let f = FakeHosts()
        defer { f.restoreDefaults() }
        f.helper.connect(folder: folder)
        f.helper.connectedFolders = [folder]
        XCTAssertEqual(f.started.count, 1)

        f.helper.reloadApiKey() // 재기동 예약 — 옛 호스트 exited 를 기다린다
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 150_000_000)
            f.exit(0)
        }
        let t = Date()
        await f.helper.stopHostAndWait()
        XCTAssertLessThan(Date().timeIntervalSince(t), 3, "새 호스트를 기다리며 상한까지 가지 않는다")
        try? await Task.sleep(nanoseconds: 300_000_000) // 예약된 재기동 Task 가 깨어날 시간
        XCTAssertEqual(f.started.count, 1, "종료 대기 중 새 호스트를 띄우지 않는다")
        XCTAssertFalse(f.helper.hasLiveHost)
    }

    /** 종료 대기 상태에서는 폴더 연결·다시 시도도 호스트를 띄우지 않는다. 업데이트 교체 실패로 앱을 계속 쓸 때만 풀고 되살린다. */
    func testTerminatingBlocksNewHostsUntilUpdateFailure() async {
        let f = FakeHosts()
        defer { f.restoreDefaults() }
        f.helper.connect(folder: folder)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 100_000_000)
            f.exit(0)
        }
        await f.helper.stopHostAndWait()
        f.helper.connect(folder: folder)
        f.helper.retryInstance()
        XCTAssertEqual(f.started.count, 1, "종료 대기 중에는 새 호스트를 띄우지 않는다")

        f.helper.restartAfterUpdateFailure()
        try? await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(f.started.count, 2, "교체 실패 뒤에는 되살린다")
        XCTAssertTrue(f.helper.hasLiveHost)
    }

    /** Opus r4 L-2 — 앱 종료 대기와 업데이트 교체 실패가 겹치면 되살리지 않는다(새 호스트가 뜨면 정리 없이 끝난다). */
    func testUpdateFailureDuringAppTerminationDoesNotRestart() async {
        let f = FakeHosts()
        let savedRequested = AppTermination.requested
        defer { f.restoreDefaults(); AppTermination.requested = savedRequested }
        f.helper.connect(folder: folder)
        f.helper.connectedFolders = [folder]
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 100_000_000)
            f.exit(0)
        }
        await f.helper.stopHostAndWait()
        AppTermination.requested = true // 그 사이 메뉴 종료·SIGTERM
        f.helper.restartAfterUpdateFailure()
        try? await Task.sleep(nanoseconds: 300_000_000)
        f.helper.connect(folder: folder)
        XCTAssertEqual(f.started.count, 1, "앱 종료 중에는 새 호스트를 띄우지 않는다")
        XCTAssertFalse(f.helper.hasLiveHost)
    }
}
