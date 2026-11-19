// 첫 실행 이전(plan-pr2.5 §4·§5.1) — 실제 파일·실제 프로세스·실제 sysctl. Keychain 은 Security 원시 호출 단위 대역
// (메모리) 또는 테스트마다 고유한 실제 서비스(ⓚ), 안내·옛 앱 조회/종료·대기는 대역. 모든 대역은 한 호출 기록에 이름을 남긴다.
// 실제 지원 폴더·/Applications·로그인 Keychain 의 실제 서비스 둘은 건드리지 않는다.
import Darwin
import Security
import XCTest
@testable import OpenMakeCompanion

/** 호출 기록 — 대역이 이름을 남긴다. */
final class CallLog {
    var calls: [String] = []
    func add(_ s: String) { calls.append(s) }
    func count(_ s: String) -> Int { calls.filter { $0 == s }.count }
}

/** migration.v1·기본값 쓰기를 기록하는 임시 도메인. */
final class RecordingDefaults: UserDefaults {
    var log: CallLog?
    override func set(_ value: Any?, forKey defaultName: String) {
        log?.add(defaultName == LegacyMigration.stateKey ? "setState" : "defaults.set(\(defaultName))")
        super.set(value, forKey: defaultName)
    }
}

/** Security 원시 호출의 메모리 대역 — 항목 하나(서비스·계정 고정). */
final class MemoryKeychain {
    var data: Data?
    func store(_ label: String, _ log: CallLog) -> KeychainStore {
        KeychainStore(
            service: "memory.\(label)",
            secAdd: { [self] q in
                log.add("\(label).add")
                data = (q as NSDictionary)[kSecValueData as String] as? Data
                return errSecSuccess
            },
            secCopyMatching: { [self] _, out in
                log.add("\(label).copy")
                guard let data else { return errSecItemNotFound }
                out?.pointee = data as CFData
                return errSecSuccess
            },
            secDelete: { [self] _ in
                log.add("\(label).delete")
                defer { data = nil }
                return data == nil ? errSecItemNotFound : errSecSuccess
            })
    }
}

@MainActor
final class LegacyMigrationIntegrationTests: XCTestCase {
    private var temp: URL!
    private var log: CallLog!
    private var defaults: RecordingDefaults!
    private var suite: String!
    private var processes: [Process] = []
    private var services: [String] = []
    private var savedStore: KeychainStore!

