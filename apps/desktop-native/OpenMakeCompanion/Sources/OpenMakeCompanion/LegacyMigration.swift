// 첫 실행 이전(plan-pr2.5 D-156~D-160·D-167, plan §3.2.2 교체 확정 계약) — 옛 정체성(OpenMake Companion)의
// 기본값·Keychain 항목·번들을 새 앱으로 옮기고 정리한다.
//  - 순수 함수: MarkerOwner.judge(표식 소유자 판정), MigrationPlan(이전 계획 표), DefaultsCopy.
//  - 효과 실행기: LegacyMigration.run(deps:) — Keychain·기본값·파일·옛 앱 조회/종료·대기·안내는 deps 로 받는다.
// 표식 판정은 표식 "내용"과 커널 프로세스 정보만 본다. 파일 속성(수정 시각)·현재 시각은 읽지 않는다(R-12 r4·r5).
// 로그에는 상태 이름만 남긴다 — 키 값·주소·표식 내용은 찍지 않는다.
import AppKit
import Darwin
import Foundation

// MARK: - 표식 소유자 판정 (D-157)

/** PID 하나의 커널 조회 결과. */
enum ProcessLookup: Equatable {
    case notFound
    case failed
    /** startTime: 커널 시작 시각(epoch 초, 0 이하는 nil). isBridgeScript: 실행 정보를 못 읽으면 nil. */
    case found(startTime: Int64?, isBridgeScript: Bool?)

    /** sysctl 만 쓴다(앱에서 ps 를 띄우지 않는다). 없는 PID 는 macOS 에서 rc 0·크기 0(F-11), 또는 ESRCH. */
    static func of(pid: Int32) -> ProcessLookup {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        if sysctl(&mib, 4, &info, &size, nil, 0) != 0 { return errno == ESRCH ? .notFound : .failed }
        if size == 0 { return .notFound }
        let start = Int64(info.kp_proc.p_starttime.tv_sec)
        let bridge = arguments(pid: pid).map { exe, argv in
            exe == "/bin/bash" && argv.count >= 2 && (argv[1] as NSString).lastPathComponent == AppIdentity.bridgeScriptName
        }
        return .found(startTime: start > 0 ? start : nil, isBridgeScript: bridge)
    }

    /** KERN_PROCARGS2 → (실행 경로, argv). 읽지 못하면 nil. */
    private static func arguments(pid: Int32) -> (String, [String])? {
        var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
        var size = 0
        guard sysctl(&mib, 3, nil, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else { return nil }
        var buf = [UInt8](repeating: 0, count: size)
        guard sysctl(&mib, 3, &buf, &size, nil, 0) == 0, size > MemoryLayout<Int32>.size else { return nil }
        let argc = Int(buf.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) })
        var i = MemoryLayout<Int32>.size
        func cString() -> String {
            let begin = i
            while i < size && buf[i] != 0 { i += 1 }
            defer { i += 1 }
            return String(decoding: buf[begin..<i], as: UTF8.self)
        }
        let exe = cString()
        while i < size && buf[i] == 0 { i += 1 } // 실행 경로 뒤 정렬용 NUL
        var argv: [String] = []
        while argv.count < argc && i < size { argv.append(cString()) }
        return argv.count == argc ? (exe, argv) : nil
    }
}

enum MarkerOwner {
    enum AliveReason: Equatable {
        case unreadable, lookupFailed, startTimeUnknown, sameProcess, bridgeScript, identityUnknown
    }

    enum Verdict: Equatable {
        case ended
        case alive(AliveReason)
    }

    /** 정확히 `<양의 정수> <양의 정수>` + 선택적 끝 줄바꿈 하나. 그 밖은 nil. */
    static func parse(_ content: String?) -> (pid: Int32, startTime: Int64)? {
        guard var text = content else { return nil }
        if text.hasSuffix("\n") { text.removeLast() }
        let parts = text.components(separatedBy: " ")
        guard parts.count == 2,
              parts.allSatisfy({ !$0.isEmpty && $0.unicodeScalars.allSatisfy { $0.value >= 0x30 && $0.value <= 0x39 } }),
              let pid = Int32(parts[0]), pid > 0, let start = Int64(parts[1]), start > 0
        else { return nil }
        return (pid, start)
    }

