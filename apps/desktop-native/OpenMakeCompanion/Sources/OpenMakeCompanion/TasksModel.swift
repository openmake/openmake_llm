// 작업 창 상태(PR-3.3 D-255~D-257·D-267) — 서버 응답 모양 → 화면 상태 대응만(판정 없음). 주기 폴링 없음: 창 열 때·새로고침·
// 행 선택·브리지 이벤트(작업 끝·승인 대기)·키·주소 변경 때만 부른다. 응답은 요청 때 찍은 세대가 지금과 같을 때만 반영한다.
import Foundation
import OmkFfi

/** 오류 범주 → 화면 문구(TaskDisplay.errorPhrase). */
enum ErrorKind: Equatable {
    case auth, offline, rateLimited, tooLarge, decode, server(UInt16), input, `internal`
}

enum ListState: Equatable {
    case noKey
    case loading
    case loaded([TaskRow])
    case failed(ErrorKind)
}

enum DetailState: Equatable {
    case none
    case loading
    case loaded(TaskDetailRecord)
    case failed(ErrorKind)
}

/** 세대 번호 — 직렬 큐(다른 스레드)에서도 읽으므로 잠금. session = 키·주소 변경, selection = 행 선택 변경. */
final class TaskGenerations: @unchecked Sendable {
    private let lock = NSLock()
    private var session = 0
    private var selection = 0

    func bumpSession() { lock.withLock { session += 1 } }
    func bumpSelection() { lock.withLock { selection += 1 } }
    func now() -> (session: Int, selection: Int) { lock.withLock { (session, selection) } }
}

@MainActor
final class TasksModel: ObservableObject {
    static let shared = TasksModel(fetcher: TaskApiClient(), key: { HelperManager.shared.currentApiKey() },
                                   server: { HelperManager.shared.serverAddress })

    @Published private(set) var list: ListState = .loading
    @Published private(set) var selectedId: String?
    @Published private(set) var detail: DetailState = .none
    /** 마지막으로 목록을 받은 시각(로컬 시계, 표시용). */
    @Published private(set) var lastRefreshed: Date?
    private(set) var isVisible = false

    private let fetcher: TaskFetching
    private let key: @MainActor () -> String?
    private let server: @MainActor () -> String
    private let gens = TaskGenerations()

    init(fetcher: TaskFetching, key: @escaping @MainActor () -> String?, server: @escaping @MainActor () -> String) {
        self.fetcher = fetcher
        self.key = key
        self.server = server
    }

    /** 창이 앞에 왔다(D-256 ①). */
    func shown() {
        isVisible = true
        refresh()
    }

    func hidden() { isVisible = false }

    /** 목록 + 선택된 상세(D-256 ②). 보이던 목록·오류는 응답이 올 때까지 그대로 둔다. */
    func refresh() {
        loadList()
        if let id = selectedId { loadDetail(id) }
    }

    func select(_ id: String?) {
        guard id != selectedId else { return }
        selectedId = id
        gens.bumpSelection()
        detail = id == nil ? .none : .loading
        if let id { loadDetail(id) }
    }

    /** 브리지 이벤트 TaskEnd·ApprovalPending(D-256 ④) — 보이는 중일 때만. */
    func serverSignaled() {
        guard isVisible else { return }
        refresh()
    }

    /** 키·주소 변경(D-267) — 옛 서버 값을 즉시 지우고, 보이는 중이면 다시 부른다. */
    func sessionChanged() {
        gens.bumpSession()
        fetcher.invalidate()
        selectedId = nil
        detail = .none
        lastRefreshed = nil
        list = currentKey() == nil ? .noKey : .loading
        if isVisible { loadList() }
    }

    private func currentKey() -> String? {
        guard let k = key(), !k.isEmpty else { return nil }
        return k
    }

    private func loadList() {
        guard let key = currentKey() else {
            list = .noKey
            return
        }
        if list == .noKey { list = .loading }
        let gens = gens, token = gens.now().session
        let current: @Sendable () -> Bool = { gens.now().session == token }
        let server = server()
        Task {
            do {
                let r = try await fetcher.listTasks(server: server, key: key, isCurrent: current)
                guard current() else { return }
                list = .loaded(r.tasks)
                lastRefreshed = Date()
            } catch {
                guard current(), !(error is CancellationError) else { return }
                list = .failed(Self.errorKind(error))
            }
        }
    }

    private func loadDetail(_ id: String) {
        guard let key = currentKey() else { return }
        let gens = gens, token = gens.now()
        let current: @Sendable () -> Bool = { gens.now() == token }
        let server = server()
        Task {
            do {
                let r = try await fetcher.getTask(server: server, key: key, id: id, isCurrent: current)
                guard current() else { return }
                detail = .loaded(r)
            } catch {
                guard current(), !(error is CancellationError) else { return }
                detail = .failed(Self.errorKind(error))
            }
        }
    }

    static func errorKind(_ e: Error) -> ErrorKind {
        guard let e = e as? ApiCallError else { return .internal }
        switch e {
        case .Authentication, .Forbidden: return .auth
        case .Network, .Timeout: return .offline
        case .RateLimited: return .rateLimited
        case .ResponseTooLarge: return .tooLarge
        case .Decode: return .decode
        case let .Server(status), let .Http(status): return .server(status)
        case .InvalidInput: return .input
        case .Internal: return .internal
        }
    }
}
