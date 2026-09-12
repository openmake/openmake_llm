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

/// 멀티모달 오케스트레이터 작업 1건 (system_event orchestrator_plan/orchestrator_task 대응 — 웹 store 와 같은 형태)
public struct OrchestratorTask: Identifiable, Equatable, Sendable {
    public enum Status: String, Sendable { case pending, running, ok, failed }
    public let id: String
    public let capability: String
    public var instruction: String?
    public var status: Status
    public var summary: String?
    public var ms: Double?

    public var label: String { CapabilityCatalog.label(capability) }
}

/// 오케스트레이터 진행 — 계획(planning) → 실행(executing, 작업별 상태) → 종합(synthesizing).
/// `simple` 계획이거나 done/skipped 가 오면 nil 로 돌아간다(배너 소멸).
public struct OrchestratorProgress: Equatable, Sendable {
    public enum Phase: String, Sendable { case planning, executing, synthesizing }
    public var phase: Phase
    public var detail: String?
    public var complexity: String?
    public var tasks: [OrchestratorTask]

    public var doneCount: Int { tasks.filter { $0.status == .ok || $0.status == .failed }.count }
}

public struct ChatStreamState: Sendable {
    public private(set) var streamingText = ""
    public private(set) var isThinking = false
    public private(set) var sessionId: String?
    public private(set) var isDone = false
    /// 사용자가 중단(abort)해서 끝났는지 — 조용히 사라지지 않게 안내를 남기는 판단 기준
    public private(set) var wasAborted = false
    public private(set) var metrics: ChatStreamMetrics?
    public private(set) var errorMessage: String?
    /// 인증 토큰 만료 임박 — 호출자는 REST refresh 후 재연결 (웹과 동일 규약)
    public private(set) var needsTokenRefresh = false
    /// resume 요청에 이어받을 스트림이 없었음 — 답변이 끝났다면 서버 히스토리에 있다
    public private(set) var resumeUnavailable = false
    /// 진행 상태 한 줄 (도구 실행·리서치/토론 진행 등) — token 수신 시 자동 해제
    public private(set) var statusText: String?
    public private(set) var activityKind: ChatActivityKind?
    public private(set) var activeSkillNames: [String] = []
    public private(set) var artifacts: [ChatArtifact] = []
    /// 이번 응답에서 지나온 단계 이력 (최신이 마지막). 진행 카드에서 펼쳐 보여준다.
    public private(set) var activityLog: [ChatActivityEntry] = []
    /// 멀티모달 오케스트레이터 진행 (이미지·영상·음성 등 capability 작업). 종전엔 system_event 를
    /// 통째로 버려 이미지 34s·영상 수 분 동안 진행 표시가 0 이었다(2026-09-12).
    public private(set) var orchestrator: OrchestratorProgress?
    /// 본문 토큰을 한 자라도 받았는지 — "응답 작성 중" 표시 판단용
    public var hasStartedAnswer: Bool { !streamingText.isEmpty }

    public init() {}

