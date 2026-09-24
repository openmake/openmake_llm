// OpenMakeKit — 모델 배정 API(역할·기능을 합친 슬롯 단위). 웹 settings/model-assignments-section 대응.
// 계약 SoT: packages/shared-types/src/model-assignments.ts
//   GET    /api/users/me/model-assignments        → { slots, assignments, effective }
//   PUT    /api/users/me/model-assignments/:slot  body { model, params? }
//   DELETE /api/users/me/model-assignments/:slot
import Foundation

public struct ModelSlotInfo: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    /// agents | quality | multimodal
    public let group: String
    /// text | modality
    public let kind: String
    public let roles: [String]
    public let capabilities: [String]
    public let paramKeys: [String]
    /// false 면 실행 경로가 없거나 소유 add-on 이 꺼져 있다
    public let available: Bool
}

public struct ModelSlotAssignment: Decodable, Sendable, Equatable {
    public let slot: String
    public let fullId: String
}

public struct ModelSlotEffective: Decodable, Sendable, Equatable {
    public let slot: String
    public let fullId: String?
    /// user | global | default | none
    public let source: String?
    public let error: String?
    public let code: String?
}

public struct ModelAssignments: Decodable, Sendable, Equatable {
    public let slots: [ModelSlotInfo]
    public let assignments: [ModelSlotAssignment]
    public let effective: [ModelSlotEffective]

    public init(slots: [ModelSlotInfo], assignments: [ModelSlotAssignment], effective: [ModelSlotEffective]) {
        self.slots = slots
        self.assignments = assignments
        self.effective = effective
    }

    public func assignment(for slot: String) -> ModelSlotAssignment? {
        assignments.first { $0.slot == slot }
    }

    public func effective(for slot: String) -> ModelSlotEffective? {
        effective.first { $0.slot == slot }
    }

    /// 화면 그룹 순서대로 슬롯을 묶는다(그룹 안 순서는 서버 순서 유지)
    public func grouped() -> [(group: String, slots: [ModelSlotInfo])] {
        ModelSlotCatalog.groupOrder.compactMap { g in
            let members = slots.filter { $0.group == g }
            return members.isEmpty ? nil : (g, members)
        }
    }
}

public extension OpenMakeClient {
    func modelAssignments() async throws -> ModelAssignments {
        struct Envelope: Decodable { let data: ModelAssignments }
        let (data, _) = try await authorizedSend(method: "GET", path: "/api/users/me/model-assignments")
        return try decodeContract(Envelope.self, from: data).data
    }

    /// 배정 — fullId 는 `<provider>:<model>` (카탈로그 modelId 그대로)
    func assignModel(slot: String, fullId: String) async throws {
        struct Request: Encodable { let model: String }
        _ = try await authorizedSend(
            method: "PUT",
            path: "/api/users/me/model-assignments/\(slot)",
            body: Request(model: fullId))
    }

    /// 배정 해제 — 전역/기본값으로 복귀
    func clearModelAssignment(slot: String) async throws {
        _ = try await authorizedSend(method: "DELETE", path: "/api/users/me/model-assignments/\(slot)")
    }
}
