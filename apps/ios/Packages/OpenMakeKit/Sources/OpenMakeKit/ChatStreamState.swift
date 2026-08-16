// OpenMakeKit — 채팅 스트림 리듀서 (축 3 Step 4)
// WS 이벤트 → 화면 상태의 순수 축약 로직. UI 와 분리해 단위 테스트 가능하게 Kit 에 둔다.
// MVP 소비 부분집합(plan §3)만 처리 — 그 외 이벤트는 무해하게 무시.
import Foundation

public struct ChatStreamMetrics: Equatable, Sendable {
    public let tokenCount: Double
    public let tokensPerSec: String
}

public enum ChatActivityKind: Equatable, Sendable {
    case preparing
    case thinking
    case agent
    case tool
    case research
    case artifact
    case finalizing
}

public struct ChatArtifact: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let title: String
    public let language: String?
    public private(set) var content: String
    public private(set) var isComplete: Bool

    init(meta: ArtifactMeta) {
        id = meta.id
        kind = meta.kind
        title = meta.title
        language = meta.lang
        content = ""
        isComplete = false
    }

    mutating func append(_ delta: String) {
        content += delta
    }

    mutating func complete() {
        isComplete = true
    }
}

public struct ChatStreamState: Sendable {
    public private(set) var streamingText = ""
    public private(set) var isThinking = false
    public private(set) var sessionId: String?
    public private(set) var isDone = false
    public private(set) var metrics: ChatStreamMetrics?
    public private(set) var errorMessage: String?
    /// 인증 토큰 만료 임박 — 호출자는 REST refresh 후 재연결 (웹과 동일 규약)
    public private(set) var needsTokenRefresh = false
    /// 진행 상태 한 줄 (도구 실행·리서치/토론 진행 등) — token 수신 시 자동 해제
    public private(set) var statusText: String?
    public private(set) var activityKind: ChatActivityKind?
    public private(set) var artifacts: [ChatArtifact] = []

    public init() {}

    public mutating func begin() {
        statusText = "요청을 분석하고 있어요"
        activityKind = .preparing
    }

    public mutating func apply(_ event: WsServerEvent) {
        switch event.type {
        case .token:
            isThinking = false
            statusText = nil
            activityKind = nil
            streamingText += event.token ?? ""
        case .thinking:
            isThinking = true
            setActivity("답변을 생각하고 있어요", kind: .thinking)
        case .thinkingSummary:
            isThinking = true
            setActivity(event.summary ?? event.message ?? "생각을 정리하고 있어요", kind: .thinking)
        case .agentSelected:
            let name = event.agent?.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if let name, !name.isEmpty {
                setActivity("\(name) 에이전트가 작업을 준비하고 있어요", kind: .agent)
            } else {
                setActivity("에이전트가 작업을 준비하고 있어요", kind: .agent)
            }
        case .skillsActivated:
            setActivity("필요한 기능을 준비하고 있어요", kind: .agent)
        case .agentTaskProgress:
            if let preview = event.step?.preview, !preview.isEmpty {
                setActivity(preview, kind: .agent)
            } else if let currentTurn = event.currentTurn {
                setActivity("에이전트가 \(Int(currentTurn))번째 단계를 진행하고 있어요", kind: .agent)
            } else {
                setActivity(event.message ?? "에이전트가 작업을 진행하고 있어요", kind: .agent)
            }
        case .mcpToolStart:
            setActivity(toolActivity(event.toolName), kind: .tool)
        case .mcpToolResult:
            setActivity("도구 결과를 검토하고 있어요", kind: .finalizing)
        case .researchProgress:
            setActivity(event.message ?? "딥리서치를 진행하고 있어요", kind: .research)
        case .discussionProgress:
            setActivity(event.message ?? "에이전트 토론을 진행하고 있어요", kind: .agent)
        case .artifactStart:
            if let meta = event.artifact {
                artifacts.removeAll { $0.id == meta.id }
                artifacts.append(ChatArtifact(meta: meta))
            }
            setActivity("아티팩트를 만들고 있어요", kind: .artifact)
        case .artifactChunk:
            guard let id = event.id,
                  let index = artifacts.firstIndex(where: { $0.id == id }) else { break }
            artifacts[index].append(event.delta ?? "")
        case .artifactEnd:
            if let id = event.id,
               let index = artifacts.firstIndex(where: { $0.id == id }) {
                artifacts[index].complete()
            }
            setActivity("답변을 정리하고 있어요", kind: .finalizing)
        case .sessionCreated:
            sessionId = event.sessionID
        case .done:
            if let cleanedContent = event.cleanedContent {
                streamingText = cleanedContent
            }
            isDone = true
            isThinking = false
            statusText = nil
            activityKind = nil
            if let raw = event.metrics {
                metrics = ChatStreamMetrics(tokenCount: raw.tokenCount, tokensPerSec: raw.tokensPerSEC)
            }
        case .aborted:
            isDone = true
            isThinking = false
            statusText = nil
            activityKind = nil
        case .error:
            errorMessage = event.message ?? event.errorType ?? "오류가 발생했습니다"
            isDone = true
            isThinking = false
            statusText = nil
            activityKind = nil
        case .tokenWarning:
            needsTokenRefresh = true
        default:
            break
        }
    }

    private mutating func setActivity(_ text: String, kind: ChatActivityKind) {
        let oneLine = text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        statusText = oneLine.isEmpty ? nil : String(oneLine.prefix(120))
        activityKind = statusText == nil ? nil : kind
    }

    private func toolActivity(_ toolName: String?) -> String {
        guard let toolName, !toolName.isEmpty else { return "도구를 사용하고 있어요" }
        let lowered = toolName.lowercased()
        if lowered.contains("search") || lowered.contains("browse") || lowered.contains("fetch") {
            return "웹에서 자료를 찾고 있어요"
        }
        if lowered.contains("read") || lowered.contains("open") {
            return "자료를 읽고 있어요"
        }
        if lowered.contains("write") || lowered.contains("edit") || lowered.contains("patch") {
            return "결과물을 작성하고 있어요"
        }
        return "\(toolName) 도구를 사용하고 있어요"
    }
}
