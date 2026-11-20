// 생성 바인딩 왕복(PR-3.2 T-S1~S4) — 실제 BridgeHost(Rust 정적 라이브러리)를 같은 프로세스에서 띄운다. 지원 폴더는 HOME 을
// 임시 폴더로 바꿔 떼어 놓는다. 환경 바꾸기는 그 시험의 모든 호스트 기동 전에만, 복원은 모든 exited 를 받은 뒤에만 한다
// (살아 있는 Rust 스레드의 env 읽기와 겹치지 않게 — D-239(r2)). XCTest 기본 직렬 실행.
import XCTest
import OmkFfi
@testable import OpenMakeCompanion

/** 닿지 않는 주소 — 주소 찾기는 넣은 값 그대로. */
let unreachableServer = "http://127.0.0.1:9"
/** 합성 키 — 서버에 보내지 않는다(닿지 않는 주소). */
let syntheticKey = "omk_live_swift_test"

/** 이벤트를 main 에서 모으는 상자 — HostEventRelay 를 그대로 쓴다(앱과 같은 넘김 경로). */
@MainActor
final class EventBox {
    var events: [HostEvent] = []
    var waiters: [(([HostEvent]) -> Bool, XCTestExpectation)] = []

    func relay(generation: Int = 1) -> HostEventRelay {
        HostEventRelay(generation: generation, current: { generation },
                       onEvent: { [weak self] in self?.add($0) },
                       onExited: { [weak self] _, code in self?.add(.exited(code: code)) })
    }

    private func add(_ e: HostEvent) {
        events.append(e)
        for (pred, exp) in waiters where pred(events) { exp.fulfill() }
        waiters.removeAll { pred, _ in pred(events) }
    }

    func expect(_ name: String, _ pred: @escaping ([HostEvent]) -> Bool) -> XCTestExpectation {
        let exp = XCTestExpectation(description: name)
        if pred(events) { exp.fulfill() } else { waiters.append((pred, exp)) }
        return exp
    }

    var exited: Int32? {
        for e in events { if case let .exited(code) = e { return code } }
        return nil
    }
}

func hasExited(_ evs: [HostEvent]) -> Bool { evs.contains { if case .exited = $0 { return true }; return false } }

/** 임시 폴더(realpath) — 지우기는 부른 쪽. */
func makeTempDir(_ tag: String) -> String {
    let p = NSTemporaryDirectory() + "omk-swift-\(tag)-\(UUID().uuidString.prefix(8))"
    try? FileManager.default.createDirectory(atPath: p, withIntermediateDirectories: true)
    // URL.resolvingSymlinksInPath 는 /private/var 를 /var 로 되돌린다 — 호스트(realpath)와 같은 값을 쓴다.
    guard let r = realpath(p, nil) else { return p }
    defer { free(r) }
    return String(cString: r)
}

/** 환경을 바꾼 채로 body — body 는 시작한 모든 호스트의 exited 를 받은 뒤 돌아와야 한다. */
@MainActor
func withEnv(_ vars: [String: String], _ body: () async throws -> Void) async rethrows {
    var saved: [String: String?] = [:]
    for (k, v) in vars {
        saved.updateValue(getenv(k).map { String(cString: $0) }, forKey: k) // nil 도 "없었음" 으로 남긴다
        setenv(k, v, 1)
    }
    defer {
        for (k, v) in saved { if let v { setenv(k, v, 1) } else { unsetenv(k) } }
    }
    try await body()
}

/** 상태·폴더 없는 이벤트를 짧은 글자로(순서 대조용). 루트 상태(폴더 있음)는 순서가 정해지지 않아 뺀다. */
func kinds(_ evs: [HostEvent]) -> [String] {
    evs.compactMap { e in
        switch e {
        case let .status(folder, _, code, _): return folder == nil ? "status:\(code)" : nil
        case .endpoints: return "endpoints"
        case .connected: return "connected"
        case .disconnected: return "disconnected"
        case let .autoApprove(count): return "autoApprove:\(count)"
        case let .exited(code): return "exited:\(code)"
        default: return "other"
        }
    }
}

