// OpenMakeKit — 모델/에이전트 카탈로그 API (축 3 Step 5)
import Foundation

public struct ModelCatalog: Sendable {
    public let defaultModel: String
    public let models: [Components.Schemas.ModelEntry]
    public let imageModel: String?
}

public extension OpenMakeClient {
    typealias ModelEntry = Components.Schemas.ModelEntry
    typealias UserAgent = Components.Schemas.UserAgent

    /// 사용 가능 모델 목록 (기본 모델이 첫 entry — 계약 규약)
    func modelCatalog() async throws -> ModelCatalog {
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/models")
        let payload = try decodeContract(
            Operations.get_sol_api_sol_models.Output.Ok.Body.jsonPayload.self, from: data)
        return ModelCatalog(
            defaultModel: payload.data.defaultModel,
            models: payload.data.models,
            imageModel: payload.data.imageModel)
    }

    /// 커스텀 에이전트 목록 — 채팅에서 userAgentId 로 지정하면 산업 에이전트 자동 라우팅 우회
    func userAgents() async throws -> [UserAgent] {
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/users/me/agents")
        let payload = try decodeContract(
            Operations.get_sol_api_sol_users_sol_me_sol_agents.Output.Ok.Body.jsonPayload.self,
            from: data)
        return payload.data.agents
    }
}
