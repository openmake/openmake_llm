// OpenMakeKit — 대화 세션/이력 API (축 3 Step 3)
// 계약 표면: /api/chat/sessions (목록·생성·제목변경·삭제) + /{id}/messages (이력).
// 메시지 영속은 WS 가 수행하므로 여기엔 조회/관리만 있다 (계약 §4 제외 사유 참고).
import Foundation

public extension OpenMakeClient {
    typealias SessionSummary = Components.Schemas.SessionSummary
    typealias ChatMessage = Components.Schemas.ChatMessage

    /// 세션 목록 (limit 기본 50, query 지정 시 제목+본문 검색).
    /// folderId 는 폴더 필터(`unfiledFolderFilter` 면 미분류), tag 는 태그 필터(157).
    func sessions(
        limit: Int? = nil, query: String? = nil, folderId: String? = nil, tag: String? = nil
    ) async throws -> [SessionSummary] {
        var path = "/api/chat/sessions"
        var items: [URLQueryItem] = []
        if let limit { items.append(.init(name: "limit", value: String(limit))) }
        if let query, !query.isEmpty { items.append(.init(name: "q", value: query)) }
        if let folderId, !folderId.isEmpty { items.append(.init(name: "folderId", value: folderId)) }
        if let tag, !tag.isEmpty { items.append(.init(name: "tag", value: tag)) }
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
    typealias ClonedSession = Operations.post_sol_api_sol_chat_sol_sessions_sol__lcub_sessionId_rcub__sol_clone.Output.Created.Body.jsonPayload.dataPayload.sessionPayload

    /// 세션 복제·분기(F08, 2026-09-17) — uptoMessageId 까지만 복사하면 "여기서 분기". 새 세션(id·제목) 반환.
    func cloneSession(id: String, uptoMessageId: Int? = nil, title: String? = nil) async throws -> ClonedSession {
        struct CloneRequest: Encodable {
            let uptoMessageId: Int?
            let title: String?
        }
        let (data, _) = try await authorizedSend(
            method: "POST", path: "/api/chat/sessions/\(id)/clone",
            body: CloneRequest(uptoMessageId: uptoMessageId, title: title))
        let payload = try decodeContract(
            Operations.post_sol_api_sol_chat_sol_sessions_sol__lcub_sessionId_rcub__sol_clone.Output.Created.Body.jsonPayload.self, from: data)
        return payload.data.session
    }

    typealias SessionTree = Operations.get_sol_api_sol_chat_sol_sessions_sol__lcub_sessionId_rcub__sol_tree.Output.Ok.Body.jsonPayload.dataPayload

    /// 세션 트리 — 조상 체인(가까운 부모부터) + 직계 자식
    func sessionTree(id: String) async throws -> SessionTree {
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/chat/sessions/\(id)/tree")
        return try decodeContract(
            Operations.get_sol_api_sol_chat_sol_sessions_sol__lcub_sessionId_rcub__sol_tree.Output.Ok.Body.jsonPayload.self, from: data).data
    }

    // MARK: - 폴더·태그 (F19.5, 157)

    typealias ConversationFolder = Components.Schemas.ConversationFolder

    /// 세션 목록 폴더 필터의 "미분류" 값
    static let unfiledFolderFilter = "none"

    /// 내 폴더 목록 (세션 수 포함, position 순)
    func folders() async throws -> [ConversationFolder] {
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/chat/folders")
        return try decodeContract(
            Operations.get_sol_api_sol_chat_sol_folders.Output.Ok.Body.jsonPayload.self, from: data).data.folders
    }

    /// 폴더 생성 — 같은 이름은 409 FOLDER_NAME_CONFLICT, 상한 초과는 409 FOLDER_LIMIT
    func createFolder(name: String) async throws -> ConversationFolder {
        struct CreateRequest: Encodable { let name: String }
        let (data, _) = try await authorizedSend(
            method: "POST", path: "/api/chat/folders", body: CreateRequest(name: name))
        return try decodeContract(
            Operations.post_sol_api_sol_chat_sol_folders.Output.Created.Body.jsonPayload.self, from: data).data.folder
    }

    /// 세션 정리 — folderId nil 은 미분류로(명시적 null 전송), tags 는 서버가 정규화해 통째로 교체한다
    func organizeSession(id: String, folderId: String?, tags: [String]) async throws {
        struct OrganizeRequest: Encodable {
            let folderId: String?
            let tags: [String]
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                try container.encode(folderId, forKey: .folderId)
                try container.encode(tags, forKey: .tags)
            }
            enum CodingKeys: String, CodingKey { case folderId, tags }
        }
        _ = try await authorizedSend(
            method: "PATCH", path: "/api/chat/sessions/\(id)",
            body: OrganizeRequest(folderId: folderId, tags: tags))
    }
}
