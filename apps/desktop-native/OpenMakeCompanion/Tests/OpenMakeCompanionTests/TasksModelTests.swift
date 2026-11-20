// 작업 창 모델(PR-3.3 D-255~D-257·D-267) — 가짜 fetcher 로 키 없음·세대 번호·이벤트 갱신·세션 변경을 본다.
import XCTest
import OmkFfi
@testable import OpenMakeCompanion

func row(_ id: String, _ status: String = "running") -> TaskRow {
    TaskRow(id: id, status: status, goal: nil, folderRel: nil, error: nil, createdAt: nil, updatedAt: nil, isolation: nil)
}

func detailOf(_ id: String) -> TaskDetailRecord { TaskDetailRecord(task: row(id), steps: []) }

/** 부른 것을 모으고, 시험이 원하는 순서로 답한다. */
@MainActor
final class FakeFetcher: TaskFetching {
    struct Call { let kind: String; let server: String; let key: String; let id: String?; let isCurrent: () -> Bool }
    var calls: [Call] = []
    var invalidated = 0
    private var listConts: [CheckedContinuation<TaskListRecord, Error>] = []
    private var detailConts: [CheckedContinuation<TaskDetailRecord, Error>] = []

    func invalidate() { invalidated += 1 }

    func listTasks(server: String, key: String, isCurrent: @escaping @Sendable () -> Bool) async throws -> TaskListRecord {
        calls.append(Call(kind: "list", server: server, key: key, id: nil, isCurrent: isCurrent))
        return try await withCheckedThrowingContinuation { listConts.append($0) }
    }

    func getTask(server: String, key: String, id: String, isCurrent: @escaping @Sendable () -> Bool) async throws -> TaskDetailRecord {
        calls.append(Call(kind: "detail", server: server, key: key, id: id, isCurrent: isCurrent))
        return try await withCheckedThrowingContinuation { detailConts.append($0) }
    }

    func answerList(_ i: Int, _ r: Result<TaskListRecord, Error>) { listConts[i].resume(with: r) }
    func answerDetail(_ i: Int, _ r: Result<TaskDetailRecord, Error>) { detailConts[i].resume(with: r) }
}

/** main 의 대기 Task 들이 돌 틈. */
@MainActor
func settle() async { for _ in 0..<20 { await Task.yield() } }

@MainActor
final class TasksModelTests: XCTestCase {
    var fetcher: FakeFetcher!
    var key: String? = "omk_test_SYNTH"
    var server = "http://127.0.0.1:1"
    var model: TasksModel!

    override func setUp() async throws {
        fetcher = FakeFetcher()
        model = TasksModel(fetcher: fetcher, key: { [unowned self] in self.key }, server: { [unowned self] in self.server })
    }

    /** T-S6 — 키 없음 → noKey, fetcher 를 부르지 않는다. */
    func testNoKeyDoesNotFetch() async {
        key = nil
        model.shown()
        await settle()
        XCTAssertEqual(model.list, .noKey)
        XCTAssertTrue(fetcher.calls.isEmpty)
    }

    func testShownLoadsList() async {
        model.shown()
        await settle()
        XCTAssertEqual(model.list, .loading)
        XCTAssertEqual(fetcher.calls.map(\.kind), ["list"])
        XCTAssertEqual(fetcher.calls[0].key, "omk_test_SYNTH")
        fetcher.answerList(0, .success(TaskListRecord(tasks: [row("a")])))
        await settle()
        XCTAssertEqual(model.list, .loaded([row("a")]))
        XCTAssertNotNil(model.lastRefreshed)
    }

    /** T-S7 — 선택 A 요청 중 B 선택 → 늦은 A 응답은 버린다. 낡은 요청은 큐에서 확인 함수가 거짓(Low-4 ②). */
    func testLateDetailDiscarded() async {
        model.shown()
        model.select("A")
        model.select("B")
        await settle()
        XCTAssertEqual(fetcher.calls.compactMap(\.id), ["A", "B"])
        XCTAssertFalse(fetcher.calls[1].isCurrent())
        XCTAssertTrue(fetcher.calls[2].isCurrent())
        fetcher.answerDetail(1, .success(detailOf("B")))
        fetcher.answerDetail(0, .success(detailOf("A")))
        await settle()
        XCTAssertEqual(model.selectedId, "B")
        XCTAssertEqual(model.detail, .loaded(detailOf("B")))
    }

