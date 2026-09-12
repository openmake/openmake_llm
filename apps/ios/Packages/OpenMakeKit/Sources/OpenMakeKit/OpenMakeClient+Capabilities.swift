// OpenMakeKit — 기능별 모델 배정(capability → 모델) API. 웹 settings/capability-models-section 대응.
//   GET    /api/users/me/capability-models              → { overrides, effective, assignableCapabilities }
//   PUT    /api/users/me/capability-models/:capability  body { model, params? }
//   DELETE /api/users/me/capability-models/:capability
import Foundation

public struct CapabilityOverride: Decodable, Sendable, Equatable {
    public let capability: String
    public let fullId: String
    public let params: [String: String]?
}

public struct CapabilityEffective: Decodable, Sendable, Equatable {
    public let capability: String
    public let fullId: String?
    /// user | global | default
    public let source: String?
    public let error: String?
    public let code: String?
}

public struct CapabilityModels: Sendable, Equatable {
    public let overrides: [CapabilityOverride]
    public let effective: [CapabilityEffective]
    public let assignable: [String]

    public init(overrides: [CapabilityOverride], effective: [CapabilityEffective], assignable: [String]) {
        self.overrides = overrides
        self.effective = effective
        self.assignable = assignable
    }

    public func override(for capability: String) -> CapabilityOverride? {
        overrides.first { $0.capability == capability }
    }

    public func effective(for capability: String) -> CapabilityEffective? {
        effective.first { $0.capability == capability }
    }
}

public extension OpenMakeClient {
    func capabilityModels() async throws -> CapabilityModels {
        struct Payload: Decodable {
            let overrides: [CapabilityOverride]
            let effective: [CapabilityEffective]
            let assignableCapabilities: [String]
        }
        struct Envelope: Decodable { let data: Payload }
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/users/me/capability-models")
        let payload = try decodeContract(Envelope.self, from: data).data
        return CapabilityModels(
            overrides: payload.overrides,
            effective: payload.effective,
            assignable: payload.assignableCapabilities)
    }

    /// 배정 — fullId 는 `<provider>:<model>` (카탈로그 modelId 그대로)
    func assignCapabilityModel(_ capability: String, fullId: String) async throws {
        struct Request: Encodable { let model: String }
        _ = try await authorizedSend(
            method: "PUT",
            path: "/api/users/me/capability-models/\(capability)",
            body: Request(model: fullId))
    }

    /// 배정 해제 — 전역/기본값으로 복귀
    func clearCapabilityModel(_ capability: String) async throws {
        _ = try await authorizedSend(method: "DELETE", path: "/api/users/me/capability-models/\(capability)")
    }
}
