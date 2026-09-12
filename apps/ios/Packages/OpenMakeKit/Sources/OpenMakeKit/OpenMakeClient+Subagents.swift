// OpenMakeKit — 에이전트 작업의 병렬 서브에이전트 진행 상태 (#813 웹 subagent-panel 대응).
//   GET /api/agent-tasks/:id/subagents → { traces: [...] }
import Foundation

public struct SubagentStep: Decodable, Sendable, Equatable {
    public let seq: Int
    public let type: String
    public let tool: String?
    public let content: String?
    public let at: String
}

public struct SubagentTrace: Decodable, Identifiable, Sendable, Equatable {
    public var id: String { traceId }
    public let traceId: String
    public let origin: String
    public let subIndex: Int
    public let label: String?
    /// queued | running | completed | failed | interrupted
    public let status: String
    public let startedAt: String
    public let finishedAt: String?
    public let steps: [SubagentStep]

    /// 웹과 같은 이름 규칙 — 라벨이 없으면 출처로 "병렬 서브 #n" / "전문가 위임"
    public var displayName: String {
        if let label, !label.isEmpty { return label }
        return origin == "spawn_agents" ? "병렬 서브 #\(subIndex + 1)" : "전문가 위임"
    }

    public var statusLabel: String {
        switch status {
        case "queued": "대기 중"
        case "running": "실행 중"
        case "completed": "완료"
        case "failed": "실패"
        case "interrupted": "중단됨"
        default: status
        }
    }

    public var isActive: Bool { status == "queued" || status == "running" }
}

public extension OpenMakeClient {
    /// 서브에이전트가 없는 작업은 빈 배열 — 화면은 패널을 숨긴다(웹과 동일).
    func agentTaskSubagents(id: String) async throws -> [SubagentTrace] {
        struct Payload: Decodable { let traces: [SubagentTrace] }
        struct Envelope: Decodable { let data: Payload }
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/agent-tasks/\(id)/subagents")
        return try decodeContract(Envelope.self, from: data).data.traces
    }
}
