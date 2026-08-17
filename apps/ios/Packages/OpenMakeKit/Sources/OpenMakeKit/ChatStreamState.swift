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

/// 진행 단계 한 건 — 지나간 단계도 남겨 "무엇을 하고 있었는지" 를 보여준다.
/// (상태 한 줄만 갈아끼우면 사용자는 멈춘 것인지 진행 중인지 알 수 없다 — 2026-08-17 피드백)
public struct ChatActivityEntry: Identifiable, Equatable, Sendable {
    public let id: UUID
    public let text: String
    public let kind: ChatActivityKind

    init(text: String, kind: ChatActivityKind) {
        self.id = UUID()
        self.text = text
        self.kind = kind
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
    public private(set) var activeSkillNames: [String] = []
    public private(set) var artifacts: [ChatArtifact] = []
    /// 이번 응답에서 지나온 단계 이력 (최신이 마지막). 진행 카드에서 펼쳐 보여준다.
    public private(set) var activityLog: [ChatActivityEntry] = []
    /// 본문 토큰을 한 자라도 받았는지 — "응답 작성 중" 표시 판단용
    public var hasStartedAnswer: Bool { !streamingText.isEmpty }

    public init() {}

    /// 전송 직후 초기 상태.
    /// - Parameter hint: 모드별 안내 문구. 이미지 생성·딥리서치처럼 첫 프레임까지
    ///   수십 초가 걸리는 요청은 이 문구가 없으면 멈춘 것처럼 보인다.
    public mutating func begin(hint: String? = nil) {
        activeSkillNames = []
        activityLog = []
        setActivity(hint ?? "요청을 분석하고 있어요", kind: .preparing)
    }

    public mutating func apply(_ event: WsServerEvent) {
        switch event.type {
        case .token:
            isThinking = false
            // 본문이 오기 시작하면 상태 줄은 "응답 작성 중" 으로 바꾼다 —
            // nil 로 비우면 화면이 정적이 되어 멈춘 것처럼 보인다.
            if statusText != Self.writingText {
                setActivity(Self.writingText, kind: .finalizing)
            }
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
            activeSkillNames = normalizedSkillNames(event.skillNames ?? [])
            if activeSkillNames.isEmpty {
                setActivity("필요한 기능을 준비하고 있어요", kind: .agent)
            } else {
                setActivity("\(activeSkillNames.joined(separator: ", ")) 적용 중", kind: .agent)
            }
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

    /// 본문 스트리밍 중 상태 문구 (토큰 수신 시 setActivity 재호출을 막기 위한 비교 기준)
    static let writingText = "응답을 작성하고 있어요"

    private mutating func setActivity(_ text: String, kind: ChatActivityKind) {
        let oneLine = text
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        statusText = oneLine.isEmpty ? nil : String(oneLine.prefix(120))
        activityKind = statusText == nil ? nil : kind
        // 같은 문구가 연달아 오면 이력을 늘리지 않는다 (진행률 갱신형 이벤트 대비)
        if let statusText, activityLog.last?.text != statusText {
            activityLog.append(ChatActivityEntry(text: statusText, kind: kind))
        }
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

    private func normalizedSkillNames(_ names: [String]) -> [String] {
        var seen = Set<String>()
        return names.compactMap { name in
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, seen.insert(trimmed).inserted else { return nil }
            return trimmed
        }
    }
}
