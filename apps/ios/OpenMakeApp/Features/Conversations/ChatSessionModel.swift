// 채팅 세션 모델 (축 3 Step 4) — 이력 + WS 스트리밍 상태.
// 이벤트 축약은 Kit 의 ChatStreamState(단위 테스트됨), 여기는 화면 상태 배선만.
import Foundation
import Observation
import OpenMakeKit

@MainActor
@Observable
final class ChatSessionModel {
    private let client: OpenMakeClient
    private let socket: WsChatSocket
    private(set) var sessionId: String?

    private(set) var messages: [OpenMakeClient.ChatMessage] = []
    private(set) var streamingText = ""
    private(set) var isThinking = false
    private(set) var isStreaming = false
    private(set) var errorMessage: String?

    init(client: OpenMakeClient, serverURL: URL, sessionId: String?) {
        self.client = client
        self.socket = WsChatSocket(serverURL: serverURL)
        self.sessionId = sessionId
    }

    func loadHistory() async {
        guard let sessionId else { return }
        do {
            messages = try await client.messages(sessionId: sessionId)
        } catch {
            errorMessage = "이력을 불러오지 못했습니다"
        }
    }

    func send(
        _ text: String,
        model: String? = nil,
        userAgentId: String? = nil,
        images: [String] = [],
        files: [WsAttachedFile] = []
    ) async {
        errorMessage = nil
        messages.append(.init(
            role: .user, content: text, model: nil, tokens: nil,
            images: images.isEmpty ? nil : images, created_at: nil))
        isStreaming = true
        defer { isStreaming = false }

        do {
            guard let bearer = await client.accessToken else {
                errorMessage = "로그인이 필요합니다"
                return
            }
            // 연결이 없으면 (재)연결 — 스트림 종료 시 다음 send 에서 재연결 (plan: 재연결+이력 재조회 단순화)
            let events: AsyncStream<WsServerEvent>
            if await socket.isConnected, let current = currentEvents {
                events = current
            } else {
                events = try await socket.connect(bearer: bearer)
                currentEvents = events
            }

            let history = messages.dropLast().suffix(20).map {
                History(content: $0.content, role: ChatRole(rawValue: $0.role.rawValue) ?? .user)
            }
            try await socket.send(.chat(
                message: text,
                sessionId: sessionId,
                model: model,
                history: Array(history),
                images: images.isEmpty ? nil : images,
                files: files.isEmpty ? nil : files,
                userAgentId: userAgentId))

            var state = ChatStreamState()
            for await event in events {
                state.apply(event)
                streamingText = state.streamingText
                isThinking = state.isThinking
                if let sid = state.sessionId { sessionId = sid }
                if state.needsTokenRefresh {
                    // 웹과 동일 규약: REST refresh — 다음 재연결이 새 토큰 사용
                    Task { try? await client.refresh() }
                }
                if state.isDone { break }
            }

            if let error = state.errorMessage {
                errorMessage = error
            }
            finalizeAssistantMessage()
        } catch {
            errorMessage = "연결에 실패했습니다"
            finalizeAssistantMessage()
        }
    }

    func teardown() {
        Task { [socket] in await socket.disconnect() }
    }

    private var currentEvents: AsyncStream<WsServerEvent>?

    private func finalizeAssistantMessage() {
        if !streamingText.isEmpty {
            messages.append(.init(
                role: .assistant, content: streamingText,
                model: nil, tokens: nil, images: nil, created_at: nil))
        }
        streamingText = ""
        isThinking = false
    }
}
