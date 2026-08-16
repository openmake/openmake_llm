// OpenMakeClient 인증 코어 테스트 (축 3 Step 2)
// MockURLProtocol 로 서버를 대역화 — CSRF 부트스트랩, 로그인 토큰 저장,
// 401→refresh 회전→재시도, refresh 실패 시 세션 폐기를 검증한다.
import XCTest
@testable import OpenMakeKit

/// path 기반 스크립트 응답 — 같은 path 는 큐 순서대로 소비
final class MockURLProtocol: URLProtocol {
    struct Scripted {
        let status: Int
        let json: String
    }

    nonisolated(unsafe) static var scripts: [String: [Scripted]] = [:]
    nonisolated(unsafe) static var recorded: [URLRequest] = []
    static let lock = NSLock()

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        scripts = [:]
        recorded = []
    }

    static func script(_ path: String, _ responses: Scripted...) {
        lock.lock(); defer { lock.unlock() }
        scripts[path, default: []].append(contentsOf: responses)
    }

    static func requests(to path: String) -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return recorded.filter { $0.url?.path == path }
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.recorded.append(request)
        let path = request.url?.path ?? ""
        let scripted = Self.scripts[path]?.isEmpty == false ? Self.scripts[path]?.removeFirst() : nil
        Self.lock.unlock()

        guard let scripted else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: scripted.status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: scripted.json.data(using: .utf8)!)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class OpenMakeClientTests: XCTestCase {
    private var store: InMemoryTokenStore!
    private var client: OpenMakeClient!

    private static let userJSON = #"{"id":"u1","email":"riskpw@gmail.com","role":"user","created_at":"2026-08-16T00:00:00.000Z","is_active":true}"#
    private static let meta = #"{"timestamp":"2026-08-16T00:00:00.000Z"}"#

    override func setUp() {
        super.setUp()
        MockURLProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MockURLProtocol.self]
        store = InMemoryTokenStore()
        client = OpenMakeClient(
            configuration: .init(serverURL: URL(string: "https://chat.openmake.cc")!),
            tokenStore: store,
            session: URLSession(configuration: config))
    }

    private func scriptCsrf() {
        MockURLProtocol.script("/api/csrf-token", .init(status: 200, json: #"{"token":"csrf-1"}"#))
    }

    func testLoginStoresTokensAndSendsCsrfHeader() async throws {
        scriptCsrf()
        MockURLProtocol.script("/api/auth/login", .init(status: 200, json:
            #"{"success":true,"data":{"success":true,"token":"at-1","refreshToken":"rt-1","user":\#(Self.userJSON)},"meta":\#(Self.meta)}"#))

        let user = try await client.login(email: "riskpw@gmail.com", password: "pw")
        XCTAssertEqual(user.email, "riskpw@gmail.com")
        XCTAssertEqual(store.load(), AuthTokens(access: "at-1", refresh: "rt-1"))

        // CSRF Double-Submit 규약: 사전 인증 POST 에 부트스트랩 토큰 헤더 동봉
        let loginRequest = MockURLProtocol.requests(to: "/api/auth/login").first
        XCTAssertEqual(loginRequest?.value(forHTTPHeaderField: "X-CSRF-Token"), "csrf-1")
    }

    func testMeRetriesOnceAfterRefreshRotation() async throws {
        store.save(AuthTokens(access: "at-old", refresh: "rt-old"))
        scriptCsrf()
        MockURLProtocol.script("/api/auth/me",
            .init(status: 401, json: #"{"success":false,"error":{"code":"UNAUTHORIZED","message":"만료"},"meta":\#(Self.meta)}"#),
            .init(status: 200, json: #"{"success":true,"data":{"user":\#(Self.userJSON)},"meta":\#(Self.meta)}"#))
        MockURLProtocol.script("/api/auth/refresh", .init(status: 200, json:
            #"{"success":true,"data":{"token":"at-new","refreshToken":"rt-new","user":\#(Self.userJSON)},"meta":\#(Self.meta)}"#))

        let user = try await client.me()
        XCTAssertEqual(user?.id, "u1")
        // 회전된 토큰이 저장되고, 재시도 요청은 새 access 를 사용
        XCTAssertEqual(store.load(), AuthTokens(access: "at-new", refresh: "rt-new"))
        let meRequests = MockURLProtocol.requests(to: "/api/auth/me")
        XCTAssertEqual(meRequests.count, 2)
        XCTAssertEqual(meRequests[0].value(forHTTPHeaderField: "Authorization"), "Bearer at-old")
        XCTAssertEqual(meRequests[1].value(forHTTPHeaderField: "Authorization"), "Bearer at-new")
        // refresh 는 body 모드 (축 2) — 쿠키가 아닌 body 로 구 refresh 전달
        let refreshRequest = MockURLProtocol.requests(to: "/api/auth/refresh").first
        XCTAssertNotNil(refreshRequest)
    }

    func testRefreshFailureClearsSession() async throws {
        store.save(AuthTokens(access: "at-old", refresh: "rt-dead"))
        scriptCsrf()
        MockURLProtocol.script("/api/auth/me",
            .init(status: 401, json: #"{"success":false,"error":{"code":"UNAUTHORIZED","message":"만료"},"meta":\#(Self.meta)}"#))
        MockURLProtocol.script("/api/auth/refresh",
            .init(status: 401, json: #"{"success":false,"error":{"code":"UNAUTHORIZED","message":"무효"},"meta":\#(Self.meta)}"#))

        do {
            _ = try await client.me()
            XCTFail("notAuthenticated 이어야 함")
        } catch let error as OpenMakeAPIError {
            XCTAssertEqual(error, .notAuthenticated)
        }
        XCTAssertNil(store.load(), "refresh 실패 시 세션 폐기 (재로그인 유도)")
    }

    func testExchangeStoresTokens() async throws {
        scriptCsrf()
        MockURLProtocol.script("/api/auth/mobile/exchange", .init(status: 200, json:
            #"{"success":true,"data":{"token":"at-x","refreshToken":"rt-x","user":\#(Self.userJSON)},"meta":\#(Self.meta)}"#))

        let user = try await client.exchange(code: String(repeating: "a", count: 64))
        XCTAssertEqual(user.id, "u1")
        XCTAssertEqual(store.load(), AuthTokens(access: "at-x", refresh: "rt-x"))
    }

    func testLogoutClearsLocalTokensEvenIfServerFails() async {
        store.save(AuthTokens(access: "at", refresh: "rt"))
        MockURLProtocol.script("/api/auth/logout",
            .init(status: 500, json: #"{"success":false,"error":{"code":"INTERNAL","message":"err"},"meta":\#(Self.meta)}"#))
        await client.logout()
        XCTAssertNil(store.load())
    }

    func testSessionsListDecodesWithBearerAndLimit() async throws {
        store.save(AuthTokens(access: "at", refresh: "rt"))
        MockURLProtocol.script("/api/chat/sessions", .init(status: 200, json:
            #"{"success":true,"data":{"sessions":[{"id":"s1","userId":"u1","title":"테스트 대화","createdAt":"2026-08-16T00:00:00.000Z","updatedAt":"2026-08-16T01:00:00.000Z","messageCount":4,"model":"local-llm:m1"}]},"meta":\#(Self.meta)}"#))

        let sessions = try await client.sessions(limit: 20)
        XCTAssertEqual(sessions.count, 1)
        XCTAssertEqual(sessions.first?.title, "테스트 대화")
        let request = MockURLProtocol.requests(to: "/api/chat/sessions").first
        XCTAssertEqual(request?.value(forHTTPHeaderField: "Authorization"), "Bearer at")
        XCTAssertEqual(request?.url?.query, "limit=20")
    }

    func testMessagesDecodes() async throws {
        store.save(AuthTokens(access: "at", refresh: "rt"))
        MockURLProtocol.script("/api/chat/sessions/s1/messages", .init(status: 200, json:
            #"{"success":true,"data":{"messages":[{"role":"user","content":"안녕"},{"role":"assistant","content":"안녕하세요","model":"local-llm:m1","tokens":10}]},"meta":\#(Self.meta)}"#))

        let messages = try await client.messages(sessionId: "s1")
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(messages.last?.role, .assistant)
    }

    func testDeleteSessionUsesDeleteMethod() async throws {
        store.save(AuthTokens(access: "at", refresh: "rt"))
        MockURLProtocol.script("/api/chat/sessions/s1", .init(status: 200, json:
            #"{"success":true,"data":{"deleted":true},"meta":\#(Self.meta)}"#))
        try await client.deleteSession(id: "s1")
        XCTAssertEqual(MockURLProtocol.requests(to: "/api/chat/sessions/s1").first?.httpMethod, "DELETE")
    }

    func testModelCatalogDecodes() async throws {
        store.save(AuthTokens(access: "at", refresh: "rt"))
        MockURLProtocol.script("/api/models", .init(status: 200, json:
            #"{"success":true,"data":{"defaultModel":"local-llm:m1","models":[{"name":"M1","modelId":"local-llm:m1","description":"로컬","provider":"local-llm","capabilities":{"executionStrategy":"single","thinking":"medium","discussion":false,"vision":true,"toolCalling":true,"streaming":true}}],"imageModel":null},"meta":\#(Self.meta)}"#))

        let catalog = try await client.modelCatalog()
        XCTAssertEqual(catalog.defaultModel, "local-llm:m1")
        XCTAssertEqual(catalog.models.first?.capabilities.vision, true)
        XCTAssertNil(catalog.imageModel)
    }

    func testUserAgentsDecodes() async throws {
        store.save(AuthTokens(access: "at", refresh: "rt"))
        MockURLProtocol.script("/api/users/me/agents", .init(status: 200, json:
            #"{"success":true,"data":{"agents":[{"id":"a1","name":"도우미","description":null,"system_prompt":"p","icon":"🤖","model":null,"visibility":"private","is_active":true,"created_at":"2026-08-16T00:00:00.000Z","updated_at":"2026-08-16T00:00:00.000Z"}]},"meta":\#(Self.meta)}"#))

        let agents = try await client.userAgents()
        XCTAssertEqual(agents.first?.name, "도우미")
        XCTAssertEqual(agents.first?.icon, "🤖")
    }

    func testNoSessionThrowsNotAuthenticated() async {
        do {
            _ = try await client.me()
            XCTFail("notAuthenticated 이어야 함")
        } catch let error as OpenMakeAPIError {
            XCTAssertEqual(error, .notAuthenticated)
        } catch {
            XCTFail("예상 밖 에러: \(error)")
        }
    }
}