    override func setUp() async throws {
        temp = FileManager.default.temporaryDirectory.appendingPathComponent("omk-migration-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
        log = CallLog()
        suite = "cc.openmake.code.test.\(UUID().uuidString)"
        defaults = RecordingDefaults(suiteName: suite)!
        defaults.log = log
        savedStore = Keychain.store
    }

    override func tearDown() async throws {
        for p in processes where p.isRunning { p.terminate(); p.waitUntilExit() }
        for s in services {
            SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: s] as CFDictionary)
        }
        Keychain.store = savedStore
        defaults.removePersistentDomain(forName: suite)
        try? FileManager.default.removeItem(at: temp)
    }

    // MARK: 준비 도우미

    private var markerPath: String { temp.appendingPathComponent("successor-pending").path }

    private func writeMarker(_ content: String) throws {
        try content.write(toFile: markerPath, atomically: true, encoding: .utf8)
    }

    private func setMarkerModified(_ epoch: Int64) throws {
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSince1970: TimeInterval(epoch))], ofItemAtPath: markerPath)
    }

    private func spawn(_ exe: String, _ args: [String]) throws -> Process {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        try p.run()
        processes.append(p)
        usleep(200_000) // exec 가 끝나 실행 정보가 바뀐 뒤에 본다
        return p
    }

    /** 다리와 같은 명령(ps lstart → epoch)으로 읽은 시작 시각 — ProcessLookup 과 따로. */
    private func psStartTime(_ pid: Int32) throws -> Int64 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "TZ=UTC LC_ALL=C date -j -f '%a %b %d %T %Y' \"$(TZ=UTC LC_ALL=C ps -o lstart= -p \(pid) | sed 's/ *$//')\" +%s"]
        let out = Pipe()
        p.standardOutput = out
        try p.run()
        p.waitUntilExit()
        let s = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return try XCTUnwrap(Int64(s))
    }

    private func legacyBundle() throws -> URL {
        let u = temp.appendingPathComponent("OpenMake Companion.app")
        try FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    private func deps(newStore: KeychainStore, legacyStore: KeychainStore, bundle: URL? = nil,
                      legacyDefaults: [String: Any]? = nil, running: [Bool] = [false]) -> LegacyMigrationDeps {
        var runningAnswers = running
        let log = self.log!
        return LegacyMigrationDeps(
            supportDirectory: temp.path,
            defaults: defaults,
            legacyDefaults: { legacyDefaults },
            newStore: newStore,
            legacyStore: legacyStore,
            remember: { log.add("remember"); Keychain.remember($0) }, // live 와 같은 캐시층(tearDown 이 store 를 되돌려 캐시도 비운다)
            legacyBundleURL: { bundle },
            legacyRunning: {
                log.add("legacyRunning")
                return runningAnswers.count > 1 ? runningAnswers.removeFirst() : runningAnswers[0]
            },
            terminateLegacy: { log.add("terminateLegacy") },
            sleep: { _ in log.add("sleep") },
            notifyQuitFailed: { log.add("prompt(quitLegacy.failed)") },
            processLookup: ProcessLookup.of)
    }

    /** 기동 조율 그대로 — FIFO 소비(동기, 맨 앞)·연결·알림·휴지통·업데이트 확인은 기록만. */
    private func launch(_ d: LegacyMigrationDeps) async {
        let log = self.log!
        log.add("consumeKey")
        await LaunchSequence.run(keyHandoff: .notReceived, LaunchSteps(
            migrate: { await LegacyMigration.run(deps: d) },
            connect: { log.add("connect") },
            requestNotifications: { log.add("requestNotifications") },
            offerTrash: { _ in log.add("trash") },
            scheduleUpdateCheck: { log.add("scheduleUpdateCheck") }))
    }

    private var state: String? { defaults.string(forKey: LegacyMigration.stateKey) }

    // MARK: R-12 시계 역행 회귀 — 표식 수정 시각은 판정에 끼지 않는다

    func testClockReversedMarkerStaysAliveUntilTheProcessEnds() async throws {
        let mem = MemoryKeychain(), old = MemoryKeychain()
        mem.data = Data("new".utf8); old.data = Data("old".utf8)
        let bundle = try legacyBundle()
        let sleeper = try spawn("/bin/sleep", ["120"])
        let start = try psStartTime(sleeper.processIdentifier)
        try writeMarker("\(sleeper.processIdentifier) \(start)\n")

        for shift: Int64 in [-3600, 86400] {
            defaults.removeObject(forKey: LegacyMigration.stateKey)
            log.calls = []
            try setMarkerModified(start + shift)
            await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log), bundle: bundle))
            XCTAssertEqual(state, "cleanup-pending", "shift \(shift)")
            XCTAssertEqual(log.count("legacy.delete"), 0)
            XCTAssertEqual(log.count("legacy.copy"), 0, "new key exists — no legacy read")
            XCTAssertEqual(log.count("trash"), 0)
            XCTAssertTrue(FileManager.default.fileExists(atPath: markerPath))
            XCTAssertEqual(log.count("connect"), 1)
        }

        sleeper.terminate(); sleeper.waitUntilExit()
        log.calls = []
        await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log), bundle: bundle))
        XCTAssertEqual(log.count("legacy.delete"), 1)
        XCTAssertNil(old.data)
        XCTAssertEqual(log.count("trash"), 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: markerPath))
        XCTAssertEqual(state, "done")
    }

    // MARK: R-12d PID 재사용 / R-12c 다리 스크립트

    func testReusedPidWithWrongStartTimeIsEnded() async throws {
        let mem = MemoryKeychain(), old = MemoryKeychain()
        mem.data = Data("new".utf8); old.data = Data("old".utf8)
        let bundle = try legacyBundle()
        let sleeper = try spawn("/bin/sleep", ["120"])
        let start = try psStartTime(sleeper.processIdentifier)
        try writeMarker("\(sleeper.processIdentifier) \(start - 100)\n")
        defaults.set("cleanup-pending", forKey: LegacyMigration.stateKey)
        log.calls = []
        await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log), bundle: bundle))
        XCTAssertEqual(log.count("legacy.delete"), 1)
        XCTAssertEqual(log.count("trash"), 1)
        XCTAssertFalse(FileManager.default.fileExists(atPath: markerPath))
        XCTAssertEqual(state, "done")
    }

    func testBridgeScriptWithWrongStartTimeStaysAlive() async throws {
        let mem = MemoryKeychain(), old = MemoryKeychain()
        mem.data = Data("new".utf8); old.data = Data("old".utf8)
        let bundle = try legacyBundle()
        let script = temp.appendingPathComponent(AppIdentity.bridgeScriptName)
        try "sleep 120\n".write(to: script, atomically: true, encoding: .utf8)
        let bridge = try spawn("/bin/bash", [script.path])
        let start = try psStartTime(bridge.processIdentifier)
        try writeMarker("\(bridge.processIdentifier) \(start - 3600)\n") // 시계가 바뀐 경우를 흉내
        defaults.set("cleanup-pending", forKey: LegacyMigration.stateKey)
        log.calls = []
        await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log), bundle: bundle))
        XCTAssertEqual(log.count("legacy.delete"), 0)
        XCTAssertEqual(log.count("trash"), 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: markerPath))
        XCTAssertEqual(state, "cleanup-pending")
        XCTAssertNotNil(old.data)
    }

    // MARK: 조회

    func testProcessLookup() throws {
        guard case let .found(start, bridge) = ProcessLookup.of(pid: getpid()) else { return XCTFail("self not found") }
        XCTAssertGreaterThan(start ?? 0, 0)
        XCTAssertEqual(bridge, false)
        let gone = try spawn("/usr/bin/true", [])
        gone.waitUntilExit()
        XCTAssertEqual(ProcessLookup.of(pid: gone.processIdentifier), .notFound)
    }

    // MARK: R-12a — FIFO 를 열지 않는다, 새 키가 있으면 옛 Keychain 을 읽지 않는다

    func testRunLeavesFifoAloneAndSkipsLegacyReadWhenNewKeyExists() async throws {
        let fifo = temp.appendingPathComponent("key-handoff").path
        XCTAssertEqual(mkfifo(fifo, 0o600), 0)
        let mem = MemoryKeychain(), old = MemoryKeychain()
        mem.data = Data("new".utf8); old.data = Data("old".utf8)
        await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log)))
        var st = Darwin.stat()
        XCTAssertEqual(lstat(fifo, &st), 0)
        XCTAssertEqual(st.st_mode & S_IFMT, S_IFIFO)
        XCTAssertEqual(log.count("legacy.copy"), 0)
        XCTAssertEqual(log.count("legacy.delete"), 1) // 표식 없음·첫 기동·영구 키 있음 → 정리
        XCTAssertEqual(state, "done")
    }

    // MARK: 옛 앱 종료(D-159) — ⓣ1~ⓣ4

    func testT1LegacyNotRunning() async throws {
        let mem = MemoryKeychain(), old = MemoryKeychain()
        old.data = Data("old".utf8)
        await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log)))
        XCTAssertEqual(log.count("terminateLegacy"), 0)
        XCTAssertEqual(log.count("sleep"), 0)
        XCTAssertEqual(log.count("connect"), 1)
        XCTAssertEqual(state, "done")
    }

    func testT2LegacyEndsOnThirdCheckBeforeAnyEffect() async throws {
        let mem = MemoryKeychain(), old = MemoryKeychain()
        old.data = Data("old".utf8)
        await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log), running: [true, true, false]))
        let c = log.calls
        XCTAssertEqual(Array(c.prefix(7)), ["consumeKey", "legacyRunning", "terminateLegacy", "sleep", "legacyRunning", "sleep", "legacyRunning"])
        let terminate = try XCTUnwrap(c.firstIndex(of: "terminateLegacy"))
        let read = try XCTUnwrap(c.firstIndex(of: "legacy.copy"))
        let delete = try XCTUnwrap(c.firstIndex(of: "legacy.delete"))
        let set = try XCTUnwrap(c.firstIndex(of: "setState"))
        let connect = try XCTUnwrap(c.firstIndex(of: "connect"))
        XCTAssertLessThan(terminate, read)
        XCTAssertLessThan(read, delete)
        XCTAssertLessThan(delete, set)
        XCTAssertLessThan(set, connect)
        XCTAssertEqual(state, "done")
        XCTAssertEqual(mem.data, Data("old".utf8))
    }

    func testT3LegacyRefusesToQuitThenT4NextLaunchMigrates() async throws {
        let bundle = try legacyBundle()
        let gone = try spawn("/usr/bin/true", [])
        gone.waitUntilExit() // 거둔 프로세스의 PID → 조회 "없음" → 끝남
        let combos: [(String?, String?)] = [(nil, nil), ("cleanup-pending", nil), (nil, "ended"), ("cleanup-pending", "ended")]
        for (startState, marker) in combos {
            let mem = MemoryKeychain(), old = MemoryKeychain()
            mem.data = startState == nil ? nil : Data("new".utf8)
            old.data = Data("old".utf8)
            defaults.removeObject(forKey: LegacyMigration.stateKey)
            defaults.removeObject(forKey: "server")
            if let startState { defaults.set(startState, forKey: LegacyMigration.stateKey) }
            try? FileManager.default.removeItem(atPath: markerPath)
            if marker != nil { try writeMarker("\(gone.processIdentifier) 5\n") }
            log.calls = []
            let label = "state \(String(describing: startState)) marker \(String(describing: marker))"

            await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log), bundle: bundle,
                              legacyDefaults: ["server": "https://a.example"], running: [true]))
            XCTAssertEqual(log.calls, ["consumeKey", "legacyRunning", "terminateLegacy"] + Array(repeating: ["sleep", "legacyRunning"], count: 10).flatMap { $0 }
                           + ["prompt(quitLegacy.failed)", "scheduleUpdateCheck"], label)
            XCTAssertEqual(state, startState, label)
            XCTAssertEqual(FileManager.default.fileExists(atPath: markerPath), marker != nil, label)
            XCTAssertNil(defaults.object(forKey: "server"), label)

            // ⓣ4 — 같은 대역 상태로 다시(이번엔 안 돎) → 처음 기동과 같은 효과가 한 번.
            log.calls = []
            await launch(deps(newStore: mem.store("new", log), legacyStore: old.store("legacy", log), bundle: bundle,
                              legacyDefaults: ["server": "https://a.example"], running: [false]))
            XCTAssertEqual(log.count("connect"), 1, label)
            XCTAssertEqual(log.count("legacy.delete"), 1, label)
            XCTAssertEqual(log.count("trash"), 1, label)
            XCTAssertEqual(state, "done", label)
            XCTAssertFalse(FileManager.default.fileExists(atPath: markerPath), label)
            XCTAssertEqual(defaults.string(forKey: "server"), startState == nil ? "https://a.example" : nil, label)
        }
    }

    // MARK: ⓚ 영구 저장 증거 — 실제 Security, 테스트마다 고유 서비스

    private func realStore(_ label: String, service: String? = nil,
                           add: ((CFDictionary) -> OSStatus)? = nil,
                           copy: ((CFDictionary, UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus)? = nil) -> KeychainStore {
        let svc = service ?? "cc.openmake.code.test.\(UUID().uuidString)"
        services.append(svc)
        let log = self.log!
        return KeychainStore(
            service: svc,
            secAdd: { q in log.add("\(label).add"); return add?(q) ?? SecItemAdd(q, nil) },
            secCopyMatching: { q, out in log.add("\(label).copy"); return copy?(q, out) ?? SecItemCopyMatching(q, out) },
            secDelete: { q in log.add("\(label).delete"); return SecItemDelete(q) })
    }

    private let testValue = "test-value-\(UUID().uuidString)"

    func testK1LoadPersistedBypassesTheCache() throws {
        let store = realStore("new")
        Keychain.store = store
        XCTAssertTrue(Keychain.save(testValue))
        Keychain.remember("other")
        XCTAssertEqual(Keychain.load(), "other")
        XCTAssertEqual(Keychain.store.loadPersisted(), testValue)

        Keychain.store = realStore("new2")
        Keychain.remember("only-memory")
        XCTAssertEqual(Keychain.load(), "only-memory")
        XCTAssertNil(Keychain.store.loadPersisted())
    }

    func testK2HandoffSaveFailsRememberCleanupPendingNoMarkerKeepsLegacy() async throws {
        let failing = realStore("new", add: { _ in errSecIO })
        let legacy = realStore("legacy")
        XCTAssertTrue(legacy.save(testValue))
        Keychain.store = failing
        KeyHandoff.keep(testValue)                 // KeyHandoff 와 같은 경로: 저장 실패 → remember
        XCTAssertEqual(Keychain.load(), testValue) // 메모리 키
        defaults.set("cleanup-pending", forKey: LegacyMigration.stateKey)
        log.calls = []
        await launch(deps(newStore: failing, legacyStore: legacy, bundle: try legacyBundle()))
        XCTAssertEqual(log.count("legacy.delete"), 0)
        XCTAssertEqual(legacy.loadPersisted(), testValue)
        XCTAssertEqual(log.count("trash"), 0)
        XCTAssertEqual(state, "cleanup-pending")
        XCTAssertEqual(log.count("connect"), 1)
        XCTAssertEqual(Keychain.load(), testValue)
    }

    func testK3CopyThenRereadFailsIsKeychainSkipped() async throws {
        let new = realStore("new", copy: { _, _ in errSecItemNotFound })
        let legacy = realStore("legacy")
        XCTAssertTrue(legacy.save(testValue))
        log.calls = []
        await launch(deps(newStore: new, legacyStore: legacy))
        XCTAssertEqual(state, "keychain-skipped")
        XCTAssertEqual(legacy.loadPersisted(), testValue)
        XCTAssertEqual(log.count("legacy.delete"), 0)
        XCTAssertEqual(log.count("remember"), 1)
    }

    func testK4CopyThenRereadMismatchIsKeychainSkipped() async throws {
        let new = realStore("new", add: { q in
            let d = NSMutableDictionary(dictionary: q as NSDictionary)
            let v = String(decoding: d[kSecValueData as String] as! Data, as: UTF8.self)
            d[kSecValueData as String] = Data((v + "x").utf8)
            return SecItemAdd(d as CFDictionary, nil)
        })
        let legacy = realStore("legacy")
        XCTAssertTrue(legacy.save(testValue))
        log.calls = []
        await launch(deps(newStore: new, legacyStore: legacy))
        XCTAssertEqual(new.loadPersisted(), testValue + "x")
        XCTAssertEqual(state, "keychain-skipped")
        XCTAssertEqual(legacy.loadPersisted(), testValue)
        XCTAssertEqual(log.count("legacy.delete"), 0)
    }

    func testK5NormalCopy() async throws {
        let new = realStore("new"), legacy = realStore("legacy")
        XCTAssertTrue(legacy.save(testValue))
        Keychain.store = new
        log.calls = []
        await launch(deps(newStore: new, legacyStore: legacy))
        XCTAssertEqual(new.loadPersisted(), testValue)
        XCTAssertNil(legacy.loadPersisted())
        XCTAssertEqual(state, "done")
        XCTAssertEqual(log.count("remember"), 1) // 복사 성공도 캐시를 영구 값과 맞춘다(리뷰 r1 M-1(a))
        XCTAssertEqual(Keychain.load(), testValue) // 연결이 쓰는 메모리 키
    }

    /** 리뷰 r1 M-1(a) 회귀 — 이전 전에 `Keychain.load()` 가 새 서비스에서 "없음"을 캐시해도 .copied 뒤엔 옮긴 키가 보인다. */
    func testK6CopiedOverridesEarlierNilCache() async throws {
        let new = realStore("new"), legacy = realStore("legacy")
        XCTAssertTrue(legacy.save(testValue))
        Keychain.store = new
        XCTAssertNil(Keychain.load()) // 캐시 .some(nil)
        log.calls = []
        await launch(deps(newStore: new, legacyStore: legacy))
        XCTAssertEqual(state, "done")
        XCTAssertEqual(new.loadPersisted(), testValue)
        XCTAssertEqual(Keychain.load(), testValue)
    }

    func testLegacyReadDeniedIsKeychainSkipped() async throws {
        // ⓓ-2 의 단위 짝 — 옛 항목 읽기가 거부되면(사용자 "거부") 옛 항목 그대로, keychain-skipped.
        let mem = MemoryKeychain()
        let legacy = realStore("legacy", copy: { _, _ in errSecUserCanceled })
        await launch(deps(newStore: mem.store("new", log), legacyStore: legacy))
        XCTAssertEqual(state, "keychain-skipped")
        XCTAssertEqual(log.count("legacy.delete"), 0)
        XCTAssertNil(mem.data)
    }
}