    /// 전송 직후 초기 상태.
    /// - Parameter hint: 모드별 안내 문구. 이미지 생성·딥리서치처럼 첫 프레임까지
    ///   수십 초가 걸리는 요청은 이 문구가 없으면 멈춘 것처럼 보인다.
    public mutating func begin(hint: String? = nil) {
        activeSkillNames = []
        activityLog = []
        orchestrator = nil
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
            orchestrator = nil
            if let raw = event.metrics {
                metrics = ChatStreamMetrics(tokenCount: raw.tokenCount, tokensPerSec: raw.tokensPerSEC)
            }
        case .aborted:
            isDone = true
            wasAborted = true
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
        case .streamResume:
            // 끊긴 사이 서버가 계속 만든 답변 스냅샷 — 본문을 통째로 되돌리고 스트리밍 상태로 복귀.
            // 뒤따르는 token/done 이 그대로 이어진다(웹 use-chat-socket 과 같은 규약).
            streamingText = event.content ?? streamingText
            isThinking = false
            isDone = false
            setActivity(streamingText.isEmpty ? "답변을 이어받고 있어요" : Self.writingText, kind: .finalizing)
        case .systemEvent:
            applySystemEvent(event.payload)
        case .resumeNone:
            resumeUnavailable = true
            isDone = true
            isThinking = false
            statusText = nil
            activityKind = nil
        default:
            break
        }
    }

    /// system_event — 오케스트레이터 진행(orchestrator_status|plan|task)만 소비하고 나머지는 무시.
    /// 알 수 없는 형태는 조용히 건너뛴다(fail-open, 웹 use-chat-socket applyOrchestratorEvent 와 같은 규칙).
    private mutating func applySystemEvent(_ payload: Payload?) {
        guard let payload else { return }
        let md = SystemEventMetadata(payload.metadata)
        switch payload.type {
        case "orchestrator_status":
            guard let phase = md.string("phase") else { return }
            switch phase {
            case "planning":
                orchestrator = OrchestratorProgress(phase: .planning, detail: md.string("detail"), complexity: orchestrator?.complexity, tasks: orchestrator?.tasks ?? [])
                setActivity("요청을 분석하고 있어요", kind: .preparing)
            case "executing":
                orchestrator = OrchestratorProgress(phase: .executing, detail: md.string("detail"), complexity: orchestrator?.complexity, tasks: orchestrator?.tasks ?? [])
                if let running = orchestrator?.tasks.first(where: { $0.status == .running }) {
                    setActivity(CapabilityCatalog.progressText(running.capability), kind: .tool)
                } else {
                    setActivity("작업을 실행하고 있어요", kind: .tool)
                }
            case "synthesizing":
                orchestrator = OrchestratorProgress(phase: .synthesizing, detail: md.string("detail"), complexity: orchestrator?.complexity, tasks: orchestrator?.tasks ?? [])
                setActivity("결과를 모아 답변을 정리하고 있어요", kind: .finalizing)
            default:
                // done | skipped | 기타 — 배너 숨김(상태 문구는 다음 이벤트가 갱신)
                orchestrator = nil
            }
        case "orchestrator_plan":
            let complexity = md.string("complexity")
            if complexity == "simple" {
                orchestrator = nil
                return
            }
            let tasks: [OrchestratorTask] = md.objects("tasks").compactMap { t in
                guard let id = t.string("id"), let capability = t.string("capability") else { return nil }
                return OrchestratorTask(id: id, capability: capability, instruction: t.string("instruction"), status: .pending, summary: nil, ms: nil)
            }
            orchestrator = OrchestratorProgress(phase: orchestrator?.phase ?? .executing, detail: orchestrator?.detail, complexity: complexity, tasks: tasks)
            if tasks.count == 1, let only = tasks.first {
                setActivity(CapabilityCatalog.progressText(only.capability), kind: .tool)
            } else if !tasks.isEmpty {
                setActivity("\(tasks.count)개 작업을 실행하고 있어요", kind: .tool)
            }
        case "orchestrator_task":
            guard let id = md.string("id"), let capability = md.string("capability"),
                  let raw = md.string("status"), let status = OrchestratorTask.Status(rawValue: raw) else { return }
            var progress = orchestrator ?? OrchestratorProgress(phase: .executing, detail: nil, complexity: nil, tasks: [])
            if let index = progress.tasks.firstIndex(where: { $0.id == id }) {
                progress.tasks[index].status = status
                progress.tasks[index].summary = md.string("summary") ?? progress.tasks[index].summary
                progress.tasks[index].ms = md.double("ms") ?? progress.tasks[index].ms
            } else {
                progress.tasks.append(OrchestratorTask(id: id, capability: capability, instruction: nil, status: status, summary: md.string("summary"), ms: md.double("ms")))
            }
            orchestrator = progress
            switch status {
            case .running:
                setActivity(CapabilityCatalog.progressText(capability), kind: .tool)
            case .ok:
                setActivity("\(CapabilityCatalog.label(capability)) 완료", kind: .finalizing)
            case .failed:
                setActivity("\(CapabilityCatalog.label(capability)) 실패", kind: .finalizing)
            case .pending:
                break
            }
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


/// system_event.payload.metadata 의 관대한 접근자 — 생성 모델의 JSONAny(value: Any) 위에서
/// 문자열/숫자/객체 배열만 꺼낸다. 형식이 다르면 nil(무시).
struct SystemEventMetadata {
    private let raw: [String: Any]

    init(_ metadata: [String: JSONAny]?) {
        raw = (metadata ?? [:]).mapValues { $0.value }
    }

    init(any: [String: Any]) {
        raw = any
    }

    func string(_ key: String) -> String? {
        raw[key] as? String
    }

    func double(_ key: String) -> Double? {
        switch raw[key] {
        case let value as Double: return value
        case let value as Int64: return Double(value)
        case let value as Int: return Double(value)
        default: return nil
        }
    }

    func objects(_ key: String) -> [SystemEventMetadata] {
        guard let array = raw[key] as? [Any] else { return [] }
        return array.compactMap { item in
            if let dict = item as? [String: Any] { return SystemEventMetadata(any: dict) }
            if let dict = item as? [String: JSONAny] { return SystemEventMetadata(dict) }
            return nil
        }
    }
}
