import Foundation

public struct SessionArtifact: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let version: Int
    public let sessionId: String
    public let messageId: String?
    public let kind: String
    public let title: String
    public let language: String?
    public let content: String
    public let createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id = "artifact_id"
        case version
        case sessionId = "session_id"
        case messageId = "message_id"
        case kind
        case title
        case language
        case content
        case createdAt = "created_at"
    }
}

public extension OpenMakeClient {
    func artifacts(sessionId: String) async throws -> [SessionArtifact] {
        struct Payload: Decodable {
            let artifacts: [SessionArtifact]
        }
        struct Envelope: Decodable {
            let data: Payload
        }
        let path = "/api/sessions/\(sessionId)/artifacts"
        let (data, _) = try await authorizedSend(method: "GET", path: path)
        return try decodeContract(Envelope.self, from: data).data.artifacts
    }
}
