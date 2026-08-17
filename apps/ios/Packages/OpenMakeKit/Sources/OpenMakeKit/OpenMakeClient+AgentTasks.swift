import Foundation

public enum AgentTaskStatus: String, Codable, Sendable, CaseIterable {
    case pending
    case queued
    case running
    case paused
    case completed
    case failed
    case cancelled
}

public enum AgentTaskApprovalPolicy: String, Codable, Sendable, CaseIterable {
    case all
    case highRisk = "high-risk"
    case none
}

public struct AgentTask: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let goal: String
    public let status: AgentTaskStatus
    public let progress: Double
    public let currentTurn: Int
    public let maxTurns: Int
    public let model: String?
    public let result: String?
    public let error: String?
    public let executor: String?
    public let totalTokens: Int?
    public let gitPrURL: String?
    public let gitPushedBranch: String?
    public let resumable: Bool
    public let createdAt: Date
    public let updatedAt: Date
    public let completedAt: Date?

    public init(
        id: String,
        goal: String,
        status: AgentTaskStatus,
        progress: Double,
        currentTurn: Int,
        maxTurns: Int,
        model: String? = nil,
        result: String? = nil,
        error: String? = nil,
        executor: String? = nil,
        totalTokens: Int? = nil,
        gitPrURL: String? = nil,
        gitPushedBranch: String? = nil,
        resumable: Bool = false,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        completedAt: Date? = nil
    ) {
        self.id = id
        self.goal = goal
        self.status = status
        self.progress = progress
        self.currentTurn = currentTurn
        self.maxTurns = maxTurns
        self.model = model
        self.result = result
        self.error = error
        self.executor = executor
        self.totalTokens = totalTokens
        self.gitPrURL = gitPrURL
        self.gitPushedBranch = gitPushedBranch
        self.resumable = resumable
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.completedAt = completedAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case goal
        case status
        case progress
        case currentTurn = "current_turn"
        case maxTurns = "max_turns"
        case model
        case result
        case error
        case executor
        case totalTokens = "total_tokens"
        case gitPrURL = "git_pr_url"
        case gitPushedBranch = "git_pushed_branch"
        case resumable
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case completedAt = "completed_at"
    }
}

public struct AgentTaskStep: Codable, Identifiable, Sendable, Equatable {
    public let id: Int
    public let taskId: String
    public let stepNumber: Int
    public let stepType: String
    public let toolName: String?
    public let content: String?
    public let status: String
    public let createdAt: Date

    public init(
        id: Int,
        taskId: String,
        stepNumber: Int,
        stepType: String,
        toolName: String? = nil,
        content: String? = nil,
        status: String,
        createdAt: Date = Date()
    ) {
        self.id = id
        self.taskId = taskId
        self.stepNumber = stepNumber
        self.stepType = stepType
        self.toolName = toolName
        self.content = content
        self.status = status
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case id
        case taskId = "task_id"
        case stepNumber = "step_number"
        case stepType = "step_type"
        case toolName = "tool_name"
        case content
        case status
        case createdAt = "created_at"
    }
}

public struct AgentTaskDetail: Sendable, Equatable {
    public let task: AgentTask
    public let steps: [AgentTaskStep]

    public init(task: AgentTask, steps: [AgentTaskStep]) {
        self.task = task
        self.steps = steps
    }
}

public struct AgentTaskCreation: Sendable, Equatable {
    public let task: AgentTask
    public let concurrentActive: Int
    public let warnings: [String]
}

public struct AgentTaskExecution: Sendable, Equatable {
    public let taskId: String
    public let message: String
    public let queued: Bool
}

public struct AgentTaskApproval: Decodable, Identifiable, Sendable, Equatable {
    public let id: String
    public let taskId: String
    public let toolName: String
    /// 승인 대상 도구의 인자 — 스칼라 값만 문자열로 평탄화해 보관한다.
    /// 서버(approval-gate PendingApproval.args)는 예전부터 내려주고 있었는데 앱이 버려서,
    /// bash 가 무엇을 실행하는지·ask_human 이 무엇을 묻는지 모른 채 승인해야 했다.
    public let args: [String: String]

    public init(id: String, taskId: String, toolName: String, args: [String: String] = [:]) {
        self.id = id
        self.taskId = taskId
        self.toolName = toolName
        self.args = args
    }

    enum CodingKeys: String, CodingKey {
        case id = "approvalId"
        case taskId
        case toolName
        case args
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        taskId = try container.decode(String.self, forKey: .taskId)
        toolName = try container.decode(String.self, forKey: .toolName)
        args = (try? container.decode(ScalarDictionary.self, forKey: .args).values) ?? [:]
    }

    /// 사용자에게 보여줄 인자 요약 — 도구별 핵심 키를 우선하고, 없으면 첫 스칼라 인자.
    public var argumentSummary: String? {
        for key in ["question", "command", "code", "path", "url", "query", "topic", "op"] {
            if let value = args[key]?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
                return value
            }
        }
        return args.sorted { $0.key < $1.key }.first.map { "\($0.key): \($0.value)" }
    }
}

/// JSON 오브젝트에서 스칼라(문자열/숫자/불리언) 값만 문자열로 뽑는 경량 디코더.
/// 중첩 오브젝트·배열은 표시 목적상 불필요하므로 버린다(서드파티 AnyCodable 도입 회피).
struct ScalarDictionary: Decodable {
    let values: [String: String]

