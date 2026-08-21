// OpenMakeKit — WS 채팅 소켓 (축 3 Step 4)
//
// 핸드셰이크: Authorization Bearer (서버 ws-auth 가 Cookie/Bearer 겸용 — 축 2 실측).
// 수신 프레임은 반드시 WsEventDecoder(미지 이벤트 무시)로 디코드한다.
// 재연결 정책은 호출자(앱 모델) 책임 — 스트림 종료 시 재연결 + 이력 재조회 (plan §6).
import Foundation

public actor WsChatSocket {
    public enum SocketError: Error, Sendable {
        case notConnected
        case invalidURL
    }

    private let serverURL: URL
    private let session: URLSession
    private var task: URLSessionWebSocketTask?
    private var continuation: AsyncStream<WsServerEvent>.Continuation?

    /// 첫 프레임까지 대기 상한. 이미지 생성(FLUX)·딥리서치는 수십 초간 서버→클라 프레임이
    /// 전혀 없다 — URLSession 기본 60s 로는 그 구간에서 조용히 끊겨 "응답이 오지 않는" 증상이
    /// 된다 (2026-08-17 실측: 이미지 생성 50s+). 넉넉히 잡되 무한 대기는 피한다.
    public static let requestTimeout: TimeInterval = 300
    public static let resourceTimeout: TimeInterval = 900

    public init(serverURL: URL, session: URLSession? = nil) {
        self.serverURL = serverURL
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = Self.requestTimeout
            config.timeoutIntervalForResource = Self.resourceTimeout
            config.waitsForConnectivity = true
            self.session = URLSession(configuration: config)
        }
    }

    public var isConnected: Bool { task != nil }

    /// 연결 + 이벤트 스트림 시작. 연결 종료(오류 포함) 시 스트림이 finish 된다.
    public func connect(bearer: String) throws -> AsyncStream<WsServerEvent> {
        disconnect()

        guard var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else {
            throw SocketError.invalidURL
        }
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        guard let url = components.url else { throw SocketError.invalidURL }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        // 서버 WS 가드는 Origin 부재를 거절한다 (isOriginAllowed — 브라우저 CSWSH 방어).
        // 네이티브 클라이언트는 위협 모델 밖이므로 서버 origin 을 명시해 allowlist 를 통과한다.
        if let origin = serverOrigin() {
            request.setValue(origin, forHTTPHeaderField: "Origin")
        }

        let socketTask = session.webSocketTask(with: request)
        task = socketTask

        let (stream, streamContinuation) = AsyncStream<WsServerEvent>.makeStream()
        continuation = streamContinuation
        socketTask.resume()
        startReceiveLoop(socketTask)
        return stream
    }

    /// 채팅 요청 전송 (계약: WsChatRequest JSON 텍스트 프레임)
    public func send(_ chatRequest: WsChatRequest) async throws {
        guard let task else { throw SocketError.notConnected }
        let data = try JSONEncoder().encode(chatRequest)
        guard let text = String(data: data, encoding: .utf8) else { throw SocketError.notConnected }
        try await task.send(.string(text))
    }

    /// 진행 중 생성 중단 요청 — 서버(handler.ts 'abort')가 aborted 이벤트로 응답한다.
    public func abort() async {
        guard let task else { return }
        try? await task.send(.string(#"{"type":"abort"}"#))
    }

    public func disconnect() {
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        continuation?.finish()
        continuation = nil
    }

    private func serverOrigin() -> String? {
        guard let components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false),
              let scheme = components.scheme, let host = components.host else { return nil }
        let port = components.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    private func startReceiveLoop(_ socketTask: URLSessionWebSocketTask) {
        Task { [weak self] in
            while true {
                do {
                    let message = try await socketTask.receive()
                    let data: Data?
                    switch message {
                    case .string(let text): data = text.data(using: .utf8)
                    case .data(let raw): data = raw
                    @unknown default: data = nil
                    }
                    // 미지 이벤트/비정상 프레임은 규약대로 무시 (forward-compat)
                    if let data, let event = WsEventDecoder.decode(data) {
                        await self?.yield(event)
                    }
                } catch {
                    await self?.handleClosed()
                    return
                }
            }
        }
    }

    private func yield(_ event: WsServerEvent) {
        continuation?.yield(event)
    }

    private func handleClosed() {
        task = nil
        continuation?.finish()
        continuation = nil
    }
}

public extension WsChatRequest {
    /// 채팅 요청 빌더 — 모드 토글은 계약 필드 그대로 노출 (nil = 서버 기본)
    static func chat(
        message: String,
        sessionId: String? = nil,
        model: String? = nil,
        history: [History] = [],
        images: [String]? = nil,
        files: [WsAttachedFile]? = nil,
        webSearch: Bool? = nil,
        thinkingMode: Bool? = nil,
        imageMode: Bool? = nil,
        artifactMode: Bool? = nil,
        discussionMode: Bool? = nil,
        deepResearchMode: Bool? = nil,
        style: Style? = nil,
        saveHistory: Bool? = nil,
        memoryLearning: Bool? = nil,
        userAgentId: String? = nil,
        userLocation: UserLocation? = nil
    ) -> WsChatRequest {
        WsChatRequest(
            anonSessionID: nil,
            artifactMode: artifactMode,
            // 좁은 화면 표면 — 서버가 답변 형식에 폭 제약(표 3열 이하·짧은 문단)을 덧붙인다
            client: .ios,
            deepResearchMode: deepResearchMode,
            discussionMode: discussionMode,
            enabledTools: nil,
            files: files,
            history: history.isEmpty ? nil : history,
            imageMode: imageMode,
            images: images,
            memoryLearning: memoryLearning,
            message: message,
            model: model,
            notebook: nil,
            saveHistory: saveHistory,
            sessionID: sessionId,
            style: style,
            thinkingMode: thinkingMode,
            type: .chat,
            userAgentID: userAgentId,
            userLocation: userLocation,
            webSearch: webSearch)
    }
}
