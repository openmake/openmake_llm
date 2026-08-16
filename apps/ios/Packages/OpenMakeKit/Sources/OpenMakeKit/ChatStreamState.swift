// OpenMakeKit — 채팅 스트림 리듀서 (축 3 Step 4)
// WS 이벤트 → 화면 상태의 순수 축약 로직. UI 와 분리해 단위 테스트 가능하게 Kit 에 둔다.
// MVP 소비 부분집합(plan §3)만 처리 — 그 외 이벤트는 무해하게 무시.
import Foundation

public struct ChatStreamMetrics: Equatable, Sendable {
    public let tokenCount: Double
    public let tokensPerSec: String
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

    public init() {}

    public mutating func apply(_ event: WsServerEvent) {
        switch event.type {
        case .token:
            isThinking = false
            statusText = nil
            streamingText += event.token ?? ""
        case .thinking:
            isThinking = true
        case .mcpToolStart:
            statusText = event.toolName.map { "도구 실행 중 · \($0)" } ?? "도구 실행 중…"
        case .mcpToolResult:
            statusText = nil
        case .researchProgress:
            statusText = event.message ?? "딥리서치 진행 중…"
        case .discussionProgress:
            statusText = event.message ?? "토론 진행 중…"
        case .artifactStart:
            statusText = "아티팩트 생성 중…"
        case .artifactEnd:
            statusText = nil
        case .sessionCreated:
            sessionId = event.sessionID
        case .done:
            isDone = true
            isThinking = false
            if let raw = event.metrics {
                metrics = ChatStreamMetrics(tokenCount: raw.tokenCount, tokensPerSec: raw.tokensPerSEC)
            }
        case .aborted:
            isDone = true
            isThinking = false
        case .error:
            errorMessage = event.message ?? event.errorType ?? "오류가 발생했습니다"
            isDone = true
            isThinking = false
        case .tokenWarning:
            needsTokenRefresh = true
        default:
            break // build_id·debug_retained·agent_selected 등 — MVP 범위 밖, 무시
        }
    }
}