@MainActor
final class FfiRoundTripTests: XCTestCase {
    /** T-S1 — start → idle·endpoints → connect → connected → shutdown → … → exited(0) 이 main 에서 순서대로. */
    func testRoundTripOrderOnMain() async throws {
        let home = makeTempDir("home")
        let root = home + "/root"
        try FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: home) }
        try await withEnv(["HOME": home]) {
            let box = EventBox()
            let host = try BridgeHost.start(config: HostConfig(server: unreachableServer, browserEnabled: false),
                                            apiKey: syntheticKey, listener: box.relay())
            let connected = box.expect("connected") { $0.contains(.connected(folder: root)) }
            try host.connect(folder: root)
            await fulfillment(of: [connected], timeout: 10)
            let exited = box.expect("exited", hasExited)
            try host.shutdown()
            await fulfillment(of: [exited], timeout: 15)
            XCTAssertEqual(kinds(box.events), ["status:idle", "endpoints", "connected", "disconnected",
                                              "autoApprove:0", "status:idle", "exited:0"])
            XCTAssertEqual(box.events.first { if case .endpoints = $0 { return true }; return false },
                           .endpoints(bridgeUrl: unreachableServer, webUrl: unreachableServer, discovered: false))
        }
    }

    /** T-S2 — 같은 지원 폴더의 둘째 호스트는 instance_conflict → exited(3). 첫째는 정상 종료. */
    func testSecondHostConflicts() async throws {
        let home = makeTempDir("lock")
        defer { try? FileManager.default.removeItem(atPath: home) }
        try await withEnv(["HOME": home, "OMK_HELPER_LOCK_WAIT_MS": "300"]) {
            let first = EventBox(), second = EventBox()
            let config = HostConfig(server: unreachableServer, browserEnabled: false)
            let h1 = try BridgeHost.start(config: config, apiKey: syntheticKey, listener: first.relay())
            await fulfillment(of: [first.expect("endpoints") { $0.contains { if case .endpoints = $0 { return true }; return false } }],
                              timeout: 10)
            let conflictDone = second.expect("exited", hasExited)
            let h2 = try BridgeHost.start(config: config, apiKey: syntheticKey, listener: second.relay())
            await fulfillment(of: [conflictDone], timeout: 10)
            // 잠금을 기다리는 동안 `잠금 대기` 상태(code connecting)를 한 번 낸다.
            XCTAssertEqual(kinds(second.events), ["status:connecting", "status:instance_conflict", "exited:3"])
            _ = h2
            let firstDone = first.expect("exited", hasExited)
            try h1.shutdown()
            await fulfillment(of: [firstDone], timeout: 15)
            XCTAssertEqual(first.exited, 0)
        }
    }

    /** T-S3 — 빈 키 → throw, 환경에 키 이름 → throw(KeyInEnvironment). */
    func testStartRejections() async throws {
        let config = HostConfig(server: unreachableServer, browserEnabled: false)
        let box = EventBox()
        XCTAssertThrowsError(try BridgeHost.start(config: config, apiKey: "", listener: box.relay())) {
            XCTAssertEqual($0 as? HostStartError, .ApiKeyRequired)
        }
        try await withEnv(["OMK_COMPANION_API_KEY": ""]) {
            XCTAssertThrowsError(try BridgeHost.start(config: config, apiKey: syntheticKey, listener: box.relay())) {
                XCTAssertEqual($0 as? HostStartError, .KeyInEnvironment)
            }
        }
    }

    /** T-S4 — 주소 찾기(블로킹): 닿지 않으면 넣은 값. */
    func testResolveEndpoints() throws {
        let e = try resolveEndpoints(server: unreachableServer)
        XCTAssertEqual(e, Endpoints(bridgeUrl: unreachableServer, webUrl: unreachableServer, discovered: false))
    }

    /** PR-3.3 T-S10 — TaskApi 생성 바인딩: 잘못된 주소 → InvalidInput(연관 값 없음), 닫힌 포트 → Network. */
    func testTaskApiRoundTrip() throws {
        XCTAssertThrowsError(try TaskApi(server: "ftp://x", apiKey: "k")) {
            XCTAssertEqual($0 as? ApiCallError, .InvalidInput)
        }
        let api = try TaskApi(server: "http://127.0.0.1:1", apiKey: "omk_test_SYNTH")
        XCTAssertThrowsError(try api.listTasks()) { XCTAssertEqual($0 as? ApiCallError, .Network) }
        XCTAssertThrowsError(try api.getTask(taskId: "t")) { XCTAssertEqual($0 as? ApiCallError, .Network) }
    }

    /** PR-3.3 T-S10 — 앱 경로(TaskApiClient: 직렬 큐 + continuation)로 같은 결과, 낡은 요청은 FFI 를 부르지 않고 취소. */
    func testTaskApiClient() async throws {
        let client = TaskApiClient()
        do {
            _ = try await client.listTasks(server: "http://127.0.0.1:1", key: "omk_test_SYNTH", isCurrent: { true })
            XCTFail("닫힌 포트")
        } catch { XCTAssertEqual(error as? ApiCallError, .Network) }
        do {
            _ = try await client.getTask(server: "http://127.0.0.1:1", key: "omk_test_SYNTH", id: "t", isCurrent: { false })
            XCTFail("낡은 요청")
        } catch { XCTAssertTrue(error is CancellationError) }
    }
}