    /**
     * 끝남 = 프로세스 없음, 또는 (시작 시각이 적힌 값과 1초 넘게 다르고 그리고 그 프로세스가 다리 스크립트가 아님).
     * 그 밖은 모두 살아 있음(유예) — 시계 변경으로 시작 시각 기록이 바뀌어도 다리 스크립트 자신은 유예된다(R-12c).
     */
    static func judge(content: String?, lookup: (Int32) -> ProcessLookup) -> Verdict {
        guard let (pid, recorded) = parse(content) else { return .alive(.unreadable) }
        switch lookup(pid) {
        case .notFound: return .ended
        case .failed: return .alive(.lookupFailed)
        case .found(nil, _): return .alive(.startTimeUnknown)
        case let .found(start?, bridge):
            if abs(start - recorded) <= 1 { return .alive(.sameProcess) }
            switch bridge {
            case true?: return .alive(.bridgeScript)
            case nil: return .alive(.identityUnknown)
            case false?: return .ended
            }
        }
    }
}

// MARK: - 이전 계획 (§4.2)

enum MarkerState: Equatable {
    case absent, alive, ended, unreadable
}

/** `migration.v1` 값. cleanup-pending 밖은 끝 상태(다시 이전하지 않는다, D-158). */
enum MigrationState: String {
    case nothing
    case done
    case keychainSkipped = "keychain-skipped"
    case cleanupPending = "cleanup-pending"
}

/** 키 복사 결과. */
enum KeychainCopy: Equatable {
    /** 새 서비스에 영구 키가 이미 있어 복사하지 않았다. */
    case notNeeded
    /** 옛 항목이 없다. */
    case noLegacyKey
    /** 저장 + 실제 재조회 일치. */
    case copied
    /** 읽기 거부·저장 실패·재조회 nil·불일치. */
    case failed
}

struct MigrationPlan: Equatable {
    enum KeyCleanup: Equatable {
        case keep
        case delete
        /** 이번 실행의 키 복사가 성공했을 때만 삭제. */
        case deleteIfCopied
    }

    enum Record: Equatable {
        /** 쓰지 않는다. */
        case keep
        case set(MigrationState)
        /** record(plan:keychainCopy:legacyDefaultsFound:) 로 정한다. */
        case fromResult
    }

    var copyDefaults: Bool
    var copyKey: Bool
    var keyCleanup: KeyCleanup
    var offerTrash: Bool
    var removeMarker: Bool
    var record: Record

    private static func isTerminal(_ state: MigrationState?) -> Bool { state != nil && state != .cleanupPending }
    private static func isDeferred(_ marker: MarkerState) -> Bool { marker == .alive || marker == .unreadable }

    /** 새 서비스의 영구 조회가 필요한 칸인가 — 아니면 조회하지 않는다(창이 뜨지 않게). */
    static func needsKeyEvidence(marker: MarkerState, state: MigrationState?) -> Bool {
        if isTerminal(state) { return false }
        if state == .cleanupPending && isDeferred(marker) { return false }
        return true
    }

    static func plan(marker: MarkerState, state: MigrationState?, newKeyPersisted: Bool, legacyBundlePresent: Bool) -> MigrationPlan {
        var p = MigrationPlan(copyDefaults: false, copyKey: false, keyCleanup: .keep, offerTrash: false,
                              removeMarker: marker == .ended, record: .keep)
        switch state {
        case nil:
            p.copyDefaults = true
            p.copyKey = !newKeyPersisted
            if isDeferred(marker) {
                p.record = .set(.cleanupPending)
            } else {
                p.keyCleanup = newKeyPersisted ? .delete : .deleteIfCopied
                p.offerTrash = legacyBundlePresent
                p.record = .fromResult
            }
        case .cleanupPending?:
            if !isDeferred(marker) && newKeyPersisted {
                p.keyCleanup = .delete
                p.offerTrash = legacyBundlePresent
                p.record = .set(.done)
            }
        default:
            break
        }
        return p
    }

    /** 이번 실행이 적을 상태. nil = 쓰지 않는다. */
    static func record(plan: MigrationPlan, keychainCopy: KeychainCopy, legacyDefaultsFound: Bool) -> MigrationState? {
        switch plan.record {
        case .keep: return nil
        case let .set(s): return s
        case .fromResult:
            if keychainCopy == .failed { return .keychainSkipped }
            if !legacyDefaultsFound && keychainCopy == .noLegacyKey && !plan.offerTrash { return .nothing }
            return .done
        }
    }
}

