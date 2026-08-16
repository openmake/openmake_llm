// OpenMakeKit — API 클라이언트 (축 3 Step 2)
//
// 서버 계약 규약:
//  - 인증 후 요청 = Bearer (CSRF 면제). access 만료(401) 시 refresh 1회 후 재시도.
//  - 사전 인증 POST(login/refresh/exchange) = CSRF Double-Submit —
//    GET /api/csrf-token 부트스트랩 후 쿠키(URLSession jar) + X-CSRF-Token 헤더.
//  - refresh 는 body 모드(축 2): body.refreshToken 전달 → 회전된 토큰을 body 로 수신.
//  - 모든 REST 디코딩은 OpenMakeJSON.decoder() (date-time 규약).
import Foundation

public struct OpenMakeClientConfiguration: Sendable {
    public var serverURL: URL

    public init(serverURL: URL) {
        self.serverURL = serverURL
    }
}

public enum OpenMakeAPIError: Error, Sendable, Equatable {
    /// 저장된 세션 없음 또는 refresh 실패 — 재로그인 필요
    case notAuthenticated
    /// 서버 에러 envelope (ApiFailure)
    case server(status: Int, code: String?, message: String?)
    /// HTTP 응답 형식 불일치
    case invalidResponse
}

public actor OpenMakeClient {
    public typealias PublicUser = Components.Schemas.PublicUser

    private let config: OpenMakeClientConfiguration
    private let session: URLSession
    private let tokenStore: TokenStore
    private var csrfToken: String?
    /// refresh 단일 비행 — 동시 401 이 중복 회전(구 토큰 재사용 401 연쇄)을 일으키지 않게
    private var refreshTask: Task<Void, Error>?

    public init(
        configuration: OpenMakeClientConfiguration,
        tokenStore: TokenStore,
        session: URLSession? = nil
    ) {
        self.config = configuration
        self.tokenStore = tokenStore
        self.session = session ?? URLSession(configuration: .ephemeral)
    }

    public var isAuthenticated: Bool { tokenStore.load() != nil }

    /// WS 핸드셰이크(Bearer) 등 외부 전송 계층용 현재 access token
    public var accessToken: String? { tokenStore.load()?.access }

    // MARK: - Auth API

    /// 이메일/비밀번호 로그인 (모바일 모드 — returnRefreshToken) → 토큰 저장
    @discardableResult
    public func login(email: String, password: String) async throws -> PublicUser {
        let body = Operations.post_sol_api_sol_auth_sol_login.Input.Body.jsonPayload(
            email: email, password: password, returnRefreshToken: true)
        let (data, _) = try await send(post: "/api/auth/login", body: body, csrf: true)
        let payload = try decodeContract(
            Operations.post_sol_api_sol_auth_sol_login.Output.Ok.Body.jsonPayload.self, from: data)
        guard let access = payload.data.token,
              let refresh = payload.data.refreshToken,
              let user = payload.data.user else {
            throw OpenMakeAPIError.invalidResponse
        }
        tokenStore.save(AuthTokens(access: access, refresh: refresh))
        return user
    }

    /// OAuth exchange code → 토큰 교환 (축 2 — `openmake://auth/callback?code=` 수신 후 호출)
    @discardableResult
    public func exchange(code: String) async throws -> PublicUser {
        struct ExchangeRequest: Encodable { let code: String }
        let (data, _) = try await send(post: "/api/auth/mobile/exchange", body: ExchangeRequest(code: code), csrf: true)
        let payload = try decodeContract(
            Operations.post_sol_api_sol_auth_sol_mobile_sol_exchange.Output.Ok.Body.jsonPayload.self,
            from: data)
        tokenStore.save(AuthTokens(access: payload.data.token, refresh: payload.data.refreshToken))
        return payload.data.user
    }

    /// 서버에 설정된 OAuth 프로바이더 id 목록 (사전 인증 GET)
    public func oauthProviders() async throws -> [String] {
        struct ProvidersPayload: Decodable { let providers: [String] }
        struct Envelope: Decodable { let data: ProvidersPayload }
        let (data, _) = try await perform(method: "GET", path: "/api/auth/providers")
        return try decodeContract(Envelope.self, from: data).data.providers
    }

    /// 현재 사용자 조회 (Bearer, 401 시 refresh 1회 재시도). 게스트 규약(user:null)은 nil.
    public func me() async throws -> PublicUser? {
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/auth/me")
        let payload = try decodeContract(
            Operations.get_sol_api_sol_auth_sol_me.Output.Ok.Body.jsonPayload.self, from: data)
        // 계약의 user 는 oneOf(PublicUser | null) — null 브랜치(case2)는 게스트로 nil 처리
        switch payload.data.user {
        case .PublicUser(let user): return user
        case .case2, .none: return nil
        }
    }

    /// 로그아웃 — 서버 블랙리스트(access + body refresh) 후 로컬 토큰 폐기.
    /// 서버 호출이 실패해도 로컬은 반드시 비운다 (fail-safe).
    public func logout() async {
        defer { tokenStore.clear() }
        guard let tokens = tokenStore.load() else { return }
        struct LogoutRequest: Encodable { let refreshToken: String }
        _ = try? await authorizedSend(
            method: "POST", path: "/api/auth/logout",
            body: LogoutRequest(refreshToken: tokens.refresh))
    }

    /// refresh 회전 (body 모드) — 실패 시 토큰 폐기 + notAuthenticated
    public func refresh() async throws {
        if let running = refreshTask {
            return try await running.value
        }
        let task = Task { [weak self] in
            guard let self else { return }
            try await self.performRefresh()
        }
        refreshTask = task
        defer { refreshTask = nil }
        return try await task.value
    }

    private func performRefresh() async throws {
        guard let tokens = tokenStore.load() else { throw OpenMakeAPIError.notAuthenticated }
        struct RefreshRequest: Encodable { let refreshToken: String }
        do {
            let (data, _) = try await send(
                post: "/api/auth/refresh", body: RefreshRequest(refreshToken: tokens.refresh), csrf: true)
            let payload = try decodeContract(
                Operations.post_sol_api_sol_auth_sol_refresh.Output.Ok.Body.jsonPayload.self, from: data)
            guard let newRefresh = payload.data.refreshToken else {
                throw OpenMakeAPIError.invalidResponse
            }
            tokenStore.save(AuthTokens(access: payload.data.token, refresh: newRefresh))
        } catch let error as OpenMakeAPIError {
            if case .server(let status, _, _) = error, status == 401 {
                tokenStore.clear()
                throw OpenMakeAPIError.notAuthenticated
            }
            throw error
        }
    }

    // MARK: - Transport

    /// Bearer 요청 + 401 시 refresh 1회 후 재시도
    func authorizedSend(
        method: String, path: String, body: (any Encodable)? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        guard let tokens = tokenStore.load() else { throw OpenMakeAPIError.notAuthenticated }
        do {
            return try await perform(method: method, path: path, body: body, bearer: tokens.access)
        } catch let error as OpenMakeAPIError {
            guard case .server(401, _, _) = error else { throw error }
            try await refresh()
            guard let rotated = tokenStore.load() else { throw OpenMakeAPIError.notAuthenticated }
            return try await perform(method: method, path: path, body: body, bearer: rotated.access)
        }
    }

    /// 사전 인증 POST — CSRF 부트스트랩 동반
    private func send(
        post path: String, body: any Encodable, csrf: Bool
    ) async throws -> (Data, HTTPURLResponse) {
        var csrfHeader: String?
        if csrf {
            csrfHeader = try await ensureCsrfToken()
        }
        return try await perform(method: "POST", path: path, body: body, csrf: csrfHeader)
    }

    private func ensureCsrfToken() async throws -> String {
        if let token = csrfToken { return token }
        struct CsrfResponse: Decodable { let token: String }
        let (data, _) = try await perform(method: "GET", path: "/api/csrf-token")
        let token = try decodeContract(CsrfResponse.self, from: data).token
        csrfToken = token
        return token
    }

    private func perform(
        method: String,
        path: String,
        body: (any Encodable)? = nil,
        bearer: String? = nil,
        csrf: String? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        // 주의: URL.appending(path:) 는 '?' 를 percent-encode 하므로 쿼리 포함 path 는 relative 해석
        guard let url = URL(string: path, relativeTo: config.serverURL) else {
            throw OpenMakeAPIError.invalidResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let bearer {
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        if let csrf {
            request.setValue(csrf, forHTTPHeaderField: "X-CSRF-Token")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try OpenMakeJSON.encoder().encode(body)
        }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw OpenMakeAPIError.invalidResponse
        }
        guard (200..<300).contains(http.statusCode) else {
            let failure = try? decodeContract(Components.Schemas.ApiFailure.self, from: data)
            throw OpenMakeAPIError.server(
                status: http.statusCode,
                code: failure?.error.code,
                message: failure?.error.message)
        }
        return (data, http)
    }

    func decodeContract<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try OpenMakeJSON.decoder().decode(type, from: data)
        } catch {
            throw OpenMakeAPIError.invalidResponse
        }
    }
}