    /** T-S7 — sessionChanged 뒤에 온 옛 목록 응답도 버린다. */
    func testLateListAfterSessionChangeDiscarded() async {
        model.shown()
        await settle()
        server = "http://127.0.0.1:2"
        model.sessionChanged()
        await settle()
        XCTAssertFalse(fetcher.calls[0].isCurrent())
        fetcher.answerList(0, .success(TaskListRecord(tasks: [row("old")])))
        await settle()
        XCTAssertEqual(model.list, .loading)
        fetcher.answerList(1, .success(TaskListRecord(tasks: [row("new")])))
        await settle()
        XCTAssertEqual(model.list, .loaded([row("new")]))
    }

    /** T-S8 — 오류 → ErrorKind. 취소(낡은 요청)는 화면을 바꾸지 않는다. */
    func testErrorKinds() async {
        let table: [(ApiCallError, ErrorKind)] = [
            (.Authentication(status: 401), .auth), (.Forbidden(status: 403), .auth), (.Network, .offline), (.Timeout, .offline),
            (.RateLimited(status: 429), .rateLimited), (.ResponseTooLarge, .tooLarge), (.Decode, .decode),
            (.Server(status: 502), .server(502)), (.Http(status: 404), .server(404)), (.InvalidInput, .input), (.Internal, .internal),
        ]
        for (e, k) in table { XCTAssertEqual(TasksModel.errorKind(e), k, "\(e)") }
        XCTAssertEqual(TasksModel.errorKind(NSError(domain: "x", code: 1)), .internal)
        model.shown()
        model.select("A")
        await settle()
        fetcher.answerList(0, .failure(ApiCallError.Network))
        fetcher.answerDetail(0, .failure(ApiCallError.ResponseTooLarge))
        await settle()
        XCTAssertEqual(model.list, .failed(.offline))
        XCTAssertEqual(model.detail, .failed(.tooLarge))
        model.refresh()
        await settle()
        fetcher.answerList(1, .failure(CancellationError()))
        await settle()
        XCTAssertEqual(model.list, .failed(.offline))
    }

    /** T-S9 — serverSignaled 는 안 보이면 부르지 않고, 보이면 목록 + 선택 상세. */
    func testServerSignaled() async {
        model.serverSignaled()
        await settle()
        XCTAssertTrue(fetcher.calls.isEmpty)
        model.shown()
        model.select("A")
        await settle()
        model.serverSignaled()
        await settle()
        XCTAssertEqual(fetcher.calls.map(\.kind), ["list", "detail", "list", "detail"])
        model.hidden()
        model.serverSignaled()
        await settle()
        XCTAssertEqual(fetcher.calls.count, 4)
    }

    /** T-S11 ① — 주소 변경: 즉시 비우고, 보이면 새 주소로 한 번, 안 보이면 부르지 않는다. */
    func testSessionChangedClearsAndReloads() async {
        model.shown()
        model.select("A")
        await settle()
        fetcher.answerList(0, .success(TaskListRecord(tasks: [row("A")])))
        fetcher.answerDetail(0, .success(detailOf("A")))
        await settle()
        server = "http://127.0.0.1:2"
        model.sessionChanged()
        XCTAssertEqual(model.list, .loading)
        XCTAssertEqual(model.detail, .none)
        XCTAssertNil(model.selectedId)
        XCTAssertNil(model.lastRefreshed)
        XCTAssertEqual(fetcher.invalidated, 1)
        await settle()
        XCTAssertEqual(fetcher.calls.last?.server, "http://127.0.0.1:2")
        XCTAssertEqual(fetcher.calls.count, 3)
        fetcher.answerList(1, .success(TaskListRecord(tasks: [])))
        await settle()
        XCTAssertEqual(model.list, .loaded([]))
        model.hidden()
        model.sessionChanged()
        await settle()
        XCTAssertEqual(fetcher.calls.count, 3)
        XCTAssertEqual(model.list, .loading)
    }

    /** T-S11 ② — noKey 에서 키 저장 → loading → loaded, ③ 키 삭제 → noKey·미호출. */
    func testKeySavedAndDeleted() async {
        key = nil
        model.shown()
        await settle()
        XCTAssertEqual(model.list, .noKey)
        key = "omk_test_SYNTH2"
        model.sessionChanged()
        XCTAssertEqual(model.list, .loading)
        await settle()
        XCTAssertEqual(fetcher.calls.map(\.key), ["omk_test_SYNTH2"])
        fetcher.answerList(0, .success(TaskListRecord(tasks: [row("x")])))
        await settle()
        XCTAssertEqual(model.list, .loaded([row("x")]))
        key = nil
        model.sessionChanged()
        await settle()
        XCTAssertEqual(model.list, .noKey)
        XCTAssertEqual(fetcher.calls.count, 1)
    }
}
