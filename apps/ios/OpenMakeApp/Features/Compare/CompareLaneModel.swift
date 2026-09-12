// 모델 비교 레인 — 레인마다 독립 소켓·세션·히스토리(웹 lib/use-compare-lane 과 같은 규약).
// 서버는 `lane` 필드로 같은 사용자의 두 스트림을 구분하므로 반드시 실어 보낸다.
import Foundation
import Observation
import OpenMakeKit

@MainActor
@Observable
final class CompareLaneModel {
    struct Message: Identifiable, Equatable {
        let id = UUID()
        let role: String
        var content: String
        var thinking: String = ""
        var isStreaming = false
        var error: String?
        /// 서버가 실제로 응답한 모델(폴백 시 다름) — system_event model_fallback
        var servedModel: String?
    }

    let lane: String
    private let client: OpenMakeClient
    private let socket: WsChatSocket
    private var events: AsyncStream<WsServerEvent>?

    private(set) var messages: [Message] = []
    private(set) var isStreaming = false
    private(set) var sessionId: String?

    init(lane: String, client: OpenMakeClient, serverURL: URL) {
        self.lane = lane
        self.client = client
        self.socket = WsChatSocket(serverURL: serverURL)
    }

    var lastServedModel: String? {
        messages.last { $0.role == "assistant" && $0.servedModel != nil }?.servedModel
    }

    func send(_ prompt: String, model: String?, thinking: Bool) async {
        // history 는 이번 사용자 메시지 직전까지 — 본문이 빈 assistant(첫 토큰 전 중단)는 제외
        // (외부 provider 가 빈 assistant 로 400 을 낸다 — 웹과 동일)
        let history = messages
            .filter { $0.error == nil && !($0.role == "assistant" && $0.content.trimmingCharacters(in: .whitespaces).isEmpty) }
            .map { History(content: $0.content, role: ChatRole(rawValue: $0.role) ?? .user) }
        messages.append(Message(role: "user", content: prompt))
        messages.append(Message(role: "assistant", content: "", isStreaming: true))
        isStreaming = true
        defer {
            isStreaming = false
            if let index = messages.indices.last { messages[index].isStreaming = false }
        }

        guard let bearer = await client.accessToken else {
            setError("로그인이 필요합니다")
            return
        }
        do {
            var stream: AsyncStream<WsServerEvent>
            if await socket.isConnected, let current = events {
                stream = current
            } else {
                stream = try await socket.connect(bearer: bearer)
                events = stream
            }
            try await socket.send(.chat(
                message: prompt,
                sessionId: sessionId,
                model: model,
                history: history,
                thinkingMode: thinking ? true : nil,
                lane: lane))

            var finished = false
            for await event in stream {
                switch event.type {
                case .token:
                    patchLast { $0.content += event.token ?? "" }
                case .thinking:
                    patchLast { $0.thinking += event.token ?? event.thinking ?? "" }
                case .sessionCreated:
                    sessionId = event.sessionID
                case .systemEvent:
                    // 모델 폴백 고지 — 실제 응답 모델을 레인 헤더에 표시
                    if event.payload?.type == "model_fallback",
                       let to = event.payload?.metadata?["to"]?.value as? String {
                        patchLast { $0.servedModel = to }
                    }
                case .done:
                    if let cleaned = event.cleanedContent { patchLast { $0.content = cleaned } }
                    finished = true
                case .aborted:
                    finished = true
                case .error:
                    setError(event.message ?? event.errorType ?? "오류가 발생했습니다")
                    finished = true
                case .tokenWarning:
                    Task { try? await client.refresh() }
                default:
                    break
                }
                if finished { break }
            }
            if !finished {
                setError("응답이 중간에 끊겼어요")
            }
        } catch {
            setError("연결에 실패했습니다")
        }
    }

    func stop() async {
        guard isStreaming else { return }
        await socket.abort()
    }

    func reset() {
        messages = []
        sessionId = nil
        events = nil
        Task { [socket] in await socket.disconnect() }
    }

    func teardown() {
        Task { [socket] in await socket.disconnect() }
    }

    private func patchLast(_ change: (inout Message) -> Void) {
        guard let index = messages.indices.last, messages[index].role == "assistant" else { return }
        change(&messages[index])
    }

    private func setError(_ text: String) {
        patchLast { $0.error = text }
    }
}
