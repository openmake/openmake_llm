// This file was generated from JSON Schema using quicktype, do not modify it directly.
// To parse the JSON, add this file to your project and do:
//
//   let wsChatEnvelope = try WsChatEnvelope(json)

import Foundation

// MARK: - WsChatEnvelope
public struct WsChatEnvelope: Codable {
    public let event: WsServerEvent?
    public let request: WsChatRequest?

    public enum CodingKeys: String, CodingKey {
        case event = "event"
        case request = "request"
    }

    public init(event: WsServerEvent?, request: WsChatRequest?) {
        self.event = event
        self.request = request
    }
}

// MARK: WsChatEnvelope convenience initializers and mutators

public extension WsChatEnvelope {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WsChatEnvelope.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        event: WsServerEvent?? = nil,
        request: WsChatRequest?? = nil
    ) -> WsChatEnvelope {
        return WsChatEnvelope(
            event: event ?? self.event,
            request: request ?? self.request
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - WsServerEvent
public struct WsServerEvent: Codable {
    public let token: String?
    public let type: WsServerEventType
    public let messageID: String?
    public let summary: String?
    public let issues: String?
    public let sessionID: String?
    public let buildID: String?
    public let message: String?
    public let captureID: String?
    public let expiresAt: String?
    public let ttlHours: Double?
    public let payload: Payload?
    /// 아티팩트가 있으면 raw 코드펜스가 placeholder 로 치환된 본문 — 클라가 누적 본문을 이걸로 reset.
    public let cleanedContent: String?
    /// 백엔드 실제 페이로드(ws-chat-handler): 스트리밍 완료 시 토큰 메트릭. tokensPerSec 는 toFixed(2) 문자열.
    public let metrics: Metrics?
    public let content: String?
    public let finished: Bool?
    public let thinking: String?
    /// 에러 분류(quota_exceeded / api_keys_exhausted / provider code 등)
    public let errorType: String?
    public let keysInCooldown: Double?
    /// 키 쿨다운 해제 시각(ISO) — api_keys_exhausted.
    public let resetTime: String?
    /// 재시도 가능까지 남은 초(quota/키 소진).
    public let retryAfter: Double?
    public let totalKeys: Double?
    public let data: JSONAny?
    public let agent: Agent?
    public let skillNames: [String]?
    public let toolName: String?
    public let resources: [MCPToolResource]?
    public let progress: ProgressUnion?
    public let artifact: ArtifactMeta?
    public let delta: String?
    public let id: String?
    public let currentTurn: Double?
    public let status: String?
    /// 방금 기록된 스텝 요약(4-5 실시간 스트림) — "현재 단계" 라이브 표시용.
    public let step: Step?
    public let taskID: String?

    public enum CodingKeys: String, CodingKey {
        case token = "token"
        case type = "type"
        case messageID = "messageId"
        case summary = "summary"
        case issues = "issues"
        case sessionID = "sessionId"
        case buildID = "buildId"
        case message = "message"
        case captureID = "captureId"
        case expiresAt = "expiresAt"
        case ttlHours = "ttlHours"
        case payload = "payload"
        case cleanedContent = "cleanedContent"
        case metrics = "metrics"
        case content = "content"
        case finished = "finished"
        case thinking = "thinking"
        case errorType = "errorType"
        case keysInCooldown = "keysInCooldown"
        case resetTime = "resetTime"
        case retryAfter = "retryAfter"
        case totalKeys = "totalKeys"
        case data = "data"
        case agent = "agent"
        case skillNames = "skillNames"
        case toolName = "toolName"
        case resources = "resources"
        case progress = "progress"
        case artifact = "artifact"
        case delta = "delta"
        case id = "id"
        case currentTurn = "currentTurn"
        case status = "status"
        case step = "step"
        case taskID = "taskId"
    }

    public init(token: String?, type: WsServerEventType, messageID: String?, summary: String?, issues: String?, sessionID: String?, buildID: String?, message: String?, captureID: String?, expiresAt: String?, ttlHours: Double?, payload: Payload?, cleanedContent: String?, metrics: Metrics?, content: String?, finished: Bool?, thinking: String?, errorType: String?, keysInCooldown: Double?, resetTime: String?, retryAfter: Double?, totalKeys: Double?, data: JSONAny?, agent: Agent?, skillNames: [String]?, toolName: String?, resources: [MCPToolResource]?, progress: ProgressUnion?, artifact: ArtifactMeta?, delta: String?, id: String?, currentTurn: Double?, status: String?, step: Step?, taskID: String?) {
        self.token = token
        self.type = type
        self.messageID = messageID
        self.summary = summary
        self.issues = issues
        self.sessionID = sessionID
        self.buildID = buildID
        self.message = message
        self.captureID = captureID
        self.expiresAt = expiresAt
        self.ttlHours = ttlHours
        self.payload = payload
        self.cleanedContent = cleanedContent
        self.metrics = metrics
        self.content = content
        self.finished = finished
        self.thinking = thinking
        self.errorType = errorType
        self.keysInCooldown = keysInCooldown
        self.resetTime = resetTime
        self.retryAfter = retryAfter
        self.totalKeys = totalKeys
        self.data = data
        self.agent = agent
        self.skillNames = skillNames
        self.toolName = toolName
        self.resources = resources
        self.progress = progress
        self.artifact = artifact
        self.delta = delta
        self.id = id
        self.currentTurn = currentTurn
        self.status = status
        self.step = step
        self.taskID = taskID
    }
}

// MARK: WsServerEvent convenience initializers and mutators

public extension WsServerEvent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WsServerEvent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        token: String?? = nil,
        type: WsServerEventType? = nil,
        messageID: String?? = nil,
        summary: String?? = nil,
        issues: String?? = nil,
        sessionID: String?? = nil,
        buildID: String?? = nil,
        message: String?? = nil,
        captureID: String?? = nil,
        expiresAt: String?? = nil,
        ttlHours: Double?? = nil,
        payload: Payload?? = nil,
        cleanedContent: String?? = nil,
        metrics: Metrics?? = nil,
        content: String?? = nil,
        finished: Bool?? = nil,
        thinking: String?? = nil,
        errorType: String?? = nil,
        keysInCooldown: Double?? = nil,
        resetTime: String?? = nil,
        retryAfter: Double?? = nil,
        totalKeys: Double?? = nil,
        data: JSONAny?? = nil,
        agent: Agent?? = nil,
        skillNames: [String]?? = nil,
        toolName: String?? = nil,
        resources: [MCPToolResource]?? = nil,
        progress: ProgressUnion?? = nil,
        artifact: ArtifactMeta?? = nil,
        delta: String?? = nil,
        id: String?? = nil,
        currentTurn: Double?? = nil,
        status: String?? = nil,
        step: Step?? = nil,
        taskID: String?? = nil
    ) -> WsServerEvent {
        return WsServerEvent(
            token: token ?? self.token,
            type: type ?? self.type,
            messageID: messageID ?? self.messageID,
            summary: summary ?? self.summary,
            issues: issues ?? self.issues,
            sessionID: sessionID ?? self.sessionID,
            buildID: buildID ?? self.buildID,
            message: message ?? self.message,
            captureID: captureID ?? self.captureID,
            expiresAt: expiresAt ?? self.expiresAt,
            ttlHours: ttlHours ?? self.ttlHours,
            payload: payload ?? self.payload,
            cleanedContent: cleanedContent ?? self.cleanedContent,
            metrics: metrics ?? self.metrics,
            content: content ?? self.content,
            finished: finished ?? self.finished,
            thinking: thinking ?? self.thinking,
            errorType: errorType ?? self.errorType,
            keysInCooldown: keysInCooldown ?? self.keysInCooldown,
            resetTime: resetTime ?? self.resetTime,
            retryAfter: retryAfter ?? self.retryAfter,
            totalKeys: totalKeys ?? self.totalKeys,
            data: data ?? self.data,
            agent: agent ?? self.agent,
            skillNames: skillNames ?? self.skillNames,
            toolName: toolName ?? self.toolName,
            resources: resources ?? self.resources,
            progress: progress ?? self.progress,
            artifact: artifact ?? self.artifact,
            delta: delta ?? self.delta,
            id: id ?? self.id,
            currentTurn: currentTurn ?? self.currentTurn,
            status: status ?? self.status,
            step: step ?? self.step,
            taskID: taskID ?? self.taskID
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Agent
public struct Agent: Codable {
    public let confidence: Double?
    public let emoji: String?
    public let name: String
    public let phase: String?
    public let reason: String?
    public let type: String

    public enum CodingKeys: String, CodingKey {
        case confidence = "confidence"
        case emoji = "emoji"
        case name = "name"
        case phase = "phase"
        case reason = "reason"
        case type = "type"
    }

    public init(confidence: Double?, emoji: String?, name: String, phase: String?, reason: String?, type: String) {
        self.confidence = confidence
        self.emoji = emoji
        self.name = name
        self.phase = phase
        self.reason = reason
        self.type = type
    }
}

// MARK: Agent convenience initializers and mutators

public extension Agent {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Agent.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        confidence: Double?? = nil,
        emoji: String?? = nil,
        name: String? = nil,
        phase: String?? = nil,
        reason: String?? = nil,
        type: String? = nil
    ) -> Agent {
        return Agent(
            confidence: confidence ?? self.confidence,
            emoji: emoji ?? self.emoji,
            name: name ?? self.name,
            phase: phase ?? self.phase,
            reason: reason ?? self.reason,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// 아티팩트 메타 — 백엔드 llm/artifact-parser.ts ArtifactInfo 와 동일 계약.
// MARK: - ArtifactMeta
public struct ArtifactMeta: Codable {
    public let id: String
    public let kind: String
    public let lang: String?
    public let title: String

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case kind = "kind"
        case lang = "lang"
        case title = "title"
    }

    public init(id: String, kind: String, lang: String?, title: String) {
        self.id = id
        self.kind = kind
        self.lang = lang
        self.title = title
    }
}

// MARK: ArtifactMeta convenience initializers and mutators

public extension ArtifactMeta {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ArtifactMeta.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String? = nil,
        kind: String? = nil,
        lang: String?? = nil,
        title: String? = nil
    ) -> ArtifactMeta {
        return ArtifactMeta(
            id: id ?? self.id,
            kind: kind ?? self.kind,
            lang: lang ?? self.lang,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// 백엔드 실제 페이로드(ws-chat-handler): 스트리밍 완료 시 토큰 메트릭. tokensPerSec 는 toFixed(2) 문자열.
// MARK: - Metrics
public struct Metrics: Codable {
    public let tokenCount: Double
    public let tokensPerSEC: String

    public enum CodingKeys: String, CodingKey {
        case tokenCount = "tokenCount"
        case tokensPerSEC = "tokensPerSec"
    }

    public init(tokenCount: Double, tokensPerSEC: String) {
        self.tokenCount = tokenCount
        self.tokensPerSEC = tokensPerSEC
    }
}

// MARK: Metrics convenience initializers and mutators

public extension Metrics {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Metrics.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        tokenCount: Double? = nil,
        tokensPerSEC: String? = nil
    ) -> Metrics {
        return Metrics(
            tokenCount: tokenCount ?? self.tokenCount,
            tokensPerSEC: tokensPerSEC ?? self.tokensPerSEC
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Payload
public struct Payload: Codable {
    public let message: String
    public let metadata: [String: JSONAny]?
    public let type: String

    public enum CodingKeys: String, CodingKey {
        case message = "message"
        case metadata = "metadata"
        case type = "type"
    }

    public init(message: String, metadata: [String: JSONAny]?, type: String) {
        self.message = message
        self.metadata = metadata
        self.type = type
    }
}

// MARK: Payload convenience initializers and mutators

public extension Payload {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Payload.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        message: String? = nil,
        metadata: [String: JSONAny]?? = nil,
        type: String? = nil
    ) -> Payload {
        return Payload(
            message: message ?? self.message,
            metadata: metadata ?? self.metadata,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum ProgressUnion: Codable {
    case double(Double)
    case progressClass(ProgressClass)

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let x = try? container.decode(Double.self) {
            self = .double(x)
            return
        }
        if let x = try? container.decode(ProgressClass.self) {
            self = .progressClass(x)
            return
        }
        throw DecodingError.typeMismatch(ProgressUnion.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for ProgressUnion"))
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .double(let x):
            try container.encode(x)
        case .progressClass(let x):
            try container.encode(x)
        }
    }
}

// MARK: - ProgressClass
public struct ProgressClass: Codable {
    public let agentEmoji: String?
    public let currentAgent: String?
    public let message: String?
    public let phase: Phase?
    public let progress: Double?
    public let roundNumber: Double?
    public let totalRounds: Double?
    public let currentLoop: Double?
    public let currentStep: String?
    public let sessionID: String?
    public let status: String?
    public let totalLoops: Double?

    public enum CodingKeys: String, CodingKey {
        case agentEmoji = "agentEmoji"
        case currentAgent = "currentAgent"
        case message = "message"
        case phase = "phase"
        case progress = "progress"
        case roundNumber = "roundNumber"
        case totalRounds = "totalRounds"
        case currentLoop = "currentLoop"
        case currentStep = "currentStep"
        case sessionID = "sessionId"
        case status = "status"
        case totalLoops = "totalLoops"
    }

    public init(agentEmoji: String?, currentAgent: String?, message: String?, phase: Phase?, progress: Double?, roundNumber: Double?, totalRounds: Double?, currentLoop: Double?, currentStep: String?, sessionID: String?, status: String?, totalLoops: Double?) {
        self.agentEmoji = agentEmoji
        self.currentAgent = currentAgent
        self.message = message
        self.phase = phase
        self.progress = progress
        self.roundNumber = roundNumber
        self.totalRounds = totalRounds
        self.currentLoop = currentLoop
        self.currentStep = currentStep
        self.sessionID = sessionID
        self.status = status
        self.totalLoops = totalLoops
    }
}

// MARK: ProgressClass convenience initializers and mutators

public extension ProgressClass {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(ProgressClass.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        agentEmoji: String?? = nil,
        currentAgent: String?? = nil,
        message: String?? = nil,
        phase: Phase?? = nil,
        progress: Double?? = nil,
        roundNumber: Double?? = nil,
        totalRounds: Double?? = nil,
        currentLoop: Double?? = nil,
        currentStep: String?? = nil,
        sessionID: String?? = nil,
        status: String?? = nil,
        totalLoops: Double?? = nil
    ) -> ProgressClass {
        return ProgressClass(
            agentEmoji: agentEmoji ?? self.agentEmoji,
            currentAgent: currentAgent ?? self.currentAgent,
            message: message ?? self.message,
            phase: phase ?? self.phase,
            progress: progress ?? self.progress,
            roundNumber: roundNumber ?? self.roundNumber,
            totalRounds: totalRounds ?? self.totalRounds,
            currentLoop: currentLoop ?? self.currentLoop,
            currentStep: currentStep ?? self.currentStep,
            sessionID: sessionID ?? self.sessionID,
            status: status ?? self.status,
            totalLoops: totalLoops ?? self.totalLoops
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Phase: String, Codable {
    case complete = "complete"
    case discussing = "discussing"
    case reviewing = "reviewing"
    case selecting = "selecting"
    case synthesizing = "synthesizing"
}

/// MCP 도구 결과의 resource content (백엔드 external-tool-exec 가 추출해 emit).
// MARK: - MCPToolResource
public struct MCPToolResource: Codable {
    public let mimeType: String?
    public let text: String?
    public let uri: String

    public enum CodingKeys: String, CodingKey {
        case mimeType = "mimeType"
        case text = "text"
        case uri = "uri"
    }

    public init(mimeType: String?, text: String?, uri: String) {
        self.mimeType = mimeType
        self.text = text
        self.uri = uri
    }
}

// MARK: MCPToolResource convenience initializers and mutators

public extension MCPToolResource {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(MCPToolResource.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        mimeType: String?? = nil,
        text: String?? = nil,
        uri: String? = nil
    ) -> MCPToolResource {
        return MCPToolResource(
            mimeType: mimeType ?? self.mimeType,
            text: text ?? self.text,
            uri: uri ?? self.uri
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// 방금 기록된 스텝 요약(4-5 실시간 스트림) — "현재 단계" 라이브 표시용.
// MARK: - Step
public struct Step: Codable {
    public let preview: String?
    public let stepType: String
    public let toolName: String?

    public enum CodingKeys: String, CodingKey {
        case preview = "preview"
        case stepType = "stepType"
        case toolName = "toolName"
    }

    public init(preview: String?, stepType: String, toolName: String?) {
        self.preview = preview
        self.stepType = stepType
        self.toolName = toolName
    }
}

// MARK: Step convenience initializers and mutators

public extension Step {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Step.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        preview: String?? = nil,
        stepType: String? = nil,
        toolName: String?? = nil
    ) -> Step {
        return Step(
            preview: preview ?? self.preview,
            stepType: stepType ?? self.stepType,
            toolName: toolName ?? self.toolName
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum WsServerEventType: String, Codable {
    case aborted = "aborted"
    case agentSelected = "agent_selected"
    case agentTaskProgress = "agent_task_progress"
    case answerVerification = "answer_verification"
    case artifactChunk = "artifact_chunk"
    case artifactEnd = "artifact_end"
    case artifactStart = "artifact_start"
    case buildID = "build_id"
    case debugRetained = "debug_retained"
    case discussionProgress = "discussion_progress"
    case done = "done"
    case error = "error"
    case mcpToolResult = "mcp_tool_result"
    case mcpToolStart = "mcp_tool_start"
    case researchProgress = "research_progress"
    case resumeNone = "resume_none"
    case sessionCreated = "session_created"
    case skillsActivated = "skills_activated"
    case streamResume = "stream_resume"
    case systemEvent = "system_event"
    case thinking = "thinking"
    case thinkingSummary = "thinking_summary"
    case token = "token"
    case tokenWarning = "token_warning"
    case typeInit = "init"
}

// MARK: - WsChatRequest
public struct WsChatRequest: Codable {
    /// Browser-scoped anonymous owner id for guest sessions.
    public let anonSessionID: String?
    /// 아티팩트 모드 — ON 이면 모델이 <artifact> 산출물을 생성하도록 유도
    public let artifactMode: Bool?
    /// 클라이언트 표면 — 좁은 화면(모바일 네이티브)에 맞는 답변 형식을 요청할 때 'ios'. 미지정은 기존 동작(데스크톱 기준). 서버는 이 값으로
    /// answer-format 에 화면 폭 지시를 덧붙일 뿐, 내용/기능 분기는 하지 않는다.
    public let client: Client?
    public let deepResearchMode: Bool?
    /// 멀티 에이전트 토론 모드
    public let discussionMode: Bool?
    public let enabledTools: [String: Bool]?
    /// 첨부 텍스트 파일 — 백엔드가 fileContext 채널로 LLM 에 주입
    public let files: [WsAttachedFile]?
    public let history: [History]?
    /// 이미지 생성 모드 — ON 이면 메시지를 프롬프트로 이미지를 직접 생성
    public let imageMode: Bool?
    public let images: [String]?
    /// 개인정보: false 면 메모리 학습 비활성 (saveHistory 와 독립). 기본 true
    public let memoryLearning: Bool?
    public let message: String
    public let model: String?
    /// NotebookLM 노트북 컨텍스트 — composer picker 선택. 백엔드(ws-chat-handler)가 grounding 프리픽스를 주입
    public let notebook: Notebook?
    /// 개인정보: false 면 백엔드가 대화 기록 저장을 생략 (설정 페이지 토글). 기본 true
    public let saveHistory: Bool?
    public let sessionID: String?
    /// 응답 스타일 — 백엔드 chat/style.ts 가 system prompt 앞에 style guard 를 prepend (concise=간결,
    /// verbose=상세)
    public let style: Style?
    /// Sequential Thinking 모드 (UI thinkingEnabled 토글)
    public let thinkingMode: Bool?
    public let type: RequestType
    /// 커스텀 에이전트(user_agents) id — 지정 시 백엔드가 산업 에이전트 자동라우팅을 우회하고 해당 페르소나 system_prompt 를 prepend
    public let userAgentID: String?
    /// 기기 GPS 현재 위치 (폰 기능 2단계, 옵트인) — 클라이언트가 위치 관련 턴에만 첨부. 서버는 system 컨텍스트에 결정적 주입해 카카오
    /// search-places(x=lng, y=lat) 좌표 검색을 가능하게 한다. 저장하지 않는 턴 단위 값.
    public let userLocation: UserLocation?
    public let webSearch: Bool?

    public enum CodingKeys: String, CodingKey {
        case anonSessionID = "anonSessionId"
        case artifactMode = "artifactMode"
        case client = "client"
        case deepResearchMode = "deepResearchMode"
        case discussionMode = "discussionMode"
        case enabledTools = "enabledTools"
        case files = "files"
        case history = "history"
        case imageMode = "imageMode"
        case images = "images"
        case memoryLearning = "memoryLearning"
        case message = "message"
        case model = "model"
        case notebook = "notebook"
        case saveHistory = "saveHistory"
        case sessionID = "sessionId"
        case style = "style"
        case thinkingMode = "thinkingMode"
        case type = "type"
        case userAgentID = "userAgentId"
        case userLocation = "userLocation"
        case webSearch = "webSearch"
    }

    public init(anonSessionID: String?, artifactMode: Bool?, client: Client?, deepResearchMode: Bool?, discussionMode: Bool?, enabledTools: [String: Bool]?, files: [WsAttachedFile]?, history: [History]?, imageMode: Bool?, images: [String]?, memoryLearning: Bool?, message: String, model: String?, notebook: Notebook?, saveHistory: Bool?, sessionID: String?, style: Style?, thinkingMode: Bool?, type: RequestType, userAgentID: String?, userLocation: UserLocation?, webSearch: Bool?) {
        self.anonSessionID = anonSessionID
        self.artifactMode = artifactMode
        self.client = client
        self.deepResearchMode = deepResearchMode
        self.discussionMode = discussionMode
        self.enabledTools = enabledTools
        self.files = files
        self.history = history
        self.imageMode = imageMode
        self.images = images
        self.memoryLearning = memoryLearning
        self.message = message
        self.model = model
        self.notebook = notebook
        self.saveHistory = saveHistory
        self.sessionID = sessionID
        self.style = style
        self.thinkingMode = thinkingMode
        self.type = type
        self.userAgentID = userAgentID
        self.userLocation = userLocation
        self.webSearch = webSearch
    }
}

// MARK: WsChatRequest convenience initializers and mutators

public extension WsChatRequest {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WsChatRequest.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        anonSessionID: String?? = nil,
        artifactMode: Bool?? = nil,
        client: Client?? = nil,
        deepResearchMode: Bool?? = nil,
        discussionMode: Bool?? = nil,
        enabledTools: [String: Bool]?? = nil,
        files: [WsAttachedFile]?? = nil,
        history: [History]?? = nil,
        imageMode: Bool?? = nil,
        images: [String]?? = nil,
        memoryLearning: Bool?? = nil,
        message: String? = nil,
        model: String?? = nil,
        notebook: Notebook?? = nil,
        saveHistory: Bool?? = nil,
        sessionID: String?? = nil,
        style: Style?? = nil,
        thinkingMode: Bool?? = nil,
        type: RequestType? = nil,
        userAgentID: String?? = nil,
        userLocation: UserLocation?? = nil,
        webSearch: Bool?? = nil
    ) -> WsChatRequest {
        return WsChatRequest(
            anonSessionID: anonSessionID ?? self.anonSessionID,
            artifactMode: artifactMode ?? self.artifactMode,
            client: client ?? self.client,
            deepResearchMode: deepResearchMode ?? self.deepResearchMode,
            discussionMode: discussionMode ?? self.discussionMode,
            enabledTools: enabledTools ?? self.enabledTools,
            files: files ?? self.files,
            history: history ?? self.history,
            imageMode: imageMode ?? self.imageMode,
            images: images ?? self.images,
            memoryLearning: memoryLearning ?? self.memoryLearning,
            message: message ?? self.message,
            model: model ?? self.model,
            notebook: notebook ?? self.notebook,
            saveHistory: saveHistory ?? self.saveHistory,
            sessionID: sessionID ?? self.sessionID,
            style: style ?? self.style,
            thinkingMode: thinkingMode ?? self.thinkingMode,
            type: type ?? self.type,
            userAgentID: userAgentID ?? self.userAgentID,
            userLocation: userLocation ?? self.userLocation,
            webSearch: webSearch ?? self.webSearch
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum Client: String, Codable {
    case ios = "ios"
}

/// 첨부 텍스트 파일 (백엔드 ws-chat-handler files[] · attach-context AttachedFileInput 호환)
// MARK: - WsAttachedFile
public struct WsAttachedFile: Codable {
    /// 텍스트 내용 (바이너리는 미전송). 클라이언트가 캡 초과 시 절단
    public let content: String?
    /// 추출 대상 바이너리 문서(PDF/docx/xlsx/pptx 등)의 base64 원본. 백엔드가 텍스트로 추출해 content 를 채운다
    public let data: String?
    public let id: String
    public let name: String
    public let size: Double?
    /// 전송 전 캡으로 내용을 절단했음
    public let truncated: Bool?
    public let type: String

    public enum CodingKeys: String, CodingKey {
        case content = "content"
        case data = "data"
        case id = "id"
        case name = "name"
        case size = "size"
        case truncated = "truncated"
        case type = "type"
    }

    public init(content: String?, data: String?, id: String, name: String, size: Double?, truncated: Bool?, type: String) {
        self.content = content
        self.data = data
        self.id = id
        self.name = name
        self.size = size
        self.truncated = truncated
        self.type = type
    }
}

// MARK: WsAttachedFile convenience initializers and mutators

public extension WsAttachedFile {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(WsAttachedFile.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        content: String?? = nil,
        data: String?? = nil,
        id: String? = nil,
        name: String? = nil,
        size: Double?? = nil,
        truncated: Bool?? = nil,
        type: String? = nil
    ) -> WsAttachedFile {
        return WsAttachedFile(
            content: content ?? self.content,
            data: data ?? self.data,
            id: id ?? self.id,
            name: name ?? self.name,
            size: size ?? self.size,
            truncated: truncated ?? self.truncated,
            type: type ?? self.type
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - History
public struct History: Codable {
    public let content: String
    public let role: ChatRole

    public enum CodingKeys: String, CodingKey {
        case content = "content"
        case role = "role"
    }

    public init(content: String, role: ChatRole) {
        self.content = content
        self.role = role
    }
}

// MARK: History convenience initializers and mutators

public extension History {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(History.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        content: String? = nil,
        role: ChatRole? = nil
    ) -> History {
        return History(
            content: content ?? self.content,
            role: role ?? self.role
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

public enum ChatRole: String, Codable {
    case assistant = "assistant"
    case system = "system"
    case user = "user"
}

// MARK: - Notebook
public struct Notebook: Codable {
    public let id: String
    public let title: String

    public enum CodingKeys: String, CodingKey {
        case id = "id"
        case title = "title"
    }

    public init(id: String, title: String) {
        self.id = id
        self.title = title
    }
}

// MARK: Notebook convenience initializers and mutators

public extension Notebook {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(Notebook.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        id: String? = nil,
        title: String? = nil
    ) -> Notebook {
        return Notebook(
            id: id ?? self.id,
            title: title ?? self.title
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

/// 응답 스타일 — 백엔드 chat/style.ts 가 system prompt 앞에 style guard 를 prepend (concise=간결,
/// verbose=상세)
public enum Style: String, Codable {
    case concise = "concise"
    case styleDefault = "default"
    case verbose = "verbose"
}

public enum RequestType: String, Codable {
    case chat = "chat"
}

/// 기기 GPS 현재 위치 (폰 기능 2단계, 옵트인) — 클라이언트가 위치 관련 턴에만 첨부. 서버는 system 컨텍스트에 결정적 주입해 카카오
/// search-places(x=lng, y=lat) 좌표 검색을 가능하게 한다. 저장하지 않는 턴 단위 값.
// MARK: - UserLocation
public struct UserLocation: Codable {
    public let lat: Double
    public let lng: Double

    public enum CodingKeys: String, CodingKey {
        case lat = "lat"
        case lng = "lng"
    }

    public init(lat: Double, lng: Double) {
        self.lat = lat
        self.lng = lng
    }
}

// MARK: UserLocation convenience initializers and mutators

public extension UserLocation {
    init(data: Data) throws {
        self = try newJSONDecoder().decode(UserLocation.self, from: data)
    }

    init(_ json: String, using encoding: String.Encoding = .utf8) throws {
        guard let data = json.data(using: encoding) else {
            throw NSError(domain: "JSONDecoding", code: 0, userInfo: nil)
        }
        try self.init(data: data)
    }

    init(fromURL url: URL) throws {
        try self.init(data: try Data(contentsOf: url))
    }

    func with(
        lat: Double? = nil,
        lng: Double? = nil
    ) -> UserLocation {
        return UserLocation(
            lat: lat ?? self.lat,
            lng: lng ?? self.lng
        )
    }

    func jsonData() throws -> Data {
        return try newJSONEncoder().encode(self)
    }

    func jsonString(encoding: String.Encoding = .utf8) throws -> String? {
        return String(data: try self.jsonData(), encoding: encoding)
    }
}

// MARK: - Helper functions for creating encoders and decoders

func newJSONDecoder() -> JSONDecoder {
    let decoder = JSONDecoder()
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        decoder.dateDecodingStrategy = .iso8601
    }
    return decoder
}

func newJSONEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    if #available(iOS 10.0, OSX 10.12, tvOS 10.0, watchOS 3.0, *) {
        encoder.dateEncodingStrategy = .iso8601
    }
    return encoder
}

// MARK: - Encode/decode helpers

public class JSONNull: Codable, Hashable {

    public static func == (lhs: JSONNull, rhs: JSONNull) -> Bool {
        return true
    }

    public var hashValue: Int {
        return 0
    }

    public func hash(into hasher: inout Hasher) {
        // No-op
    }

    public init() {}

    public required init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if !container.decodeNil() {
            throw DecodingError.typeMismatch(JSONNull.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Wrong type for JSONNull"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encodeNil()
    }
}

class JSONCodingKey: CodingKey {
    let key: String

    required init?(intValue: Int) {
        return nil
    }

    required init?(stringValue: String) {
        key = stringValue
    }

    var intValue: Int? {
        return nil
    }

    var stringValue: String {
        return key
    }
}

public class JSONAny: Codable {

    public let value: Any

    static func decodingError(forCodingPath codingPath: [CodingKey]) -> DecodingError {
        let context = DecodingError.Context(codingPath: codingPath, debugDescription: "Cannot decode JSONAny")
        return DecodingError.typeMismatch(JSONAny.self, context)
    }

    static func encodingError(forValue value: Any, codingPath: [CodingKey]) -> EncodingError {
        let context = EncodingError.Context(codingPath: codingPath, debugDescription: "Cannot encode JSONAny")
        return EncodingError.invalidValue(value, context)
    }

    static func decode(from container: SingleValueDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if container.decodeNil() {
            return JSONNull()
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout UnkeyedDecodingContainer) throws -> Any {
        if let value = try? container.decode(Bool.self) {
            return value
        }
        if let value = try? container.decode(Int64.self) {
            return value
        }
        if let value = try? container.decode(Double.self) {
            return value
        }
        if let value = try? container.decode(String.self) {
            return value
        }
        if let value = try? container.decodeNil() {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer() {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decode(from container: inout KeyedDecodingContainer<JSONCodingKey>, forKey key: JSONCodingKey) throws -> Any {
        if let value = try? container.decode(Bool.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int64.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(String.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeNil(forKey: key) {
            if value {
                return JSONNull()
            }
        }
        if var container = try? container.nestedUnkeyedContainer(forKey: key) {
            return try decodeArray(from: &container)
        }
        if var container = try? container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key) {
            return try decodeDictionary(from: &container)
        }
        throw decodingError(forCodingPath: container.codingPath)
    }

    static func decodeArray(from container: inout UnkeyedDecodingContainer) throws -> [Any] {
        var arr: [Any] = []
        while !container.isAtEnd {
            let value = try decode(from: &container)
            arr.append(value)
        }
        return arr
    }

    static func decodeDictionary(from container: inout KeyedDecodingContainer<JSONCodingKey>) throws -> [String: Any] {
        var dict = [String: Any]()
        for key in container.allKeys {
            let value = try decode(from: &container, forKey: key)
            dict[key.stringValue] = value
        }
        return dict
    }

    static func encode(to container: inout UnkeyedEncodingContainer, array: [Any]) throws {
        for value in array {
            if let value = value as? Bool {
                try container.encode(value)
            } else if let value = value as? Int64 {
                try container.encode(value)
            } else if let value = value as? Double {
                try container.encode(value)
            } else if let value = value as? String {
                try container.encode(value)
            } else if value is JSONNull {
                try container.encodeNil()
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer()
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout KeyedEncodingContainer<JSONCodingKey>, dictionary: [String: Any]) throws {
        for (key, value) in dictionary {
            let key = JSONCodingKey(stringValue: key)!
            if let value = value as? Bool {
                try container.encode(value, forKey: key)
            } else if let value = value as? Int64 {
                try container.encode(value, forKey: key)
            } else if let value = value as? Double {
                try container.encode(value, forKey: key)
            } else if let value = value as? String {
                try container.encode(value, forKey: key)
            } else if value is JSONNull {
                try container.encodeNil(forKey: key)
            } else if let value = value as? [Any] {
                var container = container.nestedUnkeyedContainer(forKey: key)
                try encode(to: &container, array: value)
            } else if let value = value as? [String: Any] {
                var container = container.nestedContainer(keyedBy: JSONCodingKey.self, forKey: key)
                try encode(to: &container, dictionary: value)
            } else {
                throw encodingError(forValue: value, codingPath: container.codingPath)
            }
        }
    }

    static func encode(to container: inout SingleValueEncodingContainer, value: Any) throws {
        if let value = value as? Bool {
            try container.encode(value)
        } else if let value = value as? Int64 {
            try container.encode(value)
        } else if let value = value as? Double {
            try container.encode(value)
        } else if let value = value as? String {
            try container.encode(value)
        } else if value is JSONNull {
            try container.encodeNil()
        } else {
            throw encodingError(forValue: value, codingPath: container.codingPath)
        }
    }

    public required init(from decoder: Decoder) throws {
        if var arrayContainer = try? decoder.unkeyedContainer() {
            self.value = try JSONAny.decodeArray(from: &arrayContainer)
        } else if var container = try? decoder.container(keyedBy: JSONCodingKey.self) {
            self.value = try JSONAny.decodeDictionary(from: &container)
        } else {
            let container = try decoder.singleValueContainer()
            self.value = try JSONAny.decode(from: container)
        }
    }

    public func encode(to encoder: Encoder) throws {
        if let arr = self.value as? [Any] {
            var container = encoder.unkeyedContainer()
            try JSONAny.encode(to: &container, array: arr)
        } else if let dict = self.value as? [String: Any] {
            var container = encoder.container(keyedBy: JSONCodingKey.self)
            try JSONAny.encode(to: &container, dictionary: dict)
        } else {
            var container = encoder.singleValueContainer()
            try JSONAny.encode(to: &container, value: self.value)
        }
    }
}