enum DefaultsCopy {
    /** 허용 목록 중 옛 도메인에 있고 새 도메인에 없는 키 — 타입은 옛 값 그대로. */
    static func keysToWrite(old: [String: Any]?, newHas: (String) -> Bool) -> [(key: String, value: Any)] {
        guard let old else { return [] }
        return AppIdentity.legacyDefaultsKeys.compactMap { k in
            guard let v = old[k], !newHas(k) else { return nil }
            return (k, v)
        }
    }
}

/** 휴지통 안내 대상(D-176) — 새 앱 번들과 같은 폴더의 옛 앱 하나. 그 경로의 Info.plist 번들 ID 가 옛 ID 일 때만.
 *  LaunchServices 조회는 쓰지 않는다(다른 위치 사본을 잡는다). */
enum LegacyBundleLocator {
    static func url(newBundle: URL) -> URL? {
        let candidate = newBundle.deletingLastPathComponent().appendingPathComponent("\(AppIdentity.legacyAppName).app")
        let plist = NSDictionary(contentsOf: candidate.appendingPathComponent("Contents/Info.plist"))
        guard plist?["CFBundleIdentifier"] as? String == AppIdentity.legacyBundleId else { return nil }
        return candidate
    }
}

// MARK: - 효과 실행기

struct LegacyMigrationDeps {
    var supportDirectory: String
    var defaults: UserDefaults
    var legacyDefaults: () -> [String: Any]?
    var newStore: KeychainStore
    var legacyStore: KeychainStore
    /** 옮긴 키의 저장이 실패했을 때 이번 실행 연결용 메모리 키. */
    var remember: (String) -> Void
    var legacyBundleURL: () -> URL?
    var legacyRunning: () -> Bool
    var terminateLegacy: () -> Void
    var sleep: (Double) async -> Void
    /** `migration.quitLegacy.failed` 안내 한 번. */
    var notifyQuitFailed: () -> Void
    var processLookup: (Int32) -> ProcessLookup
}

extension LegacyMigrationDeps {
    @MainActor
    static var live: LegacyMigrationDeps {
        LegacyMigrationDeps(
            supportDirectory: AppIdentity.supportDirectory,
            defaults: .standard,
            legacyDefaults: { UserDefaults.standard.persistentDomain(forName: AppIdentity.legacyBundleId) },
            newStore: Keychain.store,
            legacyStore: KeychainStore(service: AppIdentity.legacyKeychainService),
            remember: { Keychain.remember($0) },
            legacyBundleURL: { LegacyBundleLocator.url(newBundle: Bundle.main.bundleURL) },
            legacyRunning: { !NSRunningApplication.runningApplications(withBundleIdentifier: AppIdentity.legacyBundleId).isEmpty },
            terminateLegacy: {
                for app in NSRunningApplication.runningApplications(withBundleIdentifier: AppIdentity.legacyBundleId) { app.terminate() }
            },
            sleep: { seconds in try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) },
            notifyQuitFailed: {
                LegacyMigration.alert(L("migration.quitLegacy.failed.title"), L("migration.quitLegacy.failed.body"), buttons: [])
            },
            processLookup: ProcessLookup.of)
    }
}

enum LegacyMigration {
    static let stateKey = "migration.v1"
    /** 옛 앱 종료 대기 — 0.5초 간격 최대 10회(5초, D-159). */
    static let quitPollInterval = 0.5
    static let quitPollCount = 10

    @MainActor
    static func run(deps: LegacyMigrationDeps) async -> MigrationOutcome {
        // 1) 표식 — 기동 때 한 번만 본다(창·조회 없음).
        let markerPath = deps.supportDirectory + "/successor-pending"
        let marker: MarkerState
        if !FileManager.default.fileExists(atPath: markerPath) {
            marker = .absent
        } else {
            switch MarkerOwner.judge(content: try? String(contentsOfFile: markerPath, encoding: .utf8), lookup: deps.processLookup) {
            case .ended: marker = .ended
            case .alive(.unreadable): marker = .unreadable
            case .alive: marker = .alive
            }
        }

        // 2) 옛 앱이 돌면 종료 요청(미리 묻는 창 없음) → 주 스레드를 막지 않고 기다린다. 끝나지 않으면 효과 0회.
        if deps.legacyRunning() {
            deps.terminateLegacy()
            var quit = false
            for _ in 0..<quitPollCount {
                await deps.sleep(quitPollInterval)
                if !deps.legacyRunning() { quit = true; break }
            }
            guard quit else {
                NSLog("OpenMake Code migration: legacy app did not quit — blocked")
                deps.notifyQuitFailed()
                return .blocked
            }
        }

        // 3) 계획.
        let state = deps.defaults.string(forKey: stateKey).flatMap(MigrationState.init(rawValue:))
        let newKeyPersisted = MigrationPlan.needsKeyEvidence(marker: marker, state: state) && deps.newStore.loadPersisted() != nil
        let bundle = deps.legacyBundleURL().flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil }
        let plan = MigrationPlan.plan(marker: marker, state: state, newKeyPersisted: newKeyPersisted, legacyBundlePresent: bundle != nil)

