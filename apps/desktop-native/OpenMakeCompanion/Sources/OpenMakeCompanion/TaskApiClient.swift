// 작업 API 호출(PR-3.3 D-251) — Rust `TaskApi` 는 동기(블로킹) 함수라 직렬 DispatchQueue 하나에서만 부르고 continuation 으로
// async 로 감싼다(resolveEndpoints 와 같은 모양). Swift 협력 스레드 풀을 막지 않고, 같은 TaskApi 에 동시 호출이 없다.
// 키는 함수 인자로만 지나가고 프로퍼티에 남지 않는다(TaskApi 안 ApiKey 에만 있다).
import Foundation
import OmkFfi

/** 작업 목록·상세를 가져오는 쪽 — 시험은 가짜로 바꾼다. isCurrent 가 거짓이면 그 요청은 이미 낡았다(CancellationError). */
@MainActor
protocol TaskFetching: AnyObject {
    func invalidate()
    func listTasks(server: String, key: String, isCurrent: @escaping @Sendable () -> Bool) async throws -> TaskListRecord
    func getTask(server: String, key: String, id: String, isCurrent: @escaping @Sendable () -> Bool) async throws -> TaskDetailRecord
}

@MainActor
final class TaskApiClient: TaskFetching {
    private let worker = TaskApiWorker()

    /** 키·주소가 바뀌었다 — 다음 요청이 TaskApi 를 새로 만든다. */
    func invalidate() { worker.invalidate() }

    func listTasks(server: String, key: String, isCurrent: @escaping @Sendable () -> Bool) async throws -> TaskListRecord {
        try await worker.run(server: server, key: key, isCurrent: isCurrent) { try $0.listTasks() }
    }

    func getTask(server: String, key: String, id: String, isCurrent: @escaping @Sendable () -> Bool) async throws -> TaskDetailRecord {
        try await worker.run(server: server, key: key, isCurrent: isCurrent) { try $0.getTask(taskId: id) }
    }
}

/** 직렬 큐와 그 큐 안에서만 만지는 TaskApi. */
final class TaskApiWorker: @unchecked Sendable {
    private let queue = DispatchQueue(label: "cc.openmake.code.tasks-api", qos: .userInitiated)
    private var api: TaskApi?
    private var server: String?

    // 키를 바꾸는 경로는 TasksModel.sessionChanged() 를 불러야 한다 — 같은 서버면 여기 캐시된 TaskApi(옛 키)를 다시 쓴다.
    func invalidate() {
        queue.async {
            self.api = nil
            self.server = nil
        }
    }

    /** 큐 블록 시작에서 isCurrent 를 본다 — 낡은 요청(선택을 빠르게 바꾼 경우 등)은 FFI 를 부르지 않는다(재검토 Low-4 ②). */
    func run<T>(server: String, key: String, isCurrent: @escaping @Sendable () -> Bool,
                _ body: @escaping (TaskApi) throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { cont in
            queue.async {
                guard isCurrent() else { return cont.resume(throwing: CancellationError()) }
                do {
                    let api: TaskApi
                    if let a = self.api, self.server == server {
                        api = a
                    } else {
                        api = try TaskApi(server: server, apiKey: key)
                        self.api = api
                        self.server = server
                    }
                    cont.resume(returning: try body(api))
                } catch {
                    cont.resume(throwing: error)
                }
            }
        }
    }
}