    private struct AnyKey: CodingKey {
        let stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: AnyKey.self)
        var result: [String: String] = [:]
        for key in container.allKeys {
            if let text = try? container.decode(String.self, forKey: key) {
                result[key.stringValue] = text
            } else if let number = try? container.decode(Double.self, forKey: key) {
                result[key.stringValue] = number == number.rounded()
                    ? String(Int(number))
                    : String(number)
            } else if let flag = try? container.decode(Bool.self, forKey: key) {
                result[key.stringValue] = flag ? "true" : "false"
            }
        }
        values = result
    }
}

public extension OpenMakeClient {
    func agentTasks() async throws -> [AgentTask] {
        struct Payload: Decodable {
            let tasks: [AgentTask]
        }
        struct Envelope: Decodable {
            let data: Payload
        }
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/agent-tasks")
        return try decodeContract(Envelope.self, from: data).data.tasks
    }

    func agentTask(id: String) async throws -> AgentTaskDetail {
        struct Payload: Decodable {
            let task: AgentTask
            let steps: [AgentTaskStep]
        }
        struct Envelope: Decodable {
            let data: Payload
        }
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/agent-tasks/\(id)")
        let payload = try decodeContract(Envelope.self, from: data).data
        return AgentTaskDetail(task: payload.task, steps: payload.steps)
    }

    func createAgentTask(
        goal: String,
        maxTurns: Int? = nil,
        files: [WsAttachedFile] = [],
        images: [String] = []
    ) async throws -> AgentTaskCreation {
        struct Request: Encodable {
            let goal: String
            let maxTurns: Int?
            let files: [WsAttachedFile]?
            let images: [String]?
        }
        struct Payload: Decodable {
            let task: AgentTask
            let concurrentActive: Int
            let warnings: [String]
        }
        struct Envelope: Decodable {
            let data: Payload
        }
        let request = Request(
            goal: goal,
            maxTurns: maxTurns,
            files: files.isEmpty ? nil : files,
            images: images.isEmpty ? nil : images)
        let (data, _) = try await authorizedSend(
            method: "POST", path: "/api/agent-tasks", body: request)
        let payload = try decodeContract(Envelope.self, from: data).data
        return AgentTaskCreation(
            task: payload.task,
            concurrentActive: payload.concurrentActive,
            warnings: payload.warnings)
    }

    func executeAgentTask(
        id: String,
        approvalPolicy: AgentTaskApprovalPolicy = .highRisk
    ) async throws -> AgentTaskExecution {
        struct Request: Encodable {
            let approvalPolicy: AgentTaskApprovalPolicy
        }
        return try await taskExecution(
            path: "/api/agent-tasks/\(id)/execute",
            body: Request(approvalPolicy: approvalPolicy))
    }

    func resumeAgentTask(id: String) async throws -> AgentTaskExecution {
        struct Empty: Encodable {}
        return try await taskExecution(path: "/api/agent-tasks/\(id)/resume", body: Empty())
    }

    func cancelAgentTask(id: String) async throws {
        struct Empty: Encodable {}
        _ = try await authorizedSend(
            method: "POST", path: "/api/agent-tasks/\(id)/cancel", body: Empty())
    }

    func steerAgentTask(id: String, message: String) async throws {
        struct Request: Encodable {
            let message: String
        }
        _ = try await authorizedSend(
            method: "POST", path: "/api/agent-tasks/\(id)/steer", body: Request(message: message))
    }

    func pendingAgentTaskApprovals() async throws -> [AgentTaskApproval] {
        struct Payload: Decodable {
            let pending: [AgentTaskApproval]
        }
        struct Envelope: Decodable {
            let data: Payload
        }
        let (data, _) = try await authorizedSend(
            method: "GET", path: "/api/agent-tasks/approvals/pending")
        return try decodeContract(Envelope.self, from: data).data.pending
    }

    func resolveAgentTaskApproval(id: String, approve: Bool) async throws {
        struct Empty: Encodable {}
        let decision = approve ? "approve" : "reject"
        _ = try await authorizedSend(
            method: "POST",
            path: "/api/agent-tasks/approvals/\(id)/\(decision)",
            body: Empty())
    }

    func answerAgentTaskApproval(id: String, text: String) async throws {
        struct Request: Encodable {
            let text: String
        }
        _ = try await authorizedSend(
            method: "POST",
            path: "/api/agent-tasks/approvals/\(id)/answer",
            body: Request(text: text))
    }

    func autoApproveAgentTask(id: String) async throws {
        struct Request: Encodable {
            let enabled: Bool
        }
        _ = try await authorizedSend(
            method: "POST",
            path: "/api/agent-tasks/\(id)/approvals/auto-approve",
            body: Request(enabled: true))
    }

    private func taskExecution(
        path: String,
        body: any Encodable
    ) async throws -> AgentTaskExecution {
        struct Payload: Decodable {
            let message: String
            let taskId: String
            let queued: Bool
        }
        struct Envelope: Decodable {
            let data: Payload
        }
        let (data, _) = try await authorizedSend(method: "POST", path: path, body: body)
        let payload = try decodeContract(Envelope.self, from: data).data
        return AgentTaskExecution(
            taskId: payload.taskId,
            message: payload.message,
            queued: payload.queued)
    }
}