        // 4) 효과 — 기본값 → 키 복사(읽기·저장·재조회) → 옛 항목 삭제 → 표식 지움 → 상태 기록.
        var legacyDefaultsFound = false
        if plan.copyDefaults {
            let old = deps.legacyDefaults()
            legacyDefaultsFound = old.map { o in AppIdentity.legacyDefaultsKeys.contains { o[$0] != nil } } ?? false
            for (k, v) in DefaultsCopy.keysToWrite(old: old, newHas: { deps.defaults.object(forKey: $0) != nil }) {
                deps.defaults.set(v, forKey: k)
            }
        }
        var copy = KeychainCopy.notNeeded
        if plan.copyKey {
            switch deps.legacyStore.read() {
            case .notFound: copy = .noLegacyKey
            case .failed: copy = .failed
            case let .value(v):
                if deps.newStore.save(v) && deps.newStore.loadPersisted() == v {
                    copy = .copied
                    deps.remember(v) // 앞서 load() 가 채운 캐시(없음 등)를 영구 값과 맞춘다(리뷰 r1 M-1(a))
                } else {
                    deps.remember(v)
                    copy = .failed
                }
            }
        }
        if plan.keyCleanup == .delete || (plan.keyCleanup == .deleteIfCopied && copy == .copied) {
            let status = deps.legacyStore.deleteStatus() // 실패는 다시 시도하지 않는다(D-175: ad-hoc 서명에선 남을 수 있음)
            let ok = KeychainStore.isDeleted(status)
            NSLog("OpenMake Code migration: legacy keychain item delete \(ok ? "ok" : "failed") (OSStatus \(status))")
        }
        if plan.removeMarker { try? FileManager.default.removeItem(atPath: markerPath) }
        if let s = MigrationPlan.record(plan: plan, keychainCopy: copy, legacyDefaultsFound: legacyDefaultsFound) {
            deps.defaults.set(s.rawValue, forKey: stateKey)
        }
        NSLog("OpenMake Code migration: marker \(marker) state \(state?.rawValue ?? "none") copy \(copy) trash \(plan.offerTrash)")
        return .proceed(trash: plan.offerTrash ? bundle : nil)
    }

    /** 휴지통 안내 한 번(D-160) — 답과 무관하게 상태는 이미 끝 상태로 적혀 있다. 호스트를 띄운 뒤라 창은 main 큐 블록 밖에서
        돌린다(AppTermination.runModal) — 안에서 돌면 창이 떠 있는 동안 호스트 이벤트·신호가 멈춘다. */
    @MainActor
    static func offerTrash(_ url: URL) {
        let a = makeAlert(L("migration.trash.title"), L("migration.trash.body"), buttons: [L("migration.trash.move"), L("migration.trash.keep")])
        Task {
            guard await AppTermination.runModal({ NSApp.activate(ignoringOtherApps: true); return a.runModal() })
                == .alertFirstButtonReturn else { return }
            NSWorkspace.shared.recycle([url]) { _, error in
                if error != nil { NSLog("OpenMake Code migration: trash failed") }
            }
        }
    }

    /** 첫 버튼을 눌렀으면 true. 버튼이 없으면 확인 버튼 하나. 이전 흐름(호스트 기동 전)에서만 바로 띄운다. */
    @MainActor @discardableResult
    static func alert(_ title: String, _ body: String, buttons: [String]) -> Bool {
        NSApp.activate(ignoringOtherApps: true)
        return makeAlert(title, body, buttons: buttons).runModal() == .alertFirstButtonReturn
    }

    @MainActor
    static func makeAlert(_ title: String, _ body: String, buttons: [String]) -> NSAlert {
        let a = NSAlert()
        a.messageText = title
        a.informativeText = body
        for b in buttons { a.addButton(withTitle: b) }
        return a
    }
}
