// OpenMakeKit — 대화 세션/이력 API (축 3 Step 3)
// 계약 표면: /api/chat/sessions (목록·생성·제목변경·삭제) + /{id}/messages (이력).
// 메시지 영속은 WS 가 수행하므로 여기엔 조회/관리만 있다 (계약 §4 제외 사유 참고).
import Foundation

public extension OpenMakeClient {
    typealias SessionSummary = Components.Schemas.SessionSummary
    typealias ChatMessage = Components.Schemas.ChatMessage

    /// 세션 목록 (limit 기본 50, query 지정 시 제목+본문 검색)
    func sessions(limit: Int? = nil, query: String? = nil) async throws -> [SessionSummary] {
        var path = "/api/chat/sessions"
        var items: [URLQueryItem] = []
        if let limit { items.append(.init(name: "limit", value: String(limit))) }
        if let query, !query.isEmpty { items.append(.init(name: "q", value: query)) }
        if !items.isEmpty {
            var components = URLComponents()
            components.queryItems = items
            path += components.percentEncodedQuery.map { "?\($0)" } ?? ""
        }
        let (data, _) = try await authorizedSend(method: "GET", path: path)
        let payload = try decodeContract(
            Operations.get_sol_api_sol_chat_sol_sessions.Output.Ok.Body.jsonPayload.self, from: data)
        return payload.data.sessions
    }

    /// 세션 메시지 이력 (limit 기본 100)
    func messages(sessionId: String, limit: Int? = nil) async throws -> [ChatMessage] {
        var path = "/api/chat/sessions/\(sessionId)/messages"
        if let limit { path += "?limit=\(limit)" }
        let (data, _) = try await authorizedSend(method: "GET", path: path)
        let payload = try decodeContract(
            Operations.get_sol_api_sol_chat_sol_sessions_sol__lcub_sessionId_rcub__sol_messages
                .Output.Ok.Body.jsonPayload.self,
            from: data)
        return payload.data.messages
    }

    /// 새 세션 생성 — 생성된 세션 id 반환 (Step 4 채팅 시작용)
    func createSession(title: String? = nil, model: String? = nil) async throws -> String {
        struct CreateRequest: Encodable {
            let title: String?
            let model: String?
        }
        let (data, _) = try await authorizedSend(
            method: "POST", path: "/api/chat/sessions",
            body: CreateRequest(title: title, model: model))
        let payload = try decodeContract(
            Operations.post_sol_api_sol_chat_sol_sessions.Output.Ok.Body.jsonPayload.self, from: data)
        return payload.data.session.id
    }

    /// 세션 제목 변경
    func renameSession(id: String, title: String) async throws {
        struct RenameRequest: Encodable { let title: String }
        _ = try await authorizedSend(
            method: "PATCH", path: "/api/chat/sessions/\(id)",
            body: RenameRequest(title: title))
    }

    /// 세션 삭제
    func deleteSession(id: String) async throws {
        _ = try await authorizedSend(method: "DELETE", path: "/api/chat/sessions/\(id)")
    }
}
